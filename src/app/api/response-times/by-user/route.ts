export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── GET /api/response-times/by-user ────────────────────────────────────────
//
// Aggregated response-time stats per team member, plus all active team
// members (even those with zero replies in the period). Replaces the
// "fetch all rows + aggregate in JS" pattern that was making the SLA tab
// slow and was also hiding users who never replied.
//
// Query params:
//   date_from=YYYY-MM-DD (optional)
//   date_to=YYYY-MM-DD   (optional)
//
// Response:
//   {
//     users: [
//       {
//         user_id: string,
//         avg_minutes: number | null,
//         fastest_minutes: number | null,
//         slowest_minutes: number | null,
//         total: number,
//         supplier_count: number  // distinct suppliers replied to
//       },
//       ...
//     ]
//   }
//
// Strategy:
//   1. Fetch all active team_members (small table — typically <50 rows).
//   2. Page through response_times where direction=team_reply, selecting
//      only the lean columns we need (team_member_id, response_minutes,
//      supplier_email). Skips conversation metadata + subject/assignee
//      lookups which used to inflate the payload.
//   3. Aggregate per-user in memory. Result is one row per user, joined
//      against the team_members list so users with zero replies are
//      included with null stats and total=0.
//
// For the per-supplier expansion (used when the user expands a row in
// the dashboard table), see /api/response-times/by-user/[id]/suppliers
// which lazy-loads only when needed.

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const sp = req.nextUrl.searchParams;
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");

  // 1. All active team members. Always returned, even with zero stats.
  const { data: members, error: memErr } = await supabase
    .from("team_members")
    .select("id, name, initials, color, department")
    .eq("is_active", true);
  if (memErr) {
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }
  const memberIds = (members || []).map((m: any) => m.id);

  // 2. Page through response_times with lean columns only. Filter to
  // team_reply rows whose team_member_id is in our active member set.
  // The `.in("team_member_id", memberIds)` filter is critical — without
  // it we'd pull team_replies from offboarded/deleted users we don't
  // care about.
  let allRows: { team_member_id: string; response_minutes: number; supplier_email: string | null }[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase
      .from("response_times")
      .select("team_member_id, response_minutes, supplier_email")
      .eq("direction", "team_reply")
      .in("team_member_id", memberIds)
      .order("response_sent_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (dateFrom) q = q.gte("response_sent_at", dateFrom + "T00:00:00Z");
    if (dateTo) q = q.lte("response_sent_at", dateTo + "T23:59:59Z");

    const { data: batch, error: batErr } = await q;
    if (batErr) return NextResponse.json({ error: batErr.message }, { status: 500 });
    if (!batch || batch.length === 0) break;
    allRows = allRows.concat(batch as any[]);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  // 3. Aggregate per user
  type Agg = { mins: number[]; suppliers: Set<string> };
  const byUser: Record<string, Agg> = {};
  for (const r of allRows) {
    if (!r.team_member_id) continue;
    if (!byUser[r.team_member_id]) byUser[r.team_member_id] = { mins: [], suppliers: new Set() };
    byUser[r.team_member_id].mins.push(r.response_minutes);
    if (r.supplier_email) byUser[r.team_member_id].suppliers.add(r.supplier_email);
  }

  // 4. Build result joining team_members with aggregated stats. Users with
  // no replies get null stats and total=0 — they still appear so admins
  // can spot who isn't responding.
  const users = (members || []).map((m: any) => {
    const agg = byUser[m.id];
    if (!agg || agg.mins.length === 0) {
      return {
        user_id: m.id,
        avg_minutes: null,
        fastest_minutes: null,
        slowest_minutes: null,
        total: 0,
        supplier_count: 0,
      };
    }
    const sorted = agg.mins.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((acc, x) => acc + x, 0);
    return {
      user_id: m.id,
      avg_minutes: Math.round(sum / sorted.length),
      fastest_minutes: Math.round(sorted[0]),
      slowest_minutes: Math.round(sorted[sorted.length - 1]),
      total: sorted.length,
      supplier_count: agg.suppliers.size,
    };
  }).sort((a: any, b: any) => {
    // Sort: users with data first (by avg ascending = fastest first), then
    // users with no data alphabetically. This keeps the most useful info
    // at the top of the table.
    const aHas = a.total > 0;
    const bHas = b.total > 0;
    if (aHas && !bHas) return -1;
    if (!aHas && bHas) return 1;
    if (aHas && bHas) return (a.avg_minutes || 0) - (b.avg_minutes || 0);
    return 0;
  });

  return NextResponse.json({ users });
}
