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

  // 3. Fetch conversations grouped by supplier_contact_id to derive
  //    which accounts each supplier engaged with + most recent activity.
  //    We only pull supplier_contact_id, email_account_id, last_message_at.
  const supplierIds = suppliers.map((s: any) => s.id);
  const { data: convos, error: cErr } = await supabase
    .from("conversations")
    .select("supplier_contact_id, email_account_id, last_message_at")
    .in("supplier_contact_id", supplierIds);
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  // 4. Aggregate per supplier
  type Agg = {
    accountIds: Set<string>;
    lastEngagementAt: string | null;
  };
  const byId = new Map<string, Agg>();
  (convos || []).forEach((c: any) => {
    if (!c.supplier_contact_id) return;
    let entry = byId.get(c.supplier_contact_id);
    if (!entry) {
      entry = { accountIds: new Set<string>(), lastEngagementAt: null };
      byId.set(c.supplier_contact_id, entry);
    }
    if (c.email_account_id) entry.accountIds.add(c.email_account_id);
    if (
      c.last_message_at &&
      (!entry.lastEngagementAt || c.last_message_at > entry.lastEngagementAt)
    ) {
      entry.lastEngagementAt = c.last_message_at;
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
