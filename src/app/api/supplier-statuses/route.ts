export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/supplier-statuses ─────────────────────────────────────────
//
// Returns every active supplier status, ordered by sort_order. Used by
// the inline status dropdown in:
//   - the Team Coverage page (drill-in view)
//   - the conversation header status badge
//   - the supplier command center
//
// Read-only, no auth gate beyond being signed in to the app (handled by
// middleware). Even non-admins need to see the dropdown options so they
// can change statuses inline.
//
// Inactive statuses (is_active=false) are hidden — they're soft-deleted,
// kept around so existing assignments don't break, but not assignable
// to new things.
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  // Allow an ?include_inactive=1 flag for admin UIs that need to manage
  // the full list (Settings → Supplier Statuses).
  const includeInactive = req.nextUrl.searchParams.get("include_inactive") === "1";

  let query = supabase
    .from("supplier_statuses")
    .select("id, name, color, background_color, sort_order, is_active, created_at, updated_at")
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (!includeInactive) query = query.eq("is_active", true);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ statuses: data || [] });
}
