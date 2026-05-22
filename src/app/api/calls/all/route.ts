// src/app/api/calls/all/route.ts
//
// GET /api/calls/all
//
// Filtered + paginated list of all Quo calls across all conversations, with
// pre-aggregated stats for the dashboard strip.
//
// Query params (all optional):
//   ?direction=inbound|outbound|all     default: all
//   ?outcome=answered|voicemail|missed|no_answer|all   default: all
//   ?team_member_id=<uuid>|me|all       default: all  (filters on attributed_team_member_id, with fallback to team_member_id)
//   ?has_follow_up=true|false|all       default: all
//   ?orphans=only|exclude|all           default: all  (orphan = conversation_id IS NULL)
//   ?range=today|7d|30d|all             default: 30d  (applied to started_at)
//   ?q=<search string>                  matches participant_phone OR supplier name OR person name (best-effort)
//   ?limit=50                           default: 50 (max 200)
//   ?before=<ISO>                       pagination cursor (started_at < before)
//
// Returns:
//   {
//     calls: [...hydrated rows like /api/calls],
//     active_follow_ups: string[],
//     stats: {
//       by_day: Array<{ date: "YYYY-MM-DD", count: number }>,  // 14 days
//       by_direction: { inbound: number, outbound: number },
//       by_outcome: { answered, voicemail, missed, no_answer, other },
//       by_team_member: Array<{ team_member_id, name, initials, color, count }>,
//       total_filtered: number,
//     },
//     filter_options: {
//       team_members: Array<{ id, name, initials, color }>,
//     },
//   }
//
// Stats reflect the current filter set EXCEPT time range (by_day is always 14d
// regardless of the range filter, so the sparkline is comparable across filters).

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function ymd(iso: string): string {
  return iso.slice(0, 10); // "YYYY-MM-DD"
}

