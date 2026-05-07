export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { calcBusinessHours as sharedCalcBusinessHours, type SupplierHours } from "@/lib/business-hours";

/**
 * GET /api/metrics — Point-in-time SLA snapshots
 *
 * Batch 31 refactor: this endpoint USED to compute everything (response times,
 * per-user stats, business-hours math across the full message log). That was
 * slow and timing out as the dataset grew (~58k messages).
 *
 * Now it returns ONLY the data that's intrinsically point-in-time and has no
 * pre-computed home elsewhere:
 *   - Counts and lists of conversations awaiting our reply
 *   - Counts and lists of conversations awaiting supplier reply
 *
 * Response-time stats (avg, median, per-user, per-supplier) are read from the
 * `response_times` table via /api/response-times?summary=true. That data is
 * wall-clock by design (matches the supplier responsiveness scoring spec).
 *
 * Sort order on awaiting lists is still business-hours-aware so the operator
 * sees what's actually overdue during work hours, not what came in over a
 * weekend.
 */
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const dateFrom = req.nextUrl.searchParams.get("date_from") || null;
  const dateTo = req.nextUrl.searchParams.get("date_to") || null;

  // Build the date-bounded window for "active" conversations
  // (pulling all conversations into memory was the root performance problem)
  let convosQuery = supabase
    .from("conversations")
    .select("id, subject, from_name, from_email, assignee_id, status, last_message_at, supplier_contact_id")
    .neq("status", "trash")
    .neq("from_email", "internal");

  if (dateFrom) convosQuery = convosQuery.gte("last_message_at", dateFrom + "T00:00:00Z");
  if (dateTo) convosQuery = convosQuery.lte("last_message_at", dateTo + "T23:59:59.999Z");

  // Paginate (Supabase caps at 1000 rows per request)
  let conversations: any[] = [];
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await convosQuery.range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    conversations = conversations.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  if (conversations.length === 0) {
    return NextResponse.json({
      overall: { awaiting_our_reply: 0, awaiting_supplier_reply: 0 },
      awaiting_our_reply: [],
      awaiting_supplier_reply: [],
    });
  }

  // For each conversation, we need the LAST message to know who's waiting on whom.
  // Rather than fetching all messages (the old bottleneck), fetch only the most
  // recent message per conversation — much smaller payload.
  //
  // Postgres "DISTINCT ON" is the right tool but Supabase REST doesn't expose it
  // cleanly, so we do a chunked query: fetch the last message_at + is_outbound +
  // sent_by per conversation by querying messages with the conversation IDs
  // we care about, ordered by sent_at DESC, and take the first per conversation.
  const convoIds = conversations.map((c) => c.id);
  const lastMessageByConvo: Record<string, { is_outbound: boolean; sent_at: string }> = {};

  // Query in chunks of 200 IDs to stay well under URL length limits
  const CHUNK = 200;
  for (let i = 0; i < convoIds.length; i += CHUNK) {
    const slice = convoIds.slice(i, i + CHUNK);
    let msgsOffset = 0;
    while (true) {
      const { data: msgs, error: msgsErr } = await supabase
        .from("messages")
        .select("conversation_id, is_outbound, sent_at")
        .in("conversation_id", slice)
        .order("sent_at", { ascending: false })
        .range(msgsOffset, msgsOffset + PAGE - 1);
      if (msgsErr) return NextResponse.json({ error: msgsErr.message }, { status: 500 });
      if (!msgs || msgs.length === 0) break;
      // Take only the FIRST occurrence per conversation (since ordered DESC, that's latest)
      for (const m of msgs) {
        if (!lastMessageByConvo[m.conversation_id]) {
          lastMessageByConvo[m.conversation_id] = { is_outbound: m.is_outbound, sent_at: m.sent_at };
        }
      }
      if (msgs.length < PAGE) break;
      msgsOffset += PAGE;
    }
  }

  // Pull supplier hours for the conversations we have, used for business-hours sort
  const supplierContactIds = Array.from(new Set(
    conversations.map((c) => c.supplier_contact_id).filter(Boolean)
  ));
  const supplierMap: Record<string, SupplierHours> = {};
  if (supplierContactIds.length > 0) {
    // Chunk to stay under PostgREST in() limits
    for (let i = 0; i < supplierContactIds.length; i += 100) {
      const slice = supplierContactIds.slice(i, i + 100);
      const { data: contacts } = await supabase
        .from("supplier_contacts")
        .select("id, timezone, work_start, work_end, work_days")
        .in("id", slice);
      for (const c of (contacts || [])) {
        supplierMap[c.id] = { timezone: c.timezone, work_start: c.work_start, work_end: c.work_end, work_days: c.work_days };
      }
    }
  }

  // Build the awaiting lists. Sort by business-hours-overdue so what's actually
  // urgent during work hours surfaces first.
  const now = new Date();
  const awaitingOurReply: any[] = [];
  const awaitingSupplierReply: any[] = [];

  for (const convo of conversations) {
    const last = lastMessageByConvo[convo.id];
    if (!last) continue; // no messages — skip

    const lastMsgTime = new Date(last.sent_at);
    const wallClockHours = (now.getTime() - lastMsgTime.getTime()) / (1000 * 60 * 60);
    const supplierHours = convo.supplier_contact_id ? (supplierMap[convo.supplier_contact_id] || null) : null;
    const businessHours = sharedCalcBusinessHours(lastMsgTime, now, supplierHours);

    const item = {
      conversation_id: convo.id,
      subject: convo.subject,
      from_name: convo.from_name,
      from_email: convo.from_email,
      assignee_id: convo.assignee_id,
      last_message_at: last.sent_at,
      waiting_hours: Math.round(wallClockHours * 10) / 10,
      waiting_business_hours: Math.round(businessHours * 10) / 10,
    };

    if (last.is_outbound) {
      // We sent the last message — supplier owes us a reply
      awaitingSupplierReply.push(item);
    } else {
      // Supplier sent the last message — we owe them a reply
      awaitingOurReply.push(item);
    }
  }

  // Sort each list by business-hours-overdue (most urgent first during work hours)
  awaitingOurReply.sort((a, b) => b.waiting_business_hours - a.waiting_business_hours);
  awaitingSupplierReply.sort((a, b) => b.waiting_business_hours - a.waiting_business_hours);

  return NextResponse.json({
    overall: {
      awaiting_our_reply: awaitingOurReply.length,
      awaiting_supplier_reply: awaitingSupplierReply.length,
    },
    awaiting_our_reply: awaitingOurReply,
    awaiting_supplier_reply: awaitingSupplierReply,
  });
}