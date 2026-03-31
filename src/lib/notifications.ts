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

// Notify when someone is mentioned in a note
export async function notifyMention(
  mentionedUserIds: string[],
  actorId: string | null,
  noteText: string,
  conversationId: string
) {
  const notifications = mentionedUserIds
    .filter((id) => id && id !== actorId)
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