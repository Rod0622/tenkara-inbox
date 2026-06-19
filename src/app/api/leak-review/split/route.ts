import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { labelManualCreatedConversation } from "@/lib/folder-labels";

/**
 * /api/leak-review/split   (POST)   — split a foreign supplier's messages out
 * /api/leak-review/split   (DELETE) — undo a split by split_id
 *
 * Plus dismiss is handled in /api/leak-review/dismiss.
 *
 * SPLIT (POST):
 *   Body: {
 *     source_conversation_id: string,
 *     message_ids: string[],            // the foreign supplier's messages
 *     destination:
 *        | { type: "new", subject?, from_email?, from_name? }
 *        | { type: "existing", conversation_id: string },
 *     actor_id?: string
 *   }
 *
 *   Moves the given messages out of the source into the destination. Records
 *   the move in conversation_merges + merge_moved_records so it is REVERSIBLE
 *   via the existing unmerge machinery (and via DELETE here). For the "new"
 *   destination, the new conversation is filed into the account's Inbox folder
 *   with account/Inbox labels (NOT an orphan).
 *
 * Safety:
 *   • Only the explicitly-listed message_ids move — nothing else.
 *   • The move is tracked; DELETE restores the messages to the source.
 *   • Refreshes last_message_at on both ends.
 */

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sourceId: string | null = body?.source_conversation_id || null;
  const messageIds: string[] = Array.isArray(body?.message_ids) ? body.message_ids : [];
  const destination: any = body?.destination || null;
  const actorId: string | null = body?.actor_id || null;

  if (!sourceId || messageIds.length === 0 || !destination?.type) {
    return NextResponse.json(
      { error: "source_conversation_id, message_ids[], and destination are required" },
      { status: 400 }
    );
  }

  try {
    // Validate the source conversation + account.
    const { data: source, error: srcErr } = await supabase
      .from("conversations")
      .select("id, email_account_id")
      .eq("id", sourceId)
      .maybeSingle();
    if (srcErr || !source) {
      return NextResponse.json({ error: "source conversation not found" }, { status: 404 });
    }
    const accountId = source.email_account_id;

    // Verify the listed messages actually belong to the source (guard against
    // moving the wrong rows).
    const { data: srcMsgs, error: msgErr } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", sourceId)
      .in("id", messageIds);
    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }
    const validIds = (srcMsgs || []).map((m: any) => m.id);
    if (validIds.length === 0) {
      return NextResponse.json(
        { error: "none of the message_ids belong to the source conversation" },
        { status: 400 }
      );
    }

    // Resolve destination conversation id.
    let destId: string | null = null;
    let createdNew = false;
    const nowIso = new Date().toISOString();

    if (destination.type === "existing") {
      if (!destination.conversation_id) {
        return NextResponse.json(
          { error: "destination.conversation_id required for existing" },
          { status: 400 }
        );
      }
      // Confirm the destination is in the same account (no cross-account moves).
      const { data: dest } = await supabase
        .from("conversations")
        .select("id, email_account_id")
        .eq("id", destination.conversation_id)
        .maybeSingle();
      if (!dest) {
        return NextResponse.json({ error: "destination conversation not found" }, { status: 404 });
      }
      if (dest.email_account_id !== accountId) {
        return NextResponse.json(
          { error: "destination is in a different account" },
          { status: 400 }
        );
      }
      destId = dest.id;
    } else if (destination.type === "new") {
      const { data: nc, error: ncErr } = await supabase
        .from("conversations")
        .insert({
          email_account_id: accountId,
          subject: destination.subject || "Split conversation",
          from_email: destination.from_email || null,
          from_name: destination.from_name || null,
          status: "open",
          last_message_at: nowIso,
        })
        .select("id")
        .single();
      if (ncErr || !nc) {
        return NextResponse.json(
          { error: ncErr?.message || "failed to create destination conversation" },
          { status: 500 }
        );
      }
      destId = nc.id;
      createdNew = true;
    } else {
      return NextResponse.json({ error: "unknown destination.type" }, { status: 400 });
    }

    // Record the split as a reversible merge: treat the SOURCE as the
    // "original" so unmerge restores the messages back to it.
    const { data: mergeRec, error: mergeErr } = await supabase
      .from("conversation_merges")
      .insert({
        primary_conversation_id: destId,
        merged_conversation_id: sourceId,
        merged_by: actorId,
      })
      .select("id")
      .single();
    if (mergeErr || !mergeRec) {
      return NextResponse.json(
        { error: mergeErr?.message || "failed to record split" },
        { status: 500 }
      );
    }
    const splitId = mergeRec.id;

    // Track exactly the messages we move (so undo restores precisely these).
    const tracking = validIds.map((id) => ({
      merge_id: splitId,
      table_name: "messages",
      record_id: id,
      original_conversation_id: sourceId,
      target_conversation_id: destId,
    }));
    await supabase.from("merge_moved_records").insert(tracking);

    // Move the messages.
    const { error: moveErr } = await supabase
      .from("messages")
      .update({ conversation_id: destId })
      .in("id", validIds);
    if (moveErr) {
      return NextResponse.json({ error: moveErr.message }, { status: 500 });
    }

    // Refresh last_message_at on both conversations.
    for (const cid of [sourceId, destId]) {
      const { data: mx } = await supabase
        .from("messages")
        .select("sent_at")
        .eq("conversation_id", cid)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (mx?.sent_at) {
        await supabase.from("conversations").update({ last_message_at: mx.sent_at }).eq("id", cid);
      }
    }

    // For a brand-new destination, file it into the account's Inbox + labels
    // so it's visible (not an orphan). Best-effort.
    if (createdNew && destId) {
      await labelManualCreatedConversation(destId, accountId, true);
    }

    // Activity log on both ends.
    await supabase.from("activity_log").insert([
      {
        conversation_id: sourceId,
        actor_id: actorId,
        action: "leak_split_out",
        details: { moved: validIds.length, to: destId, split_id: splitId },
      },
      {
        conversation_id: destId,
        actor_id: actorId,
        action: "leak_split_in",
        details: { moved: validIds.length, from: sourceId, split_id: splitId },
      },
    ]);

    return NextResponse.json({
      success: true,
      split_id: splitId,
      destination_conversation_id: destId,
      moved: validIds.length,
      created_new: createdNew,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}

/**
 * DELETE /api/leak-review/split?split_id=xxx — undo a split.
 * Restores the tracked messages to the source conversation and removes the
 * split record. If the destination was a newly-created conversation and is
 * now empty, it is deleted.
 */
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const { searchParams } = new URL(req.url);
  const splitId = searchParams.get("split_id");
  if (!splitId) {
    return NextResponse.json({ error: "split_id is required" }, { status: 400 });
  }

  try {
    const { data: rec, error: recErr } = await supabase
      .from("conversation_merges")
      .select("id, primary_conversation_id, merged_conversation_id")
      .eq("id", splitId)
      .maybeSingle();
    if (recErr || !rec) {
      return NextResponse.json({ error: "split not found" }, { status: 404 });
    }
    const sourceId = rec.merged_conversation_id; // original
    const destId = rec.primary_conversation_id;

    const { data: moved } = await supabase
      .from("merge_moved_records")
      .select("record_id, table_name")
      .eq("merge_id", splitId)
      .eq("table_name", "messages");

    const ids = (moved || []).map((m: any) => m.record_id);
    if (ids.length > 0) {
      await supabase.from("messages").update({ conversation_id: sourceId }).in("id", ids);
    }

    // Clean up tracking + merge record.
    await supabase.from("merge_moved_records").delete().eq("merge_id", splitId);
    await supabase.from("conversation_merges").delete().eq("id", splitId);

    // Refresh last_message_at on source.
    const { data: mx } = await supabase
      .from("messages")
      .select("sent_at")
      .eq("conversation_id", sourceId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (mx?.sent_at) {
      await supabase.from("conversations").update({ last_message_at: mx.sent_at }).eq("id", sourceId);
    }

    // If destination is now empty, delete it (it was a split target).
    const { count } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", destId);
    if ((count || 0) === 0) {
      await supabase.from("conversations").delete().eq("id", destId);
    }

    return NextResponse.json({ success: true, restored: ids.length, source_conversation_id: sourceId });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
