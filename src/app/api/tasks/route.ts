import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import type { Task, TaskStatus, TeamMember } from "@/types";

type TaskRow = {
  id: string;
  conversation_id: string | null;
  text: string;
  assignee_id: string | null;
  is_done: boolean | null;
  status?: string | null;
  due_date: string | null;
  created_at: string;
  updated_at?: string;
};

type ConversationSummary = {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
};

type TaskAssigneeRow = {
  task_id: string;
  team_member_id: string;
};

function normalizeAssigneeIds(body: any): string[] {
  const raw = body.assignee_ids ?? body.assigneeIds ?? body.assignee_id ?? body.assigneeId;
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.filter((value) => typeof value === "string" && value.trim());
  }
  if (typeof raw === "string" && raw.trim()) return [raw.trim()];
  return [];
}

function isMissingJoinError(error: any) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return error?.code === "42P01" || message.includes("task_assignees") || message.includes("could not find");
}

async function fetchMembersById(supabase: any, ids: string[]): Promise<Map<string, TeamMember>> {
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("team_members")
    .select("*")
    .in("id", ids);

  if (error) throw error;
  return new Map((data || []).map((member: TeamMember) => [member.id, member]));
}

async function fetchConversationsById(supabase: any, ids: string[]): Promise<Map<string, ConversationSummary>> {
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from("conversations")
    .select("id, subject, from_name, from_email")
    .in("id", ids);

  if (error) throw error;
  return new Map((data || []).map((conversation: ConversationSummary) => [conversation.id, conversation]));
}

async function fetchTaskAssigneeRows(supabase: any, taskIds: string[]): Promise<TaskAssigneeRow[]> {
  if (taskIds.length === 0) return [];

  const { data, error } = await supabase
    .from("task_assignees")
    .select("task_id, team_member_id")
    .in("task_id", taskIds);

  if (error) {
    if (isMissingJoinError(error)) return [];
    throw error;
  }

  return (data || []) as TaskAssigneeRow[];
}

async function hydrateTasks(supabase: any, rows: TaskRow[]): Promise<Task[]> {
  if (rows.length === 0) return [];

  const taskIds = rows.map((row) => row.id);
  const conversationIds = Array.from(new Set(rows.map((row) => row.conversation_id).filter(Boolean))) as string[];
  const taskAssigneeRows = await fetchTaskAssigneeRows(supabase, taskIds);

  const memberIds = Array.from(new Set([
    ...rows.map((row) => row.assignee_id).filter(Boolean),
    ...taskAssigneeRows.map((row) => row.team_member_id),
  ])) as string[];

  const [membersById, conversationsById] = await Promise.all([
    fetchMembersById(supabase, memberIds),
    fetchConversationsById(supabase, conversationIds),
  ]);

  const assigneesByTaskId = new Map<string, TeamMember[]>();
  for (const row of taskAssigneeRows) {
    const member = membersById.get(row.team_member_id);
    if (!member) continue;
    const existing = assigneesByTaskId.get(row.task_id) || [];
    existing.push(member);
    assigneesByTaskId.set(row.task_id, existing);
  }

  return rows.map((row) => {
    const primaryAssignee = row.assignee_id ? membersById.get(row.assignee_id) || null : null;
    const assignees = assigneesByTaskId.get(row.id)
      || (primaryAssignee ? [primaryAssignee] : []);

    return {
      ...row,
      status: (row.status || (row.is_done ? "completed" : "todo")) as TaskStatus,
      assignee: primaryAssignee || undefined,
      assignees,
      conversation: row.conversation_id ? conversationsById.get(row.conversation_id) || undefined : undefined,
    } as Task;
  });
}

async function selectTaskById(supabase: any, taskId: string): Promise<Task> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("id", taskId)
    .single();

  if (error || !data) throw error || new Error("Task not found");
  const [task] = await hydrateTasks(supabase, [data as TaskRow]);
  return task;
}

async function selectAllTasks(supabase: any): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) throw error;
  return hydrateTasks(supabase, (data || []) as TaskRow[]);
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
    return NextResponse.json({ error: error.message || "Failed to fetch tasks" }, { status: 500 });
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
      const activityInsert = await supabase.from("activity_log").insert({
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

      if (activityInsert.error) {
        console.error("POST /api/tasks activity log failed:", activityInsert.error);
      }
    }

    const task = await selectTaskById(supabase, insert.data.id);
    return NextResponse.json({ task });
  } catch (error: any) {
    console.error("POST /api/tasks failed:", error);
    return NextResponse.json({ error: error.message || "Failed to create task" }, { status: 500 });
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
            console.error("PATCH /api/tasks assignee sync failed:", insertRes.error);
            return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
          }
        }
      }
    }

    const task = await selectTaskById(supabase, taskId);
    return NextResponse.json({ task });
  } catch (error: any) {
    console.error("PATCH /api/tasks failed:", error);
    return NextResponse.json({ error: error.message || "Failed to update task" }, { status: 500 });
  }
}
