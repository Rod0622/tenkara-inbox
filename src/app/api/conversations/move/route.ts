import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { runRulesForEvent } from "@/lib/rule-engine";

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

  // Capture previous folder_ids per conversation BEFORE update so we can fire team_changed events
  const { data: previousRows } = await supabase
    .from("conversations")
    .select("id, folder_id")
    .in("id", ids);
  const previousFolderById = new Map<string, string | null>();
  for (const row of (previousRows || [])) {
    previousFolderById.set(row.id, row.folder_id || null);
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
  let newFolderName: string | null = null;
  if (folder_id) {
    const { data: folder } = await supabase
      .from("folders")
      .select("name")
      .eq("id", folder_id)
      .single();
    folderName = folder?.name || folder_id;
    newFolderName = folder?.name || null;
  }

  // Log activity
  const logEntries = ids.map((id: string) => ({
    conversation_id: id,
    actor_id: actor_id || null,
    action: "moved_to_folder",
    details: { folder_id, folder_name: folderName },
  }));

  await supabase.from("activity_log").insert(logEntries);

  // Fire team_changed rule events — one per conversation that actually changed folders
  // Build a small cache of folder names so we don't re-query the same one
  const folderNameCache = new Map<string, string | null>();
  if (folder_id && newFolderName) folderNameCache.set(folder_id, newFolderName);

  // Pre-fetch any old folder names we need
  const oldFolderIds = Array.from(new Set(
    Array.from(previousFolderById.values()).filter((v): v is string => !!v)
  ));
  if (oldFolderIds.length > 0) {
    const { data: oldFolders } = await supabase
      .from("folders")
      .select("id, name")
      .in("id", oldFolderIds);
    for (const f of (oldFolders || [])) folderNameCache.set(f.id, f.name);
  }

  const newFolderId = folder_id || null;
  for (const id of ids) {
    const oldFolderId = previousFolderById.get(id) ?? null;
    if (oldFolderId === newFolderId) continue; // no actual change for this conversation
    try {
      await runRulesForEvent({
        event_type: "team_changed",
        conversation_id: id,
        initiator_user_id: actor_id || null,
        event_key: `team_changed:${id}:${oldFolderId || "null"}:${newFolderId || "null"}:${Date.now()}`,
        new_team_id: newFolderId,
        old_team_id: oldFolderId,
        new_team_name: newFolderId ? (folderNameCache.get(newFolderId) || null) : null,
        old_team_name: oldFolderId ? (folderNameCache.get(oldFolderId) || null) : null,
      });
    } catch (ruleErr: any) {
      console.error("[move/PATCH] rule processing error for", id, ":", ruleErr?.message || ruleErr);
    }
  }

  return NextResponse.json({ success: true, count: ids.length });
}