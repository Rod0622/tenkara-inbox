export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage ─────────────────────────────────────────────
//
// Returns the overview table data for the Team Coverage page:
//   - one row per teammate
//   - per-account supplier counts (how many unique suppliers they've
//     sent outbound emails to from each account)
//   - total supplier count
//   - most-recent outbound timestamp
//
// Definition of "contacted" (locked by Rod):
//   conversations where the teammate personally sent an outbound message
//   (messages.is_outbound = true AND messages.sent_by_user_id = teammate.id)
//
// Optional query params:
//   from              ISO timestamp, restrict to outbound after this date
//   to                ISO timestamp, restrict to outbound before this date
//   account_id        filter to ONE email account (matches the page-level filter)
//
// Response shape:
//   {
//     accounts: [{ id, name }, ...],          // for column ordering
//     rows: [
//       {
//         team_member: { id, name, initials, color, avatar_url },
//         counts: { [account_id]: distinct_supplier_count },
//         total: number,
//         latest_at: ISO timestamp | null
//       },
//       ...
//     ]
//   }
//
// The page renders columns in `accounts` order. Counts default to 0 for any
// account where the teammate has no contacts.
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const url = req.nextUrl;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const accountIdFilter = url.searchParams.get("account_id");

  // Pull team members + accounts in parallel — both are small lookups.
  const [{ data: members, error: memberErr }, { data: accounts, error: accErr }] = await Promise.all([
    supabase
      .from("team_members")
      .select("id, name, initials, color, avatar_url, role, is_active")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("email_accounts")
      .select("id, name")
      .order("name", { ascending: true }),
  ]);

  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });
  if (accErr)    return NextResponse.json({ error: accErr.message },    { status: 500 });

  // Build the outbound-message query. We pull every (sent_by_user_id,
  // conversation_id, sent_at, supplier_contact_id, email_account_id) tuple
  // for outbound messages, then aggregate in app code.
  //
  // Alternative would be a SQL GROUP BY with DISTINCT supplier counts —
  // cleaner in pure SQL, but Supabase's JS client doesn't expose that
  // pattern well. App-side aggregation is small (a few thousand rows max
  // for the team's outbound history) and easy to reason about.
  let msgQuery = supabase
    .from("messages")
    .select("sent_by_user_id, sent_at, conversation:conversations!inner(id, supplier_contact_id, email_account_id)")
    .eq("is_outbound", true)
    .not("sent_by_user_id", "is", null);

  if (from) msgQuery = msgQuery.gte("sent_at", from);
  if (to)   msgQuery = msgQuery.lt("sent_at", to);

  const { data: msgs, error: msgErr } = await msgQuery;
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  // Aggregate: per (team_member, email_account), collect unique supplier ids.
  // Map<member_id, Map<account_id, Set<supplier_id>>>
  const aggregated = new Map<string, Map<string, Set<string>>>();
  // Map<member_id, latest_sent_at>
  const latest = new Map<string, string>();

  for (const m of msgs || []) {
    const memberId = (m as any).sent_by_user_id as string | null;
    if (!memberId) continue;
    const conv = (m as any).conversation;
    if (!conv) continue;
    const accountId = conv.email_account_id as string | null;
    const supplierId = conv.supplier_contact_id as string | null;
    if (!accountId || !supplierId) continue;

    if (accountIdFilter && accountId !== accountIdFilter) continue;

    // Latest timestamp for this member
    const sentAt = (m as any).sent_at as string;
    const prev = latest.get(memberId);
    if (!prev || sentAt > prev) latest.set(memberId, sentAt);

    let perMember = aggregated.get(memberId);
    if (!perMember) {
      perMember = new Map<string, Set<string>>();
      aggregated.set(memberId, perMember);
    }
    let perAccount = perMember.get(accountId);
    if (!perAccount) {
      perAccount = new Set<string>();
      perMember.set(accountId, perAccount);
    }
    perAccount.add(supplierId);
  }

  // Materialize one row per team member (include even those with zero counts
  // so the page can show "no contacts yet" naturally instead of hiding people).
  const rows = (members || []).map((m: any) => {
    const perAccount = aggregated.get(m.id);
    const counts: Record<string, number> = {};
    let total = 0;
    for (const a of accounts || []) {
      const set = perAccount?.get(a.id);
      const n = set ? set.size : 0;
      counts[a.id] = n;
      total += n;
    }
    return {
      team_member: {
        id: m.id,
        name: m.name,
        initials: m.initials,
        color: m.color,
        avatar_url: m.avatar_url,
        role: m.role,
      },
      counts,
      total,
      latest_at: latest.get(m.id) || null,
    };
  });

  return NextResponse.json({
    accounts: (accounts || []).map((a: any) => ({ id: a.id, name: a.name })),
    rows,
  });
}
