export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── GET /api/response-times/by-user ────────────────────────────────────────
//
// Aggregated response-time stats per team member. Runs the aggregation
// ENTIRELY in Postgres via the `inbox.user_response_summary` function:
// one DB round-trip returns one row per active team member with avg/min/max/
// count/distinct-supplier-count pre-computed.
//
// Previous versions paged through every response_times row and aggregated
// in Node — slow with hundreds of thousands of rows. This version is
// O(1) round-trips and lets Postgres do what it does best.
//
// Query params:
//   date_from=YYYY-MM-DD (optional)
//   date_to=YYYY-MM-DD   (optional)
//
// Response:
//   { users: [{ user_id, avg_minutes, fastest_minutes, slowest_minutes, total, supplier_count }] }

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const sp = req.nextUrl.searchParams;
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");

  // Convert YYYY-MM-DD into full timestamps. The Postgres function expects
  // timestamptz; passing the start-of-day and end-of-day boundaries matches
  // the behaviour of the old REST-side `.gte/.lte` filters.
  const fromTs = dateFrom ? dateFrom + "T00:00:00Z" : null;
  const toTs = dateTo ? dateTo + "T23:59:59.999Z" : null;

  // Call the Postgres function. RPC returns the aggregated rows directly.
  // The function lives in the `inbox` schema; the client is already scoped
  // to that schema via the server-client factory, so the bare name works.
  const { data, error } = await supabase.rpc("user_response_summary", {
    p_date_from: fromTs,
    p_date_to: toTs,
  });

  if (error) {
    console.error("[/api/response-times/by-user] rpc failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Postgres returns COUNT(rt.id) as 0 for users with no replies (because of
  // the LEFT JOIN). AVG/MIN/MAX come back as NULL in that case. Normalize
  // here so the client renders a clean "no data" state.
  const users = (data || []).map((row: any) => {
    const total = Number(row.total) || 0;
    if (total === 0) {
      return {
        user_id: row.user_id,
        avg_minutes: null,
        fastest_minutes: null,
        slowest_minutes: null,
        total: 0,
        supplier_count: 0,
      };
    }
    return {
      user_id: row.user_id,
      avg_minutes: Math.round(Number(row.avg_minutes)),
      fastest_minutes: row.fastest_minutes,
      slowest_minutes: row.slowest_minutes,
      total,
      supplier_count: Number(row.supplier_count) || 0,
    };
  }).sort((a: any, b: any) => {
    // Users with data first (fastest avg first), then users without data
    const aHas = a.total > 0;
    const bHas = b.total > 0;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas) return (a.avg_minutes || 0) - (b.avg_minutes || 0);
    return 0;
  });

  return NextResponse.json({ users });
}