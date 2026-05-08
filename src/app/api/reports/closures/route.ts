import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/reports/closures
//
// Returns closure counts per user, optionally scoped by date range and folder.
// Supports two output modes:
//   • mode=summary (default): array of { user_id, user_name, count }
//   • mode=details: array of individual closure rows for a specific user
//
// Query params:
//   start (ISO date, optional) — only count closures on/after this date
//   end (ISO date, optional)   — only count closures on/before this date
//   folder_id (UUID, optional) — only count closures FROM this folder
//   user_id (UUID, optional)   — required when mode=details; otherwise filters summary to one user
//   mode (string, optional)    — "summary" (default) | "details"
//   limit (int, optional)      — for mode=details, max rows (default 100, max 500)
export async function GET(req: NextRequest) {
  const supabase = createServerClient();

  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");
  const folderId = req.nextUrl.searchParams.get("folder_id");
  const userId = req.nextUrl.searchParams.get("user_id");
  const mode = (req.nextUrl.searchParams.get("mode") || "summary").toLowerCase();
  const limit = Math.min(
    parseInt(req.nextUrl.searchParams.get("limit") || "100", 10),
    500
  );

  if (mode === "details") {
    if (!userId) {
      return NextResponse.json(
        { error: "user_id is required for mode=details" },
        { status: 400 }
      );
    }

    let q = supabase
      .from("conversation_closures")
      .select(`
        id,
        closed_at,
        closed_from_folder_id,
        closed_to_folder_id,
        conversation:conversations(id, subject, from_name, from_email),
        from_folder:folders!conversation_closures_closed_from_folder_id_fkey(id, name),
        to_folder:folders!conversation_closures_closed_to_folder_id_fkey(id, name)
      `)
      .eq("closed_by_user_id", userId)
      .order("closed_at", { ascending: false })
      .limit(limit);

    if (start) q = q.gte("closed_at", start);
    if (end) q = q.lte("closed_at", end);
    if (folderId) q = q.eq("closed_from_folder_id", folderId);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ closures: data || [] });
  }

  // Summary mode — counts per user.
  // We pull rows + closed_by_user_id and aggregate in JS, since Supabase doesn't
  // expose a great group_by from the client. For the typical small team (10s of
  // users) and a few hundred closures, this is fine.
  let q = supabase
    .from("conversation_closures")
    .select("closed_by_user_id, closed_at, closed_from_folder_id");

  if (start) q = q.gte("closed_at", start);
  if (end) q = q.lte("closed_at", end);
  if (folderId) q = q.eq("closed_from_folder_id", folderId);
  if (userId) q = q.eq("closed_by_user_id", userId);

  const { data: rows, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Tally per user
  const counts = new Map<string, number>();
  for (const r of (rows || [])) {
    const uid = (r as any).closed_by_user_id;
    if (!uid) continue;
    counts.set(uid, (counts.get(uid) || 0) + 1);
  }

  // Resolve user names
  const userIds = Array.from(counts.keys());
  let userMap = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: members } = await supabase
      .from("team_members")
      .select("id, name")
      .in("id", userIds);
    for (const m of (members || [])) {
      userMap.set((m as any).id, (m as any).name);
    }
  }

  const summary = Array.from(counts.entries())
    .map(([user_id, count]) => ({
      user_id,
      user_name: userMap.get(user_id) || "Unknown",
      count,
    }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({ summary, total_closures: rows?.length || 0 });
}
