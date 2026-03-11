import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import type { Task, TaskStatus } from "@/types";

function normalizeAssigneeIds(body: any): string[] {
  const raw = body.assignee_ids ?? body.assigneeIds ?? body.assignee_id ?? body.assigneeId;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((value) => typeof value === "string" && value.trim());
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

function normalizeTask(task: any): Task {
  const assignees =
    task?.task_assignees?.map((entry: any) => entry.team_member).filter(Boolean) ||
    (task?.assignee ? [task.assignee] : []);

  return {
    ...task,
    status: task?.status || (task?.is_done ? "completed" : "todo"),
    assignees,
  } as Task;
}

function isMissingJoinError(error: any) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return error?.code === "42P01" || message.includes("task_assignees") || message.includes("could not find");
}

async function selectTaskById(supabase: any, taskId: string): Promise<Task> {
  const primary = await supabase
    .from("tasks")
    .select(
      "*, assignee:team_members(*), conversation:conversations(id, subject, from_name, from_email), task_assignees(team_member_id, team_member:team_members(*))"
    )
    .eq("id", taskId)
    .single();

  if (!primary.error) return normalizeTask(primary.data);

  const fallback = await supabase
    .from("tasks")
    .select("*, assignee:team_members(*), conversation:conversations(id, subject, from_name, from_email)")
    .eq("id", taskId)
    .single();

  if (fallback.error) throw fallback.error;
  return normalizeTask(fallback.data);
}

async function selectAllTasks(supabase: any): Promise<Task[]> {
  const primary = await supabase
    .from("tasks")
    .select(
      "*, assignee:team_members(*), conversation:conversations(id, subject, from_name, from_email), task_assignees(team_member_id, team_member:team_members(*))"
    )
    .order("created_at", { ascending: false });

  if (!primary.error) {
    return (primary.data || []).map(normalizeTask);
  }

  const fallback = await supabase
    .from("tasks")
    .select("*, assignee:team_members(*), conversation:conversations(id, subject, from_name, from_email)")
    .order("created_at", { ascending: false });

  if (fallback.error) throw fallback.error;
  return (fallback.data || []).map(normalizeTask);
}

