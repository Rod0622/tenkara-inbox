import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { notifyEmailAssigned } from "@/lib/notifications";

// POST /api/conversations/create — Create a blank conversation (internal/team chat)
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const {
    subject,
    assignee_id,
    email_account_id,
    actor_id,
    notes,
    caller_assignee_id,
    task_category_id,
  } = body;

  if (!subject?.trim()) {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }

  if (!email_account_id) {
    return NextResponse.json({ error: "email_account_id is required" }, { status: 400 });
  }

  // Create the conversation
  const { data: convo, error } = await supabase
    .from("conversations")
    .insert({
      subject: subject.trim(),
      email_account_id,
      assignee_id: assignee_id || null,
      from_name: "Internal",
      from_email: "internal",
      preview: notes?.trim()?.slice(0, 200) || "Team conversation",
      status: "open",
      is_unread: false,
      last_message_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    console.error("Create conversation failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Add initial note if provided
  if (notes?.trim()) {
    await supabase.from("notes").insert({
      conversation_id: convo.id,
      author_id: actor_id || assignee_id || null,
      title: "",
      text: notes.trim(),
    });
  }

  // Log activity
  await supabase.from("activity_log").insert({
    conversation_id: convo.id,
    actor_id: actor_id || null,
    action: "conversation_created",
    details: { subject: subject.trim(), assignee_id },
  });

  // Notify the assigned user
  if (assignee_id && actor_id && assignee_id !== actor_id) {
    try {
      await notifyEmailAssigned(convo.id, assignee_id, actor_id, subject.trim());
    } catch (_e) { /* best-effort */ }
  }

  // Create call assignment task if caller specified
  if (caller_assignee_id) {
    // Find or create "Calls" category
    let callCategoryId = task_category_id || null;
    if (!callCategoryId) {
      const { data: existing } = await supabase
        .from("task_categories")
        .select("id")
        .ilike("name", "%call%")
        .limit(1)
        .single();
      callCategoryId = existing?.id || null;
    }

    const { data: callTask } = await supabase
      .from("tasks")
      .insert({
        conversation_id: convo.id,
        text: "Call assignment",
        assignee_id: caller_assignee_id,
        category_id: callCategoryId,
        is_done: false,
      })
      .select("*")
      .single();

    if (callTask) {
      await supabase.from("task_assignees").insert({
        task_id: callTask.id,
        team_member_id: caller_assignee_id,
      });
    }
  }

  return NextResponse.json({ conversation: convo });
}
