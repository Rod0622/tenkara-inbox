// src/app/api/admin/offboarded-users/[id]/actions/route.ts
//
// POST /api/admin/offboarded-users/:id/actions
//
// body: {
//   action: "reassign_conversations" | "unassign_conversations"  // unassign = NULL = team inbox
//         | "reassign_tasks"          | "unassign_tasks"          // unassign = remove offboarded user only
//         | "reassign_follow_ups"     | "cancel_follow_ups"       // cancel = DELETE the follow_up row
//         | "transfer_watchers"       | "delete_watchers"
//         | "delete_drafts"
//         | "mark_notifs_read",
//   item_ids: string[],     // ids of the items to act on
//   to_user_id?: string,    // required for reassign_* and transfer_watchers
// }
//
// Returns: { ok, action, applied, failed, details }
//
// "Item id" semantics per category:
//   conversations    → conversation.id
//   tasks            → task.id
//   follow_ups       → call_follow_ups.id
//   watchers         → conversation_id (user_id is implied = the offboarded user)
//   drafts           → email_drafts.id
//
// Admin only. Safety check: the offboarded user must actually be inactive.

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

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  const fromUserId = ctx.params.id;
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const action: string = body.action;
  const itemIds: string[] = Array.isArray(body.item_ids) ? body.item_ids : [];
  const toUserId: string | null = body.to_user_id || null;

  const REASSIGN_ACTIONS = new Set(["reassign_conversations", "reassign_tasks", "reassign_follow_ups", "transfer_watchers"]);

  if (!action) return NextResponse.json({ error: "action required" }, { status: 400 });
  if (action !== "mark_notifs_read" && itemIds.length === 0) {
    return NextResponse.json({ error: "item_ids required" }, { status: 400 });
  }
  if (REASSIGN_ACTIONS.has(action) && !toUserId) {
    return NextResponse.json({ error: "to_user_id required for this action" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Safety: confirm from_user is deactivated
  const { data: fromUser } = await supabase
    .from("team_members")
    .select("id, is_active")
    .eq("id", fromUserId)
    .maybeSingle();
  if (!fromUser) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if ((fromUser as any).is_active === true) {
    return NextResponse.json({ error: "User is still active. Deactivate first." }, { status: 400 });
  }

  // Safety: target must be active (when relevant)
  if (toUserId) {
    const { data: toUser } = await supabase
      .from("team_members")
      .select("id, is_active")
      .eq("id", toUserId)
      .maybeSingle();
    if (!toUser || (toUser as any).is_active === false) {
      return NextResponse.json({ error: "to_user_id must be active" }, { status: 400 });
    }
  }

  let result: { applied: number; failed: number; details?: any } = { applied: 0, failed: 0 };

  try {
    if (action === "reassign_conversations") {
      const { data, error } = await supabase
        .from("conversations")
        .update({ assignee_id: toUserId })
        .eq("assignee_id", fromUserId)
        .in("id", itemIds)
        .select("id");
      if (error) throw error;
      result.applied = (data || []).length;
    }
    else if (action === "unassign_conversations") {
      // Send back to team inbox by clearing assignee_id
      const { data, error } = await supabase
        .from("conversations")
        .update({ assignee_id: null })
        .eq("assignee_id", fromUserId)
        .in("id", itemIds)
        .select("id");
      if (error) throw error;
      result.applied = (data || []).length;
    }
    else if (action === "reassign_tasks") {
      // For each task: delete the offboarded user from task_assignees, and
      // add target if not already assigned. Mirrors the bulk endpoint's logic
      // but limited to the picked task IDs.
      let added = 0;
      let removed = 0;
      let skipped = 0;

      // Find existing target assignments to avoid duplicates
      const { data: existingTargetAssignments } = await supabase
        .from("task_assignees")
        .select("task_id")
        .eq("team_member_id", toUserId!)
        .in("task_id", itemIds);
      const alreadyHas = new Set(((existingTargetAssignments || []) as any[]).map((r) => r.task_id));

      // Remove offboarded user from task_assignees
      const { data: deleted, error: delErr } = await supabase
        .from("task_assignees")
        .delete()
        .eq("team_member_id", fromUserId)
        .in("task_id", itemIds)
        .select("task_id");
      if (delErr) throw delErr;
      removed = (deleted || []).length;

      // Add target where not already present
      const toInsert = itemIds
        .filter((tid) => !alreadyHas.has(tid))
        .map((task_id) => ({ task_id, team_member_id: toUserId! }));
      skipped = itemIds.length - toInsert.length;
      if (toInsert.length > 0) {
        const { data: inserted, error: insErr } = await supabase
          .from("task_assignees")
          .insert(toInsert)
          .select("task_id");
        if (insErr) throw insErr;
        added = (inserted || []).length;
      }
      result.applied = removed;
      result.details = { removed, added, skipped_already_assigned: skipped };
    }
    else if (action === "unassign_tasks") {
      // Just remove the offboarded user from task_assignees (no target add)
      const { data, error } = await supabase
        .from("task_assignees")
        .delete()
        .eq("team_member_id", fromUserId)
        .in("task_id", itemIds)
        .select("task_id");
      if (error) throw error;
      result.applied = (data || []).length;
    }
    else if (action === "reassign_follow_ups") {
      const { data, error } = await supabase
        .from("call_follow_ups")
        .update({ assigned_to: toUserId })
        .eq("assigned_to", fromUserId)
        .in("id", itemIds)
        .in("status", ["pending", "in_progress"])
        .select("id");
      if (error) throw error;
      result.applied = (data || []).length;
    }
    else if (action === "cancel_follow_ups") {
      // Delete the follow-up row (cancellation = no more attempts, no longer counted).
      // We don't try to set status='cancelled' because that enum value may not exist.
      const { data, error } = await supabase
        .from("call_follow_ups")
        .delete()
        .eq("assigned_to", fromUserId)
        .in("id", itemIds)
        .in("status", ["pending", "in_progress"])
        .select("id");
      if (error) throw error;
      result.applied = (data || []).length;
    }
    else if (action === "transfer_watchers") {
      // Item ids here are conversation_ids
      // Find which target already watches → don't double-insert
      const { data: existing } = await supabase
        .from("conversation_watchers")
        .select("conversation_id")
        .eq("user_id", toUserId!)
        .in("conversation_id", itemIds);
      const already = new Set(((existing || []) as any[]).map((r) => r.conversation_id));

      // Delete offboarded user's rows
      const { data: deleted, error: delErr } = await supabase
        .from("conversation_watchers")
        .delete()
        .eq("user_id", fromUserId)
        .in("conversation_id", itemIds)
        .select("conversation_id");
      if (delErr) throw delErr;

      // Insert for target
      const toInsert = itemIds
        .filter((cid) => !already.has(cid))
        .map((conversation_id) => ({ conversation_id, user_id: toUserId! }));
      if (toInsert.length > 0) {
        const { error: insErr } = await supabase
          .from("conversation_watchers")
          .insert(toInsert);
        if (insErr) throw insErr;
      }
      result.applied = (deleted || []).length;
      result.details = { deleted: (deleted || []).length, transferred: toInsert.length };
    }
    else if (action === "delete_watchers") {
      const { data, error } = await supabase
        .from("conversation_watchers")
        .delete()
        .eq("user_id", fromUserId)
        .in("conversation_id", itemIds)
        .select("conversation_id");
      if (error) throw error;
      result.applied = (data || []).length;
    }
    else if (action === "delete_drafts") {
      const { data, error } = await supabase
        .from("email_drafts")
        .delete()
        .eq("author_id", fromUserId)
        .in("id", itemIds)
        .select("id");
      if (error) throw error;
      result.applied = (data || []).length;
    }
    else if (action === "mark_notifs_read") {
      // Single bulk action across all unread notifications for this user
      const { data, error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", fromUserId)
        .eq("is_read", false)
        .select("id");
      if (error) throw error;
      result.applied = (data || []).length;
    }
    else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, action, error: e?.message || "Unknown error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, action, ...result });
}
