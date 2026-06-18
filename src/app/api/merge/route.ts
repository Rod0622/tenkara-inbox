export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "inbox" } }
  );
}

// POST /api/merge — Merge conversations
export async function POST(req: NextRequest) {
  const supabase = getSupabase();
  const body = await req.json();
  const { primary_id, merge_ids, actor_id } = body;

  if (!primary_id || !merge_ids || !Array.isArray(merge_ids) || merge_ids.length === 0) {
    return NextResponse.json({ error: "primary_id and merge_ids[] are required" }, { status: 400 });
  }

  // Check for duplicate merges — prevent merging the same thread twice
  const { data: existingMerges } = await supabase
    .from("conversation_merges")
    .select("merged_conversation_id")
    .eq("primary_conversation_id", primary_id)
    .eq("is_active", true);
  const alreadyMergedIds = new Set((existingMerges || []).map((m: any) => m.merged_conversation_id));
  const newMergeIds = merge_ids.filter((id: string) => !alreadyMergedIds.has(id));

  if (newMergeIds.length === 0) {
    return NextResponse.json({ error: "These threads are already merged" }, { status: 400 });
  }

  // Validate all conversations exist and aren't already merged elsewhere.
  // We also pull from_name + from_email so the activity_log entry can
  // include enough context to identify which thread was merged in
  // ("merged X messages from <name> <email>"). Without these the audit
  // trail just says "Threads merged" with no identifying info.
  const allIds = [primary_id, ...newMergeIds];
  const { data: convos } = await supabase
    .from("conversations")
    .select("id, subject, from_name, from_email, email_account_id, merged_into")
    .in("id", allIds);

  if (!convos || convos.length !== allIds.length) {
    return NextResponse.json({ error: "One or more conversations not found" }, { status: 404 });
  }

  const alreadyMergedElsewhere = convos.filter((c: any) => c.merged_into && c.id !== primary_id);
  if (alreadyMergedElsewhere.length > 0) {
    return NextResponse.json({ error: "One or more conversations are already merged into another thread" }, { status: 400 });  }

  // Map convo by id so the activity_log insert per-mergeId has O(1) access
  // to the merged conversation's subject + from_email/from_name.
  const convoById = new Map<string, any>();
  for (const c of convos) convoById.set(c.id, c);

  const results = { merges: 0, moved: { messages: 0, tasks: 0, notes: 0, activities: 0, labels: 0, drafts: 0, response_times: 0, watchers: 0, pins: 0, follow_up_tracking: 0, quo_call_logs: 0, call_follow_ups: 0 } };

  try {
    for (const mergeId of newMergeIds) {
      // Create merge record
      const { data: mergeRecord, error: mergeErr } = await supabase
        .from("conversation_merges")
        .insert({
          primary_conversation_id: primary_id,
          merged_conversation_id: mergeId,
          merged_by: actor_id || null,
        })
        .select("id")
        .single();

      if (mergeErr || !mergeRecord) {
        console.error(`[merge] Failed to create merge record for ${mergeId}:`, mergeErr?.message);
        continue;
      }

      const mid = mergeRecord.id;

      // Fetch all record IDs in parallel
      const [msgsR, tasksR, notesR, activR, labelsR, draftsR, rtsR, watchersR, pinsR, fupTrackR, callLogsR, callFollowUpsR] = await Promise.all([
        supabase.from("messages").select("id").eq("conversation_id", mergeId),
        supabase.from("tasks").select("id").eq("conversation_id", mergeId),
        supabase.from("notes").select("id").eq("conversation_id", mergeId),
        supabase.from("activity_log").select("id").eq("conversation_id", mergeId),
        supabase.from("conversation_labels").select("id, label_id").eq("conversation_id", mergeId),
        supabase.from("email_drafts").select("id").eq("conversation_id", mergeId),
        supabase.from("response_times").select("id").eq("conversation_id", mergeId),
        supabase.from("conversation_watchers").select("conversation_id, user_id").eq("conversation_id", mergeId),
        supabase.from("conversation_pins").select("user_id, conversation_id").eq("conversation_id", mergeId),
        supabase.from("follow_up_tracking").select("id, rule_id").eq("conversation_id", mergeId),
        supabase.from("quo_call_logs").select("id").eq("conversation_id", mergeId),
        supabase.from("call_follow_ups").select("id").eq("conversation_id", mergeId),
      ]);

      const msgs = msgsR.data || [];
      const tasks = tasksR.data || [];
      const notes = notesR.data || [];
      const activ = activR.data || [];
      const labels = labelsR.data || [];
      const drafts = draftsR.data || [];
      const rts = rtsR.data || [];
      const watchers = watchersR.data || [];
      const pins = pinsR.data || [];
      const fupTrack = fupTrackR.data || [];
      const callLogs = callLogsR.data || [];
      const callFollowUps = callFollowUpsR.data || [];

      // Build all tracking records in one batch
      const trackingRecords: any[] = [];
      const mkTrack = (table: string, records: any[]) => {
        for (const r of records) {
          trackingRecords.push({ merge_id: mid, table_name: table, record_id: r.id, original_conversation_id: mergeId, target_conversation_id: primary_id });
        }
      };
      mkTrack("messages", msgs);
      mkTrack("tasks", tasks);
      mkTrack("notes", notes);
      mkTrack("activity_log", activ);
      mkTrack("conversation_labels", labels);
      mkTrack("email_drafts", drafts);
      mkTrack("response_times", rts);
      mkTrack("follow_up_tracking", fupTrack);
      mkTrack("quo_call_logs", callLogs);
      mkTrack("call_follow_ups", callFollowUps);
      // Composite-PK tables — record_id = user_id for these
      for (const w of watchers) {
        trackingRecords.push({ merge_id: mid, table_name: "conversation_watchers", record_id: w.user_id, original_conversation_id: mergeId, target_conversation_id: primary_id });
      }
      for (const p of pins) {
        trackingRecords.push({ merge_id: mid, table_name: "conversation_pins", record_id: p.user_id, original_conversation_id: mergeId, target_conversation_id: primary_id });
      }

      // Insert all tracking records in one call
      if (trackingRecords.length > 0) {
        await supabase.from("merge_moved_records").insert(trackingRecords);
      }

      // Move all records in parallel
      const moveOps: any[] = [];
      if (msgs.length > 0) moveOps.push(supabase.from("messages").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).select().then(r => r));
      if (tasks.length > 0) moveOps.push(supabase.from("tasks").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).select().then(r => r));
      if (notes.length > 0) moveOps.push(supabase.from("notes").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).select().then(r => r));
      if (activ.length > 0) moveOps.push(supabase.from("activity_log").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).select().then(r => r));
      if (drafts.length > 0) moveOps.push(supabase.from("email_drafts").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).select().then(r => r));
      if (rts.length > 0) moveOps.push(supabase.from("response_times").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).select().then(r => r));
      if (callLogs.length > 0) moveOps.push(supabase.from("quo_call_logs").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).select().then(r => r));
      if (callFollowUps.length > 0) moveOps.push(supabase.from("call_follow_ups").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).select().then(r => r));

      // Handle labels: move non-duplicates, delete duplicates
      if (labels.length > 0) {
        const { data: existingLabels } = await supabase.from("conversation_labels").select("label_id").eq("conversation_id", primary_id);
        const existingLabelIds = new Set((existingLabels || []).map((l: any) => l.label_id));
        const toMove = labels.filter((l: any) => !existingLabelIds.has(l.label_id));
        const toDel = labels.filter((l: any) => existingLabelIds.has(l.label_id));
        if (toMove.length > 0) moveOps.push(supabase.from("conversation_labels").update({ conversation_id: primary_id }).in("id", toMove.map((l: any) => l.id)).select().then(r => r));
        if (toDel.length > 0) moveOps.push(supabase.from("conversation_labels").delete().in("id", toDel.map((l: any) => l.id)).select().then(r => r));
      }

      // Watchers: composite PK dedup — if user watches both, drop the duplicate's row
      if (watchers.length > 0) {
        const { data: existingW } = await supabase.from("conversation_watchers").select("user_id").eq("conversation_id", primary_id);
        const existingUserIds = new Set((existingW || []).map((w: any) => w.user_id));
        const toMove = watchers.filter((w: any) => !existingUserIds.has(w.user_id));
        const toDel = watchers.filter((w: any) => existingUserIds.has(w.user_id));
        if (toMove.length > 0) moveOps.push(supabase.from("conversation_watchers").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).in("user_id", toMove.map((w: any) => w.user_id)).select().then(r => r));
        if (toDel.length > 0) moveOps.push(supabase.from("conversation_watchers").delete().eq("conversation_id", mergeId).in("user_id", toDel.map((w: any) => w.user_id)).select().then(r => r));
      }

      // Pins: same dedup
      if (pins.length > 0) {
        const { data: existingP } = await supabase.from("conversation_pins").select("user_id").eq("conversation_id", primary_id);
        const existingPinUserIds = new Set((existingP || []).map((p: any) => p.user_id));
        const toMove = pins.filter((p: any) => !existingPinUserIds.has(p.user_id));
        const toDel = pins.filter((p: any) => existingPinUserIds.has(p.user_id));
        if (toMove.length > 0) moveOps.push(supabase.from("conversation_pins").update({ conversation_id: primary_id }).eq("conversation_id", mergeId).in("user_id", toMove.map((p: any) => p.user_id)).select().then(r => r));
        if (toDel.length > 0) moveOps.push(supabase.from("conversation_pins").delete().eq("conversation_id", mergeId).in("user_id", toDel.map((p: any) => p.user_id)).select().then(r => r));
      }

      // follow_up_tracking dedup on rule_id
      if (fupTrack.length > 0) {
        const { data: existingF } = await supabase.from("follow_up_tracking").select("rule_id").eq("conversation_id", primary_id);
        const existingRuleIds = new Set((existingF || []).map((f: any) => f.rule_id));
        const toMove = fupTrack.filter((f: any) => !existingRuleIds.has(f.rule_id));
        const toDel = fupTrack.filter((f: any) => existingRuleIds.has(f.rule_id));
        if (toMove.length > 0) moveOps.push(supabase.from("follow_up_tracking").update({ conversation_id: primary_id }).in("id", toMove.map((f: any) => f.id)).select().then(r => r));
        if (toDel.length > 0) moveOps.push(supabase.from("follow_up_tracking").delete().in("id", toDel.map((f: any) => f.id)).select().then(r => r));
      }

      // Mark merged conversation — also moves to Archive + clears assignee
      // so the empty shell stops cluttering Inbox/other folders and stops
      // being on anyone's plate. On unmerge, status flips to "open" but
      // folder_id and assignee stay (per design).
      let archiveFolderId: string | null = null;
      try {
        const { data: dupRow } = await supabase
          .from("conversations")
          .select("email_account_id")
          .eq("id", mergeId)
          .maybeSingle();
        if (dupRow?.email_account_id) {
          const { data: archive } = await supabase
            .from("folders")
            .select("id")
            .eq("email_account_id", dupRow.email_account_id)
            .ilike("name", "archive")
            .eq("is_system", true)
            .maybeSingle();
          archiveFolderId = archive?.id || null;
        }
      } catch (e: any) {
        console.error("[merge] Archive folder lookup failed:", e?.message);
      }
      moveOps.push(
        supabase.from("conversations")
          .update({
            merged_into: primary_id,
            status: "merged",
            folder_id: archiveFolderId,
            assignee_id: null,
          })
          .eq("id", mergeId)
          .select()
          .then(r => r)
      );

      await Promise.all(moveOps);

      results.moved.messages += msgs.length;
      results.moved.tasks += tasks.length;
      results.moved.notes += notes.length;
      results.moved.activities += activ.length;
      results.moved.labels += labels.length;
      results.moved.drafts += drafts.length;
      results.moved.response_times += rts.length;
      results.moved.watchers += watchers.length;
      results.moved.pins += pins.length;
      results.moved.follow_up_tracking += fupTrack.length;
      results.moved.quo_call_logs += callLogs.length;
      results.moved.call_follow_ups += callFollowUps.length;

      // Log activity — include enough detail so the audit trail is actually
      // useful. Previously this just recorded the merged_conversation_id
      // which gave the operator no clue WHICH thread was folded in or HOW
      // MUCH was moved. Now we include the subject + sender + per-record
      // counts (messages, tasks, etc.) so a glance at the activity feed
      // tells the full story.
      const mergedConvo = convoById.get(mergeId);
      await supabase.from("activity_log").insert({
        conversation_id: primary_id,
        actor_id: actor_id || null,
        action: "merge",
        details: {
          merged_conversation_id: mergeId,
          merge_record_id: mid,
          merged_subject: mergedConvo?.subject || null,
          merged_from_name: mergedConvo?.from_name || null,
          merged_from_email: mergedConvo?.from_email || null,
          moved: {
            // Per-record counts so the operator sees the scale of the merge.
            // Useful when reviewing whether a merge was correct (a 30-message
            // thread merge is a much bigger deal than a 1-message one).
            messages: msgs.length,
            tasks: tasks.length,
            notes: notes.length,
            activities: activ.length,
            labels: labels.length,
            drafts: drafts.length,
            response_times: rts.length,
            watchers: watchers.length,
            pins: pins.length,
            follow_up_tracking: fupTrack.length,
            quo_call_logs: callLogs.length,
            call_follow_ups: callFollowUps.length,
          },
        },
      });

      results.merges++;
    }

    // Update primary conversation's last_message_at
    const { data: latestMsg } = await supabase
      .from("messages")
      .select("sent_at")
      .eq("conversation_id", primary_id)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestMsg?.sent_at) {
      await supabase.from("conversations").update({ last_message_at: latestMsg.sent_at }).eq("id", primary_id);
    }

    return NextResponse.json({ success: true, ...results });
  } catch (error: any) {
    console.error("[merge] Failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/merge?merge_id=xxx — Unmerge a specific merge
export async function DELETE(req: NextRequest) {
  const supabase = getSupabase();
  const mergeId = req.nextUrl.searchParams.get("merge_id");
  const actorId = req.nextUrl.searchParams.get("actor_id");

  if (!mergeId) {
    return NextResponse.json({ error: "merge_id is required" }, { status: 400 });
  }

  const { data: merge } = await supabase
    .from("conversation_merges")
    .select("*")
    .eq("id", mergeId)
    .eq("is_active", true)
    .single();

  if (!merge) {
    return NextResponse.json({ error: "Merge not found or already unmerged" }, { status: 404 });
  }

  try {
    // Get all moved records grouped by table
    const { data: movedRecords } = await supabase
      .from("merge_moved_records")
      .select("*")
      .eq("merge_id", mergeId);

    // SAFETY GUARD: unmerge can only move records back if the original merge
    // recorded what it moved. Some legacy/system merges (e.g. the buggy
    // sync auto-merge) did NOT write merge_moved_records, so there is nothing
    // to restore — the merged conversation's messages were relocated to the
    // primary with no recoverable origin marker. In that case, silently
    // reporting "success" is itself the bug: it tells the user the unmerge
    // worked when the messages are actually still stranded in the primary.
    // Detect this and return a clear, actionable error instead of a false
    // success, so the user knows a manual split is required.
    if (!movedRecords || movedRecords.length === 0) {
      return NextResponse.json({
        success: false,
        error: "untracked_merge",
        message:
          "This merge has no tracked records, so its messages cannot be " +
          "automatically moved back (it predates record tracking or was a " +
          "system merge). The conversation has been marked unmerged, but its " +
          "messages remain in the primary conversation and must be separated " +
          "manually. Contact an admin to split them.",
        primary_conversation_id: merge.primary_conversation_id,
        merged_conversation_id: merge.merged_conversation_id,
      }, { status: 409 });
    }

    // Group by table for batch updates
    const byTable: Record<string, any[]> = {};
    for (const r of (movedRecords || [])) {
      if (!byTable[r.table_name]) byTable[r.table_name] = [];
      byTable[r.table_name].push(r);
    }

    // Restore records in parallel — batch by table using record IDs
    const restoreOps: any[] = [];
    for (const [table, records] of Object.entries(byTable)) {
      const origConvoId = records[0].original_conversation_id;
      // Composite-PK tables (watchers/pins): we stored user_id in record_id.
      // Restore via (current conversation_id = primary, user_id = X) → set to original.
      if (table === "conversation_watchers" || table === "conversation_pins") {
        const userIds = records.map(r => r.record_id);
        restoreOps.push(
          supabase.from(table)
            .update({ conversation_id: origConvoId })
            .eq("conversation_id", merge.primary_conversation_id)
            .in("user_id", userIds)
            .select()
            .then((r: any) => r)
        );
      } else {
        const ids = records.map(r => r.record_id);
        restoreOps.push(
          supabase.from(table).update({ conversation_id: origConvoId }).in("id", ids).select().then(r => r)
        );
      }
    }
    await Promise.all(restoreOps);

    // Fetch the unmerged conversation's identity so the activity_log entry
    // can include enough context to identify it ("unmerged <subject> from
    // <from_name>"). Without this the audit trail just says "Thread unmerged".
    const { data: unmergedConvo } = await supabase
      .from("conversations")
      .select("subject, from_name, from_email")
      .eq("id", merge.merged_conversation_id)
      .maybeSingle();

    // Restore conversation, mark merge inactive, clean up — in parallel
    await Promise.all([
      supabase.from("conversations").update({ merged_into: null, status: "open" }).eq("id", merge.merged_conversation_id).select().then(r => r),
      supabase.from("conversation_merges").update({ is_active: false, unmerged_at: new Date().toISOString(), unmerged_by: actorId || null }).eq("id", mergeId).select().then(r => r),
      supabase.from("merge_moved_records").delete().eq("merge_id", mergeId).select().then(r => r),
      supabase.from("activity_log").insert({
        conversation_id: merge.primary_conversation_id,
        actor_id: actorId || null,
        action: "unmerge",
        details: {
          unmerged_conversation_id: merge.merged_conversation_id,
          merge_record_id: mergeId,
          unmerged_subject: unmergedConvo?.subject || null,
          unmerged_from_name: unmergedConvo?.from_name || null,
          unmerged_from_email: unmergedConvo?.from_email || null,
        },
      }).select().then(r => r),
    ]);

    // Update primary conversation's last_message_at
    const { data: latestMsg } = await supabase
      .from("messages")
      .select("sent_at")
      .eq("conversation_id", merge.primary_conversation_id)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestMsg?.sent_at) {
      await supabase.from("conversations").update({ last_message_at: latestMsg.sent_at }).eq("id", merge.primary_conversation_id);
    }

    const counts: Record<string, number> = {};
    for (const [table, records] of Object.entries(byTable)) counts[table] = records.length;

    return NextResponse.json({ success: true, restored: counts });
  } catch (error: any) {
    console.error("[unmerge] Failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET /api/merge?conversation_id=xxx — Get merge history for a conversation
export async function GET(req: NextRequest) {
  const supabase = getSupabase();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  const { data: merges } = await supabase
    .from("conversation_merges")
    .select(`
      id, merged_conversation_id, merged_by, merged_at, is_active,
      merged_conversation:conversations!conversation_merges_merged_conversation_id_fkey(id, subject, from_name, from_email, status),
      merged_by_user:team_members!conversation_merges_merged_by_fkey(id, name, initials, color)
    `)
    .eq("primary_conversation_id", conversationId)
    .eq("is_active", true)
    .order("merged_at", { ascending: false });

  return NextResponse.json({ merges: merges || [] });
}