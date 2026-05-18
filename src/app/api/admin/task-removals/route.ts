/**
 * GET /api/admin/task-removals
 *
 * Returns the task_removals audit log for the dashboard "Removals" tab.
 * Admin-only (caller must pass actor_id query param and that team_member
 * must have role = "admin").
 *
 * Query params:
 *   actor_id?   string  team_members.id of the caller (required, used for admin check)
 *   since?      ISO     only rows with removed_at >= since
 *   until?      ISO     only rows with removed_at <= until
 *   removed_by? string  filter to one team_member
 *   sole_only?  "true"  if set, only include rows where was_sole_assignee = true
 *   limit?      number  cap, default 500
 *
 * Response 200:
 *   {
 *     rows: [
 *       { id, task_id, removed_by, reason, removed_at, was_sole_assignee,
 *         task_text, task_status, conversation_id,
 *         remover: { id, name, initials, color }
 *       }, ...
 *     ],
 *     summary: {
 *       total: number,
 *       sole: number,
 *       in_window: number,    // last 7 days
 *       short_reason: number, // <= 10 chars after trim (abuse signal)
 *       by_user: [{ id, name, count }],
 *       top_remover: { id, name, count } | null,
 *     }
 *   }
 *
 * Response 403 if caller isn't admin.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const params = req.nextUrl.searchParams;

    const actorId = params.get("actor_id");
    if (!actorId) {
      return NextResponse.json({ error: "actor_id is required" }, { status: 400 });
    }

    // Admin gate.
    const { data: actor } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", actorId)
      .maybeSingle();
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    const since = params.get("since");
    const until = params.get("until");
    const removedBy = params.get("removed_by");
    const soleOnly = params.get("sole_only") === "true";
    const limit = Math.min(parseInt(params.get("limit") || "500", 10) || 500, 2000);

    let q = supabase
      .from("task_removals")
      .select(
        "id, task_id, removed_by, reason, removed_at, was_sole_assignee, task_text, task_status, conversation_id, remover:team_members!task_removals_removed_by_fkey(id, name, initials, color)"
      )
      .order("removed_at", { ascending: false })
      .limit(limit);

    if (since) q = q.gte("removed_at", since);
    if (until) q = q.lte("removed_at", until);
    if (removedBy) q = q.eq("removed_by", removedBy);
    if (soleOnly) q = q.eq("was_sole_assignee", true);

    const { data, error } = await q;
    if (error) {
      // The audit-table foreign key might not exist on older deployments;
      // retry without the join so the UI still loads with raw rows.
      const fallback = await supabase
        .from("task_removals")
        .select("*")
        .order("removed_at", { ascending: false })
        .limit(limit);
      if (fallback.error) {
        return NextResponse.json({ error: fallback.error.message }, { status: 500 });
      }
      return buildResponse(fallback.data || []);
    }

    return buildResponse(data || []);
  } catch (err: any) {
    console.error("GET /api/admin/task-removals failed:", err);
    return NextResponse.json(
      { error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}

function buildResponse(rows: any[]) {
  const total = rows.length;
  const sole = rows.filter((r) => r.was_sole_assignee).length;
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const in_window = rows.filter((r) => {
    const t = r.removed_at ? new Date(r.removed_at).getTime() : 0;
    return t >= sevenDaysAgo;
  }).length;
  // Short-reason heuristic: trimmed reason <= 10 chars. Useful signal for
  // abuse (one-word brush-offs like "ok", "done", "no", "n/a").
  const short_reason = rows.filter(
    (r) => (r.reason || "").trim().length <= 10
  ).length;

  // Aggregate by user
  const byUser = new Map<string, { id: string; name: string; count: number }>();
  for (const r of rows) {
    const id = r.removed_by || "unknown";
    const name = r.remover?.name || "Unknown";
    const cur = byUser.get(id) || { id, name, count: 0 };
    cur.count += 1;
    byUser.set(id, cur);
  }
  const byUserArr = Array.from(byUser.values()).sort((a, b) => b.count - a.count);
  const top_remover = byUserArr[0] || null;

  return NextResponse.json({
    rows,
    summary: {
      total,
      sole,
      in_window,
      short_reason,
      by_user: byUserArr,
      top_remover,
    },
  });
}
