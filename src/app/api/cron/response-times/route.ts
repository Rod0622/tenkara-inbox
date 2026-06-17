export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { backfillConversation } from "@/app/api/response-times/route";

// ═══════════════════════════════════════════════════════════════
// Cron: /api/cron/response-times — hourly
//
// Keeps inbox.response_times current WITHOUT adding load to the sync
// hot path (computeResponseTime was deliberately removed from sync for
// CPU reasons). This task finds conversations that have had recent
// message activity and recomputes their response_times via the existing
// backfillConversation() helper (which deletes-and-reinserts that one
// conversation's rows, so it is idempotent and safe to re-run).
//
// It is intentionally bounded (LOOKBACK_HOURS + MAX_CONVERSATIONS) so each
// run is small and gentle on the 1 GB / 2-CPU instance. score-suppliers
// (every 6h) then reads the freshly-updated response_times.
//
// Secured by CRON_SECRET header check (matches other cron routes).
// ═══════════════════════════════════════════════════════════════

const LOOKBACK_HOURS = 6;       // reconsider conversations active in this window
const MAX_CONVERSATIONS = 300;  // hard cap per run to protect the instance

export async function GET(req: NextRequest) {
  const startTime = Date.now();

  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "inbox" } }
  );

  const result = {
    success: false as boolean,
    conversations_considered: 0,
    conversations_updated: 0,
    response_time_records_inserted: 0,
    duration_ms: 0,
    errors: [] as string[],
  };

  try {
    const cutoff = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

    // Conversations with recent activity. last_message_at is the cheapest
    // signal that a new message arrived (in either direction).
    const { data: convos, error } = await supabase
      .from("conversations")
      .select("id")
      .neq("status", "trash")
      .gte("last_message_at", cutoff)
      .order("last_message_at", { ascending: false })
      .limit(MAX_CONVERSATIONS);

    if (error) {
      result.errors.push("conversation query: " + error.message);
      result.duration_ms = Date.now() - startTime;
      return NextResponse.json(result, { status: 500 });
    }

    const ids = (convos || []).map((c: any) => c.id);
    result.conversations_considered = ids.length;

    for (const cid of ids) {
      try {
        const count = await backfillConversation(supabase, cid);
        if (count > 0) {
          result.conversations_updated += 1;
          result.response_time_records_inserted += count;
        }
      } catch (e: any) {
        result.errors.push("convo " + cid + ": " + (e?.message || "unknown"));
      }
    }

    result.success = true;
    result.duration_ms = Date.now() - startTime;
    return NextResponse.json(result);
  } catch (e: any) {
    result.errors.push(e?.message || "unknown");
    result.duration_ms = Date.now() - startTime;
    return NextResponse.json(result, { status: 500 });
  }
}