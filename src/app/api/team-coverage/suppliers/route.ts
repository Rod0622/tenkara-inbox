export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/team-coverage/suppliers ───────────────────────────────────
//
// Supplier-first cut of Team Coverage (Batch 7).
// Returns a paginated list of suppliers with per-supplier aggregates:
//   - account_count   — how many of the company's email accounts this
//                       supplier has been contacted from
//   - teammate_count  — how many distinct teammates have sent outbound
//                       messages to this supplier
//   - total_outbound  — total outbound messages sent to this supplier
//                       across every account
//   - last_contact_at — latest outbound message timestamp
//   - statuses_by_account — supplier_account_status assignments
//
// Query params:
//   - q          : free-text match against name + email (case-insensitive)
//   - account_ids: comma-separated; supplier shown only if it has at
//                  least one conversation in any of these accounts
//   - status_id  : comma-separated; supplier shown only if it has at
//                  least one matching supplier_account_status. Sentinel
//                  "__none__" matches suppliers without any status row.
//   - sort       : "name" | "last_contact" | "outbound" | "accounts"
//                  | "teammates"  (default: "last_contact")
//   - order      : "asc" | "desc"  (default: "desc")
//   - limit      : page size  (default 50, max 200)
//   - offset     : page offset (default 0)
//
// Implementation: ONE aggregation pass over all relevant data. Pagination
// is applied AFTER aggregation + sort so users can sort by computed
// columns. Bounded by supplier count + outbound message count; both
// reasonable at Rod's scale (hundreds to low thousands of each).
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const params = req.nextUrl.searchParams;

  const q          = (params.get("q") || "").trim().toLowerCase();
  const accountIds = (params.get("account_ids") || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const statusIds  = (params.get("status_id") || params.get("status_ids") || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  const sort       = params.get("sort")  || "last_contact";
  const order      = (params.get("order") || "desc") === "asc" ? "asc" : "desc";
  // Cap raised: Batch 7 follow-up — Rod prefers no pagination, just scroll.
  // Default request from the UI is now `limit=5000` (effectively "all").
  const limit      = Math.min(parseInt(params.get("limit")  || "50", 10), 5000);
  const offset     = Math.max(parseInt(params.get("offset") || "0", 10), 0);

  // ── Parallel raw data fetches ─────────────────────────────────────
  const [
    suppliersRes,
    conversationsRes,
    messagesRes,
    accountsRes,
    teamMembersRes,
    statusAssignsRes,
    statusDefsRes,
  ] = await Promise.all([
    supabase
      .from("supplier_contacts")
      .select("id, name, email"),
    supabase
      .from("conversations")
      .select("id, supplier_contact_id, email_account_id, last_message_at")
      .not("supplier_contact_id", "is", null)
      .neq("status", "merged"),
    supabase
      .from("messages")
      .select("conversation_id, sent_at, sent_by_user_id")
      .eq("is_outbound", true)
      .not("conversation_id", "is", null)
      .not("sent_by_user_id", "is", null)
      .limit(50000),
    supabase
      .from("email_accounts")
      .select("id, name"),
    supabase
      .from("team_members")
      .select("id, name, initials, color"),
    supabase
      .from("supplier_account_statuses")
      .select("supplier_contact_id, email_account_id, status_id"),
    supabase
      .from("supplier_statuses")
      .select("id, name, color, background_color"),
  ]);

  for (const r of [suppliersRes, conversationsRes, messagesRes, accountsRes, teamMembersRes, statusAssignsRes, statusDefsRes]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 });
  }

  const suppliers      = (suppliersRes.data      || []) as any[];
  const conversations  = (conversationsRes.data  || []) as any[];
  const messages       = (messagesRes.data       || []) as any[];
  const accounts       = (accountsRes.data       || []) as any[];
  const teamMembers    = (teamMembersRes.data    || []) as any[];
  const statusAssigns  = (statusAssignsRes.data  || []) as any[];
  const statusDefs     = (statusDefsRes.data     || []) as any[];

  const accountById   = new Map<string, any>(accounts.map(a => [a.id, a]));
  const teamMemberById = new Map<string, any>(teamMembers.map(t => [t.id, t]));
  const statusById    = new Map<string, any>(statusDefs.map(s => [s.id, s]));

  // Conversation lookup — supplier_contact_id + email_account_id per conversation
  const convoById = new Map<string, any>(conversations.map(c => [c.id, c]));

  // ── Build per-supplier aggregates ────────────────────────────────
  type Agg = {
    id: string;
    name: string | null;
    email: string | null;
    account_set: Set<string>;
    teammate_set: Set<string>;
    total_outbound: number;
    last_contact_at: string | null;
    statuses_by_account: { account_id: string; account_name: string | null; status_id: string | null;
                          status_name: string | null; status_color: string | null; status_bg_color: string | null }[];
  };
  const aggBySupplier = new Map<string, Agg>();
  for (const s of suppliers) {
    aggBySupplier.set(s.id, {
      id: s.id,
      name: s.name || null,
      email: s.email || null,
      account_set: new Set(),
      teammate_set: new Set(),
      total_outbound: 0,
      last_contact_at: null,
      statuses_by_account: [],
    });
  }

  // Accounts: derived from conversations (a supplier appears in account X
  // if they have a conversation in account X)
  for (const c of conversations) {
    const a = aggBySupplier.get(c.supplier_contact_id);
    if (!a) continue;
    if (c.email_account_id) a.account_set.add(c.email_account_id);
  }

  // Outbound messages: walk every outbound message, look up its conversation,
  // and credit the supplier with one outbound + one distinct teammate.
  for (const m of messages) {
    const conv = convoById.get(m.conversation_id);
    if (!conv) continue;
    const supplierId = conv.supplier_contact_id;
    if (!supplierId) continue;
    const a = aggBySupplier.get(supplierId);
    if (!a) continue;
    a.total_outbound++;
    if (m.sent_by_user_id) a.teammate_set.add(m.sent_by_user_id);
    if (m.sent_at) {
      if (!a.last_contact_at || m.sent_at > a.last_contact_at) {
        a.last_contact_at = m.sent_at;
      }
    }
  }

  // Statuses: assign + resolve names
  for (const sa of statusAssigns) {
    const a = aggBySupplier.get(sa.supplier_contact_id);
    if (!a) continue;
    const acct = accountById.get(sa.email_account_id);
    const st = sa.status_id ? statusById.get(sa.status_id) : null;
    a.statuses_by_account.push({
      account_id: sa.email_account_id,
      account_name: acct?.name || null,
      status_id: sa.status_id || null,
      status_name: st?.name || null,
      status_color: st?.color || null,
      status_bg_color: st?.background_color || null,
    });
  }

  // ── Apply filters ────────────────────────────────────────────────
  let rows = Array.from(aggBySupplier.values()).filter(a => {
    // Only suppliers with at least one conversation (skips dead contact rows)
    if (a.account_set.size === 0) return false;
    return true;
  });

  if (q) {
    rows = rows.filter(a =>
      (a.name || "").toLowerCase().includes(q) ||
      (a.email || "").toLowerCase().includes(q)
    );
  }
  if (accountIds.length > 0) {
    rows = rows.filter(a => {
      for (const aid of accountIds) if (a.account_set.has(aid)) return true;
      return false;
    });
  }
  if (statusIds.length > 0) {
    const wantsNone = statusIds.includes("__none__");
    const realIds = new Set(statusIds.filter(s => s !== "__none__"));
    rows = rows.filter(a => {
      // "No status" matches if supplier has no status row OR all rows are null
      const hasAny = a.statuses_by_account.some(s => s.status_id);
      if (wantsNone && !hasAny) return true;
      if (realIds.size > 0) {
        for (const s of a.statuses_by_account) {
          if (s.status_id && realIds.has(s.status_id)) return true;
        }
      }
      return false;
    });
  }

  // ── Sort ─────────────────────────────────────────────────────────
  const mul = order === "asc" ? 1 : -1;
  const cmpStr = (a: string | null, b: string | null) =>
    (a || "").localeCompare(b || "", undefined, { sensitivity: "base" });
  rows.sort((x, y) => {
    switch (sort) {
      case "name":         return mul * cmpStr(x.name, y.name);
      case "outbound":     return mul * (x.total_outbound - y.total_outbound);
      case "accounts":     return mul * (x.account_set.size - y.account_set.size);
      case "teammates":    return mul * (x.teammate_set.size - y.teammate_set.size);
      case "last_contact":
      default:             return mul * cmpStr(x.last_contact_at, y.last_contact_at);
    }
  });

  const total = rows.length;
  const paged = rows.slice(offset, offset + limit);

  return NextResponse.json({
    suppliers: paged.map(a => {
      // Resolve account_set IDs → {id, name} objects (sorted by name for stable display)
      const accountList = Array.from(a.account_set)
        .map(id => {
          const acct = accountById.get(id);
          return acct ? { id: acct.id, name: acct.name } : null;
        })
        .filter(Boolean)
        .sort((x: any, y: any) => (x.name || "").localeCompare(y.name || ""));
      // Resolve teammate_set IDs → {id, name, initials, color} objects
      const teammateList = Array.from(a.teammate_set)
        .map(id => {
          const tm = teamMemberById.get(id);
          return tm ? { id: tm.id, name: tm.name, initials: tm.initials, color: tm.color } : null;
        })
        .filter(Boolean)
        .sort((x: any, y: any) => (x.name || "").localeCompare(y.name || ""));
      return {
        id: a.id,
        name: a.name,
        email: a.email,
        accounts: accountList,
        teammates: teammateList,
        // Counts retained for sort stability + backward compatibility
        account_count: accountList.length,
        teammate_count: teammateList.length,
        total_outbound: a.total_outbound,
        last_contact_at: a.last_contact_at,
        statuses_by_account: a.statuses_by_account,
      };
    }),
    total,
    limit,
    offset,
  });
}