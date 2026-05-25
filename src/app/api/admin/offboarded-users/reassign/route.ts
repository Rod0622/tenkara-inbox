// src/app/api/admin/offboarded-users/reassign/route.ts
//
// POST /api/admin/offboarded-users/reassign
//
// body: {
//   from_user_id: string,      // the offboarded user
//   to_user_id: string | null, // target — REQUIRED for conversations/tasks/follow-ups;
//                              // can be null only when categories are limited to unassign-style ops
//   categories: {
//     conversations?: boolean,         // reassign assignee_id
//     tasks?: boolean,                  // remove from task_assignees + add target
//     follow_ups?: boolean,             // reassign call_follow_ups.assigned_to
//     watchers?: "delete" | "transfer", // either drop watcher rows or move them to target
//     drafts?: "delete" | "keep",       // drafts have personal voice — default keep
//     notifications?: "mark_read",      // mark unread notifications as read
//   }
// }
//
// Returns: per-category result counts.
//
// Admin only. The offboarded user must actually be inactive (safety check).

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

async function requireAdmin(): Promise<{ ok: boolean; actorId?: string; resp?: NextResponse }> {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return { ok: false, resp: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.teamMember.role !== "admin") {
    return { ok: false, resp: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { ok: true, actorId: session.teamMember.id };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const fromUserId: string | undefined = body.from_user_id;
  const toUserId: string | null = body.to_user_id || null;
  const categories: any = body.categories || {};

  if (!fromUserId) {
    return NextResponse.json({ error: "from_user_id required" }, { status: 400 });
  }

  const needsTarget = categories.conversations || categories.tasks || categories.follow_ups
    || categories.watchers === "transfer";
  if (needsTarget && !toUserId) {
    return NextResponse.json({ error: "to_user_id required for the requested categories" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Safety: confirm from_user is actually deactivated
  const { data: fromUser, error: fromErr } = await supabase
    .from("team_members")
    .select("id, is_active, name")
    .eq("id", fromUserId)
    .maybeSingle();
  if (fromErr) return NextResponse.json({ error: fromErr.message }, { status: 500 });
  if (!fromUser) return NextResponse.json({ error: "from_user_id not found" }, { status: 404 });
  if ((fromUser as any).is_active === true) {
    return NextResponse.json(
      { error: "This user is still active. Deactivate them first before reassigning." },
      { status: 400 }
    );
  }

  // Safety: confirm to_user (if any) is active
  if (toUserId) {
    const { data: toUser } = await supabase
      .from("team_members")
      .select("id, is_active")
      .eq("id", toUserId)
      .maybeSingle();
    if (!toUser || (toUser as any).is_active === false) {
      return NextResponse.json({ error: "to_user_id must be an active team member" }, { status: 400 });
    }
  }

  const result: any = {
    conversations: { attempted: false, updated: 0, error: null as string | null },
    tasks: { attempted: false, removed: 0, added: 0, skipped_already_assigned: 0, error: null as string | null },
    follow_ups: { attempted: false, updated: 0, error: null as string | null },
    watchers: { attempted: false, deleted: 0, transferred: 0, error: null as string | null },
    drafts: { attempted: false, deleted: 0, kept: 0, error: null as string | null },
    notifications: { attempted: false, marked_read: 0, error: null as string | null },
  };

  // ── Conversations ──────────────────────────────────
  if (categories.conversations) {
    result.conversations.attempted = true;
    try {
      const { data, error } = await supabase
        .from("conversations")
        .update({ assignee_id: toUserId })
        .eq("assignee_id", fromUserId)
        .select("id");
      if (error) throw error;
      result.conversations.updated = (data || []).length;
    } catch (e: any) {
      result.conversations.error = e?.message || "Unknown error";
    }
  }

  // ── Tasks (multi-assignee join table) ─────────────
  // 1. Find all task_assignees rows for the offboarded user
  // 2. For each: delete that row. If target is set AND target isn't already
  //    an assignee on that task, insert target as an assignee.
  if (categories.tasks) {
    result.tasks.attempted = true;
    try {
      const { data: rows } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("team_member_id", fromUserId);
      const taskIds = ((rows || []) as any[]).map((r) => r.task_id);

      if (taskIds.length === 0) {
        result.tasks.removed = 0;
      } else {
        // Find which of those tasks the target is ALREADY assigned to (so we don't duplicate)
        let alreadyAssignedTasks = new Set<string>();
        if (toUserId) {
          const { data: existing } = await supabase
            .from("task_assignees")
            .select("task_id")
            .eq("team_member_id", toUserId)
            .in("task_id", taskIds);
          alreadyAssignedTasks = new Set(((existing || []) as any[]).map((r) => r.task_id));
        }

        // Delete the offboarded user's rows
        const { data: deleted, error: delErr } = await supabase
          .from("task_assignees")
          .delete()
          .eq("team_member_id", fromUserId)
          .select("task_id");
        if (delErr) throw delErr;
        result.tasks.removed = (deleted || []).length;

        // Add target as assignee for the tasks that don't already have them
        if (toUserId) {
          const toInsert = taskIds
            .filter((tid) => !alreadyAssignedTasks.has(tid))
            .map((task_id) => ({ task_id, team_member_id: toUserId }));
          result.tasks.skipped_already_assigned = taskIds.length - toInsert.length;
          if (toInsert.length > 0) {
            const { data: inserted, error: insErr } = await supabase
              .from("task_assignees")
              .insert(toInsert)
              .select("task_id");
            if (insErr) throw insErr;
            result.tasks.added = (inserted || []).length;
          }
        }
      }
    } catch (e: any) {
      result.tasks.error = e?.message || "Unknown error";
    }
  }

  // ── Call follow-ups ───────────────────────────────
  if (categories.follow_ups) {
    result.follow_ups.attempted = true;
    try {
      const { data, error } = await supabase
        .from("call_follow_ups")
        .update({ assigned_to: toUserId })
        .eq("assigned_to", fromUserId)
        .in("status", ["pending", "in_progress"])
        .select("id");
      if (error) throw error;
      result.follow_ups.updated = (data || []).length;
    } catch (e: any) {
      result.follow_ups.error = e?.message || "Unknown error";
    }
  }

  // ── Conversation watchers ─────────────────────────
  if (categories.watchers === "delete") {
    result.watchers.attempted = true;
    try {
      const { data, error } = await supabase
        .from("conversation_watchers")
        .delete()
        .eq("user_id", fromUserId)
        .select("conversation_id");
      if (error) throw error;
      result.watchers.deleted = (data || []).length;
    } catch (e: any) {
      result.watchers.error = e?.message || "Unknown error";
    }
  } else if (categories.watchers === "transfer" && toUserId) {
    result.watchers.attempted = true;
    try {
      // Find watcher rows for the offboarded user
      const { data: rows } = await supabase
        .from("conversation_watchers")
        .select("conversation_id")
        .eq("user_id", fromUserId);
      const convIds = ((rows || []) as any[]).map((r) => r.conversation_id);
      if (convIds.length > 0) {
        // Which of these does the target already watch?
        const { data: existing } = await supabase
          .from("conversation_watchers")
          .select("conversation_id")
          .eq("user_id", toUserId)
          .in("conversation_id", convIds);
        const alreadyWatching = new Set(((existing || []) as any[]).map((r) => r.conversation_id));

        // Delete the offboarded user's watch rows
        await supabase
          .from("conversation_watchers")
          .delete()
          .eq("user_id", fromUserId);

        // Insert watch rows for the target where they don't already exist
        const toInsert = convIds
          .filter((id) => !alreadyWatching.has(id))
          .map((conversation_id) => ({ conversation_id, user_id: toUserId }));
        if (toInsert.length > 0) {
          await supabase.from("conversation_watchers").insert(toInsert);
        }
        result.watchers.transferred = toInsert.length;
        result.watchers.deleted = convIds.length;
      }
    } catch (e: any) {
      result.watchers.error = e?.message || "Unknown error";
    }
  }

  // ── Drafts ────────────────────────────────────────
  if (categories.drafts === "delete") {
    result.drafts.attempted = true;
    try {
      const { data, error } = await supabase
        .from("email_drafts")
        .delete()
        .eq("author_id", fromUserId)
        .select("id");
      if (error) throw error;
      result.drafts.deleted = (data || []).length;
    } catch (e: any) {
      result.drafts.error = e?.message || "Unknown error";
    }
  }
  // "keep" → no action needed; drafts stay under the offboarded author

  // ── Notifications ─────────────────────────────────
  if (categories.notifications === "mark_read") {
    result.notifications.attempted = true;
    try {
      const { data, error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", fromUserId)
        .eq("is_read", false)
        .select("id");
      if (error) throw error;
      result.notifications.marked_read = (data || []).length;
    } catch (e: any) {
      result.notifications.error = e?.message || "Unknown error";
    }
  }

  return NextResponse.json({ ok: true, from_user_id: fromUserId, to_user_id: toUserId, result });
}
