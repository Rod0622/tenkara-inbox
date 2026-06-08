import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * GET /api/outreach-tracker/options
 *
 * Returns the lookup data the tracker's filter row needs:
 *   • accounts    — every email account the user can see (RLS-filtered)
 *   • statuses    — full outreach_statuses list (ordered)
 *   • assignees   — every active user (role != 'disabled')
 *   • labels      — the full labels catalog (both top-level and children).
 *                   The page splits these client-side by parent_label_id
 *                   into the two filter dropdowns (Label / Sublabel).
 *
 * Called once on page mount. The lists are small (handful of accounts,
 * 18 statuses, <100 team members, <100 labels), so we send them all
 * rather than paginate.
 */
export async function GET() {
  const supabase = createServerClient();

  const [accountsRes, statusesRes, assigneesRes, labelsRes] = await Promise.all([
    supabase
      .from("email_accounts")
      .select("id, name, email")
      .order("name", { ascending: true }),
    supabase
      .from("outreach_statuses")
      .select("id, name, sort_order, color")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("team_members")
      .select("id, name, initials, color, avatar_url, role")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabase
      .from("labels")
      .select("id, name, parent_label_id, color")
      .order("name", { ascending: true }),
  ]);

  if (accountsRes.error) {
    return NextResponse.json({ error: accountsRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    accounts:  accountsRes.data  || [],
    statuses:  statusesRes.data  || [],
    assignees: assigneesRes.data || [],
    labels:    labelsRes.data    || [],
  });
}