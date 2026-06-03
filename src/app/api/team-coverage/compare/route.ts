export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage/compare ─────────────────────────────────────
//
// Multi-teammate Venn-style comparison view. Given a set of teammate ids,
// returns suppliers grouped by which subset of the selected teammates
// contacted them.
//
// Example with 3 selected (A, B, C):
//   - All three contacted (A ∩ B ∩ C)
//   - A + B only (not C)
//   - A + C only (not B)
//   - B + C only (not A)
//   - A only
//   - B only
//   - C only
//
// Constraint: teammate_ids must be 2..4 (Venn beyond 4 has 15+ regions which
// becomes unreadable). For larger comparisons, the user should narrow down.
//
// Query params:
//   teammate_ids   required, CSV of team_member ids (2..4)
//   account_ids    optional, CSV to filter suppliers to certain accounts
//   status_id      optional, status uuid OR "__none__"
//
// Response:
//   {
//     teammates: [{ id, name, initials, color, ... }, ...],
//     groups: [
//       {
//         key:        "id1,id2",   // sorted CSV of the teammate ids in this group
//         teammate_ids: ["id1", "id2"],
//         label:      "Rosie + Mildred only",
//         rows: [
//           {
//             supplier: { id, name, email },
//             account:  { id, name },
//             status:   {...} | null,
//             labels:   [...],
//             last_contact_at: ISO,
//             per_teammate_outbound: { "id1": 5, "id2": 3 }  // counts for teammates IN this group only
//           },
//           ...
//         ]
//       },
//       ...
//     ]
//   }
//
// Groups are returned in order: biggest set first (all-selected), then by
// set size descending, then by alphabetical teammate-ids for stability.
export async function GET(req: NextRequest) {
  const debug: Record<string, any> = {};
  try {
    const supabase = createServerClient();
    const url = req.nextUrl;
    const teammateIdsParam = url.searchParams.get("teammate_ids") || "";
    const accountIdsParam = url.searchParams.get("account_ids") || "";
    const statusIdFilter = url.searchParams.get("status_id");

    const teammateIds = teammateIdsParam.split(",").map(s => s.trim()).filter(Boolean);
    const accountIdSet = new Set(
      accountIdsParam.split(",").map(s => s.trim()).filter(Boolean)
    );
    debug.teammate_ids = teammateIds;
    debug.account_ids = Array.from(accountIdSet);

    if (teammateIds.length < 2) {
      return NextResponse.json({ error: "Need at least 2 teammates for comparison", _debug: debug }, { status: 400 });
    }
    if (teammateIds.length > 4) {
      return NextResponse.json({ error: "Comparison supports up to 4 teammates (Venn regions become unreadable beyond)", _debug: debug }, { status: 400 });
    }

    // ── Fetch teammate metadata ─────────────────────────────────────────
    debug.step = "fetch_teammates";
    const { data: teammates, error: tmErr } = await supabase
      .from("team_members")
      .select("id, name, initials, color, avatar_url, role")
      .in("id", teammateIds);
    if (tmErr) return NextResponse.json({ error: tmErr.message, _debug: debug }, { status: 500 });
    if (!teammates || teammates.length === 0) {
      return NextResponse.json({ error: "No teammates found", _debug: debug }, { status: 404 });
    }
    const teammateById = new Map<string, any>((teammates || []).map((t: any) => [t.id, t]));

    // ── Fetch outbound messages from any of the selected teammates ──────
    debug.step = "fetch_messages";
    const { data: msgs, error: msgErr } = await supabase
      .from("messages")
      .select("conversation_id, sent_at, sent_by_user_id")
      .eq("is_outbound", true)
      .in("sent_by_user_id", teammateIds)
      .not("conversation_id", "is", null)
      .limit(20000);
    if (msgErr) return NextResponse.json({ error: msgErr.message, _debug: debug }, { status: 500 });
    debug.outbound_msg_count = (msgs || []).length;
    if (!msgs || msgs.length === 0) {
      return NextResponse.json({ teammates, groups: [], _debug: debug });
    }

    // ── Fetch conversations ─────────────────────────────────────────────
    debug.step = "fetch_conversations";
    const convoIds = Array.from(new Set(msgs.map((m: any) => m.conversation_id).filter(Boolean)));
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
      if (convErr) return NextResponse.json({ error: convErr.message, _debug: debug }, { status: 500 });
      for (const c of convs || []) convoById.set((c as any).id, c as any);
    }
    debug.conversations_loaded = convoById.size;

    // ── Aggregate per (supplier, account) pair, tracking which teammates
    //    contacted each pair + per-teammate outbound counts. ────────────
    debug.step = "aggregate";
    type Pair = {
      supplier_id: string;
      account_id: string;
      teammates_contacted: Set<string>;
      per_teammate_count: Map<string, number>;
      last_contact_at: string;
      latest_conversation_id: string;
      latest_conversation_subject: string | null;
      latest_conversation_last_message_at: string | null;
    };
    const pairsByKey = new Map<string, Pair>();
    for (const m of msgs) {
      const conv = convoById.get((m as any).conversation_id);
      if (!conv) continue;
      const supplierId = conv.supplier_contact_id;
      const accountId = conv.email_account_id;
      if (!supplierId || !accountId) continue;
      if (accountIdSet.size > 0 && !accountIdSet.has(accountId)) continue;
      const senderId = (m as any).sent_by_user_id as string;
      const sentAt = (m as any).sent_at as string;
      const key = `${supplierId}::${accountId}`;
      let pair = pairsByKey.get(key);
      if (!pair) {
        pair = {
          supplier_id: supplierId,
          account_id: accountId,
          teammates_contacted: new Set(),
          per_teammate_count: new Map(),
          last_contact_at: sentAt,
          latest_conversation_id: conv.id,
          latest_conversation_subject: conv.subject,
          latest_conversation_last_message_at: conv.last_message_at,
        };
        pairsByKey.set(key, pair);
      }
      pair.teammates_contacted.add(senderId);
      pair.per_teammate_count.set(senderId, (pair.per_teammate_count.get(senderId) || 0) + 1);
      if (sentAt > pair.last_contact_at) {
        pair.last_contact_at = sentAt;
        pair.latest_conversation_id = conv.id;
        pair.latest_conversation_subject = conv.subject;
        pair.latest_conversation_last_message_at = conv.last_message_at;
      }
    }
    debug.pairs_total = pairsByKey.size;

    if (pairsByKey.size === 0) {
      return NextResponse.json({ teammates, groups: [], _debug: debug });
    }

    // ── Lookups (suppliers, accounts, statuses, labels) in parallel ─────
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
      supabase.from("labels").select("id, name, color"),
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

    // ── Group pairs by SET of teammates who contacted them ──────────────
    debug.step = "group";
    type Group = {
      key: string;
      teammate_ids: string[];
      label: string;
      rows: any[];
    };
    const groupsByKey = new Map<string, Group>();
    for (const [pairKey, pair] of Array.from(pairsByKey.entries())) {
      // Restrict to selected teammates (paranoia)
      const groupTeammateIds = Array.from(pair.teammates_contacted).filter(id => teammateIds.includes(id)).sort();
      if (groupTeammateIds.length === 0) continue;
      const groupKey = groupTeammateIds.join(",");
      let group = groupsByKey.get(groupKey);
      if (!group) {
        // Build the human label for this group
        const inGroupTeammates = groupTeammateIds.map(id => teammateById.get(id)?.name || "?");
        const isAll = groupTeammateIds.length === teammateIds.length;
        const groupLabel = isAll
          ? `All ${inGroupTeammates.length} contacted`
          : groupTeammateIds.length === 1
            ? `${inGroupTeammates[0]} only`
            : `${inGroupTeammates.join(" + ")} only`;
        group = { key: groupKey, teammate_ids: groupTeammateIds, label: groupLabel, rows: [] };
        groupsByKey.set(groupKey, group);
      }
      const status = statusByPair.get(pairKey) || null;
      // Apply status filter
      if (statusIdFilter === "__none__" && status) continue;
      if (statusIdFilter && statusIdFilter !== "__none__" && status?.id !== statusIdFilter) continue;

      // Per-teammate outbound count, only for teammates in this group
      const perCount: Record<string, number> = {};
      for (const id of groupTeammateIds) perCount[id] = pair.per_teammate_count.get(id) || 0;

      group.rows.push({
        supplier: supplierById.get(pair.supplier_id) || null,
        account: accountById.get(pair.account_id) || null,
        status,
        labels: labelsByConv.get(pair.latest_conversation_id) || [],
        last_contact_at: pair.last_contact_at,
        per_teammate_outbound: perCount,
        latest_conversation: {
          id: pair.latest_conversation_id,
          subject: pair.latest_conversation_subject,
          last_message_at: pair.latest_conversation_last_message_at,
        },
      });
    }

    // Sort rows within each group by most-recent contact descending
    for (const group of Array.from(groupsByKey.values())) {
      group.rows.sort((a: any, b: any) => (b.last_contact_at || "").localeCompare(a.last_contact_at || ""));
    }

    // Sort groups: all-selected first, then by group size desc, then key asc
    const allKey = [...teammateIds].sort().join(",");
    const groups = Array.from(groupsByKey.values()).sort((a, b) => {
      if (a.key === allKey) return -1;
      if (b.key === allKey) return 1;
      if (b.teammate_ids.length !== a.teammate_ids.length) {
        return b.teammate_ids.length - a.teammate_ids.length;
      }
      return a.key.localeCompare(b.key);
    });

    debug.groups_count = groups.length;
    debug.total_rows = groups.reduce((acc, g) => acc + g.rows.length, 0);

    return NextResponse.json({ teammates, groups, _debug: debug });
  } catch (e: any) {
    debug.uncaught_error = e?.message || String(e);
    debug.uncaught_stack = (e?.stack || "").split("\n").slice(0, 5);
    return NextResponse.json({ error: e?.message || "Unknown error", _debug: debug }, { status: 500 });
  }
}
