import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// POST /api/conversations/tasks — create a task
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const conversationId = body.conversation_id || body.conversationId;
  const text = body.text;
  const assigneeId = body.assignee_id || body.assigneeId || null;
  const dueDate = body.due_date || body.dueDate || null;

  if (!conversationId || !text?.trim()) {
    return NextResponse.json(
      { error: "conversation_id and text are required" },
      { status: 400 }
    );
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      conversation_id: conversationId,
      text: text.trim(),
      assignee_id: assigneeId,
      due_date: dueDate,
      is_done: false,
    })
    .select("*, assignee:team_members(*)")
    .single();

  if (error) {
    console.error("Create task error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ task });
}

// PATCH /api/conversations/tasks — toggle a task
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const taskId = body.task_id || body.taskId;
  const isDone = body.is_done ?? body.isDone;

  if (!taskId || isDone === undefined) {
    return NextResponse.json(
      { error: "task_id and is_done are required" },
      { status: 400 }
    );
  }

  const { data: task, error } = await supabase
    .from("tasks")
    .update({ is_done: isDone })
    .eq("id", taskId)
    .select("*, assignee:team_members(*)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ task });
}