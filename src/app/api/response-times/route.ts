export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/response-times ──
// Query params:
//   ?supplier_email=x  — get response times for a specific supplier
//   ?supplier_domain=x — get response times for all suppliers on a domain
//   ?team_member_id=x  — get response times for a specific team member
//   ?direction=supplier_reply|team_reply — filter by direction
//   ?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD — date range filter
//   ?summary=true — return aggregated stats instead of individual records
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const sp = req.nextUrl.searchParams;

  const supplierEmail = sp.get("supplier_email");
  const supplierDomain = sp.get("supplier_domain");
  const teamMemberId = sp.get("team_member_id");
  const direction = sp.get("direction");
  const dateFrom = sp.get("date_from");
  const dateTo = sp.get("date_to");
  const summary = sp.get("summary") === "true";

  let query = supabase
    .from("response_times")
    .select("*")
    .order("response_sent_at", { ascending: false });

  if (supplierEmail) query = query.eq("supplier_email", supplierEmail.toLowerCase());
  if (supplierDomain) query = query.eq("supplier_domain", supplierDomain.toLowerCase());
  if (teamMemberId) query = query.eq("team_member_id", teamMemberId);
  if (direction) query = query.eq("direction", direction);
  if (dateFrom) query = query.gte("response_sent_at", dateFrom + "T00:00:00Z");
  if (dateTo) query = query.lte("response_sent_at", dateTo + "T23:59:59Z");

  const { data: records, error } = await query.limit(500);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (!summary) {
    return NextResponse.json({ records: records || [] });
  }

  // Aggregate stats
  const supplierReplies = (records || []).filter((r: any) => r.direction === "supplier_reply");
  const teamReplies = (records || []).filter((r: any) => r.direction === "team_reply");

  const calcStats = (items: any[]) => {
    if (items.length === 0) return { avg_minutes: 0, median_minutes: 0, fastest_minutes: 0, slowest_minutes: 0, total: 0 };
    const mins = items.map((r: any) => r.response_minutes).sort((a: number, b: number) => a - b);
    const sum = mins.reduce((a: number, b: number) => a + b, 0);
    return {
      avg_minutes: Math.round(sum / mins.length),
      median_minutes: Math.round(mins[Math.floor(mins.length / 2)]),
      fastest_minutes: Math.round(mins[0]),
      slowest_minutes: Math.round(mins[mins.length - 1]),
      total: mins.length,
    };
  };

  // Per-supplier breakdown
  const bySupplier: Record<string, any[]> = {};
  for (const r of supplierReplies) {
    const key = r.supplier_email || "unknown";
    if (!bySupplier[key]) bySupplier[key] = [];
    bySupplier[key].push(r);
  }

  // Per-team-member breakdown
  const byUser: Record<string, any[]> = {};
  for (const r of teamReplies) {
    const key = r.team_member_id || "unassigned";
    if (!byUser[key]) byUser[key] = [];
    byUser[key].push(r);
  }

  return NextResponse.json({
    supplier_responsiveness: {
      overall: calcStats(supplierReplies),
      by_supplier: Object.fromEntries(
        Object.entries(bySupplier).map(([email, items]) => [email, calcStats(items)])
      ),
    },
    team_responsiveness: {
      overall: calcStats(teamReplies),
      by_user: Object.fromEntries(
        Object.entries(byUser).map(([userId, items]) => [userId, calcStats(items)])
      ),
    },
  });
}

