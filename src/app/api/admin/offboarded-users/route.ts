// src/app/api/admin/offboarded-users/route.ts
//
// GET /api/admin/offboarded-users
//
// Returns all deactivated team members (is_active = false) with counts of
// their lingering workload:
//   - assigned conversations (assignee_id)
//   - open tasks where they are an assignee (task_assignees join)
//   - active call follow-ups (call_follow_ups.assigned_to + status pending/in_progress)
//   - email drafts they authored (email_drafts.author_id)
//   - conversation watch entries (conversation_watchers.user_id)
//   - unread notifications for them
//
// Admin only.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

async function requireAdmin(): Promise<{ ok: boolean; resp?: NextResponse }> {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return { ok: false, resp: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.teamMember.role !== "admin") {
    return { ok: false, resp: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { ok: true };
}

interface OffboardedUserSummary {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  deactivated_at: string | null;
  counts: {
    conversations: number;
    open_tasks: number;
    active_follow_ups: number;
    drafts: number;
    watched_threads: number;
    unread_notifications: number;
    total_outstanding: number; // sum of the actionable ones (everything except notifications)
  };
}

export async function GET(_req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  const supabase = createServerClient();

  // 1. Fetch deactivated team members
  const { data: deactivated, error: deactErr } = await supabase
    .from("team_members")
    .select("id, name, email, initials, color, updated_at")
    .eq("is_active", false)
    .order("updated_at", { ascending: false });

  if (deactErr) return NextResponse.json({ error: deactErr.message }, { status: 500 });

  const users = (deactivated || []) as any[];
  if (users.length === 0) {
    return NextResponse.json({ users: [], active_team_members: [] });
  }

  const userIds = users.map((u) => u.id);

  // 2. Bulk fetch ALL the join data we need, then index by user.
  // Cheaper than 6 queries × N users.
  const [
    convosRes,
    taskAssigneesRes,
    followUpsRes,
    draftsRes,
    watchersRes,
    notifsRes,
    activeMembersRes,
  ] = await Promise.all([
    // Assigned conversations (not in spam/trash folders is implicit — folder filtering would
    // require a join; counts include all assignments regardless of folder)
    supabase
      .from("conversations")
      .select("id, assignee_id")
      .in("assignee_id", userIds),
    // task_assignees rows. We need to JOIN to tasks to filter by status
    // (open = NOT in completed/dismissed).
    supabase
      .from("task_assignees")
      .select("team_member_id, task:tasks!inner(id, status)")
      .in("team_member_id", userIds),
    supabase
      .from("call_follow_ups")
      .select("id, assigned_to, status")
      .in("assigned_to", userIds)
      .in("status", ["pending", "in_progress"]),
    supabase
      .from("email_drafts")
      .select("id, author_id")
      .in("author_id", userIds),
    supabase
      .from("conversation_watchers")
      .select("conversation_id, user_id")
      .in("user_id", userIds),
    supabase
      .from("notifications")
      .select("id, user_id, is_read")
      .in("user_id", userIds)
      .eq("is_read", false),
    // For the reassign target dropdown — list active team members
    supabase
      .from("team_members")
      .select("id, name, email, initials, color")
      .eq("is_active", true)
      .order("name"),
  ]);

  const convoCount = new Map<string, number>();
  for (const c of (convosRes.data || []) as any[]) {
    if (!c.assignee_id) continue;
    convoCount.set(c.assignee_id, (convoCount.get(c.assignee_id) || 0) + 1);
  }

  const openTaskCount = new Map<string, number>();
  for (const ta of (taskAssigneesRes.data || []) as any[]) {
    const status = ta.task?.status;
    if (status === "completed" || status === "dismissed") continue;
    if (!ta.team_member_id) continue;
    openTaskCount.set(ta.team_member_id, (openTaskCount.get(ta.team_member_id) || 0) + 1);
  }

  const followUpCount = new Map<string, number>();
  for (const f of (followUpsRes.data || []) as any[]) {
    if (!f.assigned_to) continue;
    followUpCount.set(f.assigned_to, (followUpCount.get(f.assigned_to) || 0) + 1);
  }

  const draftCount = new Map<string, number>();
  for (const d of (draftsRes.data || []) as any[]) {
    if (!d.author_id) continue;
    draftCount.set(d.author_id, (draftCount.get(d.author_id) || 0) + 1);
  }

  const watchCount = new Map<string, number>();
  for (const w of (watchersRes.data || []) as any[]) {
    if (!w.user_id) continue;
    watchCount.set(w.user_id, (watchCount.get(w.user_id) || 0) + 1);
  }

  const notifCount = new Map<string, number>();
  for (const n of (notifsRes.data || []) as any[]) {
    if (!n.user_id) continue;
    notifCount.set(n.user_id, (notifCount.get(n.user_id) || 0) + 1);
  }

  const summaries: OffboardedUserSummary[] = users.map((u) => {
    const conversations = convoCount.get(u.id) || 0;
    const open_tasks = openTaskCount.get(u.id) || 0;
    const active_follow_ups = followUpCount.get(u.id) || 0;
    const drafts = draftCount.get(u.id) || 0;
    const watched_threads = watchCount.get(u.id) || 0;
    const unread_notifications = notifCount.get(u.id) || 0;
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      initials: u.initials,
      color: u.color,
      deactivated_at: u.updated_at || null,
      counts: {
        conversations,
        open_tasks,
        active_follow_ups,
        drafts,
        watched_threads,
        unread_notifications,
        total_outstanding: conversations + open_tasks + active_follow_ups + watched_threads,
      },
    };
  });

  return NextResponse.json({
    users: summaries,
    active_team_members: (activeMembersRes.data || []) as any[],
  });
}
