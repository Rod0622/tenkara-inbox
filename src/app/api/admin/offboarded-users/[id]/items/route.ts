// src/app/api/admin/offboarded-users/[id]/items/route.ts
//
// GET /api/admin/offboarded-users/:id/items?category=<cat>&q=<search>&sort=<sort>&limit=<n>&offset=<n>
//
// Returns one category's items for the offboarded user, with search/sort and
// pagination. Each category has its own row shape — the client knows how to
// render each.
//
// Categories: conversations | tasks | follow_ups | watchers | drafts
//   (notifications are not listed; treated as a bulk "mark all read" only)
//
// All categories include a `total` count regardless of pagination so the UI
// can show "Showing N of M".
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

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  const userId = ctx.params.id;
  const url = new URL(req.url);
  const category = url.searchParams.get("category") || "";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const sort = url.searchParams.get("sort") || "default";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10), 0);

  const supabase = createServerClient();

  // Confirm user exists and is offboarded (admins shouldn't be drilling into
  // active users via this endpoint)
  const { data: user } = await supabase
    .from("team_members")
    .select("id, name, email, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if ((user as any).is_active === true) {
    return NextResponse.json({ error: "User is still active" }, { status: 400 });
  }

  if (category === "conversations") {
    return await listConversations(supabase, userId, q, sort, limit, offset);
  }
  if (category === "tasks") {
    return await listTasks(supabase, userId, q, sort, limit, offset);
  }
  if (category === "follow_ups") {
    return await listFollowUps(supabase, userId, q, sort, limit, offset);
  }
  if (category === "watchers") {
    return await listWatchers(supabase, userId, q, sort, limit, offset);
  }
  if (category === "drafts") {
    return await listDrafts(supabase, userId, q, sort, limit, offset);
  }
  return NextResponse.json({ error: "Unknown category" }, { status: 400 });
}

// ── Conversations ────────────────────────────────────
async function listConversations(supabase: any, userId: string, q: string, sort: string, limit: number, offset: number) {
  // Sort options: last_message_at_desc (default), last_message_at_asc, subject
  let order: { column: string; ascending: boolean } = { column: "last_message_at", ascending: false };
  if (sort === "last_message_at_asc") order = { column: "last_message_at", ascending: true };
  if (sort === "subject") order = { column: "subject", ascending: true };

  // First the count
  let countQ = supabase.from("conversations").select("id", { count: "exact", head: true }).eq("assignee_id", userId);
  if (q) countQ = countQ.or(`subject.ilike.%${q}%,preview.ilike.%${q}%`);
  const { count } = await countQ;

  // Then the page
  let listQ = supabase
    .from("conversations")
    .select("id, subject, preview, last_message_at, from_name, folder_id, status, email_account_id, " +
            "email_account:email_accounts(id, name, icon, color)")
    .eq("assignee_id", userId)
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (q) listQ = listQ.or(`subject.ilike.%${q}%,preview.ilike.%${q}%`);

  const { data, error } = await listQ;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: (data || []).map((c: any) => ({
      id: c.id,
      subject: c.subject || "(no subject)",
      preview: c.preview || "",
      last_message_at: c.last_message_at,
      from_name: c.from_name,
      folder_id: c.folder_id,
      status: c.status,
      email_account_name: c.email_account?.name || null,
      email_account_icon: c.email_account?.icon || null,
      email_account_color: c.email_account?.color || null,
    })),
    total: count || 0,
  });
}

// ── Tasks ────────────────────────────────────────────
async function listTasks(supabase: any, userId: string, q: string, sort: string, limit: number, offset: number) {
  // We pull task_assignees rows for this user (filtered to non-completed/dismissed tasks)
  // and then return the task data + other co-assignees.
  let order: { column: string; ascending: boolean } = { column: "due_date", ascending: true };
  if (sort === "due_date_desc") order = { column: "due_date", ascending: false };
  if (sort === "created_at") order = { column: "created_at", ascending: false };

  // Get task IDs the user is assigned to
  const { data: assigneeRows } = await supabase
    .from("task_assignees")
    .select("task_id")
    .eq("team_member_id", userId);
  const taskIds = ((assigneeRows || []) as any[]).map((r) => r.task_id);

  if (taskIds.length === 0) {
    return NextResponse.json({ items: [], total: 0 });
  }

  // Now fetch the full task data, filtered + sorted + paginated
  let countQ = supabase.from("tasks").select("id", { count: "exact", head: true })
    .in("id", taskIds)
    .not("status", "in", "(completed,dismissed)");
  if (q) countQ = countQ.ilike("text", `%${q}%`);
  const { count } = await countQ;

  let listQ = supabase
    .from("tasks")
    .select("id, text, status, due_date, due_time, created_at, conversation_id, " +
            "co_assignees:task_assignees(team_member_id, team_member:team_members(id, name, initials, color))")
    .in("id", taskIds)
    .not("status", "in", "(completed,dismissed)")
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (q) listQ = listQ.ilike("text", `%${q}%`);

  const { data, error } = await listQ;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: (data || []).map((t: any) => ({
      id: t.id,
      text: t.text,
      status: t.status,
      due_date: t.due_date,
      due_time: t.due_time,
      created_at: t.created_at,
      conversation_id: t.conversation_id,
      // Filter out the offboarded user from co-assignees display
      co_assignees: (t.co_assignees || [])
        .filter((ca: any) => ca.team_member_id !== userId && ca.team_member)
        .map((ca: any) => ({
          id: ca.team_member.id,
          name: ca.team_member.name,
          initials: ca.team_member.initials,
          color: ca.team_member.color,
        })),
    })),
    total: count || 0,
  });
}

