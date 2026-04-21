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

  // Validate all conversations exist and aren't already merged elsewhere
  const allIds = [primary_id, ...newMergeIds];
  const { data: convos } = await supabase
    .from("conversations")
    .select("id, subject, email_account_id, merged_into")
    .in("id", allIds);

  if (!convos || convos.length !== allIds.length) {
    return NextResponse.json({ error: "One or more conversations not found" }, { status: 404 });
  }

  const alreadyMergedElsewhere = convos.filter((c: any) => c.merged_into && c.id !== primary_id);
  if (alreadyMergedElsewhere.length > 0) {
    return NextResponse.json({ error: "One or more conversations are already merged into another thread" }, { status: 400 });
  }

  const results = { merges: 0, moved: { messages: 0, tasks: 0, notes: 0, activities: 0, labels: 0, drafts: 0, response_times: 0 } };

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
      const [msgsR, tasksR, notesR, activR, labelsR, draftsR, rtsR] = await Promise.all([
        supabase.from("messages").select("id").eq("conversation_id", mergeId),
        supabase.from("tasks").select("id").eq("conversation_id", mergeId),
        supabase.from("notes").select("id").eq("conversation_id", mergeId),
        supabase.from("activity_log").select("id").eq("conversation_id", mergeId),
        supabase.from("conversation_labels").select("id, label_id").eq("conversation_id", mergeId),
        supabase.from("email_drafts").select("id").eq("conversation_id", mergeId),
        supabase.from("response_times").select("id").eq("conversation_id", mergeId),
      ]);

      const msgs = msgsR.data || [];
      const tasks = tasksR.data || [];
      const notes = notesR.data || [];
      const activ = activR.data || [];
      const labels = labelsR.data || [];
      const drafts = draftsR.data || [];
      const rts = rtsR.data || [];

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

      // Insert all tracking records in one call
      if (trackingRecords.length > 0) {
        await supabase.from("merge_moved_records").insert(trackingRecords);
      }

      // Move all records in parallel
      const moveOps: Promise<any>[] = [];
      if (msgs.length > 0) moveOps.push(supabase.from("messages").update({ conversation_id: primary_id }).eq("conversation_id", mergeId));
      if (tasks.length > 0) moveOps.push(supabase.from("tasks").update({ conversation_id: primary_id }).eq("conversation_id", mergeId));
      if (notes.length > 0) moveOps.push(supabase.from("notes").update({ conversation_id: primary_id }).eq("conversation_id", mergeId));
      if (activ.length > 0) moveOps.push(supabase.from("activity_log").update({ conversation_id: primary_id }).eq("conversation_id", mergeId));
      if (drafts.length > 0) moveOps.push(supabase.from("email_drafts").update({ conversation_id: primary_id }).eq("conversation_id", mergeId));
      if (rts.length > 0) moveOps.push(supabase.from("response_times").update({ conversation_id: primary_id }).eq("conversation_id", mergeId));

      // Handle labels: move non-duplicates, delete duplicates
      if (labels.length > 0) {
        const { data: existingLabels } = await supabase.from("conversation_labels").select("label_id").eq("conversation_id", primary_id);
        const existingLabelIds = new Set((existingLabels || []).map((l: any) => l.label_id));
        const toMove = labels.filter((l: any) => !existingLabelIds.has(l.label_id));
        const toDel = labels.filter((l: any) => existingLabelIds.has(l.label_id));
        if (toMove.length > 0) moveOps.push(supabase.from("conversation_labels").update({ conversation_id: primary_id }).in("id", toMove.map((l: any) => l.id)));
        if (toDel.length > 0) moveOps.push(supabase.from("conversation_labels").delete().in("id", toDel.map((l: any) => l.id)));
      }

      // Mark merged conversation
      moveOps.push(supabase.from("conversations").update({ merged_into: primary_id, status: "merged" }).eq("id", mergeId));

      await Promise.all(moveOps);

      results.moved.messages += msgs.length;
      results.moved.tasks += tasks.length;
      results.moved.notes += notes.length;
      results.moved.activities += activ.length;
      results.moved.labels += labels.length;
      results.moved.drafts += drafts.length;
      results.moved.response_times += rts.length;

      // Log activity
      await supabase.from("activity_log").insert({
        conversation_id: primary_id,
        actor_id: actor_id || null,
        action: "merge",
        details: { merged_conversation_id: mergeId, merge_record_id: mid },
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

    // Group by table for batch updates
    const byTable: Record<string, any[]> = {};
    for (const r of (movedRecords || [])) {
      if (!byTable[r.table_name]) byTable[r.table_name] = [];
      byTable[r.table_name].push(r);
    }

    // Restore records in parallel — batch by table using record IDs
    const restoreOps: Promise<any>[] = [];
    for (const [table, records] of Object.entries(byTable)) {
      const ids = records.map(r => r.record_id);
      const origConvoId = records[0].original_conversation_id;
      restoreOps.push(
        supabase.from(table).update({ conversation_id: origConvoId }).in("id", ids)
      );
    }
    await Promise.all(restoreOps);

    // Restore conversation, mark merge inactive, clean up — in parallel
    await Promise.all([
      supabase.from("conversations").update({ merged_into: null, status: "open" }).eq("id", merge.merged_conversation_id),
      supabase.from("conversation_merges").update({ is_active: false, unmerged_at: new Date().toISOString(), unmerged_by: actorId || null }).eq("id", mergeId),
      supabase.from("merge_moved_records").delete().eq("merge_id", mergeId),
      supabase.from("activity_log").insert({ conversation_id: merge.primary_conversation_id, actor_id: actorId || null, action: "unmerge", details: { unmerged_conversation_id: merge.merged_conversation_id, merge_record_id: mergeId } }),
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