// ── POST /api/response-times ──
// Actions:
//   { action: "backfill" }                   — Compute response times from all existing messages
//   { action: "backfill_conversation", conversation_id: "..." } — Backfill a single conversation
//   { action: "compute", conversation_id, message_id } — Compute for a single new message
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { action } = body;

  if (action === "backfill") {
    return await backfillAll(supabase);
  }

  if (action === "backfill_conversation") {
    const { conversation_id } = body;
    if (!conversation_id) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
    const count = await backfillConversation(supabase, conversation_id);
    return NextResponse.json({ success: true, new_records: count });
  }

  if (action === "compute") {
    const { conversation_id, message_id } = body;
    if (!conversation_id) return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
    const count = await computeForNewMessage(supabase, conversation_id, message_id);
    return NextResponse.json({ success: true, new_records: count });
  }

  if (action === "update_aggregates") {
    await updateAllSupplierAggregates(supabase);
    return NextResponse.json({ success: true, message: "Supplier aggregates updated" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

// ══════════════════════════════════════════════════════
// BACKFILL ALL CONVERSATIONS
// ══════════════════════════════════════════════════════
async function backfillAll(supabase: any) {
  const startTime = Date.now();

  // Clear existing response_times
  await supabase.from("response_times").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // Fetch ALL messages in bulk (much faster than per-conversation queries)
  const { data: allMessages, error: msgErr } = await supabase
    .from("messages")
    .select("id, conversation_id, from_email, is_outbound, sent_at, sent_by_user_id")
    .order("sent_at", { ascending: true });

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  // Fetch all conversations for metadata
  const { data: allConvos, error: convErr } = await supabase
    .from("conversations")
    .select("id, email_account_id, assignee_id")
    .neq("status", "trash");

  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 });

  const convoMap: Record<string, any> = {};
  for (const c of (allConvos || [])) convoMap[c.id] = c;

  // Group messages by conversation
  const msgsByConvo: Record<string, any[]> = {};
  for (const msg of (allMessages || [])) {
    if (!msgsByConvo[msg.conversation_id]) msgsByConvo[msg.conversation_id] = [];
    msgsByConvo[msg.conversation_id].push(msg);
  }

  // Process each conversation in memory
  const allInserts: any[] = [];
  let conversationsWithPairs = 0;
  let conversationsSkipped = 0;

  for (const convoId of Object.keys(msgsByConvo)) {
    const messages = msgsByConvo[convoId];
    if (messages.length < 2) { conversationsSkipped++; continue; }

    const hasOutbound = messages.some((m: any) => m.is_outbound === true);
    const hasInbound = messages.some((m: any) => m.is_outbound === false);
    if (!hasOutbound || !hasInbound) { conversationsSkipped++; continue; }

    const convo = convoMap[convoId];
    if (!convo) { conversationsSkipped++; continue; }

    let foundPair = false;

    for (let i = 0; i < messages.length - 1; i++) {
      const trigger = messages[i];

      for (let j = i + 1; j < messages.length; j++) {
        const response = messages[j];
        if (trigger.is_outbound === response.is_outbound) continue;

        const diffMinutes = (new Date(response.sent_at).getTime() - new Date(trigger.sent_at).getTime()) / (1000 * 60);
        if (diffMinutes <= 0) break;
        if (diffMinutes > 30 * 24 * 60) break;

        const supplierEmail = trigger.is_outbound
          ? response.from_email?.toLowerCase()
          : trigger.from_email?.toLowerCase();
        const supplierDomain = supplierEmail ? supplierEmail.split("@")[1] || null : null;
        const direction = trigger.is_outbound ? "supplier_reply" : "team_reply";
        const teamMemberId = direction === "team_reply"
          ? (response.sent_by_user_id || convo.assignee_id || null)
          : null;

        allInserts.push({
          conversation_id: convoId,
          email_account_id: convo.email_account_id,
          direction,
          trigger_message_id: trigger.id,
          trigger_sent_at: trigger.sent_at,
          response_message_id: response.id,
          response_sent_at: response.sent_at,
          response_minutes: Math.round(diffMinutes * 10) / 10,
          response_business_minutes: null,
          supplier_email: supplierEmail || null,
          supplier_domain: supplierDomain || null,
          team_member_id: teamMemberId,
        });

        foundPair = true;
        break;
      }
    }

    if (foundPair) conversationsWithPairs++;
    else conversationsSkipped++;
  }

  // Batch insert all records in chunks of 100
  let insertedCount = 0;
  for (let k = 0; k < allInserts.length; k += 100) {
    const chunk = allInserts.slice(k, k + 100);
    const { error: insertErr } = await supabase.from("response_times").insert(chunk);
    if (insertErr) {
      console.error("Response time batch insert error:", insertErr.message);
    } else {
      insertedCount += chunk.length;
    }
  }

  // Update supplier aggregates
  try { await updateAllSupplierAggregates(supabase); } catch (_e) {}

  return NextResponse.json({
    success: true,
    conversations_with_pairs: conversationsWithPairs,
    conversations_skipped: conversationsSkipped,
    conversations_total: Object.keys(msgsByConvo).length,
    response_times_created: insertedCount,
    total_messages_scanned: (allMessages || []).length,
    duration_ms: Date.now() - startTime,
    message: "Backfill complete. " + conversationsWithPairs + " conversations had response pairs, " + conversationsSkipped + " skipped.",
  });
}

// ══════════════════════════════════════════════════════
// BACKFILL A SINGLE CONVERSATION
// ══════════════════════════════════════════════════════
async function backfillConversation(supabase: any, conversationId: string): Promise<number> {
  // Fetch conversation metadata
  const { data: convo } = await supabase
    .from("conversations")
    .select("id, email_account_id, from_email, assignee_id")
    .eq("id", conversationId)
    .single();

  if (!convo) return 0;

  // Fetch the account email to determine outbound vs inbound
  const { data: account } = await supabase
    .from("email_accounts")
    .select("email")
    .eq("id", convo.email_account_id)
    .single();

  if (!account) return 0;
  const accountEmail = account.email.toLowerCase();

  // Fetch all messages in this conversation, ordered by sent_at
  const { data: messages } = await supabase
    .from("messages")
    .select("id, from_email, to_addresses, is_outbound, sent_at, sent_by_user_id")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true });

  if (!messages || messages.length < 2) return 0;

  // Check if there are messages in both directions
  const hasOutbound = messages.some((m: any) => m.is_outbound === true);
  const hasInbound = messages.some((m: any) => m.is_outbound === false);
  if (!hasOutbound || !hasInbound) return 0;

  // Delete existing response_times for this conversation to avoid duplicates
  await supabase.from("response_times").delete().eq("conversation_id", conversationId);

  const inserts: any[] = [];

  for (let i = 0; i < messages.length - 1; i++) {
    const trigger = messages[i];

    // Find the NEXT message in the opposite direction
    for (let j = i + 1; j < messages.length; j++) {
      const response = messages[j];

      // Must be in the opposite direction
      if (trigger.is_outbound === response.is_outbound) continue;

      const triggerTime = new Date(trigger.sent_at);
      const responseTime = new Date(response.sent_at);
      const diffMinutes = (responseTime.getTime() - triggerTime.getTime()) / (1000 * 60);

      // Skip negative or zero times (data quality)
      if (diffMinutes <= 0) break;

      // Skip unreasonably long gaps (> 30 days) — likely unrelated
      if (diffMinutes > 30 * 24 * 60) break;

      // Determine the external party's email
      const supplierEmail = trigger.is_outbound
        ? response.from_email?.toLowerCase()  // supplier is the one replying
        : trigger.from_email?.toLowerCase();   // supplier is the one who sent the trigger

      const supplierDomain = supplierEmail ? supplierEmail.split("@")[1] || null : null;

      // Direction: if the trigger was outbound (we sent), the response is a supplier_reply
      //            if the trigger was inbound (they sent), the response is a team_reply
      const direction = trigger.is_outbound ? "supplier_reply" : "team_reply";

      // For team_reply, identify which team member responded
      const teamMemberId = direction === "team_reply"
        ? (response.sent_by_user_id || convo.assignee_id || null)
        : null;

      inserts.push({
        conversation_id: conversationId,
        email_account_id: convo.email_account_id,
        direction,
        trigger_message_id: trigger.id,
        trigger_sent_at: trigger.sent_at,
        response_message_id: response.id,
        response_sent_at: response.sent_at,
        response_minutes: Math.round(diffMinutes * 10) / 10,
        response_business_minutes: null, // Could compute with business hours if needed
        supplier_email: supplierEmail || null,
        supplier_domain: supplierDomain || null,
        team_member_id: teamMemberId,
      });

      break; // Only count first response per trigger message
    }
  }

  if (inserts.length > 0) {
    // Batch insert in chunks of 50
    for (let k = 0; k < inserts.length; k += 50) {
      const chunk = inserts.slice(k, k + 50);
      const { error: insertErr } = await supabase.from("response_times").insert(chunk);
      if (insertErr) console.error("Response time insert error:", insertErr.message);
    }
  }

  return inserts.length;
}

