export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * GET /api/metrics — Point-in-time SLA snapshots
 *
 * Returns counts + lists of conversations awaiting our reply / awaiting
 * supplier reply.
 *
 * Implementation: calls the Postgres function `inbox.awaiting_reply_summary`
 * which uses DISTINCT ON to find the last message per conversation in a
 * single query. Previously this endpoint paginated through all conversations
 * AND all messages, then did per-conversation business-hours math in Node —
 * which timed out as the dataset grew and made both counts return "—" in the
 * dashboard.
 *
 * Business-hours sorting was dropped from this endpoint as part of the
 * optimization (it required per-supplier timezone/work-hour lookups that
 * blew up the query). Sorting is now by wall-clock hours waiting, which
 * matches what users see in the conversation list anyway. If we need
 * business-hours sort back, we can layer it on top in the client without
 * blocking the initial count.
 */
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const dateFrom = req.nextUrl.searchParams.get("date_from") || null;
  const dateTo = req.nextUrl.searchParams.get("date_to") || null;

  const fromTs = dateFrom ? dateFrom + "T00:00:00Z" : null;
  const toTs = dateTo ? dateTo + "T23:59:59.999Z" : null;

  const { data, error } = await supabase.rpc("awaiting_reply_summary", {
    p_date_from: fromTs,
    p_date_to: toTs,
  });

  if (error) {
    console.error("[/api/metrics] rpc failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The function returns jsonb — Postgres-JS gives it back as a parsed object
  return NextResponse.json(data || {
    overall: { awaiting_our_reply: 0, awaiting_supplier_reply: 0 },
    awaiting_our_reply: [],
    awaiting_supplier_reply: [],
  });
}