export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── GET /api/response-times/by-user/[id]/suppliers ─────────────────────────
//
// Per-supplier response stats for a single team member. Uses the SQL
// function `inbox.user_supplier_breakdown` to do all aggregation in
// Postgres — one round-trip, no row pulling.
//
// The SQL function returns: supplier_email, avg_minutes, total, subjects[].
// Subjects are gathered via a correlated subquery on conversations.
//
// Query params:
//   date_from=YYYY-MM-DD (optional)
//   date_to=YYYY-MM-DD   (optional)

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createServerClient();
  const sp = req.nextUrl.searchParams;
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");
  const userId = params.id;

  if (!userId) {
    return NextResponse.json({ error: "user id required" }, { status: 400 });
  }

  const fromTs = dateFrom ? dateFrom + "T00:00:00Z" : null;
  const toTs = dateTo ? dateTo + "T23:59:59.999Z" : null;

  const { data, error } = await supabase.rpc("user_supplier_breakdown", {
    p_user_id: userId,
    p_date_from: fromTs,
    p_date_to: toTs,
  });

  if (error) {
    console.error("[/api/response-times/by-user/[id]/suppliers] rpc failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const suppliers = (data || []).map((row: any) => ({
    email: row.supplier_email,
    avg_minutes: Math.round(Number(row.avg_minutes)),
    total: Number(row.total),
    subjects: row.subjects || [],
  }));

  return NextResponse.json({ suppliers });
}