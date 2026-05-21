// src/app/api/calls/[id]/route.ts
//
// GET /api/calls/[id]  — fetch one call with hydrated supplier/person/member names
// PATCH /api/calls/[id] — currently not used (placeholder)

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

export async function GET(_req: NextRequest, ctx: { params: { id: string } }) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const callId = ctx.params.id;
  if (!callId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: call, error } = await supabase
    .from("quo_call_logs")
    .select("*")
    .eq("id", callId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!call) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const c: any = call;

  // Hydrate names in parallel
  const [supplierRes, personRes, memberRes, followUpRes] = await Promise.all([
    c.supplier_contact_id
      ? supabase.from("supplier_contacts").select("name").eq("id", c.supplier_contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    c.supplier_contact_person_id
      ? supabase.from("supplier_contact_persons").select("name, title").eq("id", c.supplier_contact_person_id).maybeSingle()
      : Promise.resolve({ data: null }),
    c.team_member_id
      ? supabase.from("team_members").select("name, initials, color").eq("id", c.team_member_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("call_follow_ups")
      .select("id, status, attempt_count, max_attempts, next_attempt_after, escalated_at")
      .eq("quo_call_log_id", c.id)
      .in("status", ["pending", "in_progress", "escalated"])
      .maybeSingle(),
  ]);

  return NextResponse.json({
    call: {
      ...c,
      supplier_name: (supplierRes.data as any)?.name || null,
      person_name: (personRes.data as any)?.name || null,
      person_title: (personRes.data as any)?.title || null,
      team_member_name: (memberRes.data as any)?.name || null,
      team_member_initials: (memberRes.data as any)?.initials || null,
      team_member_color: (memberRes.data as any)?.color || null,
      follow_up: followUpRes.data || null,
    },
  });
}
