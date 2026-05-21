// src/app/api/calls/route.ts
//
// GET /api/calls
//   ?conversation_id=...        Filter by linked conversation
//   ?supplier_contact_id=...    Filter by supplier
//   ?limit=50                   Page size (max 200)
//   ?before=<ISO>               Pagination cursor on started_at
//
// Returns: { calls: QuoCallLog[] }
//
// This endpoint will be used by the conversation timeline in Batch 1B.
// Shipped now so the data side is testable from the browser network tab.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id");
  const supplierId = url.searchParams.get("supplier_contact_id");
  const limitParam = parseInt(url.searchParams.get("limit") || "50", 10);
  const limit = Math.min(Math.max(limitParam, 1), 200);
  const before = url.searchParams.get("before");

  const supabase = createServerClient();
  let q = supabase
    .from("quo_call_logs")
    .select(
      "id, quo_call_id, conversation_id, supplier_contact_id, supplier_contact_person_id, team_member_id, direction, status, outcome, participant_phone, duration_seconds, started_at, answered_at, ended_at, recording_url, voicemail_url, voicemail_transcript, ai_summary, ai_next_steps, created_at"
    )
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (conversationId) q = q.eq("conversation_id", conversationId);
  if (supplierId) q = q.eq("supplier_contact_id", supplierId);
  if (before) q = q.lt("started_at", before);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ calls: data || [] });
}
