// src/app/api/calls/dial/route.ts
//
// POST /api/calls/dial
//   body: {
//     to_phone: string,                       // E.164 target number
//     from_phone_number_id?: string,          // Quo phone number ID to dial from (optional)
//     from_phone?: string,                    // Workspace E.164 (optional; for display)
//     supplier_contact_id?: string | null,    // Pre-linked supplier
//     conversation_id?: string | null,        // Pre-linked conversation
//     supplier_contact_person_id?: string | null,
//   }
//
// Creates a "stub" row in quo_call_logs (is_stub=true, status=ringing) so the
// call appears in the conversation timeline immediately. Returns the stub row
// + a tel: link the client opens to launch the OS dialer (Quo desktop, etc.).
//
// When the real Quo webhook arrives later (~10-30s after the user actually
// connects), src/lib/quo-webhook.ts will try to merge the inbound call into
// this stub by matching (workspace_phone, participant_phone, direction='outbound')
// within a 5-minute window. If matched, the stub's quo_call_id is overwritten
// with the real one and the data merges. If no match (e.g. user clicked Call
// but never actually dialed), the cron expires the stub after 10 minutes.
//
// NOTE: We do NOT call Quo's API to place the call — Quo has no
// "POST /v1/calls" endpoint. The tel: link is the actual launcher.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { normalizeE164, matchPhoneToSupplier } from "@/lib/phone";

export async function POST(req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const toPhone = normalizeE164(body.to_phone);
  if (!toPhone) {
    return NextResponse.json({ error: "Missing or invalid to_phone" }, { status: 400 });
  }

  const fromPhone = body.from_phone ? normalizeE164(body.from_phone) : null;
  const fromPhoneNumberId: string | null = body.from_phone_number_id || null;

  // Pre-linked supplier / conversation. If supplier was provided but no
  // conversation, attempt to auto-pick the supplier's most-recent open
  // conversation via the existing phone matcher (which can hand us a conv id
  // even when called with a phone that doesn't match the supplier directly).
  let supplierContactId: string | null = body.supplier_contact_id || null;
  let supplierContactPersonId: string | null = body.supplier_contact_person_id || null;
  let conversationId: string | null = body.conversation_id || null;

  // If no explicit supplier was provided, try to match by phone (same logic as webhook)
  if (!supplierContactId) {
    try {
      const match = await matchPhoneToSupplier(toPhone);
      supplierContactId = match.supplier_contact_id;
      supplierContactPersonId = supplierContactPersonId || match.supplier_contact_person_id;
      conversationId = conversationId || match.conversation_id;
    } catch (e: any) {
      // Non-fatal — proceed without auto-link
      console.warn("[dial] phone match failed:", e?.message);
    }
  } else if (!conversationId) {
    // Supplier provided but no conversation — auto-pick the supplier's most recent open conv
    const supabase = createServerClient();
    const { data: openConvos } = await supabase
      .from("conversations")
      .select("id, last_message_at")
      .eq("supplier_contact_id", supplierContactId)
      .eq("status", "open")
      .order("last_message_at", { ascending: false })
      .limit(1);
    if (openConvos && openConvos.length > 0) {
      conversationId = (openConvos as any[])[0].id;
    }
  }

  // Build a synthetic quo_call_id for the stub.
  // Format "STUB-<uuid>" so it's obvious in DB inspection.
  // When the real webhook arrives, this gets overwritten with the real ID.
  const stubQuoId = `STUB-${cryptoRandom()}`;

  const supabase = createServerClient();
  const nowIso = new Date().toISOString();

  // ── Line lookup + attribution (per Q3 rule) ─────────
  // If the chosen "Call from" line is classified, populate line fields on the
  // stub. For shared lines, attribute to the conversation's assignee if any;
  // otherwise to the dialer themselves.
  let quoPhoneLineId: string | null = null;
  let lineType: string | null = null;
  let attributedTeamMemberId: string | null = session.teamMember.id;

  if (fromPhoneNumberId) {
    const { data: line } = await supabase
      .from("quo_phone_lines")
      .select("id, line_type")
      .eq("quo_phone_number_id", fromPhoneNumberId)
      .maybeSingle();
    if (line) {
      quoPhoneLineId = (line as any).id;
      lineType = (line as any).line_type;
      if (lineType === "shared" && conversationId) {
        const { data: convo } = await supabase
          .from("conversations")
          .select("assignee_id")
          .eq("id", conversationId)
          .maybeSingle();
        const assigneeId = (convo as any)?.assignee_id || null;
        if (assigneeId) attributedTeamMemberId = assigneeId;
      }
    }
  }

  const stubRow: Record<string, any> = {
    quo_call_id: stubQuoId,
    conversation_id: conversationId,
    supplier_contact_id: supplierContactId,
    supplier_contact_person_id: supplierContactPersonId,
    team_member_id: session.teamMember.id,
    attributed_team_member_id: attributedTeamMemberId,
    direction: "outbound",
    status: "ringing",
    outcome: null,
    participant_phone: toPhone,
    workspace_phone: fromPhone,
    quo_phone_number_id: fromPhoneNumberId,
    quo_phone_line_id: quoPhoneLineId,
    line_type: lineType,
    quo_user_id: null,
    duration_seconds: null,
    started_at: nowIso,
    is_stub: true,
  };

  const { data: inserted, error: insErr } = await supabase
    .from("quo_call_logs")
    .insert(stubRow)
    .select("*")
    .single();

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Activity log if linked to a conversation
  if (conversationId) {
    await supabase.from("activity_log").insert({
      conversation_id: conversationId,
      actor_id: session.teamMember.id,
      action: "quo_call_initiated",
      details: {
        quo_call_log_id: (inserted as any).id,
        to_phone: toPhone,
        from_phone: fromPhone,
        is_stub: true,
      },
    });
  }

  // Persist user's "Call from" preference for next time, if they picked a workspace number
  if (fromPhoneNumberId) {
    await supabase
      .from("team_members")
      .update({ preferred_quo_phone_number_id: fromPhoneNumberId })
      .eq("id", session.teamMember.id);
  }

  // Build the tel: link. Strip non-digits/plus.
  const telHref = `tel:${toPhone.replace(/[^\d+]/g, "")}`;

  return NextResponse.json({
    stub: inserted,
    tel: telHref,
    note: "Open this tel: link to launch Quo. If you have multiple lines, set the active line in Quo first.",
  });
}

// Small RNG helper — uuid-ish, doesn't need crypto-grade randomness here
// because the value is just a unique placeholder.
function cryptoRandom(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 6)
  );
}