import { createServerClient } from "@/lib/supabase";

/**
 * Auto-watch assignees on a conversation when they're assigned to a task within it.
 *
 * Idempotent — upserts on (conversation_id, user_id), mirroring the manual
 * /api/conversations/watchers POST endpoint exactly. If the user is already
 * watching, this OVERWRITES watch_source and notification prefs back to
 * defaults. For the task-assignment trigger that's acceptable; if users start
 * complaining their custom prefs get reset, switch to a select-then-insert
 * pattern that skips existing rows entirely.
 *
 * Caveats:
 *   - Best-effort. Failures log to the server console but don't break task
 *     creation, which is the user-facing operation.
 *   - Skips empty user IDs and de-dupes the list.
 *   - Per-user loop, not a bulk upsert. An earlier array + ignoreDuplicates
 *     version silently no-op'd in production, so this matches the proven
 *     single-row pattern.
 *
 * Required: the `watch_source` value must be in the CHECK constraint on
 * `inbox.conversation_watchers.watch_source`. Currently allowed:
 *   'manual', 'rule', 'auto', 'task_assigned'.
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
  if (!conversationId) return;
  if (!Array.isArray(userIds) || userIds.length === 0) return;

  const cleaned = Array.from(
    new Set(userIds.filter((id) => typeof id === "string" && id.trim()))
  );
  if (cleaned.length === 0) return;

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

  for (const userId of cleaned) {
    const row = {
      conversation_id: conversationId,
      user_id: userId,
      watch_source: watchSource,
      ...DEFAULT_PREFS,
    };

    const { error } = await supabase
      .from("conversation_watchers")
      .upsert(row, { onConflict: "conversation_id,user_id" })
      .select()
      .single();

    if (error) {
      // Best-effort: log and move on. We don't want a watcher-table issue to
      // break task creation, which is the user-facing operation.
      console.error("[autoWatchTaskAssignees] upsert failed", {
        conversationId,
        userId,
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
      });
    }
  }
}