// src/app/api/calls/dial-preferences/route.ts
//
// GET   /api/calls/dial-preferences  → { preferred_quo_phone_number_id, phone_numbers: [...] }
// PATCH /api/calls/dial-preferences  → body: { preferred_quo_phone_number_id }
//
// Reads workspace phone numbers from integration_configs.config.knownPhoneNumbers
// (saved during Quo setup). Returns them in a UI-friendly shape for the picker.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

export async function GET(_req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();

  const [meRes, cfgRes] = await Promise.all([
    supabase
      .from("team_members")
      .select("preferred_quo_phone_number_id")
      .eq("id", session.teamMember.id)
      .maybeSingle(),
    supabase
      .from("integration_configs")
      .select("config")
      .eq("provider", "quo")
      .maybeSingle(),
  ]);

  const me: any = meRes.data;
  const cfg: any = cfgRes.data;
  const known: any[] = cfg?.config?.knownPhoneNumbers || [];

  // Shape: [{ id, number, name }, ...]
  const phoneNumbers = known.map((n: any) => ({
    id: n.id,
    number: n.number || n.phoneNumber || null,
    name: n.name || null,
  })).filter((n: any) => n.id && n.number);

  return NextResponse.json({
    preferred_quo_phone_number_id: me?.preferred_quo_phone_number_id || null,
    phone_numbers: phoneNumbers,
  });
}

export async function PATCH(req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const value: string | null =
    typeof body.preferred_quo_phone_number_id === "string"
      ? body.preferred_quo_phone_number_id
      : (body.preferred_quo_phone_number_id === null ? null : undefined as any);

  if (value === undefined) {
    return NextResponse.json({ error: "preferred_quo_phone_number_id required (string or null)" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("team_members")
    .update({ preferred_quo_phone_number_id: value })
    .eq("id", session.teamMember.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
