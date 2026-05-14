import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * GET /api/suppliers
 *
 * Returns the list of suppliers (rows in inbox.supplier_contacts) together
 * with the email accounts they have engaged with (derived from
 * inbox.conversations.email_account_id WHERE supplier_contact_id = X).
 *
 * Each supplier row carries:
 *   - id, name, email, company
 *   - responsiveness_score, responsiveness_tier, qualifying_exchanges
 *   - last_engagement_at  (MAX of conversations.last_message_at)
 *   - accounts: [{ id, name, email }]
 *
 * Sorted by last_engagement_at DESC (most recent activity first), then name.
 */
export async function GET(_req: NextRequest) {
  const supabase = createServerClient();

  // 1. Fetch all supplier_contacts (basic fields + scoring)
  const { data: suppliers, error: sErr } = await supabase
    .from("supplier_contacts")
    .select(
      "id, name, email, company, responsiveness_score, responsiveness_tier, qualifying_exchanges, last_exchange_at"
    );
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  // 2. Fetch all email accounts (small set — 3 today) for chip metadata
  const { data: accounts, error: aErr } = await supabase
    .from("email_accounts")
    .select("id, name, email, icon, color")
    .eq("is_active", true);
  if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

  const accountMap = new Map<string, any>();
  (accounts || []).forEach((a: any) => accountMap.set(a.id, a));

  if (!suppliers || suppliers.length === 0) {
    return NextResponse.json({ suppliers: [], accounts: accounts || [] });
  }

  // 3. Fetch engagement signals to derive which accounts each supplier engages with.
  //    Two signals run in parallel:
  //      A. conversations.supplier_contact_id backlink — covers manually-created
  //         suppliers (via CreateConversation) before any email exchange happens.
  //      B. response_times.supplier_email + email_account_id — the authoritative
  //         source. Every supplier hydrated by the score-suppliers cron has rows
  //         here, and supplier_email is already lowercased on insert.
  //    response_times can grow large; paginate by 1000 to be safe.
  const supplierIds = suppliers.map((s: any) => s.id);
  const supplierEmails = new Set(
    suppliers.map((s: any) => (s.email || "").toLowerCase()).filter(Boolean)
  );

  // Paginated fetch of response_times (small per-row footprint: 3 columns)
  const responseTimes: { supplier_email: string; email_account_id: string | null; response_sent_at: string | null }[] = [];
  {
    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data: rtBatch, error: rtErr } = await supabase
        .from("response_times")
        .select("supplier_email, email_account_id, response_sent_at")
        .not("supplier_email", "is", null)
        .range(offset, offset + PAGE - 1);
      if (rtErr) {
        return NextResponse.json({ error: rtErr.message }, { status: 500 });
      }
      if (!rtBatch || rtBatch.length === 0) break;
      responseTimes.push(...(rtBatch as any));
      if (rtBatch.length < PAGE) break;
      offset += PAGE;
      // Safety cap
      if (offset > 100000) break;
    }
  }

  // Signal A: conversations with supplier_contact_id backlink
  const { data: byIdData, error: byIdErr } = await supabase
    .from("conversations")
    .select("supplier_contact_id, email_account_id, last_message_at")
    .in("supplier_contact_id", supplierIds);
  if (byIdErr) {
    return NextResponse.json({ error: byIdErr.message }, { status: 500 });
  }
  const byIdRes = { data: byIdData };

  // 4. Aggregate per supplier — union account ids from both signals.
  type Agg = {
    accountIds: Set<string>;
    lastEngagementAt: string | null;
  };
  const byId = new Map<string, Agg>();

  // Helper: ensure-get an aggregation bucket
  const ensure = (key: string): Agg => {
    let entry = byId.get(key);
    if (!entry) {
      entry = { accountIds: new Set<string>(), lastEngagementAt: null };
      byId.set(key, entry);
    }
    return entry;
  };

  // Signal A: conversations with explicit supplier_contact_id backlink
  (byIdRes.data || []).forEach((c: any) => {
    if (!c.supplier_contact_id) return;
    const entry = ensure(c.supplier_contact_id);
    if (c.email_account_id) entry.accountIds.add(c.email_account_id);
    if (
      c.last_message_at &&
      (!entry.lastEngagementAt || c.last_message_at > entry.lastEngagementAt)
    ) {
      entry.lastEngagementAt = c.last_message_at;
    }
  });

  // Signal B: response_times rows matched by supplier_email — map back to supplier id
  const emailToSupplierId = new Map<string, string>();
  suppliers.forEach((s: any) => {
    const e = (s.email || "").toLowerCase();
    if (e) emailToSupplierId.set(e, s.id);
  });
  responseTimes.forEach((r: any) => {
    const e = (r.supplier_email || "").toLowerCase();
    if (!e || !supplierEmails.has(e)) return;
    const sid = emailToSupplierId.get(e);
    if (!sid) return;
    const entry = ensure(sid);
    if (r.email_account_id) entry.accountIds.add(r.email_account_id);
    if (
      r.response_sent_at &&
      (!entry.lastEngagementAt || r.response_sent_at > entry.lastEngagementAt)
    ) {
      entry.lastEngagementAt = r.response_sent_at;
    }
  });

  // 5. Build response rows
  const rows = suppliers.map((s: any) => {
    const agg = byId.get(s.id);
    const accountIds = agg ? Array.from(agg.accountIds) : [];
    const supplierAccounts = accountIds
      .map((id) => accountMap.get(id))
      .filter(Boolean)
      .map((a: any) => ({ id: a.id, name: a.name, email: a.email, icon: a.icon, color: a.color }));
    return {
      id: s.id,
      name: s.name,
      email: s.email,
      company: s.company,
      responsiveness_score: s.responsiveness_score,
      responsiveness_tier: s.responsiveness_tier,
      qualifying_exchanges: s.qualifying_exchanges,
      last_engagement_at: agg?.lastEngagementAt || s.last_exchange_at || null,
      accounts: supplierAccounts,
    };
  });

  // 6. Sort: most-recent engagement first; tie-break by name
  rows.sort((a: any, b: any) => {
    const ta = a.last_engagement_at ? new Date(a.last_engagement_at).getTime() : 0;
    const tb = b.last_engagement_at ? new Date(b.last_engagement_at).getTime() : 0;
    if (ta !== tb) return tb - ta;
    return (a.name || a.email || "").localeCompare(b.name || b.email || "");
  });

  return NextResponse.json({ suppliers: rows, accounts: accounts || [] });
}