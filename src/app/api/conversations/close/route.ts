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

  let previousFolderId: string | null = convo.folder_id || null;
  console.log("[close] convo.folder_id:", convo.folder_id, "target_folder_id:", target_folder_id, "account:", convo.email_account_id);

  // PHASE 1 FALLBACK: if the conversation has no folder_id, look for an Inbox folder
  // by name (case-insensitive). Logs what it finds for diagnostics.
  if (!previousFolderId) {
    const { data: inboxFolder } = await supabase
      .from("folders")
      .select("id, name, is_system, created_at")
      .eq("email_account_id", convo.email_account_id)
      .ilike("name", "Inbox")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (inboxFolder?.id) {
      previousFolderId = inboxFolder.id;
      console.log("[close] phase1 fallback: matched 'Inbox' folder:", inboxFolder.name, inboxFolder.id);
    } else {
      console.log("[close] phase1 fallback: no folder named 'Inbox' for account", convo.email_account_id);
    }
  }

  // Apply the close: move folder + unassign user.
  // NOTE: Per spec change, status stays as-is (typically "open"). The conversation
  // does NOT become "closed" — closure is recorded in conversation_closures only.
  // This way, the conversation reappears in the destination folder's
  // unassigned-open view (the team triage view at the next stage).
  const { error: updateErr } = await supabase
    .from("conversations")
    .update({
      folder_id: target_folder_id,
      assignee_id: null,
    })
    .eq("id", conversation_id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Unassign the caller too: clear assignees from any open call-category tasks
  // on this conversation. Caller is modeled as the assignee of a task whose
  // category name contains "call".
  try {
    const { data: callCategory } = await supabase
      .from("task_categories")
      .select("id")
      .ilike("name", "%call%")
      .limit(1)
      .maybeSingle();

    if (callCategory?.id) {
      // Find tasks on this conversation that are call-category and not done
      const { data: callTasks } = await supabase
        .from("tasks")
        .select("id, status")
        .eq("conversation_id", conversation_id)
        .eq("category_id", callCategory.id);

      const openCallTaskIds = (callTasks || [])
        .filter((t: any) => t.status !== "completed" && t.status !== "dismissed")
        .map((t: any) => t.id);

      if (openCallTaskIds.length > 0) {
        await supabase
          .from("task_assignees")
          .delete()
          .in("task_id", openCallTaskIds);
      }
    }
  } catch (e: any) {
    console.error("[close] caller unassign failed:", e?.message || e);
    // Non-fatal — keep going
  }

  // Swap the folder label (best-effort)
  try {
    await swapFolderLabel(conversation_id, previousFolderId, target_folder_id);
  } catch (e: any) {
    console.error("[close] swapFolderLabel failed:", e?.message || e);
  }

  // PHASE 2 FALLBACK: still no previousFolderId? Try harder. We rank candidates:
  // 1. Any folder named "Inbox" (case-insensitive) — best match for "where the conversation came from"
  // 2. Otherwise: earliest-created folder for this account that isn't the target.
  //
  // This guarantees the closure footprint always points to a real folder so the
  // Closed sub-view can find it.
  if (!previousFolderId) {
    // Try Inbox-by-name one more time (in case phase 1 was skipped due to convo.folder_id being a value that already pointed to Test).
    const { data: inboxFolder } = await supabase
      .from("folders")
      .select("id, name")
      .eq("email_account_id", convo.email_account_id)
      .ilike("name", "Inbox")
      .neq("id", target_folder_id)
      .limit(1)
      .maybeSingle();
    if (inboxFolder?.id) {
      previousFolderId = inboxFolder.id;
      console.log("[close] phase2 fallback: matched 'Inbox' folder:", inboxFolder.name, inboxFolder.id);
    } else {
      // Last resort: ANY folder for this account, NOT named spam/trash/sent/drafts (avoid wrong defaults).
      const { data: anyFolder } = await supabase
        .from("folders")
        .select("id, name")
        .eq("email_account_id", convo.email_account_id)
        .neq("id", target_folder_id)
        .not("name", "ilike", "spam")
        .not("name", "ilike", "trash")
        .not("name", "ilike", "sent")
        .not("name", "ilike", "drafts")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (anyFolder?.id) {
        previousFolderId = anyFolder.id;
        console.log("[close] phase2 fallback: earliest non-special folder:", anyFolder.name, anyFolder.id);
      } else {
        console.error("[close] could NOT find any source folder. account:", convo.email_account_id);
      }
    }
  }
  console.log("[close] writing closure with closed_from_folder_id:", previousFolderId, "closed_to_folder_id:", target_folder_id);

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