import { createServerClient } from "@/lib/supabase";

// Create notifications for one or more users
export async function createNotifications(notifications: {
  user_id: string;
  type: string;
  title: string;
  body?: string;
  conversation_id?: string;
  task_id?: string;
  actor_id?: string | null;
}[]) {
  if (notifications.length === 0) return;
  const supabase = createServerClient();

  // Clean: ensure actor_id is null not empty string (FK constraint)
  const cleaned = notifications.map((n) => ({
    ...n,
    actor_id: n.actor_id || null,
    conversation_id: n.conversation_id || null,
    task_id: n.task_id || null,
  }));

  const { error } = await supabase.from("notifications").insert(cleaned);
  if (error) {
    console.error("Failed to create notifications:", error.message);
  }
}

// Notify when an email conversation is assigned to someone
export async function notifyEmailAssigned(
  conversationId: string,
  assigneeId: string,
  actorId: string | null,
  subject: string
) {
  if (!assigneeId) return;
  if (assigneeId === actorId) return; // Don't notify self
  await createNotifications([{
    user_id: assigneeId,
    type: "email_assigned",
    title: "Email assigned to you",
    body: subject,
    conversation_id: conversationId,
    actor_id: actorId,
  }]);
}

// Notify when a task is assigned to users
export async function notifyTaskAssigned(
  taskId: string,
  assigneeIds: string[],
  actorId: string | null,
  taskText: string,
  conversationId?: string
) {
  const notifications = assigneeIds
    .filter((id) => id && id !== actorId) // Don't notify the creator, skip empty
    .map((id) => ({
      user_id: id,
      type: "task_assigned",
      title: "New task assigned to you",
      body: taskText,
      conversation_id: conversationId || undefined,
      task_id: taskId,
      actor_id: actorId,
    }));
  await createNotifications(notifications);
}

// Notify when someone is mentioned in a team chat or note
// Accepts optional actorName to produce a more readable title.
// If `mentionType === "everyone"`, the title makes that clear.
export async function notifyMention(
  mentionedUserIds: string[],
  actorId: string | null,
  noteText: string,
  conversationId: string,
  opts?: { actorName?: string; mentionType?: "direct" | "everyone"; conversationSubject?: string }
) {
  const actorName = opts?.actorName?.trim() || "Someone";
  const isEveryone = opts?.mentionType === "everyone";
  const subjectPart = opts?.conversationSubject?.trim();

  const title = isEveryone
    ? `${actorName} mentioned @everyone`
    : `${actorName} mentioned you`;

  const bodyParts: string[] = [];
  if (subjectPart) bodyParts.push(subjectPart);
  bodyParts.push(noteText.slice(0, 140));
  const body = bodyParts.join(" — ");

  const notifications = mentionedUserIds
    .filter((id) => id && id !== actorId)
    .map((id) => ({
      user_id: id,
      type: "mention",
      title,
      body,
      conversation_id: conversationId,
      actor_id: actorId,
    }));
  await createNotifications(notifications);
}

// Notify watchers of a conversation about a specific event.
// Each watcher has per-watch boolean flags controlling which events they care about.
// We filter to only watchers whose preference for this event is true.
//
// eventType maps to a flag column on conversation_watchers:
//   - "new_message" -> notify_on_new_message
//   - "status_change" -> notify_on_status_change
//   - "assignee_change" -> notify_on_assignee_change
//   - "label_change" -> notify_on_label_change
//   - "comment" -> notify_on_comment
//
// Includes simple dedup: same (user, conversation, eventType) within last 60s is skipped.
export async function notifyWatchers(
  conversationId: string,
  eventType: "new_message" | "status_change" | "assignee_change" | "label_change" | "comment",
  opts: {
    title: string;
    body?: string;
    actorId?: string | null;
    excludeUserIds?: string[];
  }
) {
  const supabase = createServerClient();

  const flagColumn = ({
    new_message: "notify_on_new_message",
    status_change: "notify_on_status_change",
    assignee_change: "notify_on_assignee_change",
    label_change: "notify_on_label_change",
    comment: "notify_on_comment",
  } as const)[eventType];

  // Fetch watchers who care about this event type
  const { data: watchers } = await supabase
    .from("conversation_watchers")
    .select("user_id")
    .eq("conversation_id", conversationId)
    .eq(flagColumn, true);

  if (!watchers || watchers.length === 0) return;

  // Build target user list: exclude actor + any explicitly excluded users
  const exclude = new Set<string>(opts.excludeUserIds || []);
  if (opts.actorId) exclude.add(opts.actorId);
  const targetUserIds = watchers.map((w: any) => w.user_id).filter((id: string) => !exclude.has(id));
  if (targetUserIds.length === 0) return;

  // Dedup: filter out users who already received this exact (conversation, eventType) in last 60s
  const sixtyAgo = new Date(Date.now() - 60 * 1000).toISOString();
  const { data: recent } = await supabase
    .from("notifications")
    .select("user_id")
    .in("user_id", targetUserIds)
    .eq("conversation_id", conversationId)
    .eq("type", `watch_${eventType}`)
    .gte("created_at", sixtyAgo);
  const recentSet = new Set((recent || []).map((r: any) => r.user_id));
  const finalIds = targetUserIds.filter((id: string) => !recentSet.has(id));
  if (finalIds.length === 0) return;

  await createNotifications(finalIds.map((id: string) => ({
    user_id: id,
    type: `watch_${eventType}`,
    title: opts.title,
    body: opts.body,
    conversation_id: conversationId,
    actor_id: opts.actorId || null,
  })));
}