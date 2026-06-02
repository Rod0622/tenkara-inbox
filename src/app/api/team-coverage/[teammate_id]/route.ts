export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage/[teammate_id] ────────────────────────────────
//
// Drill-in: every (supplier × email_account) pair this teammate has sent
// outbound emails to, plus manual status + latest conversation labels.
//
// IMPLEMENTATION NOTE (June 3, 2026 — Batch 2 bug fix):
// Earlier version used a nested `conversation:conversations!inner(...)`
// JOIN that silently returned empty `conversation` fields on the inbox
// schema, producing zero drill-in rows. Rewritten to a two-pass query
// pattern (matches existing endpoints in this codebase).
//
// Steps:
//   1. SELECT outbound messages for this teammate
//   2. SELECT conversations for those messages
//   3. SELECT supplier_contacts + email_accounts + status assignments + labels
//   4. Aggregate per (supplier, account) pair
export async function GET(req: NextRequest, { params }: { params: { teammate_id: string } }) {
  const supabase = createServerClient();
  const teammateId = params.teammate_id;
  const url = req.nextUrl;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const accountIdFilter = url.searchParams.get("account_id");
  const statusIdFilter = url.searchParams.get("status_id");

  // Step 0: confirm teammate exists
  const { data: teamMember, error: memberErr } = await supabase
    .from("team_members")
    .select("id, name, initials, color, avatar_url, role")
    .eq("id", teammateId)
    .maybeSingle();
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });
  if (!teamMember) return NextResponse.json({ error: "Team member not found" }, { status: 404 });

  // Step 1: pull this teammate's outbound messages (with conversation_id + timestamp)
  let msgQuery = supabase
    .from("messages")
    .select("conversation_id, sent_at")
    .eq("is_outbound", true)
    .eq("sent_by_user_id", teammateId)
    .not("conversation_id", "is", null)
    .limit(50000);
  if (from) msgQuery = msgQuery.gte("sent_at", from);
  if (to)   msgQuery = msgQuery.lt("sent_at", to);
  const { data: msgs, error: msgErr } = await msgQuery;
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  if (!msgs || msgs.length === 0) {
    return NextResponse.json({ team_member: teamMember, rows: [] });
  }

  // Step 2: fetch the conversations referenced by these messages
  const convoIds = Array.from(new Set(msgs.map((m: any) => m.conversation_id).filter(Boolean)));
  type ConvLite = {
    id: string;
    supplier_contact_id: string | null;
    email_account_id: string | null;
    subject: string | null;
    last_message_at: string | null;
  };
  const convoById = new Map<string, ConvLite>();
  const CHUNK = 500;
  for (let i = 0; i < convoIds.length; i += CHUNK) {
    const chunk = convoIds.slice(i, i + CHUNK);
    const { data: convs, error: convErr } = await supabase
      .from("conversations")
      .select("id, supplier_contact_id, email_account_id, subject, last_message_at")
      .in("id", chunk);
    if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 });
    for (const c of convs || []) {
      convoById.set((c as any).id, c as any);
    }
  }

  // Step 3: aggregate per (supplier, account) pair.
  // For each pair, track total outbound count + latest contact + the
  // most-recent conversation_id (used to fetch labels).
  type Pair = {
    supplier_id: string;
    account_id: string;
    total_outbound: number;
    last_contact_at: string;
    latest_conversation_id: string;
    latest_conversation_subject: string | null;
    latest_conversation_last_message_at: string | null;
  };
  const pairsByKey = new Map<string, Pair>();
  for (const m of msgs) {
    const convoId = (m as any).conversation_id as string;
    const conv = convoById.get(convoId);
    if (!conv) continue;
    const supplierId = conv.supplier_contact_id;
    const accountId  = conv.email_account_id;
    if (!supplierId || !accountId) continue;
    if (accountIdFilter && accountId !== accountIdFilter) continue;

    const key = `${supplierId}::${accountId}`;
    const sentAt = (m as any).sent_at as string;
    let pair = pairsByKey.get(key);
    if (!pair) {
      pair = {
        supplier_id: supplierId,
        account_id: accountId,
        total_outbound: 0,
        last_contact_at: sentAt,
        latest_conversation_id: conv.id,
        latest_conversation_subject: conv.subject,
        latest_conversation_last_message_at: conv.last_message_at,
      };
      pairsByKey.set(key, pair);
    }
    pair.total_outbound++;
    if (sentAt > pair.last_contact_at) {
      pair.last_contact_at = sentAt;
      pair.latest_conversation_id = conv.id;
      pair.latest_conversation_subject = conv.subject;
      pair.latest_conversation_last_message_at = conv.last_message_at;
    }
  }

  if (pairsByKey.size === 0) {
    return NextResponse.json({ team_member: teamMember, rows: [] });
  }

  // Step 4: bulk-fetch supplier names, account names, status assignments,
  // and labels on the latest conversation IDs. All in parallel.
  const supplierIds = Array.from(new Set(Array.from(pairsByKey.values()).map(p => p.supplier_id)));
  const accountIds  = Array.from(new Set(Array.from(pairsByKey.values()).map(p => p.account_id)));
  const latestConvIds = Array.from(new Set(Array.from(pairsByKey.values()).map(p => p.latest_conversation_id)));

  const [suppliersRes, accountsRes, statusesRes, statusLookupRes, convLabelsRes, labelsRes] = await Promise.all([
    supabase.from("supplier_contacts").select("id, name, email").in("id", supplierIds),
    supabase.from("email_accounts").select("id, name").in("id", accountIds),
    // assignment rows (status_id may be null)
    supabase
      .from("supplier_account_statuses")
      .select("supplier_contact_id, email_account_id, status_id")
      .in("supplier_contact_id", supplierIds)
      .in("email_account_id", accountIds),
    // status lookup (id → name, color, bg) — no IN needed, table is small
    supabase
      .from("supplier_statuses")
      .select("id, name, color, background_color"),
    // labels on latest conversations
    supabase
      .from("conversation_labels")
      .select("conversation_id, label_id")
      .in("conversation_id", latestConvIds),
    // label lookup
    supabase
      .from("labels")
      .select("id, name, color, background_color"),
  ]);

  if (suppliersRes.error)   return NextResponse.json({ error: suppliersRes.error.message },   { status: 500 });
  if (accountsRes.error)    return NextResponse.json({ error: accountsRes.error.message },    { status: 500 });
  if (statusesRes.error)    return NextResponse.json({ error: statusesRes.error.message },    { status: 500 });
  if (statusLookupRes.error)return NextResponse.json({ error: statusLookupRes.error.message },{ status: 500 });
  if (convLabelsRes.error)  return NextResponse.json({ error: convLabelsRes.error.message },  { status: 500 });
  if (labelsRes.error)      return NextResponse.json({ error: labelsRes.error.message },      { status: 500 });

  const supplierById = new Map<string, any>((suppliersRes.data || []).map((s: any) => [s.id, s]));
  const accountById  = new Map<string, any>((accountsRes.data  || []).map((a: any) => [a.id, a]));
  const statusLookup = new Map<string, any>((statusLookupRes.data || []).map((s: any) => [s.id, s]));
  const statusByPair = new Map<string, any>();
  for (const row of statusesRes.data || []) {
    const key = `${(row as any).supplier_contact_id}::${(row as any).email_account_id}`;
    const statusId = (row as any).status_id;
    statusByPair.set(key, statusId ? statusLookup.get(statusId) || null : null);
  }
  const labelLookup = new Map<string, any>((labelsRes.data || []).map((l: any) => [l.id, l]));
  const labelsByConv = new Map<string, any[]>();
  for (const row of convLabelsRes.data || []) {
    const cid = (row as any).conversation_id;
    const lbl = labelLookup.get((row as any).label_id);
    if (!lbl) continue;
    const arr = labelsByConv.get(cid) || [];
    arr.push(lbl);
    labelsByConv.set(cid, arr);
  }

  // Step 5: materialize rows, applying optional status filter, and sort
  // by most-recent contact descending.
  const rows = Array.from(pairsByKey.entries()).map(([key, pair]) => {
    const status = statusByPair.get(key) || null;
    return {
      supplier: supplierById.get(pair.supplier_id) || null,
      account:  accountById.get(pair.account_id)  || null,
      last_contact_at: pair.last_contact_at,
      total_outbound: pair.total_outbound,
      status,
      latest_conversation: pair.latest_conversation_id
        ? {
            id: pair.latest_conversation_id,
            subject: pair.latest_conversation_subject,
            last_message_at: pair.latest_conversation_last_message_at,
            labels: labelsByConv.get(pair.latest_conversation_id) || [],
          }
        : null,
    };
  })
  .filter((r: any) => {
    if (statusIdFilter === "__none__") return !r.status;
    if (statusIdFilter) return r.status?.id === statusIdFilter;
    return true;
  })
  .sort((a: any, b: any) => (b.last_contact_at || "").localeCompare(a.last_contact_at || ""));

  return NextResponse.json({ team_member: teamMember, rows });
}