import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { notifyTaskAssigned } from "@/lib/notifications";
import { autoWatchTaskAssignees } from "@/lib/watchers";
import { addBusinessHours, getSupplierHoursForConversation } from "@/lib/business-hours";
import type { Task, TaskStatus } from "@/types";

function normalizeAssigneeIds(body: any): string[] {
  const raw =
    body.assignee_ids ??
    body.assigneeIds ??
    body.assignee_id ??
    body.assigneeId;

  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.filter((value) => typeof value === "string" && value.trim());
  }

  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }

  return [];
}

function normalizeTask(task: any): Task {
  const taskAssigneeEntries = task?.task_assignees || [];
  const assignees =
    taskAssigneeEntries.map((entry: any) => ({
      ...entry.team_member,
      is_done: entry.is_done || false,
      completed_at: entry.completed_at || null,
      personal_status: entry.status || (entry.is_done ? "completed" : "todo"),
    })).filter((a: any) => a && a.id) ||
    (task?.assignee ? [{ ...task.assignee, is_done: false, personal_status: "todo" }] : []);

  // For multi-assignee tasks: status is driven by per-user completion
  let effectiveStatus: string;
  if (assignees.length > 1) {
    const allDone = assignees.every((a: any) => a.is_done);
    const anyDone = assignees.some((a: any) => a.is_done);
    effectiveStatus = allDone ? "completed" : anyDone ? "in_progress" : (task?.status === "completed" ? "todo" : (task?.status || "todo"));
  } else {
    const allAssigneesDone = assignees.length === 1 && assignees[0].is_done;
    effectiveStatus = task?.status === "completed" || task?.is_done || allAssigneesDone ? "completed" : (task?.status || "todo");
  }

  return {
    ...task,
    status: effectiveStatus,
    assignees,
  } as Task;
}

function isMissingJoinError(error: any) {
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST200" ||
    error?.code === "PGRST201" ||
    message.includes("could not find") ||
    message.includes("more than one relationship was found")
  );
}

async function selectTaskById(supabase: any, taskId: string): Promise<Task> {
  const primary = await supabase
    .from("tasks")
    .select(
      "*, assignee:team_members!tasks_assignee_id_fkey(*), conversation:conversations(id, subject, from_name, from_email), task_assignees(team_member_id, is_done, completed_at, status, team_member:team_members!task_assignees_team_member_id_fkey(*)), category:task_categories(*)"
    )
    .eq("id", taskId)
    .single();

  if (!primary.error) {
    return normalizeTask(primary.data);
  }

  const fallback = await supabase
    .from("tasks")
    .select(
      "*, assignee:team_members!tasks_assignee_id_fkey(*), conversation:conversations(id, subject, from_name, from_email), category:task_categories(*)"
    )
    .eq("id", taskId)
    .single();

  if (fallback.error) {
    throw fallback.error;
  }

  return normalizeTask(fallback.data);
}

