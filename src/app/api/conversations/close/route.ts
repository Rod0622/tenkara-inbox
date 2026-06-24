import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { runRulesForEvent } from "@/lib/rule-engine";
import { notifyWatchers } from "@/lib/notifications";

// POST /api/conversations/close
//
// Close a conversation (NEW terminal model).
//
//   • Sets status = "closed". This is the durable close state — the per-folder
//     "Closed" sub-view filters on status === "closed" (no more
//     conversation_closures footprints, no redundant copies).
//   • KEEPS the assignee (no longer unassigned on close).
//   • KEEPS the folder label / folder_id (the durable record of which folder
//     the conversation belongs to — e.g. Vita Organica → Inbox — so it shows
//     in that folder's Closed sub-view).
//   • Does NOT auto-reopen and does NOT move to a chosen target folder.
//
// Once closed, the conversation drops out of the assignee's personal inbox
// (personal inbox = assigned AND open) and appears in its folder's Closed
// sub-view. A supplier reply reopens it (see onIncomingMessageReopenCheck).
//
// Body:
//   conversation_id: UUID (required)
//   actor_id: UUID (required) — the user closing it
//   note: string (optional) — added as a conversation note
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_id, actor_id, note } = body || {};

  if (!conversation_id || !actor_id) {
    return NextResponse.json(
      { error: "conversation_id and actor_id are required" },
      { status: 400 }
    );
  }

  // Fetch conversation to capture current state + verify access
  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("id, email_account_id, folder_id, assignee_id, status")
    .eq("id", conversation_id)
    .maybeSingle();

  if (convoErr || !convo) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Permission: the assignee can close their own conversation; admins can
  // close any conversation.
  if (convo.assignee_id !== actor_id) {
    const { data: actor } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", actor_id)
      .maybeSingle();
    const isAdmin = actor?.role === "admin";
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Only the assigned user or an admin can close this conversation" },
        { status: 403 }
      );
    }
  }

  if (convo.status === "closed") {
    // Already closed — no-op success.
    return NextResponse.json({ success: true, already_closed: true });
  }

  // Apply the close: status only. Assignee and folder/label are preserved.
  const { error: updateErr } = await supabase
    .from("conversations")
    .update({ status: "closed" })
    .eq("id", conversation_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Optional note
  if (note && typeof note === "string" && note.trim()) {
    await supabase.from("notes").insert({
      conversation_id,
      author_id: actor_id,
      title: "Closed",
      text: note.trim(),
    }).then(({ error }) => {
      if (error) console.error("[close] failed to insert note:", error.message);
    });
  }

  // Activity log
  await supabase.from("activity_log").insert({
    conversation_id,
    actor_id,
    action: "closed",
    details: {},
  });

  // Notify watchers (best-effort)
  try {
    await notifyWatchers(conversation_id, "status_change", {
      title: "Conversation closed",
      actorId: actor_id || null,
    });
  } catch (_e) { /* best-effort */ }

  // Fire conversation_closed rule event (best-effort)
  try {
    await runRulesForEvent({
      event_type: "conversation_closed",
      conversation_id,
      initiator_user_id: actor_id || null,
      event_key: `conversation_closed:${conversation_id}:${Date.now()}`,
      new_status: "closed",
      old_status: convo.status || "open",
    });
  } catch (ruleErr: any) {
    console.error("[close] conversation_closed rule error:", ruleErr?.message || ruleErr);
  }

  return NextResponse.json({ success: true });
}