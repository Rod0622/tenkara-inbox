export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── Primary Contact API ────────────────────────────────────────────────────
//
// Manages the "primary contact" displayed below the conversation subject.
// Two modes:
//   - Auto (default): primary_contact_is_manual = false. The sync layer
//     updates primary_contact_name/email to the latest external sender on
//     every new inbound message.
//   - Manual: primary_contact_is_manual = true. The sync layer leaves the
//     primary contact alone. User explicitly picked someone (could be any
//     participant from the thread, not necessarily the latest).
//
// Endpoints:
//   POST   { conversation_id, name, email }   → set manual primary contact
//   DELETE ?conversation_id=X                   → revert to auto mode

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { conversation_id, name, email } = body || {};

  if (!conversation_id || !email) {
    return NextResponse.json({ error: "conversation_id and email required" }, { status: 400 });
  }

  const cleanEmail = String(email).trim().toLowerCase();
  if (!cleanEmail.includes("@")) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }
  const cleanName = name ? String(name).trim() : cleanEmail.split("@")[0];

  // Fetch the previous primary contact for the audit entry's "from"
  const { data: prev } = await supabase
    .from("conversations")
    .select("primary_contact_name, primary_contact_email")
    .eq("id", conversation_id)
    .maybeSingle();

  const { data, error } = await supabase
    .from("conversations")
    .update({
      primary_contact_name: cleanName,
      primary_contact_email: cleanEmail,
      primary_contact_is_manual: true,
    })
    .eq("id", conversation_id)
    .select("id, primary_contact_name, primary_contact_email, primary_contact_is_manual")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ─── Footprint: primary_contact_changed ───────────────────────────
  await supabase.from("activity_log").insert({
    conversation_id,
    actor_id: body.actor_id || null,
    action: "primary_contact_changed",
    details: {
      from_name: prev?.primary_contact_name || null,
      from_email: prev?.primary_contact_email || null,
      to_name: cleanName,
      to_email: cleanEmail,
    },
  });

  return NextResponse.json({ conversation: data });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");
  const actorId = req.nextUrl.searchParams.get("actor_id");

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  }

  // Capture the previous primary contact before resetting, for the audit log
  const { data: prev } = await supabase
    .from("conversations")
    .select("primary_contact_name, primary_contact_email")
    .eq("id", conversationId)
    .maybeSingle();

  // Revert to auto mode. Also clear the override fields so the UI falls back
  // to from_name/from_email until the next inbound message triggers the sync
  // layer's auto-update.
  const { data, error } = await supabase
    .from("conversations")
    .update({
      primary_contact_name: null,
      primary_contact_email: null,
      primary_contact_is_manual: false,
    })
    .eq("id", conversationId)
    .select("id, primary_contact_name, primary_contact_email, primary_contact_is_manual")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ─── Footprint: primary_contact_reset ─────────────────────────────
  await supabase.from("activity_log").insert({
    conversation_id: conversationId,
    actor_id: actorId || null,
    action: "primary_contact_reset",
    details: {
      previous_name: prev?.primary_contact_name || null,
      previous_email: prev?.primary_contact_email || null,
    },
  });

  return NextResponse.json({ conversation: data });
}