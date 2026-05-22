// src/app/api/calls/route.ts
//
// GET /api/calls
//   ?conversation_id=...        Filter by linked conversation
//   ?supplier_contact_id=...    Filter by supplier
//   ?limit=50                   Page size (max 200)
//   ?before=<ISO>               Pagination cursor on started_at
//
// Returns:
//   { calls: QuoCallLog[],            // with hydrated supplier_name, person_name, team_member_name,
//                                        workspace_phone, line info (line_type, line_display_name,
//                                        email_account_name/icon/color), and attributed_team_member info
//     active_follow_ups: string[]      // quo_call_logs.id values with active follow-ups
//   }

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
      "id, quo_call_id, conversation_id, supplier_contact_id, supplier_contact_person_id, team_member_id, attributed_team_member_id, direction, status, outcome, participant_phone, workspace_phone, duration_seconds, started_at, answered_at, ended_at, recording_url, voicemail_url, voicemail_transcript, ai_summary, ai_next_steps, created_at, quo_phone_line_id, line_type, is_stub"
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

  const calls = (data || []) as any[];

  if (calls.length === 0) {
    return NextResponse.json({ calls: [], active_follow_ups: [] });
  }

  // Collect unique IDs needing lookup. attributedMemberIds may overlap with
  // memberIds — that's fine, the Set + lookup map handles it.
  const supplierIds = Array.from(new Set(calls.map((c) => c.supplier_contact_id).filter(Boolean)));
  const personIds = Array.from(new Set(calls.map((c) => c.supplier_contact_person_id).filter(Boolean)));
  const memberIds = Array.from(new Set(
    calls.flatMap((c) => [c.team_member_id, c.attributed_team_member_id]).filter(Boolean)
  ));
  const lineIds = Array.from(new Set(calls.map((c) => c.quo_phone_line_id).filter(Boolean)));
  const callIds = calls.map((c) => c.id);

  // Parallel hydration
  const [suppliersRes, personsRes, membersRes, linesRes, followUpsRes] = await Promise.all([
    supplierIds.length
      ? supabase.from("supplier_contacts").select("id, name").in("id", supplierIds)
      : Promise.resolve({ data: [] as any[] }),
    personIds.length
      ? supabase.from("supplier_contact_persons").select("id, name, title").in("id", personIds)
      : Promise.resolve({ data: [] as any[] }),
    memberIds.length
      ? supabase.from("team_members").select("id, name, initials, color").in("id", memberIds)
      : Promise.resolve({ data: [] as any[] }),
    lineIds.length
      ? supabase.from("quo_phone_lines").select(
          "id, display_name, line_type, email_account_id, " +
          "email_account:email_accounts(id, name, icon, color)"
        ).in("id", lineIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase
      .from("call_follow_ups")
      .select("quo_call_log_id")
      .in("quo_call_log_id", callIds)
      .in("status", ["pending", "in_progress"]),
  ]);

  const supplierMap = new Map<string, any>((suppliersRes.data || []).map((r: any) => [r.id, r]));
  const personMap = new Map<string, any>((personsRes.data || []).map((r: any) => [r.id, r]));
  const memberMap = new Map<string, any>((membersRes.data || []).map((r: any) => [r.id, r]));
  const lineMap = new Map<string, any>((linesRes.data || []).map((r: any) => [r.id, r]));
  const activeFollowUpCallIds = new Set<string>(
    (followUpsRes.data || []).map((r: any) => r.quo_call_log_id)
  );

  const hydrated = calls.map((c) => {
    const line = c.quo_phone_line_id ? lineMap.get(c.quo_phone_line_id) : null;
    const emailAccount = line?.email_account || null;
    const attributed = c.attributed_team_member_id ? memberMap.get(c.attributed_team_member_id) : null;
    return {
      ...c,
      supplier_name: c.supplier_contact_id ? (supplierMap.get(c.supplier_contact_id)?.name || null) : null,
      person_name: c.supplier_contact_person_id ? (personMap.get(c.supplier_contact_person_id)?.name || null) : null,
      person_title: c.supplier_contact_person_id ? (personMap.get(c.supplier_contact_person_id)?.title || null) : null,
      team_member_name: c.team_member_id ? (memberMap.get(c.team_member_id)?.name || null) : null,
      team_member_initials: c.team_member_id ? (memberMap.get(c.team_member_id)?.initials || null) : null,
      team_member_color: c.team_member_id ? (memberMap.get(c.team_member_id)?.color || null) : null,
      attributed_team_member_name: attributed?.name || null,
      attributed_team_member_initials: attributed?.initials || null,
      attributed_team_member_color: attributed?.color || null,
      line_display_name: line?.display_name || null,
      email_account_name: emailAccount?.name || null,
      email_account_icon: emailAccount?.icon || null,
      email_account_color: emailAccount?.color || null,
    };
  });

  return NextResponse.json({
    calls: hydrated,
    active_follow_ups: Array.from(activeFollowUpCallIds),
  });
}