export async function GET(req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const direction = url.searchParams.get("direction") || "all";
  const outcome = url.searchParams.get("outcome") || "all";
  const teamMemberParam = url.searchParams.get("team_member_id") || "all";
  const hasFollowUp = url.searchParams.get("has_follow_up") || "all";
  const orphans = url.searchParams.get("orphans") || "all";
  const range = url.searchParams.get("range") || "30d";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10), 1), 200);
  const before = url.searchParams.get("before");

  const supabase = createServerClient();

  // Resolve "me" → session team member id
  const resolvedTeamMemberId =
    teamMemberParam === "me" ? session.teamMember.id :
    teamMemberParam === "all" ? null :
    teamMemberParam;

  // Compute time range floor for the query (does NOT affect by_day stats — those
  // always look at the last 14 days)
  let rangeFloor: string | null = null;
  if (range === "today") rangeFloor = isoDaysAgo(0);
  else if (range === "7d") rangeFloor = isoDaysAgo(7);
  else if (range === "30d") rangeFloor = isoDaysAgo(30);
  // "all" → null

  // ── Main query ──────────────────────────────────────
  let qBuilder = supabase
    .from("quo_call_logs")
    .select(
      "id, quo_call_id, conversation_id, supplier_contact_id, supplier_contact_person_id, team_member_id, attributed_team_member_id, direction, status, outcome, participant_phone, workspace_phone, duration_seconds, started_at, answered_at, ended_at, recording_url, voicemail_url, voicemail_transcript, ai_summary, ai_next_steps, created_at, quo_phone_line_id, line_type, is_stub"
    )
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (direction !== "all") qBuilder = qBuilder.eq("direction", direction);
  if (outcome !== "all") qBuilder = qBuilder.eq("outcome", outcome);
  if (rangeFloor) qBuilder = qBuilder.gte("started_at", rangeFloor);
  if (before) qBuilder = qBuilder.lt("started_at", before);

  if (orphans === "only") {
    qBuilder = qBuilder.is("conversation_id", null);
  } else if (orphans === "exclude") {
    qBuilder = qBuilder.not("conversation_id", "is", null);
  }

  // Team-member filter applies to attributed_team_member_id with fallback to
  // team_member_id (so the "who handled it" filter works for both lines).
  // We use OR for this.
  if (resolvedTeamMemberId) {
    qBuilder = qBuilder.or(`attributed_team_member_id.eq.${resolvedTeamMemberId},and(attributed_team_member_id.is.null,team_member_id.eq.${resolvedTeamMemberId})`);
  }

  const { data: callsRaw, error } = await qBuilder;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let calls = (callsRaw || []) as any[];

  // ── Hydration ────────────────────────────────────────
  const supplierIds = Array.from(new Set(calls.map((c) => c.supplier_contact_id).filter(Boolean)));
  const personIds = Array.from(new Set(calls.map((c) => c.supplier_contact_person_id).filter(Boolean)));
  const memberIds = Array.from(new Set(
    calls.flatMap((c) => [c.team_member_id, c.attributed_team_member_id]).filter(Boolean)
  ));
  const lineIds = Array.from(new Set(calls.map((c) => c.quo_phone_line_id).filter(Boolean)));
  const callIds = calls.map((c) => c.id);

  const [suppliersRes, personsRes, membersRes, linesRes, followUpsRes, allMembersRes] = await Promise.all([
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
    callIds.length
      ? supabase.from("call_follow_ups").select("quo_call_log_id").in("quo_call_log_id", callIds).in("status", ["pending", "in_progress"])
      : Promise.resolve({ data: [] as any[] }),
    // For filter dropdown population — return ALL active team members regardless of filter
    supabase.from("team_members").select("id, name, initials, color").eq("is_active", true),
  ]);

  const supplierMap = new Map<string, any>((suppliersRes.data || []).map((r: any) => [r.id, r]));
  const personMap = new Map<string, any>((personsRes.data || []).map((r: any) => [r.id, r]));
  const memberMap = new Map<string, any>((membersRes.data || []).map((r: any) => [r.id, r]));
  const lineMap = new Map<string, any>((linesRes.data || []).map((r: any) => [r.id, r]));
  const activeFollowUpSet = new Set<string>((followUpsRes.data || []).map((r: any) => r.quo_call_log_id));

  let hydrated = calls.map((c) => {
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
      has_follow_up: activeFollowUpSet.has(c.id),
    };
  });

  // Has-follow-up filter (applied post-hydration since the join is complex)
  if (hasFollowUp === "true") {
    hydrated = hydrated.filter((c) => c.has_follow_up);
  } else if (hasFollowUp === "false") {
    hydrated = hydrated.filter((c) => !c.has_follow_up);
  }

  // Search filter (post-hydration; search across phone, supplier, person, AI summary)
  if (q) {
    hydrated = hydrated.filter((c) => {
      const haystack = [
        c.participant_phone,
        c.workspace_phone,
        c.supplier_name,
        c.person_name,
        c.ai_summary,
        c.team_member_name,
        c.attributed_team_member_name,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }

  // ── Stats (computed from hydrated set) ───────────────
  // by_day uses last 14 days, NOT the range filter
  const dayBuckets = new Map<string, number>();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dayBuckets.set(ymd(d.toISOString()), 0);
  }
  // For by_day we need a SEPARATE query that ignores the range filter (so the
  // sparkline shows trailing 14d regardless of "today" filter being active).
  // But still respects all OTHER filters. Simplest approach: refetch with
  // range=14d, applying everything else.
  const sparklineFloor = isoDaysAgo(14);
  let sparkQ = supabase
    .from("quo_call_logs")
    .select("id, started_at, direction, outcome, team_member_id, attributed_team_member_id, conversation_id")
    .gte("started_at", sparklineFloor)
    .order("started_at", { ascending: false })
    .limit(5000);

  if (direction !== "all") sparkQ = sparkQ.eq("direction", direction);
  if (outcome !== "all") sparkQ = sparkQ.eq("outcome", outcome);
  if (orphans === "only") sparkQ = sparkQ.is("conversation_id", null);
  else if (orphans === "exclude") sparkQ = sparkQ.not("conversation_id", "is", null);
  if (resolvedTeamMemberId) {
    sparkQ = sparkQ.or(`attributed_team_member_id.eq.${resolvedTeamMemberId},and(attributed_team_member_id.is.null,team_member_id.eq.${resolvedTeamMemberId})`);
  }
  const { data: sparkRaw } = await sparkQ;
  const sparkRows = (sparkRaw || []) as any[];
  for (const r of sparkRows) {
    if (!r.started_at) continue;
    const day = ymd(r.started_at);
    if (dayBuckets.has(day)) dayBuckets.set(day, (dayBuckets.get(day) || 0) + 1);
  }

  // Direction / outcome / team_member breakdowns — from the hydrated (range-filtered) set
  const byDirection = { inbound: 0, outbound: 0 };
  const byOutcome: Record<string, number> = { answered: 0, voicemail: 0, missed: 0, no_answer: 0, other: 0 };
  const byTeamMember = new Map<string, { id: string; name: string; initials: string; color: string; count: number }>();
  for (const c of hydrated) {
    if (c.direction === "inbound") byDirection.inbound++;
    else if (c.direction === "outbound") byDirection.outbound++;

    const o = c.outcome || "other";
    if (byOutcome[o] !== undefined) byOutcome[o]++;
    else byOutcome.other++;

    // Attribute to attributed_team_member_id first, fall back to team_member_id
    const tmId = c.attributed_team_member_id || c.team_member_id;
    if (tmId) {
      const member = memberMap.get(tmId);
      if (member) {
        const existing = byTeamMember.get(tmId);
        if (existing) existing.count++;
        else byTeamMember.set(tmId, { id: tmId, name: member.name, initials: member.initials, color: member.color, count: 1 });
      }
    }
  }

  return NextResponse.json({
    calls: hydrated,
    active_follow_ups: Array.from(activeFollowUpSet),
    stats: {
      by_day: Array.from(dayBuckets.entries()).map(([date, count]) => ({ date, count })),
      by_direction: byDirection,
      by_outcome: byOutcome,
      by_team_member: Array.from(byTeamMember.values()).sort((a, b) => b.count - a.count),
      total_filtered: hydrated.length,
    },
    filter_options: {
      team_members: ((allMembersRes.data || []) as any[]).map((m: any) => ({
        id: m.id, name: m.name, initials: m.initials, color: m.color,
      })),
    },
  });
}
