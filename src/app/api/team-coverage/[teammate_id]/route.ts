export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage/[teammate_id] ────────────────────────────────
//
// Drill-in view: every (supplier × email_account) pair this teammate has
// sent outbound emails to, plus the manual status and most recent labels.
//
// Optional query params:
//   from              ISO timestamp
//   to                ISO timestamp
//   account_id        filter to one account
//   status_id         filter to one supplier status
//
// Response:
//   {
//     team_member: { id, name, ... },
//     rows: [
//       {
//         supplier: { id, name, email },
//         account: { id, name },
//         last_contact_at: ISO,
//         total_outbound: number,
//         status: { id, name, color, background_color } | null,
//         latest_conversation: {
//           id, subject, last_message_at,
//           labels: [{ id, name, color, background_color }]
//         } | null
//       }
//     ]
//   }
export async function GET(req: NextRequest, { params }: { params: { teammate_id: string } }) {
  const supabase = createServerClient();
  const teammateId = params.teammate_id;
  const url = req.nextUrl;
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const accountIdFilter = url.searchParams.get("account_id");
  const statusIdFilter = url.searchParams.get("status_id");

  // 1. Confirm teammate exists
  const { data: teamMember, error: memberErr } = await supabase
    .from("team_members")
    .select("id, name, initials, color, avatar_url, role")
    .eq("id", teammateId)
    .maybeSingle();
  if (memberErr) return NextResponse.json({ error: memberErr.message }, { status: 500 });
  if (!teamMember) return NextResponse.json({ error: "Team member not found" }, { status: 404 });

  // 2. Fetch every outbound message this teammate sent. Per (supplier,
  //    account) pair, we want: count of outbound, latest sent_at, and the
  //    conversation_id of the MOST RECENT outbound (used to pull labels).
  let msgQuery = supabase
    .from("messages")
    .select("conversation_id, sent_at, conversation:conversations!inner(id, supplier_contact_id, email_account_id, subject, last_message_at)")
    .eq("is_outbound", true)
    .eq("sent_by_user_id", teammateId);

  if (from) msgQuery = msgQuery.gte("sent_at", from);
  if (to)   msgQuery = msgQuery.lt("sent_at", to);

  const { data: msgs, error: msgErr } = await msgQuery;
  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  // Aggregate per (supplier, account) pair.
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
  for (const m of msgs || []) {
    const conv = (m as any).conversation;
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
    // Track the conversation with the latest sent_at within this pair, so
    // labels reflect the most recent conversation (most useful context).
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

  // 3. Fetch supplier names, account names, statuses, and labels — all in
  //    parallel batched queries.
  const supplierIds = Array.from(new Set(Array.from(pairsByKey.values()).map(p => p.supplier_id)));
  const accountIds  = Array.from(new Set(Array.from(pairsByKey.values()).map(p => p.account_id)));
  const convIds     = Array.from(new Set(Array.from(pairsByKey.values()).map(p => p.latest_conversation_id)));

  const [
    { data: suppliers, error: sErr },
    { data: accounts,  error: aErr },
    { data: statuses,  error: stErr },
    { data: convLabels, error: clErr },
  ] = await Promise.all([
    supabase.from("supplier_contacts").select("id, name, email").in("id", supplierIds),
    supabase.from("email_accounts").select("id, name").in("id", accountIds),
    // status assignment per (supplier, account) — JOIN with supplier_statuses
    supabase
      .from("supplier_account_statuses")
      .select("supplier_contact_id, email_account_id, status_id, status:supplier_statuses(id, name, color, background_color)")
      .in("supplier_contact_id", supplierIds)
      .in("email_account_id", accountIds),
    // labels on the latest conversations
    supabase
      .from("conversation_labels")
      .select("conversation_id, label:labels(id, name, color, background_color)")
      .in("conversation_id", convIds),
  ]);

  if (sErr)  return NextResponse.json({ error: sErr.message },  { status: 500 });
  if (aErr)  return NextResponse.json({ error: aErr.message },  { status: 500 });
  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
  if (clErr) return NextResponse.json({ error: clErr.message }, { status: 500 });

  const supplierById = new Map<string, any>((suppliers || []).map((s: any) => [s.id, s]));
  const accountById  = new Map<string, any>((accounts  || []).map((a: any) => [a.id, a]));
  const statusByPair = new Map<string, any>();
  for (const row of statuses || []) {
    const key = `${(row as any).supplier_contact_id}::${(row as any).email_account_id}`;
    statusByPair.set(key, (row as any).status);
  }
  const labelsByConv = new Map<string, any[]>();
  for (const row of convLabels || []) {
    const cid = (row as any).conversation_id;
    const lbl = (row as any).label;
    if (!lbl) continue;
    const arr = labelsByConv.get(cid) || [];
    arr.push(lbl);
    labelsByConv.set(cid, arr);
  }

  // 4. Materialize the rows, optionally filtered by status_id.
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
  // Sort by most-recent contact first
  .sort((a: any, b: any) => (b.last_contact_at || "").localeCompare(a.last_contact_at || ""));

  return NextResponse.json({ team_member: teamMember, rows });
}