// ── Follow-ups ───────────────────────────────────────
async function listFollowUps(supabase: any, userId: string, q: string, sort: string, limit: number, offset: number) {
  let order: { column: string; ascending: boolean } = { column: "next_attempt_after", ascending: true };
  if (sort === "created_at_desc") order = { column: "created_at", ascending: false };

  let countQ = supabase.from("call_follow_ups").select("id", { count: "exact", head: true })
    .eq("assigned_to", userId)
    .in("status", ["pending", "in_progress"]);
  const { count } = await countQ;

  let listQ = supabase
    .from("call_follow_ups")
    .select("id, status, attempt_count, next_attempt_after, created_at, quo_call_log_id, " +
            "call:quo_call_logs(id, participant_phone, direction, outcome, started_at, " +
            "  supplier:supplier_contacts(id, name), " +
            "  person:supplier_contact_persons(id, name))")
    .eq("assigned_to", userId)
    .in("status", ["pending", "in_progress"])
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    .range(offset, offset + limit - 1);

  const { data, error } = await listQ;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let items = (data || []).map((f: any) => ({
    id: f.id,
    status: f.status,
    attempt_count: f.attempt_count,
    next_attempt_after: f.next_attempt_after,
    created_at: f.created_at,
    quo_call_log_id: f.quo_call_log_id,
    participant_phone: f.call?.participant_phone || null,
    direction: f.call?.direction || null,
    outcome: f.call?.outcome || null,
    call_started_at: f.call?.started_at || null,
    supplier_name: f.call?.supplier?.name || null,
    person_name: f.call?.person?.name || null,
  }));

  // Client-side filter (search across supplier/person/phone since Supabase doesn't easily
  // filter on joined columns with this query shape)
  if (q) {
    items = items.filter((i: any) => {
      const hay = [i.supplier_name, i.person_name, i.participant_phone].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  return NextResponse.json({ items, total: q ? items.length : (count || 0) });
}

// ── Watchers ─────────────────────────────────────────
async function listWatchers(supabase: any, userId: string, q: string, sort: string, limit: number, offset: number) {
  // conversation_watchers has NO timestamp column on the row itself. We sort
  // via the joined conversation's last_message_at instead — that's the
  // operationally useful sort anyway ("which watched threads are most active").
  let order: { foreignTable: string; column: string; ascending: boolean } =
    { foreignTable: "conversation", column: "last_message_at", ascending: false };
  if (sort === "last_message_at_asc") order = { foreignTable: "conversation", column: "last_message_at", ascending: true };

  let countQ = supabase.from("conversation_watchers").select("conversation_id", { count: "exact", head: true })
    .eq("user_id", userId);
  const { count } = await countQ;

  let listQ = supabase
    .from("conversation_watchers")
    .select("conversation_id, watch_source, " +
            "conversation:conversations(id, subject, preview, last_message_at, " +
            "  email_account:email_accounts(id, name, icon, color))")
    .eq("user_id", userId)
    .order(order.column, { ascending: order.ascending, nullsFirst: false, foreignTable: order.foreignTable })
    .range(offset, offset + limit - 1);

  const { data, error } = await listQ;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let items = (data || []).map((w: any) => ({
    // For watchers, the "item id" is the conversation_id (user_id is implicit)
    id: w.conversation_id,
    conversation_id: w.conversation_id,
    watch_source: w.watch_source,
    subject: w.conversation?.subject || "(no subject)",
    preview: w.conversation?.preview || "",
    last_message_at: w.conversation?.last_message_at,
    email_account_name: w.conversation?.email_account?.name || null,
    email_account_icon: w.conversation?.email_account?.icon || null,
    email_account_color: w.conversation?.email_account?.color || null,
  }));

  if (q) {
    items = items.filter((i: any) => {
      const hay = [i.subject, i.preview].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }

  return NextResponse.json({ items, total: q ? items.length : (count || 0) });
}

// ── Drafts ───────────────────────────────────────────
async function listDrafts(supabase: any, userId: string, q: string, sort: string, limit: number, offset: number) {
  let order: { column: string; ascending: boolean } = { column: "updated_at", ascending: false };
  if (sort === "updated_at_asc") order = { column: "updated_at", ascending: true };

  let countQ = supabase.from("email_drafts").select("id", { count: "exact", head: true })
    .eq("author_id", userId);
  if (q) countQ = countQ.or(`subject.ilike.%${q}%,to_addresses.ilike.%${q}%`);
  const { count } = await countQ;

  let listQ = supabase
    .from("email_drafts")
    .select("id, subject, to_addresses, conversation_id, updated_at, created_at")
    .eq("author_id", userId)
    .order(order.column, { ascending: order.ascending, nullsFirst: false })
    .range(offset, offset + limit - 1);
  if (q) listQ = listQ.or(`subject.ilike.%${q}%,to_addresses.ilike.%${q}%`);

  const { data, error } = await listQ;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    items: (data || []).map((d: any) => ({
      id: d.id,
      subject: d.subject || "(no subject)",
      to_addresses: d.to_addresses || "",
      conversation_id: d.conversation_id,
      updated_at: d.updated_at,
      created_at: d.created_at,
    })),
    total: count || 0,
  });
}