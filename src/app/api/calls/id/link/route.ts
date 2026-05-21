// src/app/api/calls/[id]/link/route.ts
//
// POST /api/calls/[id]/link
//   body: { conversation_id?: string|null, supplier_contact_id?: string|null,
//           supplier_contact_person_id?: string|null }
//
// Manually link a call to a conversation/supplier. Useful when phone matching
// didn't find a supplier (e.g. caller used a different number than what's in
// supplier_contact_persons.phone, anonymous caller, etc.).
//
// Pass null to clear an existing link.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const callId = ctx.params.id;
  if (!callId) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  // Only update fields the caller explicitly provided. `undefined` = leave alone,
  // `null` = clear, string = set.
  const updates: Record<string, any> = {};
  if (body.conversation_id !== undefined) updates.conversation_id = body.conversation_id;
  if (body.supplier_contact_id !== undefined) updates.supplier_contact_id = body.supplier_contact_id;
  if (body.supplier_contact_person_id !== undefined) updates.supplier_contact_person_id = body.supplier_contact_person_id;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: updated, error } = await supabase
    .from("quo_call_logs")
    .update(updates)
    .eq("id", callId)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const u: any = updated;

  // Log the linkage to activity_log if we linked to a conversation
  if (updates.conversation_id) {
    await supabase.from("activity_log").insert({
      conversation_id: updates.conversation_id,
      actor_id: session.teamMember.id,
      action: "quo_call_linked",
      details: {
        quo_call_id: u.quo_call_id,
        direction: u.direction,
        participant_phone: u.participant_phone,
        manual: true,
      },
    });
  }

  return NextResponse.json({ call: updated });
}
