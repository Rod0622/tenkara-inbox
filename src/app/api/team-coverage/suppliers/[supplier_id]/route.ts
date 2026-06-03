export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage/suppliers/[supplier_id] ─────────────────────
//
// Per-supplier drill (Batch 7). Returns the breakdown of which teammates
// reached out to this supplier, sliced by account.
//
// Response:
//   {
//     supplier: { id, name, email, statuses_by_account: [...] },
//     rows: [
//       {
//         team_member: { id, name, initials, color, role },
//         account: { id, name },
//         total_outbound: number,
//         last_contact_at: string,
//         latest_conversation: { id, subject, last_message_at }
//       },
//       ...
//     ]
//   }
//
// Query params (all optional):
//   - account_ids: comma-separated, limits the rows to specific accounts.
//
// Aggregation key is (team_member × account) just like the existing
// teammate-drill is keyed on (supplier × account) — symmetric design.
export async function GET(
  req: NextRequest,
  { params }: { params: { supplier_id: string } }
) {
  const supplierId = params.supplier_id;
  if (!supplierId) {
    return NextResponse.json({ error: "supplier_id is required" }, { status: 400 });
  }

  const supabase = createServerClient();
  const sp = req.nextUrl.searchParams;
  const accountIds = (sp.get("account_ids") || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const accountIdSet = new Set(accountIds);

  // ── Step 1: supplier basics ─────────────────────────────────────
  const { data: supplier, error: supErr } = await supabase
    .from("supplier_contacts")
    .select("id, name, email")
    .eq("id", supplierId)
    .maybeSingle();
  if (supErr) return NextResponse.json({ error: supErr.message }, { status: 500 });
  if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });

  // ── Step 2: this supplier's conversations ────────────────────────
  const { data: convosRaw, error: convoErr } = await supabase
    .from("conversations")
    .select("id, email_account_id, subject, last_message_at")
    .eq("supplier_contact_id", supplierId)
    .neq("status", "merged");
  if (convoErr) return NextResponse.json({ error: convoErr.message }, { status: 500 });
  const convos = (convosRaw || []) as any[];
  const convoById = new Map<string, any>(convos.map(c => [c.id, c]));
  const convoIds = convos.map(c => c.id);

  // ── Step 3: outbound messages in those conversations ─────────────
  let msgs: any[] = [];
  if (convoIds.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < convoIds.length; i += CHUNK) {
      const chunk = convoIds.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("messages")
        .select("conversation_id, sent_at, sent_by_user_id")
        .eq("is_outbound", true)
        .not("sent_by_user_id", "is", null)
        .in("conversation_id", chunk);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      msgs = msgs.concat(data || []);
    }
  }

  // ── Step 4: lookups (team_members, accounts, statuses) ───────────
  const teammateIdsNeeded = Array.from(new Set(msgs.map(m => m.sent_by_user_id).filter(Boolean)));
  const accountIdsInData  = Array.from(new Set(convos.map(c => c.email_account_id).filter(Boolean)));

  const [teamRes, acctRes, saRes, statusDefsRes] = await Promise.all([
    teammateIdsNeeded.length > 0
      ? supabase
          .from("team_members")
          .select("id, name, initials, color, role")
          .in("id", teammateIdsNeeded)
      : Promise.resolve({ data: [] as any[], error: null }),
    accountIdsInData.length > 0
      ? supabase
          .from("email_accounts")
          .select("id, name")
          .in("id", accountIdsInData)
      : Promise.resolve({ data: [] as any[], error: null }),
    supabase
      .from("supplier_account_statuses")
      .select("supplier_contact_id, email_account_id, status_id")
      .eq("supplier_contact_id", supplierId),
    supabase
      .from("supplier_statuses")
      .select("id, name, color, background_color"),
  ]);
  if (teamRes.error)       return NextResponse.json({ error: teamRes.error.message }, { status: 500 });
  if (acctRes.error)       return NextResponse.json({ error: acctRes.error.message }, { status: 500 });
  if (saRes.error)         return NextResponse.json({ error: saRes.error.message }, { status: 500 });
  if (statusDefsRes.error) return NextResponse.json({ error: statusDefsRes.error.message }, { status: 500 });

  const teamById      = new Map<string, any>(((teamRes.data || []) as any[]).map(t => [t.id, t]));
  const accountById   = new Map<string, any>(((acctRes.data || []) as any[]).map(a => [a.id, a]));
  const statusById    = new Map<string, any>(((statusDefsRes.data || []) as any[]).map(s => [s.id, s]));
  const statusAssigns = (saRes.data || []) as any[];

  // ── Step 5: aggregate per (teammate × account) ───────────────────
  type Pair = {
    team_member_id: string;
    account_id: string;
    total_outbound: number;
    last_contact_at: string;
    latest_conversation_id: string;
    latest_conversation_subject: string | null;
    latest_conversation_last_message_at: string | null;
  };
  const pairsByKey = new Map<string, Pair>();
  for (const m of msgs) {
    const conv = convoById.get(m.conversation_id);
    if (!conv) continue;
    const accountId = conv.email_account_id;
    if (!accountId) continue;
    if (accountIdSet.size > 0 && !accountIdSet.has(accountId)) continue;
    const teammateId = m.sent_by_user_id;
    if (!teammateId) continue;

    const key = `${teammateId}::${accountId}`;
    const sentAt = m.sent_at as string;
    let pair = pairsByKey.get(key);
    if (!pair) {
      pair = {
        team_member_id: teammateId,
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

  // ── Step 6: hydrate into response shape ──────────────────────────
  const rows = Array.from(pairsByKey.values()).map(p => {
    const tm = teamById.get(p.team_member_id);
    const acct = accountById.get(p.account_id);
    return {
      team_member: tm ? {
        id: tm.id, name: tm.name, initials: tm.initials, color: tm.color, role: tm.role,
      } : null,
      account: acct ? { id: acct.id, name: acct.name } : null,
      total_outbound: p.total_outbound,
      last_contact_at: p.last_contact_at,
      latest_conversation: {
        id: p.latest_conversation_id,
        subject: p.latest_conversation_subject,
        last_message_at: p.latest_conversation_last_message_at,
      },
    };
  })
  // Filter out rows where lookups failed (defensive)
  .filter(r => r.team_member && r.account)
  // Default sort: most recent contact first
  .sort((a, b) => (b.last_contact_at || "").localeCompare(a.last_contact_at || ""));

  const statuses_by_account = statusAssigns.map(sa => {
    const acct = accountById.get(sa.email_account_id);
    const st = sa.status_id ? statusById.get(sa.status_id) : null;
    return {
      account_id: sa.email_account_id,
      account_name: acct?.name || null,
      status_id: sa.status_id || null,
      status_name: st?.name || null,
      status_color: st?.color || null,
      status_bg_color: st?.background_color || null,
    };
  });

  return NextResponse.json({
    supplier: { id: supplier.id, name: supplier.name, email: supplier.email, statuses_by_account },
    rows,
  });
}
