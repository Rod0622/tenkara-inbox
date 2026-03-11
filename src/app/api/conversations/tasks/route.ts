import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

function normalizeAssigneeIds(body: any): string[] {
  const raw = body.assignee_ids ?? body.assigneeIds ?? body.assignee_id ?? body.assigneeId;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((value) => typeof value === "string" && value.trim());
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

// POST /api/conversations/tasks - create a task
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const conversationId = body.conversation_id || body.conversationId;
  const text = body.text;
  const assigneeIds = normalizeAssigneeIds(body);
  const dueDate = body.due_date || body.dueDate || null;
  const primaryAssigneeId = assigneeIds[0] || null;

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
      assignee_id: primaryAssigneeId,
      due_date: dueDate,
      is_done: false,
    })
    .select("*")
    .single();

  if (error || !task) {
    console.error("Create task error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create task" }, { status: 500 });
  }

  if (assigneeIds.length > 0) {
    const { error: assigneeError } = await supabase
      .from("task_assignees")
      .insert(assigneeIds.map((teamMemberId) => ({ task_id: task.id, team_member_id: teamMemberId })));

    if (assigneeError) {
      console.error("Task assignee insert error:", assigneeError);
      await supabase.from("tasks").delete().eq("id", task.id);
      return NextResponse.json({ error: assigneeError.message }, { status: 500 });
    }
  }

  const { data: fullTask } = await supabase
    .from("tasks")
    .select("*, assignee:team_members!tasks_assignee_id_fkey(*), task_assignees(team_member_id, team_member:team_members(*))")
    .eq("id", task.id)
    .single();

  await supabase.from("activity_log").insert({
    conversation_id: conversationId,
    actor_id: primaryAssigneeId,
    action: "task_created",
    details: {
      task_id: task.id,
      text: text.trim().slice(0, 80),
      assignee_ids: assigneeIds,
      due_date: dueDate,
    },
  });

  return NextResponse.json({ task: fullTask || task });
}

// PATCH /api/conversations/tasks - toggle a task
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const taskId = body.task_id || body.taskId;
  const isDone = body.is_done ?? body.isDone;
  const actorId = body.actor_id || null;

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
    .select("*, assignee:team_members!tasks_assignee_id_fkey(*), task_assignees(team_member_id, team_member:team_members(*))")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (task?.conversation_id) {
    await supabase.from("activity_log").insert({
      conversation_id: task.conversation_id,
      actor_id: actorId,
      action: isDone ? "task_completed" : "task_reopened",
      details: { task_id: taskId, text: task.text?.slice(0, 80) },
    });
  }

  return NextResponse.json({ task });
}
