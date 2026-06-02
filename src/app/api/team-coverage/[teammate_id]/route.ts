export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage/[teammate_id] ────────────────────────────────
//
// Drill-in. Returns the (supplier × email_account) pairs this teammate
// has personally sent outbound emails to, plus manual statuses + labels.
//
// DEBUG VERSION (June 3, 2026): drill-in returned 0 rows for every teammate
// even though the overview showed positive counts. Rather than guess at
// causes, this version:
//   1. Pulls ALL outbound messages (same query the working overview uses)
//      and filters in-memory by sent_by_user_id == teammateId. This bypasses
//      any Supabase quirk with `.eq()` on this column.
//   2. Returns `_debug` metadata in the response so we can see exactly
//      where rows are dropped if the count is still zero.
//
// Once we have a confirmed root cause, this can be tightened up.

export async function GET(req: NextRequest, { params }: { params: { teammate_id: string } }) {
  const supabase = createServerClient();
  const teammateId = params.teammate_id;
  const url = req.nextUrl;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const accountIdFilter = url.searchParams.get("account_id");
  const statusIdFilter = url.searchParams.get("status_id");

  const debug: Record<string, any> = {
    teammate_id_received: teammateId,
    account_id_filter: accountIdFilter,
    status_id_filter: statusIdFilter,
  };

  // Step 0: confirm teammate exists
  const { data: teamMember, error: memberErr } = await supabase
    .from("team_members")
    .select("id, name, initials, color, avatar_url, role")
    .eq("id", teammateId)
    .maybeSingle();
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });
  if (!teamMember) return NextResponse.json({ error: "Team member not found", _debug: debug }, { status: 404 });
  debug.team_member_found = teamMember.name;

  // Step 1: pull ALL outbound messages (no server-side filter on
  // sent_by_user_id). We'll filter in-memory after, matching the working
  // overview's approach. This is wasteful in bandwidth but bypasses any
  // potential `.eq()` quirk on the column.
  let msgQuery = supabase
    .from("messages")
    .select("sent_by_user_id, conversation_id, sent_at")
    .eq("is_outbound", true)
    .not("sent_by_user_id", "is", null)
    .not("conversation_id", "is", null)
    .limit(50000);
  if (from) msgQuery = msgQuery.gte("sent_at", from);
  if (to)   msgQuery = msgQuery.lt("sent_at", to);
  const { data: allMsgs, error: msgErr } = await msgQuery;
  if (msgErr) return NextResponse.json({ error: msgErr.message, _debug: debug }, { status: 500 });

  debug.all_outbound_msgs = (allMsgs || []).length;

  // Distinct sent_by_user_id values — to confirm what's actually in the column
  const distinctSenders = new Set<string>();
  for (const m of allMsgs || []) {
    const sender = (m as any).sent_by_user_id;
    if (sender) distinctSenders.add(sender);
  }
  debug.distinct_sender_count = distinctSenders.size;
  debug.sample_senders = Array.from(distinctSenders).slice(0, 5);

  // Step 2: in-memory filter to this teammate's messages.
  const msgs = (allMsgs || []).filter((m: any) => m.sent_by_user_id === teammateId);
  debug.msgs_after_member_filter = msgs.length;

  if (msgs.length === 0) {
    return NextResponse.json({ team_member: teamMember, rows: [], _debug: debug });
  }

  // Step 3: fetch the conversations referenced by these messages
  const convoIds = Array.from(new Set(msgs.map((m: any) => m.conversation_id).filter(Boolean)));
  debug.unique_conversation_ids = convoIds.length;

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
    if (convErr) return NextResponse.json({ error: convErr.message, _debug: debug }, { status: 500 });
    for (const c of convs || []) convoById.set((c as any).id, c as any);
  }
  debug.conversations_loaded = convoById.size;

  // Count how many conversations have a non-null supplier_contact_id
  let convsWithSupplier = 0;
  let convsWithAccount = 0;
  for (const c of Array.from(convoById.values())) {
    if (c.supplier_contact_id) convsWithSupplier++;
    if (c.email_account_id) convsWithAccount++;
  }
  debug.conversations_with_supplier = convsWithSupplier;
  debug.conversations_with_account = convsWithAccount;

  // Step 4: aggregate per (supplier, account) pair
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
  let droppedNoConv = 0;
  let droppedNoSupplier = 0;
  let droppedNoAccount = 0;
  let droppedAccountFilter = 0;
  for (const m of msgs) {
    const convoId = (m as any).conversation_id as string;
    const conv = convoById.get(convoId);
    if (!conv) { droppedNoConv++; continue; }
    const supplierId = conv.supplier_contact_id;
    const accountId  = conv.email_account_id;
    if (!supplierId) { droppedNoSupplier++; continue; }
    if (!accountId)  { droppedNoAccount++; continue; }
    if (accountIdFilter && accountId !== accountIdFilter) { droppedAccountFilter++; continue; }

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
  debug.dropped_no_conv = droppedNoConv;
  debug.dropped_no_supplier = droppedNoSupplier;
  debug.dropped_no_account = droppedNoAccount;
  debug.dropped_account_filter = droppedAccountFilter;
  debug.pairs_aggregated = pairsByKey.size;

  if (pairsByKey.size === 0) {
    return NextResponse.json({ team_member: teamMember, rows: [], _debug: debug });
  }

  // Step 5: lookups (supplier names, account names, statuses, labels) in parallel
  const supplierIds = Array.from(new Set(Array.from(pairsByKey.values()).map(p => p.supplier_id)));
  const accountIds  = Array.from(new Set(Array.from(pairsByKey.values()).map(p => p.account_id)));
  const latestConvIds = Array.from(new Set(Array.from(pairsByKey.values()).map(p => p.latest_conversation_id)));

  const [suppliersRes, accountsRes, statusesRes, statusLookupRes, convLabelsRes, labelsRes] = await Promise.all([
    supabase.from("supplier_contacts").select("id, name, email").in("id", supplierIds),
    supabase.from("email_accounts").select("id, name").in("id", accountIds),
    supabase
      .from("supplier_account_statuses")
      .select("supplier_contact_id, email_account_id, status_id")
      .in("supplier_contact_id", supplierIds)
      .in("email_account_id", accountIds),
    supabase
      .from("supplier_statuses")
      .select("id, name, color, background_color"),
    supabase
      .from("conversation_labels")
      .select("conversation_id, label_id")
      .in("conversation_id", latestConvIds),
    supabase
      .from("labels")
      .select("id, name, color, background_color"),
  ]);

  if (suppliersRes.error)   return NextResponse.json({ error: suppliersRes.error.message,   _debug: debug }, { status: 500 });
  if (accountsRes.error)    return NextResponse.json({ error: accountsRes.error.message,    _debug: debug }, { status: 500 });
  if (statusesRes.error)    return NextResponse.json({ error: statusesRes.error.message,    _debug: debug }, { status: 500 });
  if (statusLookupRes.error)return NextResponse.json({ error: statusLookupRes.error.message,_debug: debug }, { status: 500 });
  if (convLabelsRes.error)  return NextResponse.json({ error: convLabelsRes.error.message,  _debug: debug }, { status: 500 });
  if (labelsRes.error)      return NextResponse.json({ error: labelsRes.error.message,      _debug: debug }, { status: 500 });

  debug.suppliers_loaded = (suppliersRes.data || []).length;
  debug.accounts_loaded = (accountsRes.data || []).length;

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

  debug.rows_after_status_filter = rows.length;

  return NextResponse.json({ team_member: teamMember, rows, _debug: debug });
}