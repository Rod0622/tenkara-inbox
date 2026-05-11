import { createServerClient } from "@/lib/supabase";

/**
 * Auto-watch assignees on a conversation when they're assigned to a task within it.
 *
 * Idempotent — uses upsert on (conversation_id, user_id), so re-running with the
 * same users does nothing. Preserves existing watch_source and notification prefs
 * if the user was already watching, because upsert only writes the row if it
 * doesn't exist.
 *
 * Important caveats:
 *   - Pass `watch_source` so we can tell auto-watches apart from manual ones in
 *     analytics or future "unwatch on unassign" features. Currently set to
 *     "task_assigned" by callers.
 *   - This is best-effort: failures are logged but don't break task creation
 *     or assignee updates. The task is the primary operation.
 *   - Skips empty user IDs and de-dupes the list.
 *
 * Called from:
 *   - POST /api/tasks                 (initial task creation with assignees)
 *   - POST /api/conversations/tasks   (same, via thread tasks tab)
 *   - PATCH /api/tasks                (assignee replacement on existing tasks)
 *   - PATCH /api/conversations/tasks  (same)
 *
 * Default notification prefs match the manual-watch defaults in
 * /api/conversations/watchers POST. We do NOT pass any notify_on_* fields here —
 * the watchers endpoint's defaults take effect on first insert; subsequent runs
 * leave existing prefs alone.
 */
export async function autoWatchTaskAssignees(
  conversationId: string,
  userIds: string[],
  watchSource: string = "task_assigned"
): Promise<void> {
  if (!conversationId) return;
  if (!Array.isArray(userIds) || userIds.length === 0) return;

  const cleaned = Array.from(
    new Set(
      userIds.filter((id) => typeof id === "string" && id.trim())
    )
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

  const rows = cleaned.map((userId) => ({
    conversation_id: conversationId,
    user_id: userId,
    watch_source: watchSource,
    ...DEFAULT_PREFS,
  }));

  const { error } = await supabase
    .from("conversation_watchers")
    .upsert(rows, {
      onConflict: "conversation_id,user_id",
      ignoreDuplicates: true,
    });

  if (error) {
    // Best-effort: log and move on. We don't want a watcher-table issue to
    // break task creation, which is the user-facing operation.
    console.error("autoWatchTaskAssignees failed:", error.message);
  }
}
