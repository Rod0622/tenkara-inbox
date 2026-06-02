export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage/[teammate_id] ────────────────────────────────
//
// Drill-in: (supplier × email_account) pairs this teammate has sent
// outbound emails to, plus manual status + labels on the latest convo.
//
// HARDENED VERSION (June 3, 2026):
// Earlier diagnostic version pulled ALL outbound messages (no server filter)
// to bypass a suspected `.eq()` quirk. It returned HTTP 500 — likely memory
// or timeout on Vercel because the dataset is too large.
// This version:
//   - Reverts to server-side `.eq("sent_by_user_id", ...)` filter
//   - Wraps every step in try/catch so failures surface as JSON errors
//     instead of crashing the function
//   - Reasonable .limit(10000) on messages — still well beyond any single
//     teammate's expected outbound count
//   - Returns `_debug` info on every response (success or error) so we can
//     see where things stop
export async function GET(req: NextRequest, { params }: { params: { teammate_id: string } }) {
  const debug: Record<string, any> = {};
  try {
    const supabase = createServerClient();
    const teammateId = params.teammate_id;
    const url = req.nextUrl;
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const accountIdFilter = url.searchParams.get("account_id");
    const statusIdFilter = url.searchParams.get("status_id");

    debug.teammate_id = teammateId;
    debug.account_filter = accountIdFilter;
    debug.status_filter = statusIdFilter;

    // ── Step 0: confirm teammate exists ────────────────────────────────
    debug.step = "fetch_team_member";
    const { data: teamMember, error: memberErr } = await supabase
      .from("team_members")
      .select("id, name, initials, color, avatar_url, role")
      .eq("id", teammateId)
      .maybeSingle();
    if (memberErr) {
      debug.error = memberErr.message;
      return NextResponse.json({ error: memberErr.message, _debug: debug }, { status: 500 });
    }
    if (!teamMember) {
      return NextResponse.json({ error: "Team member not found", _debug: debug }, { status: 404 });
    }
    debug.team_member_name = teamMember.name;

    // ── Step 1: fetch this teammate's outbound messages ────────────────
    // Server-side filter — much cheaper than pulling everyone's.
    debug.step = "fetch_messages";
    let msgQuery = supabase
      .from("messages")
      .select("conversation_id, sent_at")
      .eq("is_outbound", true)
      .eq("sent_by_user_id", teammateId)
      .not("conversation_id", "is", null)
      .limit(10000);
    if (from) msgQuery = msgQuery.gte("sent_at", from);
    if (to)   msgQuery = msgQuery.lt("sent_at", to);
    const { data: msgs, error: msgErr } = await msgQuery;
    if (msgErr) {
      debug.error = msgErr.message;
      return NextResponse.json({ error: msgErr.message, _debug: debug }, { status: 500 });
    }
    debug.outbound_msg_count = (msgs || []).length;

    if (!msgs || msgs.length === 0) {
      return NextResponse.json({ team_member: teamMember, rows: [], _debug: debug });
    }

    // ── Step 2: fetch conversations referenced by these messages ───────
    debug.step = "fetch_conversations";
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
    const CHUNK = 200;
    for (let i = 0; i < convoIds.length; i += CHUNK) {
      const chunk = convoIds.slice(i, i + CHUNK);
      const { data: convs, error: convErr } = await supabase
        .from("conversations")
        .select("id, supplier_contact_id, email_account_id, subject, last_message_at")
        .in("id", chunk);
      if (convErr) {
        debug.error = `conversations chunk failed: ${convErr.message}`;
        return NextResponse.json({ error: convErr.message, _debug: debug }, { status: 500 });
      }
      for (const c of convs || []) convoById.set((c as any).id, c as any);
    }
    debug.conversations_loaded = convoById.size;

    // Diagnostic: how many of these conversations have supplier_contact_id?
    let convsWithSupplier = 0;
    let convsWithAccount = 0;
    const convoArr = Array.from(convoById.values());
    for (const c of convoArr) {
      if (c.supplier_contact_id) convsWithSupplier++;
      if (c.email_account_id) convsWithAccount++;
    }
    debug.conversations_with_supplier = convsWithSupplier;
    debug.conversations_with_account = convsWithAccount;

    // ── Step 3: aggregate per (supplier, account) pair ─────────────────
    debug.step = "aggregate";
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

    // ── Step 4: lookups in parallel ─────────────────────────────────────
    debug.step = "lookups";
    const pairArr = Array.from(pairsByKey.values());
    const supplierIds = Array.from(new Set(pairArr.map(p => p.supplier_id)));
    const accountIds  = Array.from(new Set(pairArr.map(p => p.account_id)));
    const latestConvIds = Array.from(new Set(pairArr.map(p => p.latest_conversation_id)));

    const [suppliersRes, accountsRes, statusesRes, statusLookupRes, convLabelsRes, labelsRes] = await Promise.all([
      supabase.from("supplier_contacts").select("id, name, email").in("id", supplierIds),
      supabase.from("email_accounts").select("id, name").in("id", accountIds),
      supabase
        .from("supplier_account_statuses")
        .select("supplier_contact_id, email_account_id, status_id")
        .in("supplier_contact_id", supplierIds)
        .in("email_account_id", accountIds),
      supabase.from("supplier_statuses").select("id, name, color, background_color"),
      supabase.from("conversation_labels").select("conversation_id, label_id").in("conversation_id", latestConvIds),
      supabase.from("labels").select("id, name, color, background_color"),
    ]);

    for (const [label, res] of [
      ["suppliers", suppliersRes],
      ["accounts", accountsRes],
      ["statuses", statusesRes],
      ["status_lookup", statusLookupRes],
      ["conv_labels", convLabelsRes],
      ["labels", labelsRes],
    ] as const) {
      if (res.error) {
        debug.error = `${label} lookup failed: ${res.error.message}`;
        return NextResponse.json({ error: res.error.message, _debug: debug }, { status: 500 });
      }
    }
    debug.suppliers_loaded = (suppliersRes.data || []).length;
    debug.accounts_loaded = (accountsRes.data || []).length;

    // ── Step 5: build response rows ─────────────────────────────────────
    debug.step = "build_rows";
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

    debug.final_rows = rows.length;
    return NextResponse.json({ team_member: teamMember, rows, _debug: debug });
  } catch (e: any) {
    // Catch-all so unexpected errors come back as JSON with debug info,
    // not as opaque HTTP 500.
    debug.uncaught_error = e?.message || String(e);
    debug.uncaught_stack = (e?.stack || "").split("\n").slice(0, 5);
    return NextResponse.json({ error: e?.message || "Unknown error", _debug: debug }, { status: 500 });
  }
}