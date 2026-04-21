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

  // Validate all conversations exist
  const allIds = [primary_id, ...merge_ids];
  const { data: convos } = await supabase
    .from("conversations")
    .select("id, subject, email_account_id, merged_into")
    .in("id", allIds);

  if (!convos || convos.length !== allIds.length) {
    return NextResponse.json({ error: "One or more conversations not found" }, { status: 404 });
  }

  // Check none are already merged
  const alreadyMerged = convos.filter((c: any) => c.merged_into);
  if (alreadyMerged.length > 0) {
    return NextResponse.json({ error: "One or more conversations are already merged into another thread" }, { status: 400 });
  }

  const results = { merges: 0, moved: { messages: 0, tasks: 0, notes: 0, activities: 0, labels: 0, drafts: 0, response_times: 0 } };

  try {
    for (const mergeId of merge_ids) {
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

      const merge_id_ref = mergeRecord.id;

      // Move messages
      const { data: msgs } = await supabase.from("messages").select("id").eq("conversation_id", mergeId);
      if (msgs && msgs.length > 0) {
        await supabase.from("merge_moved_records").insert(
          msgs.map((m: any) => ({ merge_id: merge_id_ref, table_name: "messages", record_id: m.id, original_conversation_id: mergeId, target_conversation_id: primary_id }))
        );
        await supabase.from("messages").update({ conversation_id: primary_id }).eq("conversation_id", mergeId);
        results.moved.messages += msgs.length;
      }

      // Move tasks
      const { data: tasks } = await supabase.from("tasks").select("id").eq("conversation_id", mergeId);
      if (tasks && tasks.length > 0) {
        await supabase.from("merge_moved_records").insert(
          tasks.map((t: any) => ({ merge_id: merge_id_ref, table_name: "tasks", record_id: t.id, original_conversation_id: mergeId, target_conversation_id: primary_id }))
        );
        await supabase.from("tasks").update({ conversation_id: primary_id }).eq("conversation_id", mergeId);
        results.moved.tasks += tasks.length;
      }

      // Move notes
      const { data: notes } = await supabase.from("notes").select("id").eq("conversation_id", mergeId);
      if (notes && notes.length > 0) {
        await supabase.from("merge_moved_records").insert(
          notes.map((n: any) => ({ merge_id: merge_id_ref, table_name: "notes", record_id: n.id, original_conversation_id: mergeId, target_conversation_id: primary_id }))
        );
        await supabase.from("notes").update({ conversation_id: primary_id }).eq("conversation_id", mergeId);
        results.moved.notes += notes.length;
      }

      // Move activity_log
      const { data: activities } = await supabase.from("activity_log").select("id").eq("conversation_id", mergeId);
      if (activities && activities.length > 0) {
        await supabase.from("merge_moved_records").insert(
          activities.map((a: any) => ({ merge_id: merge_id_ref, table_name: "activity_log", record_id: a.id, original_conversation_id: mergeId, target_conversation_id: primary_id }))
        );
        await supabase.from("activity_log").update({ conversation_id: primary_id }).eq("conversation_id", mergeId);
        results.moved.activities += activities.length;
      }

      // Move conversation_labels (avoid duplicates)
      const { data: labels } = await supabase.from("conversation_labels").select("id, label_id").eq("conversation_id", mergeId);
      const { data: existingLabels } = await supabase.from("conversation_labels").select("label_id").eq("conversation_id", primary_id);
      const existingLabelIds = new Set((existingLabels || []).map((l: any) => l.label_id));
      if (labels && labels.length > 0) {
        await supabase.from("merge_moved_records").insert(
          labels.map((l: any) => ({ merge_id: merge_id_ref, table_name: "conversation_labels", record_id: l.id, original_conversation_id: mergeId, target_conversation_id: primary_id }))
        );
        // Only move non-duplicate labels
        for (const label of labels) {
          if (!existingLabelIds.has(label.label_id)) {
            await supabase.from("conversation_labels").update({ conversation_id: primary_id }).eq("id", label.id);
          } else {
            await supabase.from("conversation_labels").delete().eq("id", label.id);
          }
        }
        results.moved.labels += labels.length;
      }

      // Move email_drafts
      const { data: drafts } = await supabase.from("email_drafts").select("id").eq("conversation_id", mergeId);
      if (drafts && drafts.length > 0) {
        await supabase.from("merge_moved_records").insert(
          drafts.map((d: any) => ({ merge_id: merge_id_ref, table_name: "email_drafts", record_id: d.id, original_conversation_id: mergeId, target_conversation_id: primary_id }))
        );
        await supabase.from("email_drafts").update({ conversation_id: primary_id }).eq("conversation_id", mergeId);
        results.moved.drafts += drafts.length;
      }

      // Move response_times
      const { data: rts } = await supabase.from("response_times").select("id").eq("conversation_id", mergeId);
      if (rts && rts.length > 0) {
        await supabase.from("merge_moved_records").insert(
          rts.map((r: any) => ({ merge_id: merge_id_ref, table_name: "response_times", record_id: r.id, original_conversation_id: mergeId, target_conversation_id: primary_id }))
        );
        await supabase.from("response_times").update({ conversation_id: primary_id }).eq("conversation_id", mergeId);
        results.moved.response_times += rts.length;
      }

      // Mark merged conversation
      await supabase.from("conversations").update({
        merged_into: primary_id,
        status: "merged",
      }).eq("id", mergeId);

      // Log activity
      await supabase.from("activity_log").insert({
        conversation_id: primary_id,
        actor_id: actor_id || null,
        action: "merge",
        details: { merged_conversation_id: mergeId, merge_record_id: merge_id_ref },
      });

      results.merges++;
    }

    // Update primary conversation's last_message_at to the most recent message
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

  // Get merge record
  const { data: merge } = await supabase
    .from("conversation_merges")
    .select("*")
    .eq("id", mergeId)
    .eq("is_active", true)
    .single();

  if (!merge) {
    return NextResponse.json({ error: "Merge not found or already unmerged" }, { status: 404 });
  }

  const results = { restored: { messages: 0, tasks: 0, notes: 0, activities: 0, labels: 0, drafts: 0, response_times: 0 } };

  try {
    // Get all moved records for this merge
    const { data: movedRecords } = await supabase
      .from("merge_moved_records")
      .select("*")
      .eq("merge_id", mergeId);

    // Restore each record to its original conversation
    for (const record of (movedRecords || [])) {
      const table = record.table_name;
      const key = table === "conversation_labels" ? "id" : "id";

      await supabase
        .from(table)
        .update({ conversation_id: record.original_conversation_id })
        .eq(key, record.record_id);

      const category = table as keyof typeof results.restored;
      if (results.restored[category] !== undefined) {
        results.restored[category]++;
      }
    }

    // Restore the merged conversation
    await supabase.from("conversations").update({
      merged_into: null,
      status: "open",
    }).eq("id", merge.merged_conversation_id);

    // Mark merge as inactive
    await supabase.from("conversation_merges").update({
      is_active: false,
      unmerged_at: new Date().toISOString(),
      unmerged_by: actorId || null,
    }).eq("id", mergeId);

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

    // Log activity
    await supabase.from("activity_log").insert({
      conversation_id: merge.primary_conversation_id,
      actor_id: actorId || null,
      action: "unmerge",
      details: { unmerged_conversation_id: merge.merged_conversation_id, merge_record_id: mergeId },
    });

    // Delete moved records tracking
    await supabase.from("merge_moved_records").delete().eq("merge_id", mergeId);

    return NextResponse.json({ success: true, ...results });
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

  // Get active merges where this conversation is the primary
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
