export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage/status-reports ──────────────────────────────
//
// Returns three reports in one round-trip for the Team Coverage → Reports
// tab (Batch 6, Feature 5):
//   1. Distribution — supplier counts per (status × account). Includes a
//      "(No status set)" pseudo-row for suppliers with no assignment.
//   2. Aging — every (supplier × account) row with a status, plus how
//      many days it has been at that status. Sorted oldest-first so the
//      worst offenders surface at the top.
//   3. Activity — recent supplier_status_changed entries from activity_log,
//      filtered by the `range` query param.
//
// Query params:
//   - range: "7" | "30" | "90" | "all"  (default "30")
//     Only affects the Activity section.
//
// Distribution and Aging are always "current state" — no time filter.
//
// All data is from the inbox schema; server client bypasses RLS on
// supplier_account_statuses and supplier_statuses (browser client is
// blocked on these tables, same reason Feature 3's overview endpoint
// exists).
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const rangeRaw = req.nextUrl.searchParams.get("range") || "30";
  const rangeDays = rangeRaw === "all" ? null : parseInt(rangeRaw, 10);
  if (rangeDays !== null && (isNaN(rangeDays) || rangeDays < 1 || rangeDays > 3650)) {
    return NextResponse.json({ error: "range must be 7, 30, 90, or all" }, { status: 400 });
  }

  // ── Parallel fetches for the source data ──────────────────────────
  const [statusesRes, accountsRes, assignmentsRes, suppliersRes, activityRes, allConversationsRes] = await Promise.all([
    supabase
      .from("supplier_statuses")
      .select("id, name, color, background_color, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("email_accounts")
      .select("id, name"),
    supabase
      .from("supplier_account_statuses")
      .select("supplier_contact_id, email_account_id, status_id, updated_at"),
    supabase
      .from("supplier_contacts")
      .select("id, name, email"),
    (() => {
      const q = supabase
        .from("activity_log")
        .select("id, created_at, actor_id, details, actor:team_members!activity_log_actor_id_fkey(id, name, initials, color)")
        .eq("action", "supplier_status_changed")
        .order("created_at", { ascending: false })
        .limit(500);
      if (rangeDays !== null) {
        const since = new Date(Date.now() - rangeDays * 86400000).toISOString();
        return q.gte("created_at", since);
      }
      return q;
    })(),
    // For the "No status set" row in Distribution: count suppliers per
    // account that have at least one conversation but no status row.
    // Pull conversations with supplier_contact_id so we can compute
    // (supplier × account) pairs covered.
    supabase
      .from("conversations")
      .select("supplier_contact_id, email_account_id")
      .not("supplier_contact_id", "is", null)
      .neq("status", "merged"),
  ]);

  if (statusesRes.error)         return NextResponse.json({ error: statusesRes.error.message },         { status: 500 });
  if (accountsRes.error)         return NextResponse.json({ error: accountsRes.error.message },         { status: 500 });
  if (assignmentsRes.error)      return NextResponse.json({ error: assignmentsRes.error.message },      { status: 500 });
  if (suppliersRes.error)        return NextResponse.json({ error: suppliersRes.error.message },        { status: 500 });
  if (activityRes.error)         return NextResponse.json({ error: activityRes.error.message },         { status: 500 });
  if (allConversationsRes.error) return NextResponse.json({ error: allConversationsRes.error.message }, { status: 500 });

  const statuses     = (statusesRes.data || []) as any[];
  const accounts     = (accountsRes.data || []) as any[];
  const assignments  = (assignmentsRes.data || []) as any[];
  const suppliers    = (suppliersRes.data || []) as any[];
  const activityRows = (activityRes.data || []) as any[];
  const allConvos    = (allConversationsRes.data || []) as any[];

  // Lookup maps
  const statusById   = new Map<string, any>(statuses.map(s => [s.id, s]));
  const accountById  = new Map<string, any>(accounts.map(a => [a.id, a]));
  const supplierById = new Map<string, any>(suppliers.map(s => [s.id, s]));

  // ── 1. Distribution ────────────────────────────────────────────────
  // For each status × account: count assignments with that status_id.
  // For the "(No status set)" pseudo-row: per account, count distinct
  // suppliers that have ANY conversation in that account MINUS those
  // with a status assignment row.
  const distribution: any[] = [];

  // Index assignments by (account → status → count) + track which
  // (supplier × account) pairs already have any row.
  const statusedPairs = new Set<string>();
  const countMap = new Map<string, number>(); // key = `${status_id}::${account_id}`
  for (const a of assignments) {
    statusedPairs.add(`${a.supplier_contact_id}::${a.email_account_id}`);
    if (!a.status_id) continue; // null status_id = explicitly cleared, treat as "no status"
    const k = `${a.status_id}::${a.email_account_id}`;
    countMap.set(k, (countMap.get(k) || 0) + 1);
  }

  for (const s of statuses) {
    for (const a of accounts) {
      const c = countMap.get(`${s.id}::${a.id}`) || 0;
      distribution.push({
        status_id: s.id,
        status_name: s.name,
        status_color: s.color,
        status_bg_color: s.background_color,
        account_id: a.id,
        account_name: a.name,
        count: c,
      });
    }
  }

  // "(No status set)" row per account — supplier-account pairs from
  // conversations that don't have a status assignment.
  // Build distinct supplier-account pairs from conversations.
  const convoPairs = new Set<string>();
  for (const c of allConvos) {
    if (!c.supplier_contact_id || !c.email_account_id) continue;
    convoPairs.add(`${c.supplier_contact_id}::${c.email_account_id}`);
  }
  // Count per account: pairs in convoPairs that are NOT in statusedPairs
  // AND assignment rows where status_id IS null
  const noStatusByAccount = new Map<string, number>();
  for (const pair of Array.from(convoPairs)) {
    if (statusedPairs.has(pair)) {
      // Check: do they have a non-null status? If the assignment row
      // has status_id=null, count it as "no status".
      const accountId = pair.split("::")[1];
      const supplierId = pair.split("::")[0];
      const assignment = assignments.find(
        a => a.supplier_contact_id === supplierId && a.email_account_id === accountId
      );
      if (assignment && !assignment.status_id) {
        noStatusByAccount.set(accountId, (noStatusByAccount.get(accountId) || 0) + 1);
      }
      continue;
    }
    // No assignment row at all = no status
    const accountId = pair.split("::")[1];
    noStatusByAccount.set(accountId, (noStatusByAccount.get(accountId) || 0) + 1);
  }
  for (const a of accounts) {
    distribution.push({
      status_id: null,
      status_name: "(No status set)",
      status_color: null,
      status_bg_color: null,
      account_id: a.id,
      account_name: a.name,
      count: noStatusByAccount.get(a.id) || 0,
    });
  }

  // ── 2. Aging ───────────────────────────────────────────────────────
  // For each assignment with a status, compute days since updated_at.
  // Sort by oldest (highest days_at_status) first.
  const now = Date.now();
  const aging = assignments
    .filter(a => a.status_id) // skip null/cleared
    .map(a => {
      const status = statusById.get(a.status_id);
      const account = accountById.get(a.email_account_id);
      const supplier = supplierById.get(a.supplier_contact_id);
      const updatedMs = a.updated_at ? new Date(a.updated_at).getTime() : now;
      const daysAtStatus = Math.floor((now - updatedMs) / 86400000);
      return {
        supplier_id: a.supplier_contact_id,
        supplier_name: supplier?.name || null,
        supplier_email: supplier?.email || null,
        account_id: a.email_account_id,
        account_name: account?.name || null,
        status_id: a.status_id,
        status_name: status?.name || null,
        status_color: status?.color || null,
        status_bg_color: status?.background_color || null,
        updated_at: a.updated_at,
        days_at_status: daysAtStatus,
      };
    })
    .sort((a, b) => b.days_at_status - a.days_at_status);

  // Aging buckets summary
  const buckets = { lt7: 0, d7to30: 0, d30to90: 0, gt90: 0 };
  for (const r of aging) {
    if (r.days_at_status < 7) buckets.lt7++;
    else if (r.days_at_status < 30) buckets.d7to30++;
    else if (r.days_at_status < 90) buckets.d30to90++;
    else buckets.gt90++;
  }

  // ── 3. Activity ────────────────────────────────────────────────────
  // Flatten the activity_log rows into a friendly shape. Names come
  // straight from details.* (written by supplier-status-activity helper).
  const activity = activityRows.map(r => {
    const d = r.details || {};
    const actor = r.actor as any;
    const supplier = d.supplier_contact_id ? supplierById.get(d.supplier_contact_id) : null;
    return {
      id: r.id,
      created_at: r.created_at,
      actor_id: r.actor_id,
      actor_name: actor?.name || null,
      actor_color: actor?.color || null,
      actor_initials: actor?.initials || null,
      supplier_id: d.supplier_contact_id || null,
      supplier_name: supplier?.name || null,
      account_id: d.email_account_id || null,
      account_name: d.account_name || null,
      previous_status_name: d.previous_status_name || null,
      new_status_name: d.new_status_name || null,
    };
  });
  // Dedup activity: same (supplier × account × actor × new_status) within
  // 5 seconds is the same logical event written to many conversations.
  // For the report, collapse to one entry per logical change.
  const seen = new Set<string>();
  const dedupedActivity: any[] = [];
  for (const a of activity) {
    const tBucket = a.created_at ? Math.floor(new Date(a.created_at).getTime() / 5000) : 0;
    const key = `${a.actor_id}::${a.supplier_id}::${a.account_id}::${a.new_status_name}::${tBucket}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedActivity.push(a);
  }

  return NextResponse.json({
    distribution,
    aging,
    aging_buckets: buckets,
    activity: dedupedActivity,
    range: rangeRaw,
    generated_at: new Date().toISOString(),
  });
}
