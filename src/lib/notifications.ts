import { createServerClient } from "@/lib/supabase";

// Create notifications for one or more users
export async function createNotifications(notifications: {
  user_id: string;
  type: string;
  title: string;
  body?: string;
  conversation_id?: string;
  task_id?: string;
  actor_id?: string;
}[]) {
  if (notifications.length === 0) return;
  const supabase = createServerClient();
  await supabase.from("notifications").insert(notifications);
}

// Notify when an email conversation is assigned to someone
export async function notifyEmailAssigned(
  conversationId: string,
  assigneeId: string,
  actorId: string,
  subject: string
) {
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
  actorId: string,
  taskText: string,
  conversationId?: string
) {
  const notifications = assigneeIds
    .filter((id) => id !== actorId) // Don't notify the creator
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

// Notify when someone is mentioned in a note
export async function notifyMention(
  mentionedUserIds: string[],
  actorId: string,
  noteText: string,
  conversationId: string
) {
  const notifications = mentionedUserIds
    .filter((id) => id !== actorId)
    .map((id) => ({
      user_id: id,
      type: "mention",
      title: "You were mentioned in a note",
      body: noteText.slice(0, 100),
      conversation_id: conversationId,
      actor_id: actorId,
    }));
  await createNotifications(notifications);
}