// ══════════════════════════════════════════════════════
// COMPUTE FOR A SINGLE NEW MESSAGE (real-time hook)
// ══════════════════════════════════════════════════════
async function computeForNewMessage(supabase: any, conversationId: string, newMessageId?: string): Promise<number> {
  // Fetch conversation metadata
  const { data: convo } = await supabase
    .from("conversations")
    .select("id, email_account_id, from_email, assignee_id")
    .eq("id", conversationId)
    .single();

  if (!convo) return 0;

  const { data: account } = await supabase
    .from("email_accounts")
    .select("email")
    .eq("id", convo.email_account_id)
    .single();

  if (!account) return 0;

  // Fetch last few messages to find the response pair
  const { data: messages } = await supabase
    .from("messages")
    .select("id, from_email, to_addresses, is_outbound, sent_at, sent_by_user_id")
    .eq("conversation_id", conversationId)
    .order("sent_at", { ascending: true });

  if (!messages || messages.length < 2) return 0;

  // Find the new message (last one, or by ID)
  const newMsg = newMessageId
    ? messages.find((m: any) => m.id === newMessageId)
    : messages[messages.length - 1];

  if (!newMsg) return 0;

  // Look backwards for the most recent message in the opposite direction
  const idx = messages.indexOf(newMsg);
  let triggerMsg = null;
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].is_outbound !== newMsg.is_outbound) {
      triggerMsg = messages[i];
      break;
    }
  }

  if (!triggerMsg) return 0;

  const triggerTime = new Date(triggerMsg.sent_at);
  const responseTime = new Date(newMsg.sent_at);
  const diffMinutes = (responseTime.getTime() - triggerTime.getTime()) / (1000 * 60);

  if (diffMinutes <= 0 || diffMinutes > 30 * 24 * 60) return 0;

  // Check if this pair already exists
  const { data: existing } = await supabase
    .from("response_times")
    .select("id")
    .eq("trigger_message_id", triggerMsg.id)
    .eq("response_message_id", newMsg.id)
    .maybeSingle();

  if (existing) return 0;

  const supplierEmail = triggerMsg.is_outbound
    ? newMsg.from_email?.toLowerCase()
    : triggerMsg.from_email?.toLowerCase();

  const supplierDomain = supplierEmail ? supplierEmail.split("@")[1] || null : null;
  const direction = triggerMsg.is_outbound ? "supplier_reply" : "team_reply";
  const teamMemberId = direction === "team_reply"
    ? (newMsg.sent_by_user_id || convo.assignee_id || null)
    : null;

  const { error: insertErr } = await supabase.from("response_times").insert({
    conversation_id: conversationId,
    email_account_id: convo.email_account_id,
    direction,
    trigger_message_id: triggerMsg.id,
    trigger_sent_at: triggerMsg.sent_at,
    response_message_id: newMsg.id,
    response_sent_at: newMsg.sent_at,
    response_minutes: Math.round(diffMinutes * 10) / 10,
    response_business_minutes: null,
    supplier_email: supplierEmail || null,
    supplier_domain: supplierDomain || null,
    team_member_id: teamMemberId,
  });

  if (insertErr) {
    console.error("Response time insert error:", insertErr.message);
    return 0;
  }

  // Update supplier aggregate if this was a supplier reply
  if (direction === "supplier_reply" && supplierEmail) {
    await updateSupplierAggregate(supabase, supplierEmail);
  }

  return 1;
}

