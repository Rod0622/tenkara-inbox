// src/app/api/calls/[id]/follow-up/route.ts
//
// POST   /api/calls/[id]/follow-up — create a pending follow-up for this call
//   body: { assigned_to?: string|null, notes?: string|null,
//           next_attempt_after?: string (ISO), max_attempts?: number }
//
// DELETE /api/calls/[id]/follow-up — cancel the active follow-up
//
// One active (pending/in_progress) follow-up per call is enforced by a
// partial unique index on call_follow_ups.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

const DEFAULT_DELAY_HOURS = 4; // Next retry default: 4 hours from now
const DEFAULT_MAX_ATTEMPTS = 2;

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const callId = ctx.params.id;
  if (!callId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty body */ }

  const supabase = createServerClient();

  // Fetch the call to inherit conversation/supplier linkage
  const { data: call, error: callErr } = await supabase
    .from("quo_call_logs")
    .select("id, conversation_id, supplier_contact_id, team_member_id")
    .eq("id", callId)
    .maybeSingle();

  if (callErr) return NextResponse.json({ error: callErr.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });

  const c: any = call;

  // Check if active follow-up already exists
  const { data: existing } = await supabase
    .from("call_follow_ups")
    .select("id")
    .eq("quo_call_log_id", callId)
    .in("status", ["pending", "in_progress"])
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Follow-up already exists for this call", follow_up_id: (existing as any).id }, { status: 409 });
  }

  const nextAfter = body.next_attempt_after
    ? new Date(body.next_attempt_after).toISOString()
    : new Date(Date.now() + DEFAULT_DELAY_HOURS * 60 * 60 * 1000).toISOString();

  const row = {
    quo_call_log_id: callId,
    conversation_id: c.conversation_id,
    supplier_contact_id: c.supplier_contact_id,
    assigned_to: body.assigned_to !== undefined ? body.assigned_to : c.team_member_id,
    status: "pending" as const,
    attempt_count: 0,
    max_attempts: typeof body.max_attempts === "number" && body.max_attempts > 0
      ? body.max_attempts
      : DEFAULT_MAX_ATTEMPTS,
    next_attempt_after: nextAfter,
    notes: body.notes || null,
    created_by: session.teamMember.id,
  };

  const { data: created, error: insErr } = await supabase
    .from("call_follow_ups")
    .insert(row)
    .select("*")
    .single();

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // Activity log if linked to a conversation
  if (c.conversation_id) {
    await supabase.from("activity_log").insert({
      conversation_id: c.conversation_id,
      actor_id: session.teamMember.id,
      action: "quo_call_followup_set",
      details: {
        quo_call_log_id: callId,
        next_attempt_after: nextAfter,
        max_attempts: row.max_attempts,
      },
    });
  }

  return NextResponse.json({ follow_up: created });
}

export async function DELETE(_req: NextRequest, ctx: { params: { id: string } }) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const callId = ctx.params.id;
  if (!callId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = createServerClient();

  // Cancel any active follow-up
  const { data: cancelled, error } = await supabase
    .from("call_follow_ups")
    .update({
      status: "canceled",
      resolved_at: new Date().toISOString(),
    })
    .eq("quo_call_log_id", callId)
    .in("status", ["pending", "in_progress"])
    .select("id, conversation_id");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Activity log for each cancelled follow-up that has a conversation
  if (cancelled && cancelled.length > 0) {
    for (const row of cancelled as any[]) {
      if (row.conversation_id) {
        await supabase.from("activity_log").insert({
          conversation_id: row.conversation_id,
          actor_id: session.teamMember.id,
          action: "quo_call_followup_canceled",
          details: { quo_call_log_id: callId, follow_up_id: row.id },
        });
      }
    }
  }

  return NextResponse.json({ canceled: cancelled?.length || 0 });
}