async function selectAllTasks(supabase: any): Promise<Task[]> {
  const primary = await supabase
    .from("tasks")
    .select(
      "*, assignee:team_members!tasks_assignee_id_fkey(*), conversation:conversations(id, subject, from_name, from_email), task_assignees(team_member_id, is_done, completed_at, status, team_member:team_members!task_assignees_team_member_id_fkey(*)), category:task_categories(*)"
    )
    .order("created_at", { ascending: false });

  if (!primary.error) {
    const tasks = (primary.data || []).map(normalizeTask);
    console.log(`selectAllTasks: primary OK, ${tasks.length} tasks, first task assignees: ${tasks[0]?.assignees?.length || 0}`);
    return tasks;
  }

  console.log("selectAllTasks: primary failed, using fallback:", primary.error?.message);

  const fallback = await supabase
    .from("tasks")
    .select(
      "*, assignee:team_members!tasks_assignee_id_fkey(*), conversation:conversations(id, subject, from_name, from_email), category:task_categories(*)"
    )
    .order("created_at", { ascending: false });

  if (fallback.error) {
    throw fallback.error;
  }

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
      tasks = tasks.filter((task) => matchesAssignee(task, assigneeId));
    }

    tasks.sort((a, b) => {
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
    let dueDate = body.due_date || body.dueDate || null;
    const dueTime = body.due_time || body.dueTime || null;

    // Default deadline: 24 business hours using supplier's schedule (or EST 9am-8pm fallback)
    if (!dueDate) {
      const supplierHours = conversationId
        ? await getSupplierHoursForConversation(supabase, conversationId)
        : null;
      const result = addBusinessHours(new Date(), 24, supplierHours);
      dueDate = result.dueDate;
    }
    const categoryId = body.category_id || body.categoryId || null;
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
      due_time: dueTime,
      category_id: categoryId,
      is_done: status === "completed",
    };

    if (["todo", "in_progress", "completed"].includes(status)) {
      payload.status = status;
    }

    let insert = await supabase
      .from("tasks")
      .insert(payload)
      .select("*")
      .single();

    if (
      insert.error &&
      `${insert.error.message || ""}`.toLowerCase().includes("status")
    ) {
      delete payload.status;
      insert = await supabase.from("tasks").insert(payload).select("*").single();
    }

    if (insert.error || !insert.data) {
      console.error("POST /api/tasks insert failed:", insert.error);
      return NextResponse.json(
        { error: insert.error?.message || "Failed to create task" },
        { status: 500 }
      );
    }

    if (assigneeIds.length > 0) {
      const assigneeRows = assigneeIds.map((teamMemberId) => ({
        task_id: insert.data.id,
        team_member_id: teamMemberId,
      }));
      console.log("Inserting task_assignees:", JSON.stringify(assigneeRows));

      const assigneeInsert = await supabase
        .from("task_assignees")
        .insert(assigneeRows);

      if (assigneeInsert.error) {
        console.error("POST /api/tasks assignee insert error:", JSON.stringify(assigneeInsert.error));
        if (!isMissingJoinError(assigneeInsert.error)) {
          return NextResponse.json(
            { error: assigneeInsert.error.message },
            { status: 500 }
          );
        }
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

    // Notify assigned users
    try {
      const actorId = body.actor_id || null;
      await notifyTaskAssigned(insert.data.id, assigneeIds, actorId, text, conversationId || undefined);
    } catch (_e) { /* best-effort */ }

    // Auto-watch: assignees should follow the thread automatically
    // so the conversation appears in their Watching folder. Best-effort.
    if (conversationId && assigneeIds.length > 0) {
      try {
        await autoWatchTaskAssignees(conversationId, assigneeIds, "task_assigned");
      } catch (_e) { /* best-effort */ }
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
    const text = typeof body.text === "string" ? body.text.trim() : undefined;
    const assigneeIds = body.assignee_ids || body.assigneeIds;
    const toggleAssigneeId = body.toggle_assignee_id;
    const assigneeStatus = body.assignee_status; // "todo" | "in_progress" | "completed"

    if (!taskId) {
      return NextResponse.json({ error: "task_id is required" }, { status: 400 });
    }

    // Update individual assignee status
    if (toggleAssigneeId) {
      if (assigneeStatus) {
        // Explicit status set (todo / in_progress / completed)
        const isDone = assigneeStatus === "completed";
        await supabase
          .from("task_assignees")
          .update({
            status: assigneeStatus,
            is_done: isDone,
            completed_at: isDone ? new Date().toISOString() : null,
          })
          .eq("task_id", taskId)
          .eq("team_member_id", toggleAssigneeId);
      } else {
        // Legacy toggle behavior
        const { data: existing } = await supabase
          .from("task_assignees")
          .select("is_done")
          .eq("task_id", taskId)
          .eq("team_member_id", toggleAssigneeId)
          .single();

        const newDone = !(existing?.is_done);
        await supabase
          .from("task_assignees")
          .update({
            status: newDone ? "completed" : "todo",
            is_done: newDone,
            completed_at: newDone ? new Date().toISOString() : null,
          })
          .eq("task_id", taskId)
          .eq("team_member_id", toggleAssigneeId);
      }

      // Check if ALL assignees are now done
      const { data: allAssignees } = await supabase
        .from("task_assignees")
        .select("is_done")
        .eq("task_id", taskId);

      const allDone = allAssignees && allAssignees.length > 0 && allAssignees.every((a: any) => a.is_done);
      const anyDone = allAssignees && allAssignees.some((a: any) => a.is_done);

      // Update task status accordingly
      await supabase
        .from("tasks")
        .update({
          status: allDone ? "completed" : anyDone ? "in_progress" : "todo",
          is_done: allDone,
        })
        .eq("id", taskId);

      const task = await selectTaskById(supabase, taskId);
      return NextResponse.json({ task });
    }

    const update: any = {};

    if (status) {
      update.status = status;
      update.is_done = status === "completed";
    }

    if (dueDate !== undefined) {
      update.due_date = dueDate || null;
    }

    const dueTime = body.due_time;
    if (dueTime !== undefined) {
      update.due_time = dueTime || null;
    }

    if (text) {
      update.text = text;
    }

    const categoryId = body.category_id;
    if (categoryId !== undefined) {
      update.category_id = categoryId || null;
    }

    if (Array.isArray(assigneeIds)) {
      update.assignee_id = assigneeIds[0] || null;
    }

    let result = await supabase
      .from("tasks")
      .update(update)
      .eq("id", taskId)
      .select("*")
      .single();

    if (
      result.error &&
      `${result.error.message || ""}`.toLowerCase().includes("status")
    ) {
      delete update.status;
      result = await supabase.from("tasks").update(update).eq("id", taskId).select("*").single();
    }

    if (result.error) {
      console.error("PATCH /api/tasks update failed:", result.error);
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    if (Array.isArray(assigneeIds)) {
      const deleteRes = await supabase
        .from("task_assignees")
        .delete()
        .eq("task_id", taskId);

      if (!deleteRes.error || isMissingJoinError(deleteRes.error)) {
        if (assigneeIds.length > 0) {
          const insertRes = await supabase.from("task_assignees").insert(
            assigneeIds.map((teamMemberId: string) => ({
              task_id: taskId,
              team_member_id: teamMemberId,
            }))
          );

          if (insertRes.error && !isMissingJoinError(insertRes.error)) {
            console.error("PATCH /api/tasks assignee insert failed:", insertRes.error);
            return NextResponse.json({ error: insertRes.error.message }, { status: 500 });
          }

          // Auto-watch new assignees on the parent conversation. The task row
          // we just updated above (result.data) carries conversation_id.
          // Skip if the task is standalone (no conversation).
          const taskConvoId = result.data?.conversation_id;
          if (taskConvoId) {
            try {
              await autoWatchTaskAssignees(taskConvoId, assigneeIds, "task_assigned");
            } catch (_e) { /* best-effort */ }
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

    const assigneeDelete = await supabase
      .from("task_assignees")
      .delete()
      .in("task_id", taskIds);

    if (assigneeDelete.error && !isMissingJoinError(assigneeDelete.error)) {
      console.error("DELETE /api/tasks assignee delete failed:", assigneeDelete.error);
      return NextResponse.json({ error: assigneeDelete.error.message }, { status: 500 });
    }

    const { error: deleteError } = await supabase
      .from("tasks")
      .delete()
      .in("id", taskIds);

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
    return NextResponse.json({ error: error.message || "Failed to delete tasks" }, { status: 500 });
  }
}