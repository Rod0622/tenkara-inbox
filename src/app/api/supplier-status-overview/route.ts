export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/supplier-status-overview ──────────────────────────────────
//
// Returns ALL active status definitions + ALL status assignments in one
// response. Used by the inbox conversation list's status filter (Batch 6,
// Feature 3) which needs to know:
//   - The full list of statuses to render in the filter dropdown
//   - Every (supplier × account) → status_id assignment so the client can
//     decide which conversations match the active filter
//
// Uses the server client (service role) to bypass RLS on these tables —
// they're internal workflow data and direct browser reads are blocked.
// The same pattern is used everywhere else status data is fetched.
//
// Response:
//   {
//     statuses: [{ id, name, color, background_color }, ...],
//     assignments: [{ supplier_contact_id, email_account_id, status_id }, ...]
//   }
//
// Assignments with status_id=null are omitted from the response (they
// represent rows that have been explicitly cleared and are equivalent
// to "no status" for filtering purposes).
export async function GET() {
  const supabase = createServerClient();

  const [statusRes, assignRes] = await Promise.all([
    supabase
      .from("supplier_statuses")
      .select("id, name, color, background_color")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    supabase
      .from("supplier_account_statuses")
      .select("supplier_contact_id, email_account_id, status_id")
      .not("status_id", "is", null),
  ]);

  if (statusRes.error) {
    return NextResponse.json({ error: statusRes.error.message }, { status: 500 });
  }
  if (assignRes.error) {
    return NextResponse.json({ error: assignRes.error.message }, { status: 500 });
  }

  return NextResponse.json({
    statuses: statusRes.data || [],
    assignments: assignRes.data || [],
  });
}
