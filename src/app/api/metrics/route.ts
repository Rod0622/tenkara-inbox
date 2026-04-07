import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { calcBusinessHours as sharedCalcBusinessHours, type SupplierHours } from "@/lib/business-hours";

// GET /api/metrics — Compute SLA/KPI metrics
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const dateFrom = req.nextUrl.searchParams.get("date_from") || null;
  const dateTo = req.nextUrl.searchParams.get("date_to") || null;

  // ── 1. Fetch all conversations with their messages ──
  let convosQuery = supabase
    .from("conversations")
    .select("id, subject, from_name, from_email, assignee_id, status, email_account_id, last_message_at, created_at, supplier_contact_id")
    .neq("status", "trash")
    .neq("from_email", "internal"); // Exclude internal conversations

  const { data: conversations } = await convosQuery;

  // ── 2. Fetch all messages with timestamps ──
  let msgsQuery = supabase
    .from("messages")
    .select("id, conversation_id, is_outbound, sent_at, from_email, sent_by_user_id")
    .order("sent_at", { ascending: true });

  const { data: allMessages } = await msgsQuery;

  // Group messages by conversation
  const msgsByConvo: Record<string, any[]> = {};
  for (const msg of (allMessages || [])) {
    if (!msgsByConvo[msg.conversation_id]) msgsByConvo[msg.conversation_id] = [];
    msgsByConvo[msg.conversation_id].push(msg);
  }

  // ── 2b. Fetch supplier contacts for timezone-aware business hours ──
  const supplierContactIds = Array.from(new Set(
    (conversations || []).map((c: any) => c.supplier_contact_id).filter(Boolean)
  ));
  const supplierMap: Record<string, SupplierHours> = {};
  if (supplierContactIds.length > 0) {
    const { data: contacts } = await supabase
      .from("supplier_contacts")
      .select("id, timezone, work_start, work_end, work_days")
      .in("id", supplierContactIds);
    for (const c of (contacts || [])) {
      supplierMap[c.id] = { timezone: c.timezone, work_start: c.work_start, work_end: c.work_end, work_days: c.work_days };
    }
  }

  // ── 3. Compute per-conversation metrics ──
  const now = new Date();
  const awaitingOurReply: any[] = [];
  const awaitingSupplierReply: any[] = [];
  const responseTimes: { conversation_id: string; user_id: string | null; response_hours: number; sent_at: string }[] = [];

  for (const convo of (conversations || [])) {
    const msgs = msgsByConvo[convo.id] || [];
    if (msgs.length === 0) continue;

    // Apply date filter on conversation activity
    if (dateFrom && convo.last_message_at < dateFrom) continue;
    if (dateTo && convo.created_at > dateTo + "T23:59:59.999Z") continue;

    const supplierHours = convo.supplier_contact_id ? (supplierMap[convo.supplier_contact_id] || null) : null;
    const lastMsg = msgs[msgs.length - 1];
    const lastMsgTime = new Date(lastMsg.sent_at);
    const hoursSinceLastMsg = (now.getTime() - lastMsgTime.getTime()) / (1000 * 60 * 60);

    if (lastMsg.is_outbound) {
      // We sent the last message — waiting for supplier reply
      awaitingSupplierReply.push({
        conversation_id: convo.id,
        subject: convo.subject,
        from_name: convo.from_name,
        from_email: convo.from_email,
        assignee_id: convo.assignee_id,
        last_message_at: lastMsg.sent_at,
        waiting_hours: Math.round(hoursSinceLastMsg * 10) / 10,
        waiting_business_hours: sharedCalcBusinessHours(lastMsgTime, now, supplierHours),
      });
    } else {
      // Supplier sent the last message — waiting for our reply
      awaitingOurReply.push({
        conversation_id: convo.id,
        subject: convo.subject,
        from_name: convo.from_name,
        from_email: convo.from_email,
        assignee_id: convo.assignee_id,
        last_message_at: lastMsg.sent_at,
        waiting_hours: Math.round(hoursSinceLastMsg * 10) / 10,
        waiting_business_hours: sharedCalcBusinessHours(lastMsgTime, now, supplierHours),
      });
    }

    // ── Calculate response times ──
    // For each inbound message, find the next outbound message = response time
    for (let i = 0; i < msgs.length; i++) {
      if (msgs[i].is_outbound) continue; // Skip outbound

      // Find next outbound after this inbound
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].is_outbound) {
          const inboundTime = new Date(msgs[i].sent_at);
          const responseTime = new Date(msgs[j].sent_at);
          const diffHours = (responseTime.getTime() - inboundTime.getTime()) / (1000 * 60 * 60);
          const businessHours = sharedCalcBusinessHours(inboundTime, responseTime, supplierHours);

          // Apply date filter on the response
          if (dateFrom && msgs[j].sent_at < dateFrom) break;
          if (dateTo && msgs[j].sent_at > dateTo + "T23:59:59.999Z") break;

          responseTimes.push({
            conversation_id: convo.id,
            user_id: msgs[j].sent_by_user_id || convo.assignee_id || null,
            response_hours: Math.round(businessHours * 10) / 10,
            sent_at: msgs[j].sent_at,
          });
          break; // Only count first response per inbound
        }
      }
    }
  }

  // ── 4. Aggregate per-user response time stats ──
  const userResponseStats: Record<string, { total: number; count: number; fastest: number; slowest: number }> = {};

  for (const rt of responseTimes) {
    const uid = rt.user_id || "unassigned";
    if (!userResponseStats[uid]) {
      userResponseStats[uid] = { total: 0, count: 0, fastest: Infinity, slowest: 0 };
    }
    userResponseStats[uid].total += rt.response_hours;
    userResponseStats[uid].count += 1;
    userResponseStats[uid].fastest = Math.min(userResponseStats[uid].fastest, rt.response_hours);
    userResponseStats[uid].slowest = Math.max(userResponseStats[uid].slowest, rt.response_hours);
  }

  const perUserStats = Object.entries(userResponseStats).map(([userId, stats]) => ({
    user_id: userId,
    avg_response_hours: Math.round((stats.total / stats.count) * 10) / 10,
    fastest_response_hours: stats.fastest === Infinity ? 0 : Math.round(stats.fastest * 10) / 10,
    slowest_response_hours: Math.round(stats.slowest * 10) / 10,
    total_responses: stats.count,
  }));

  // ── 5. Overall stats ──
  const allResponseHours = responseTimes.map((r) => r.response_hours);
  const overallAvg = allResponseHours.length > 0
    ? Math.round((allResponseHours.reduce((a, b) => a + b, 0) / allResponseHours.length) * 10) / 10
    : 0;

  // Sort awaiting lists by longest wait first
  awaitingOurReply.sort((a, b) => b.waiting_business_hours - a.waiting_business_hours);
  awaitingSupplierReply.sort((a, b) => b.waiting_business_hours - a.waiting_business_hours);

  return NextResponse.json({
    overall: {
      avg_response_hours: overallAvg,
      total_responses: responseTimes.length,
      awaiting_our_reply: awaitingOurReply.length,
      awaiting_supplier_reply: awaitingSupplierReply.length,
    },
    per_user: perUserStats,
    awaiting_our_reply: awaitingOurReply,
    awaiting_supplier_reply: awaitingSupplierReply,
  });
}

// Business hours calculation now uses shared utility from @/lib/business-hours