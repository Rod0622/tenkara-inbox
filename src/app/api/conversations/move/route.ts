import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// PATCH /api/conversations/move — move conversation(s) to a folder
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_ids, folder_id, actor_id } = body;

  // Accept single id or array
  const ids = Array.isArray(conversation_ids)
    ? conversation_ids
    : conversation_ids
    ? [conversation_ids]
    : [];

  if (ids.length === 0) {
    return NextResponse.json({ error: "conversation_ids required" }, { status: 400 });
  }

  // folder_id can be null (move to root / unassign from folder)
  const update: any = { folder_id: folder_id || null };

  // If moving to a folder, also clear assignee (back to team space)
  // Unless folder_id is null (which means unassigning from folder)
  if (folder_id) {
    update.assignee_id = null;
  }

  const { error } = await supabase
    .from("conversations")
    .update(update)
    .in("id", ids);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Get folder name for activity log
  let folderName = "root";
  if (folder_id) {
    const { data: folder } = await supabase
      .from("folders")
      .select("name")
      .eq("id", folder_id)
      .single();
    folderName = folder?.name || folder_id;
  }

  // Log activity
  const logEntries = ids.map((id: string) => ({
    conversation_id: id,
    actor_id: actor_id || null,
    action: "moved_to_folder",
    details: { folder_id, folder_name: folderName },
  }));

  await supabase.from("activity_log").insert(logEntries);

  return NextResponse.json({ success: true, count: ids.length });
}