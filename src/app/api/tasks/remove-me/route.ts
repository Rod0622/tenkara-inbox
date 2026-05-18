/**
 * POST /api/tasks/remove-me
 *
 * "Remove me from this task" — a per-user action that removes only the
 * caller from a task's assignee list. If the caller was the SOLE assignee,
 * the task is soft-deleted instead of left orphaned.
 *
 * Every call logs to `inbox.task_removals` for audit. Admins can query
 * that table later to spot abuse patterns.
 *
 * Request body:
 *   {
 *     task_id: string,
 *     removed_by: string,   // team_members.id of caller (sent from client,
 *                           // matches the pattern used elsewhere in this app)
 *     reason: string        // required, trimmed; rejected if empty
 *   }
 *
 * Response 200:
 *   {
 *     ok: true,
 *     action: "left" | "soft_deleted",
 *     task_id: string,
 *     removal_id: string
 *   }
 *
 * Response 400 on bad input, 404 if task doesn't exist or caller wasn't
 * assigned, 500 on DB errors.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json();

    const taskId: string | undefined = body.task_id || body.taskId;
    const removedBy: string | undefined = body.removed_by || body.removedBy;
    const rawReason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (!taskId) {
      return NextResponse.json({ error: "task_id is required" }, { status: 400 });
    }
    if (!removedBy) {
      return NextResponse.json({ error: "removed_by is required" }, { status: 400 });
    }
    if (!rawReason) {
      return NextResponse.json({ error: "reason is required" }, { status: 400 });
    }

    // Fetch task + current assignees so we can decide between "leave the
    // task" and "soft-delete the task" before mutating anything.
    const { data: task, error: taskErr } = await supabase
      .from("tasks")
      .select("id, text, status, conversation_id, deleted_at")
      .eq("id", taskId)
      .single();

    if (taskErr || !task) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }
    if (task.deleted_at) {
      return NextResponse.json({ error: "Task already removed" }, { status: 400 });
    }

    const { data: assignees, error: aErr } = await supabase
      .from("task_assignees")
      .select("team_member_id")
      .eq("task_id", taskId);

    if (aErr) {
      return NextResponse.json({ error: aErr.message }, { status: 500 });
    }

    const isAssigned = (assignees || []).some(
      (a: any) => a.team_member_id === removedBy
    );
    if (!isAssigned) {
      return NextResponse.json(
        { error: "You are not assigned to this task" },
        { status: 404 }
      );
    }

    const wasSole = (assignees || []).length <= 1;
    const nowIso = new Date().toISOString();

    if (wasSole) {
      // Soft-delete the task. Keep the task_assignees row so audits still
      // show who was on it. Tasks with deleted_at != null are filtered out
      // of all board/list queries; they survive in the DB for audit.
      const { error: updErr } = await supabase
        .from("tasks")
        .update({ deleted_at: nowIso, deleted_by: removedBy })
        .eq("id", taskId);
      if (updErr) {
        return NextResponse.json({ error: updErr.message }, { status: 500 });
      }
    } else {
      // Multi-assignee path: just drop the caller's assignee row. The
      // task itself stays for the other assignees.
      const { error: delErr } = await supabase
        .from("task_assignees")
        .delete()
        .eq("task_id", taskId)
        .eq("team_member_id", removedBy);
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 });
      }

      // After removal, recompute the parent task.status from the remaining
      // assignees. If all remaining are done -> completed. If some are
      // done -> in_progress. Else todo. The dashboard's selectTaskById
      // helper already does this on read, but we also persist here so
      // status is consistent for direct DB queries (e.g. exports).
      const { data: remaining } = await supabase
        .from("task_assignees")
        .select("is_done")
        .eq("task_id", taskId);
      const r = remaining || [];
      const allDone = r.length > 0 && r.every((x: any) => x.is_done);
      const anyDone = r.some((x: any) => x.is_done);
      const newStatus = allDone ? "completed" : anyDone ? "in_progress" : "todo";

      await supabase
        .from("tasks")
        .update({ status: newStatus, is_done: allDone })
        .eq("id", taskId);
    }

    // Audit insert. Snapshot the task fields so the audit row stays useful
    // even if the task is later hard-deleted.
    const { data: removal, error: remErr } = await supabase
      .from("task_removals")
      .insert({
        task_id: taskId,
        removed_by: removedBy,
        reason: rawReason,
        was_sole_assignee: wasSole,
        task_text: task.text || null,
        task_status: task.status || null,
        conversation_id: task.conversation_id || null,
      })
      .select("id")
      .single();

    if (remErr) {
      // Audit failure is annoying but the user-visible removal already
      // succeeded. Log loudly so we don't lose the trail silently.
      console.error("[remove-me] audit insert failed:", remErr);
    }

    return NextResponse.json({
      ok: true,
      action: wasSole ? "soft_deleted" : "left",
      task_id: taskId,
      removal_id: removal?.id || null,
    });
  } catch (err: any) {
    console.error("POST /api/tasks/remove-me failed:", err);
    return NextResponse.json(
      { error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}
