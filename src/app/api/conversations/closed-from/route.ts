import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/conversations/closed-from?folder_id=xxx&limit=50&before=ISO_TIMESTAMP
//
// Returns conversations that were CLOSED FROM the given folder.
// Used by the Closed sub-view in the sidebar — shows conversations that
// were closed via the Close action while they were in this folder, even
// if they've since been moved to another folder.
//
// Pagination via "before" cursor: pass the closed_at of the oldest row
// in the previous page to get the next page (newest-first ordering).
export async function GET(req: NextRequest) {
  const supabase = createServerClient();

  const folderId = req.nextUrl.searchParams.get("folder_id");
  if (!folderId) {
    return NextResponse.json({ error: "folder_id required" }, { status: 400 });
  }

  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") || "50", 10),
    100
  );
  const before = req.nextUrl.searchParams.get("before"); // ISO timestamp

  // Look up the folder's name + account so we can match closures by NAME-equivalence,
  // not just strict UUID equality. This handles cases where:
  //   • The same email account has multiple folders with the same name (e.g. IMAP "INBOX"
  //     vs Microsoft Graph "Inbox") — the Sidebar shows ONE of them but closures may
  //     have been recorded against ANOTHER one with the same name.
  //   • The close API's fallback picked a different "Inbox" UUID than the Sidebar uses.
  //
  // Strategy: find ALL folders for this account that share the clicked folder's name,
  // then query closures whose closed_from_folder_id is in that set.
  const { data: clickedFolder } = await supabase
    .from("folders")
    .select("id, name, email_account_id")
    .eq("id", folderId)
    .maybeSingle();

  // Build the set of folder IDs to match against.
  let folderIdsToMatch: string[] = [folderId];
  if (clickedFolder?.name && clickedFolder?.email_account_id) {
    const { data: siblingFolders } = await supabase
      .from("folders")
      .select("id")
      .eq("email_account_id", clickedFolder.email_account_id)
      .ilike("name", clickedFolder.name);
    if (siblingFolders && siblingFolders.length > 0) {
      folderIdsToMatch = siblingFolders.map((f: any) => f.id);
    }
  }
  console.log("[closed-from] folder_id query param:", folderId, "matched folder IDs:", folderIdsToMatch);

  // Build query: closures where closed_from_folder_id is in our matched set.
  let query = supabase
    .from("conversation_closures")
    .select(`
      id,
      closed_at,
      closed_by_user_id,
      closed_from_folder_id,
      closed_to_folder_id,
      conversation:conversations(
        id,
        email_account_id,
        folder_id,
        thread_id,
        subject,
        from_name,
        from_email,
        preview,
        is_unread,
        is_starred,
        assignee_id,
        status,
        has_attachments,
        last_message_at,
        created_at,
        updated_at,
        supplier_contact_id,
        assignee:team_members!conversations_assignee_id_fkey(*),
        labels:conversation_labels(label_id, label:labels(*))
      ),
      closed_by:team_members!conversation_closures_closed_by_user_id_fkey(id, name, email)
    `)
    .in("closed_from_folder_id", folderIdsToMatch)
    .order("closed_at", { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt("closed_at", before);
  }

  const { data: closures, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Filter out any closures whose conversation has been deleted (conversation: null)
  const validClosures = (closures || []).filter((c: any) => c.conversation);

  // Flatten the closure->conversation join into a list of conversations,
  // each carrying the closure metadata as extra fields. This is what
  // ConversationList expects to render (it's coded for conversation records).
  const flatConversations = validClosures.map((c: any) => ({
    ...c.conversation,
    // Closure footprint metadata (so the UI can show "closed by X on Y" if it wants)
    _closure_id: c.id,
    _closed_at: c.closed_at,
    _closed_by: c.closed_by,
    _closed_from_folder_id: c.closed_from_folder_id,
    _closed_to_folder_id: c.closed_to_folder_id,
  }));

  // Compute the cursor for the next page (oldest closed_at in this batch)
  const nextCursor = validClosures.length === limit
    ? validClosures[validClosures.length - 1]?.closed_at || null
    : null;

  return NextResponse.json({
    conversations: flatConversations,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
  });
}