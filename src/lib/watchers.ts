import { createServerClient } from "@/lib/supabase";

/**
 * Auto-watch assignees on a conversation when they're assigned to a task within it.
 *
 * v2 (debugging): rewritten to mirror /api/conversations/watchers POST exactly,
 * one row at a time, no array upsert, no ignoreDuplicates. The previous version
 * silently no-op'd in production — most likely cause was the combination of
 * array upsert + ignoreDuplicates: true. This version is verbose and per-user.
 *
 * Idempotent — upsert on (conversation_id, user_id), same as the manual endpoint.
 * If the user is already watching, this OVERWRITES watch_source and notification
 * prefs back to defaults. That's a small downside vs the manual path (which keeps
 * existing prefs), but task-assignment is a strong signal that the user wants
 * the standard prefs anyway. If users complain, switch to a select-then-insert
 * pattern that skips existing rows entirely.
 *
 * Caveats:
 *   - This is best-effort. Failures are logged but don't break task creation.
 *   - Skips empty user IDs and de-dupes the list.
 *   - Each user gets its own upsert call — slower for tasks with many assignees,
 *     but matches the proven working pattern.
 *
 * Called from:
 *   - POST /api/tasks                 (initial task creation with assignees)
 *   - POST /api/conversations/tasks   (same, via thread tasks tab)
 *   - PATCH /api/tasks                (assignee replacement on existing tasks)
 *   - PATCH /api/conversations/tasks  (same)
 */
export async function autoWatchTaskAssignees(
  conversationId: string,
  userIds: string[],
  watchSource: string = "task_assigned"
): Promise<void> {
  console.log("[autoWatchTaskAssignees] start", { conversationId, userIds, watchSource });

  if (!conversationId) {
    console.log("[autoWatchTaskAssignees] skip: no conversationId");
    return;
  }
  if (!Array.isArray(userIds) || userIds.length === 0) {
    console.log("[autoWatchTaskAssignees] skip: empty userIds");
    return;
  }

  const cleaned = Array.from(
    new Set(
      userIds.filter((id) => typeof id === "string" && id.trim())
    )
  );
  if (cleaned.length === 0) {
    console.log("[autoWatchTaskAssignees] skip: cleaned list empty");
    return;
  }

  const supabase = createServerClient();

  // Default notification preferences for auto-watches — must match the defaults
  // in /api/conversations/watchers POST so behaviour is consistent regardless of
  // how the watch row was created.
  const DEFAULT_PREFS = {
    notify_on_new_message: true,
    notify_on_status_change: true,
    notify_on_assignee_change: true,
    notify_on_label_change: false,
    notify_on_comment: false,
  };

  // Upsert one row at a time, mirroring the proven-working /api/conversations/watchers POST.
  // We deliberately do NOT use the bulk upsert + ignoreDuplicates pattern here;
  // v1 of this helper used that and silently no-op'd in production.
  for (const userId of cleaned) {
    const row = {
      conversation_id: conversationId,
      user_id: userId,
      watch_source: watchSource,
      ...DEFAULT_PREFS,
    };

    const { data, error } = await supabase
      .from("conversation_watchers")
      .upsert(row, { onConflict: "conversation_id,user_id" })
      .select()
      .single();

    if (error) {
      console.error("[autoWatchTaskAssignees] upsert failed", {
        conversationId,
        userId,
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
      });
    } else {
      console.log("[autoWatchTaskAssignees] upsert ok", {
        conversationId,
        userId,
        watch_id: (data as any)?.id,
      });
    }
  }

  console.log("[autoWatchTaskAssignees] done", { conversationId, count: cleaned.length });
}