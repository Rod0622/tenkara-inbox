import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { runRulesForEvent } from "@/lib/rule-engine";

// PATCH /api/conversations/status — update read/star/flag status
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const conversationId = body.conversation_id || body.conversationId;
  const actorId = body.actor_id;

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  // Build update object from provided fields
  const update: any = {};
  if (body.is_unread !== undefined) update.is_unread = body.is_unread;
  if (body.is_starred !== undefined) update.is_starred = body.is_starred;
  if (body.status !== undefined) update.status = body.status;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // If we're updating the status field, capture the old value first so we can detect transitions
  let previousStatus: string | null = null;
  if (body.status !== undefined) {
    const { data: pre } = await supabase
      .from("conversations")
      .select("status")
      .eq("id", conversationId)
      .single();
    previousStatus = pre?.status || null;
  }

  const { data, error } = await supabase
    .from("conversations")
    .update(update)
    .eq("id", conversationId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log activity for each changed field
  const logEntries: any[] = [];
  if (body.is_starred !== undefined) {
    logEntries.push({
      conversation_id: conversationId,
      actor_id: actorId || null,
      action: body.is_starred ? "starred" : "unstarred",
      details: {},
    });
  }
  if (body.is_unread !== undefined) {
    logEntries.push({
      conversation_id: conversationId,
      actor_id: actorId || null,
      action: body.is_unread ? "marked_unread" : "marked_read",
      details: {},
    });
  }
  if (body.status !== undefined) {
    logEntries.push({
      conversation_id: conversationId,
      actor_id: actorId || null,
      action: "status_changed",
      details: { status: body.status },
    });
  }
  if (logEntries.length > 0) {
    await supabase.from("activity_log").insert(logEntries);
  }

  // Fire event-based rules for status transitions
  if (body.status !== undefined && previousStatus !== body.status) {
    const newStatus = body.status;
    const oldStatus = previousStatus || "";

    // Closed: any -> closed
    if (newStatus === "closed" && oldStatus !== "closed") {
      try {
        await runRulesForEvent({
          event_type: "conversation_closed",
          conversation_id: conversationId,
          initiator_user_id: actorId || null,
          event_key: `conversation_closed:${conversationId}:${Date.now()}`,
          new_status: newStatus,
          old_status: oldStatus,
        });
      } catch (ruleErr: any) {
        console.error("[status/PATCH] conversation_closed rule error:", ruleErr?.message || ruleErr);
      }
    }

    // Reopened: closed -> open (the typical reopen path)
    if (oldStatus === "closed" && newStatus === "open") {
      try {
        await runRulesForEvent({
          event_type: "conversation_reopened",
          conversation_id: conversationId,
          initiator_user_id: actorId || null,
          event_key: `conversation_reopened:${conversationId}:${Date.now()}`,
          new_status: newStatus,
          old_status: oldStatus,
        });
      } catch (ruleErr: any) {
        console.error("[status/PATCH] conversation_reopened rule error:", ruleErr?.message || ruleErr);
      }
    }
  }

  return NextResponse.json({ conversation: data });
}