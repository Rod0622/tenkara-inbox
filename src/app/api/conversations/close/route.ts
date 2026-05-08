import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { swapFolderLabel } from "@/lib/folder-labels";

// POST /api/conversations/close
//
// Close a conversation. Per spec:
//   • Only the current assignee can close (caller must verify before invoking,
//     but we double-check server-side as a safety net).
//   • The conversation moves to the chosen target folder (label swap).
//   • assignee_id is cleared (back to team triage).
//   • status is set to "closed".
//   • A row is inserted into conversation_closures recording who closed it,
//     from which folder, to which folder, and when.
//   • If a note is provided, it is added to the conversation.
//
// Body:
//   conversation_id: UUID (required)
//   target_folder_id: UUID (required) — must belong to the same email account
//   actor_id: UUID (required) — the user closing it
//   note: string (optional)
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_id, target_folder_id, actor_id, note } = body || {};

  if (!conversation_id || !target_folder_id || !actor_id) {
    return NextResponse.json(
      { error: "conversation_id, target_folder_id, and actor_id are required" },
      { status: 400 }
    );
  }

  // Fetch conversation to capture its current state + verify access
  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("id, email_account_id, folder_id, assignee_id, status")
    .eq("id", conversation_id)
    .maybeSingle();

  if (convoErr || !convo) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Safety check: only the current assignee can close.
  if (convo.assignee_id !== actor_id) {
    return NextResponse.json(
      { error: "Only the assigned user can close this conversation" },
      { status: 403 }
    );
  }

  // Safety check: target folder must belong to the same email account
  const { data: targetFolder } = await supabase
    .from("folders")
    .select("id, email_account_id, name")
    .eq("id", target_folder_id)
    .maybeSingle();

  if (!targetFolder || targetFolder.email_account_id !== convo.email_account_id) {
    return NextResponse.json(
      { error: "Target folder must belong to the same email account" },
      { status: 400 }
    );
  }

  const previousFolderId: string | null = convo.folder_id || null;

  // Apply the close: move folder + unassign + status=closed
  const { error: updateErr } = await supabase
    .from("conversations")
    .update({
      folder_id: target_folder_id,
      assignee_id: null,
      status: "closed",
    })
    .eq("id", conversation_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Swap the folder label (best-effort)
  try {
    await swapFolderLabel(conversation_id, previousFolderId, target_folder_id);
  } catch (e: any) {
    console.error("[close] swapFolderLabel failed:", e?.message || e);
  }

  // Record the closure footprint
  const { error: closureErr } = await supabase
    .from("conversation_closures")
    .insert({
      conversation_id,
      closed_by_user_id: actor_id,
      closed_from_folder_id: previousFolderId,
      closed_to_folder_id: target_folder_id,
      // closed_at defaults to NOW() at the database level
    });

  if (closureErr) {
    console.error("[close] failed to write closure footprint:", closureErr.message);
    // Don't fail the request — the close itself succeeded.
  }

  // Add a note if provided
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
    details: {
      from_folder_id: previousFolderId,
      to_folder_id: target_folder_id,
      to_folder_name: targetFolder.name,
    },
  });

  return NextResponse.json({
    success: true,
    closed_to_folder: targetFolder.name,
  });
}
