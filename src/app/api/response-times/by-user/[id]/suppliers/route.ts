export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── GET /api/response-times/by-user/[id]/suppliers ─────────────────────────
//
// Per-supplier response stats for a single team member. Called lazily by
// the dashboard when the user expands a row in the SLA "Response Times by
// User" table. Splitting this out keeps the initial dashboard load fast
// (only the per-user roll-up is fetched up front).
//
// Query params:
//   date_from=YYYY-MM-DD (optional)
//   date_to=YYYY-MM-DD   (optional)
//
// Response:
//   {
//     suppliers: [
//       { email: string, avg_minutes: number, total: number, subjects: string[] },
//       ...
//     ]
//   }

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

  // Fetch response_times rows for this user only — much smaller scope.
  // We include conversation_id so we can look up subjects in a follow-up
  // query. Paginated for safety on heavy responders.
  let rows: { response_minutes: number; supplier_email: string | null; conversation_id: string | null }[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    let q = supabase
      .from("response_times")
      .select("response_minutes, supplier_email, conversation_id")
      .eq("direction", "team_reply")
      .eq("team_member_id", userId)
      .order("response_sent_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (dateFrom) q = q.gte("response_sent_at", dateFrom + "T00:00:00Z");
    if (dateTo) q = q.lte("response_sent_at", dateTo + "T23:59:59Z");

    const { data: batch, error: batErr } = await q;
    if (batErr) return NextResponse.json({ error: batErr.message }, { status: 500 });
    if (!batch || batch.length === 0) break;
    rows = rows.concat(batch as any[]);
    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  // Group by supplier email + collect distinct conversation ids for subjects
  const bySupplier: Record<string, { mins: number[]; convoIds: Set<string> }> = {};
  for (const r of rows) {
    const key = r.supplier_email || "unknown";
    if (!bySupplier[key]) bySupplier[key] = { mins: [], convoIds: new Set() };
    bySupplier[key].mins.push(r.response_minutes);
    if (r.conversation_id) bySupplier[key].convoIds.add(r.conversation_id);
  }

  // Bulk-fetch subjects for the distinct conversation ids (chunked at 200
  // to stay under Postgrest's IN-list limits)
  const allConvoIds = Array.from(new Set(Object.values(bySupplier).flatMap((s) => Array.from(s.convoIds))));
  const subjectByConvo: Record<string, string> = {};
  for (let i = 0; i < allConvoIds.length; i += 200) {
    const chunk = allConvoIds.slice(i, i + 200);
    const { data: convos } = await supabase
      .from("conversations")
      .select("id, subject")
      .in("id", chunk);
    for (const c of (convos || [])) {
      subjectByConvo[c.id] = c.subject || "";
    }
  }

  // Build final supplier list with stats + subjects
  const suppliers = Object.entries(bySupplier).map(([email, agg]) => {
    const sorted = agg.mins.slice().sort((a, b) => a - b);
    const sum = sorted.reduce((acc, x) => acc + x, 0);
    const subjects = Array.from(agg.convoIds)
      .map((cid) => subjectByConvo[cid])
      .filter((s): s is string => !!s);
    return {
      email,
      avg_minutes: Math.round(sum / sorted.length),
      total: sorted.length,
      subjects,
    };
  }).sort((a, b) => b.total - a.total);

  return NextResponse.json({ suppliers });
}