// ══════════════════════════════════════════════════════
// AGGREGATE HELPERS
// ══════════════════════════════════════════════════════
async function updateSupplierAggregate(supabase: any, supplierEmail: string) {
  const { data: records } = await supabase
    .from("response_times")
    .select("response_minutes, response_sent_at")
    .eq("supplier_email", supplierEmail)
    .eq("direction", "supplier_reply")
    .order("response_sent_at", { ascending: false });

  if (!records || records.length === 0) return;

  const mins = records.map((r: any) => r.response_minutes);
  const avg = mins.reduce((a: number, b: number) => a + b, 0) / mins.length;

  await supabase
    .from("supplier_contacts")
    .update({
      avg_response_minutes: Math.round(avg * 10) / 10,
      total_responses: records.length,
      fastest_response_minutes: Math.round(Math.min(...mins) * 10) / 10,
      slowest_response_minutes: Math.round(Math.max(...mins) * 10) / 10,
      last_response_at: records[0].response_sent_at,
    })
    .eq("email", supplierEmail);
}

async function updateAllSupplierAggregates(supabase: any) {
  // Get all unique supplier emails with response times
  const { data: allRt } = await supabase
    .from("response_times")
    .select("supplier_email")
    .eq("direction", "supplier_reply")
    .not("supplier_email", "is", null);

  const uniqueEmails = Array.from(new Set((allRt || []).map((r: any) => r.supplier_email).filter(Boolean)));

  for (const email of uniqueEmails) {
    try {
      await updateSupplierAggregate(supabase, email as string);
    } catch (err: any) {
      console.error(`Aggregate update error for ${email}:`, err.message);
    }
  }
}