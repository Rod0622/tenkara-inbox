export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage ─────────────────────────────────────────────
//
// Overview: per-teammate × per-account distinct supplier counts.
//
// Definition of "contacted" = outbound message where sent_by_user_id matches
// the team member (Rod locked this in design).
//
// IMPLEMENTATION NOTE (June 3, 2026 — Batch 2 bug fix):
// Earlier version used Supabase's nested join syntax
//   `.select("..., conversation:conversations!inner(...)")`
// which silently produced empty `conversation` fields for many rows under
// the `inbox` schema setup. Result: drill-in returned zero rows even when
// the overview showed positive counts.
// Rewritten to a two-pass pattern (matches existing patterns in
// contact-command-center, reminders, tasks endpoints).
//
// Query plan:
//   1. SELECT all outbound messages (sent_by_user_id, conversation_id, sent_at)
//   2. SELECT conversations for the referenced ids (supplier_contact_id, email_account_id)
//   3. Join in app code, aggregate per (member, account) → unique supplier set
//
// Optional query params: from, to, account_id.
//
// Response:
//   { accounts: [{id, name}], rows: [{ team_member, counts: {[account_id]: n}, total, latest_at }] }
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const url = req.nextUrl;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const accountIdFilter = url.searchParams.get("account_id");

  // Step 0: parallel lookups for team members + accounts (small fixed-size tables)
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

  // Step 1: pull outbound messages with their sender + conversation reference.
  // Explicit large limit to avoid the silent 1000-row Supabase cap.
  let msgQuery = supabase
    .from("messages")
    .select("sent_by_user_id, conversation_id, sent_at")
    .eq("is_outbound", true)
    .not("sent_by_user_id", "is", null)
    .not("conversation_id", "is", null)
    .limit(50000);

  if (from) msgQuery = msgQuery.gte("sent_at", from);
  if (to)   msgQuery = msgQuery.lt("sent_at", to);

  const { data: msgs, error: msgErr } = await msgQuery;
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  if (!msgs || msgs.length === 0) {
    return NextResponse.json({
      accounts: (accounts || []).map((a: any) => ({ id: a.id, name: a.name })),
      rows: (members || []).map((m: any) => ({
        team_member: { id: m.id, name: m.name, initials: m.initials, color: m.color, avatar_url: m.avatar_url, role: m.role },
        counts: Object.fromEntries((accounts || []).map((a: any) => [a.id, 0])),
        total: 0,
        latest_at: null,
      })),
    });
  }

  // Step 2: fetch conversations referenced by these messages — batched in
  // chunks of 500 ids to avoid request size limits.
  const convoIds = Array.from(new Set(msgs.map((m: any) => m.conversation_id).filter(Boolean)));
  const convoById = new Map<string, { supplier_contact_id: string | null; email_account_id: string | null }>();
  const CHUNK = 500;
  for (let i = 0; i < convoIds.length; i += CHUNK) {
    const chunk = convoIds.slice(i, i + CHUNK);
    const { data: convs, error: convErr } = await supabase
      .from("conversations")
      .select("id, supplier_contact_id, email_account_id")
      .in("id", chunk);
    if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 });
    for (const c of convs || []) {
      convoById.set((c as any).id, {
        supplier_contact_id: (c as any).supplier_contact_id,
        email_account_id: (c as any).email_account_id,
      });
    }
  }

  // Step 3: aggregate. Per (team_member, email_account), collect unique
  // supplier ids. Map<member_id, Map<account_id, Set<supplier_id>>>.
  const aggregated = new Map<string, Map<string, Set<string>>>();
  const latest = new Map<string, string>();

  for (const m of msgs) {
    const memberId = (m as any).sent_by_user_id as string | null;
    const convoId  = (m as any).conversation_id as string | null;
    if (!memberId || !convoId) continue;
    const conv = convoById.get(convoId);
    if (!conv) continue; // conversation row missing (deleted/orphaned message)
    const accountId  = conv.email_account_id;
    const supplierId = conv.supplier_contact_id;
    if (!accountId || !supplierId) continue;
    if (accountIdFilter && accountId !== accountIdFilter) continue;

    const sentAt = (m as any).sent_at as string;
    const prev = latest.get(memberId);
    if (!prev || sentAt > prev) latest.set(memberId, sentAt);

    let perMember = aggregated.get(memberId);
    if (!perMember) { perMember = new Map(); aggregated.set(memberId, perMember); }
    let perAccount = perMember.get(accountId);
    if (!perAccount) { perAccount = new Set(); perMember.set(accountId, perAccount); }
    perAccount.add(supplierId);
  }

  // Step 4: shape the response (one row per active team member, including
  // those with zero counts).
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