function matchesAssignee(task: Task, assigneeId: string) {
  const ids = task.assignees?.map((member) => member.id) || [];
  return ids.includes(assigneeId) || task.assignee_id === assigneeId;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const assigneeId = req.nextUrl.searchParams.get("assignee_id");
    const scope = req.nextUrl.searchParams.get("scope") || "mine";

    let tasks: Task[] = await selectAllTasks(supabase);

    if (scope === "mine" && assigneeId) {
      tasks = tasks.filter((task: Task) => matchesAssignee(task, assigneeId));
    }

    tasks.sort((a: Task, b: Task) => {
      const aDone = a.status === "completed" ? 1 : 0;
      const bDone = b.status === "completed" ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      if (a.due_date) return -1;
      if (b.due_date) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    return NextResponse.json({ tasks });
  } catch (error: any) {
    console.error("GET /api/tasks failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json();

    const text = body.text?.trim();
    const conversationId = body.conversation_id || body.conversationId || null;
    const dueDate = body.due_date || body.dueDate || null;
    const assigneeIds = normalizeAssigneeIds(body);
    const primaryAssigneeId = assigneeIds[0] || null;
    const status = (body.status || "todo") as TaskStatus;

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const payload: any = {
      conversation_id: conversationId,
      text,
      assignee_id: primaryAssigneeId,
      due_date: dueDate,
      is_done: status === "completed",
    };

    if (["todo", "in_progress", "completed"].includes(status)) {
      payload.status = status;
    }

    let insert = await supabase.from("tasks").insert(payload).select("*").single();

    if (insert.error && `${insert.error.message || ""}`.toLowerCase().includes("status")) {
      delete payload.status;
      insert = await supabase.from("tasks").insert(payload).select("*").single();
    }

    if (insert.error || !insert.data) {
      console.error("POST /api/tasks insert failed:", insert.error);
      return NextResponse.json({ error: insert.error?.message || "Failed to create task" }, { status: 500 });
    }

    if (assigneeIds.length > 0) {
      const assigneeInsert = await supabase
        .from("task_assignees")
        .insert(assigneeIds.map((teamMemberId) => ({ task_id: insert.data.id, team_member_id: teamMemberId })));

      if (assigneeInsert.error && !isMissingJoinError(assigneeInsert.error)) {
        console.error("POST /api/tasks assignee insert failed:", assigneeInsert.error);
        return NextResponse.json({ error: assigneeInsert.error.message }, { status: 500 });
      }
    }

    if (conversationId) {
      await supabase.from("activity_log").insert({
        conversation_id: conversationId,
        actor_id: primaryAssigneeId,
        action: "task_created",
        details: {
          task_id: insert.data.id,
          text: text.slice(0, 80),
          assignee_ids: assigneeIds,
          due_date: dueDate,
          status,
        },
      });
    }

    const task = await selectTaskById(supabase, insert.data.id);
    return NextResponse.json({ task });
  } catch (error: any) {
    console.error("POST /api/tasks failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json();

    const taskId = body.task_id || body.taskId;
    const status = body.status as TaskStatus | undefined;
    const dueDate = body.due_date ?? body.dueDate;
    const text = body.text?.trim();
    const assigneeIds = body.assignee_ids || body.assigneeIds;

    if (!taskId) {
      return NextResponse.json({ error: "task_id is required" }, { status: 400 });
    }

    const update: any = {};
    if (status) {
      update.status = status;
      update.is_done = status === "completed";
    }
    if (dueDate !== undefined) update.due_date = dueDate || null;
    if (text) update.text = text;
    if (Array.isArray(assigneeIds)) update.assignee_id = assigneeIds[0] || null;

    let result = await supabase.from("tasks").update(update).eq("id", taskId).select("*").single();

    if (result.error && `${result.error.message || ""}`.toLowerCase().includes("status")) {
      delete update.status;
      result = await supabase.from("tasks").update(update).eq("id", taskId).select("*").single();
    }

    if (result.error) {
      console.error("PATCH /api/tasks update failed:", result.error);
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    if (Array.isArray(assigneeIds)) {
      const deleteRes = await supabase.from("task_assignees").delete().eq("task_id", taskId);
      if (!deleteRes.error || isMissingJoinError(deleteRes.error)) {
        if (assigneeIds.length > 0) {
          const insertRes = await supabase
            .from("task_assignees")
            .insert(assigneeIds.map((teamMemberId: string) => ({ task_id: taskId, team_member_id: teamMemberId })));
          if (insertRes.error && !isMissingJoinError(insertRes.error)) {
            console.error("PATCH /api/tasks assignee insert failed:", insertRes.error);
            return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
          }
        }
      }
    }

    const task = await selectTaskById(supabase, taskId);
    return NextResponse.json({ task });
  } catch (error: any) {
    console.error("PATCH /api/tasks failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => ({}));
    const rawIds = body.task_ids || body.taskIds || body.ids || body.id;
    const taskIds = Array.isArray(rawIds)
      ? rawIds.filter((value) => typeof value === "string" && value.trim())
      : typeof rawIds === "string" && rawIds.trim()
        ? [rawIds.trim()]
        : [];

    if (taskIds.length === 0) {
      return NextResponse.json({ error: "task_ids is required" }, { status: 400 });
    }

    const { data: existingTasks, error: selectError } = await supabase
      .from("tasks")
      .select("id, conversation_id, text")
      .in("id", taskIds);

    if (selectError) {
      console.error("DELETE /api/tasks select failed:", selectError);
      return NextResponse.json({ error: selectError.message }, { status: 500 });
    }

    const assigneeDelete = await supabase.from("task_assignees").delete().in("task_id", taskIds);
    if (assigneeDelete.error && !isMissingJoinError(assigneeDelete.error)) {
      console.error("DELETE /api/tasks assignee delete failed:", assigneeDelete.error);
      return NextResponse.json({ error: assigneeDelete.error.message }, { status: 500 });
    }

    const { error: deleteError } = await supabase.from("tasks").delete().in("id", taskIds);
    if (deleteError) {
      console.error("DELETE /api/tasks delete failed:", deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    const activityRows = (existingTasks || [])
      .filter((task: any) => task.conversation_id)
      .map((task: any) => ({
        conversation_id: task.conversation_id,
        actor_id: null,
        action: "task_deleted",
        details: {
          task_id: task.id,
          text: String(task.text || "").slice(0, 80),
        },
      }));

    if (activityRows.length > 0) {
      await supabase.from("activity_log").insert(activityRows);
    }

    return NextResponse.json({ success: true, deleted_ids: taskIds });
  } catch (error: any) {
    console.error("DELETE /api/tasks failed:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}