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

  // Build query: closures where closed_from_folder_id matches, joined with
  // the conversation row so the UI can render it like a normal list item.
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
    .eq("closed_from_folder_id", folderId)
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

  // Compute the cursor for the next page (oldest closed_at in this batch)
  const nextCursor = validClosures.length === limit
    ? validClosures[validClosures.length - 1]?.closed_at || null
    : null;

  return NextResponse.json({
    closures: validClosures,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
  });
}
