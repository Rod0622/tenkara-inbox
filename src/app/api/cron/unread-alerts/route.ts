export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/cron/unread-alerts — Called by Vercel Cron (hourly).
//
// Was previously embedded in /api/cron/sync (every 5 min), which paginated
// through every unread conversation 288 times per day, eating disk I/O.
// Moved here so it runs at most 24 times per day, and we use a smarter
// aggregation query to avoid pulling thousands of rows into memory.
//
// Secured by CRON_SECRET header check.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const supabase = createServerClient();
  const UNREAD_THRESHOLD = 5; // Alert when user has >=5 unread assigned emails
  const COOLDOWN_HOURS = 24;

  try {
    // 1. Get active team members (small table)
    const { data: members, error: membersError } = await supabase
      .from("team_members")
      .select("id, name")
      .eq("is_active", true);
    if (membersError) {
      console.error("[unread-alerts] team_members error:", membersError.message);
      return NextResponse.json({ error: membersError.message }, { status: 500 });
    }
    if (!members || members.length === 0) {
      return NextResponse.json({ message: "No active team members", duration_ms: Date.now() - startTime });
    }

    // 2. For each member, ask Postgres directly for the unread count.
    // count='exact' + head=true returns ONLY the count, no rows — no I/O for row data.
    // This is dramatically cheaper than pulling all unread conversation rows into Node
    // and counting them in memory.
    const counts: Record<string, number> = {};
    for (const m of members) {
      const { count } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("assignee_id", m.id)
        .eq("is_unread", true)
        .neq("status", "trash")
        .neq("status", "merged");
      counts[m.id] = count || 0;
    }

    // 3. Find members exceeding threshold who haven't been alerted in the cooldown window
    const cooldownIso = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();
    const candidates = members.filter((m) => (counts[m.id] || 0) >= UNREAD_THRESHOLD);

    if (candidates.length === 0) {
      return NextResponse.json({
        message: "No members above threshold",
        members_checked: members.length,
        duration_ms: Date.now() - startTime,
      });
    }

    // Bulk-check who's still in cooldown (one query instead of N queries)
    const candidateIds = candidates.map((c) => c.id);
    const { data: recentAlerts } = await supabase
      .from("notifications")
      .select("user_id")
      .in("user_id", candidateIds)
      .eq("type", "unread_alert")
      .gte("created_at", cooldownIso);
    const cooldownSet = new Set((recentAlerts || []).map((r: any) => r.user_id));

    // 4. Insert notifications for those not in cooldown — bulk insert (1 query)
    const toInsert = candidates
      .filter((m) => !cooldownSet.has(m.id))
      .map((m) => ({
        user_id: m.id,
        title: `You have ${counts[m.id]} unread emails`,
        body: `${counts[m.id]} assigned emails are waiting for your attention. Please review and respond.`,
        type: "unread_alert",
      }));

    let alertsCreated = 0;
    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from("notifications").insert(toInsert);
      if (insertError) {
        console.error("[unread-alerts] insert error:", insertError.message);
      } else {
        alertsCreated = toInsert.length;
        console.log(`[unread-alerts] Sent ${alertsCreated} unread alerts to:`, toInsert.map((t) => t.user_id.slice(0, 8)).join(", "));
      }
    }

    return NextResponse.json({
      members_checked: members.length,
      members_above_threshold: candidates.length,
      members_in_cooldown: cooldownSet.size,
      alerts_created: alertsCreated,
      duration_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    console.error("[unread-alerts] Fatal error:", error.message);
    return NextResponse.json({ error: error.message, duration_ms: Date.now() - startTime }, { status: 500 });
  }
}
