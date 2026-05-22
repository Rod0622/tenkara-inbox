// src/app/api/integrations/quo/lines/route.ts
//
// GET   /api/integrations/quo/lines
//   Returns one entry per Quo phone number in the workspace, enriched with:
//     - current line_type / email_account_id / primary_owner_team_member_id (if classified)
//     - suggested classification (line_type, suggested_owner_email, suggested_email_account_id)
//     - email_accounts available for assignment
//     - team_members available for owner assignment
//
// PATCH /api/integrations/quo/lines
//   body: { lines: Array<{
//             quo_phone_number_id: string,
//             line_type: "private" | "shared" | "unknown",
//             email_account_id?: string | null,
//             primary_owner_team_member_id?: string | null,
//             is_active?: boolean,
//             notes?: string | null,
//           }> }
//   Upserts each line by quo_phone_number_id.
//
// Admin only.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import {
  classifyLineName,
  suggestOwnerEmail,
  suggestEmailAccountId,
} from "@/lib/quo-line-classifier";

async function requireAdmin(): Promise<{ ok: boolean; userId?: string; resp?: NextResponse }> {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return { ok: false, resp: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.teamMember.role !== "admin") {
    return { ok: false, resp: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { ok: true, userId: session.teamMember.id };
}

interface LineView {
  quo_phone_number_id: string;
  number: string | null;
  display_name: string | null;
  // Current saved state (NULL if never classified)
  line_id: string | null;
  line_type: "private" | "shared" | "unknown" | null;
  email_account_id: string | null;
  primary_owner_team_member_id: string | null;
  is_active: boolean;
  notes: string | null;
  // Auto-classification suggestion (always computed)
  suggested_line_type: "private" | "shared" | "unknown";
  suggested_email_account_id: string | null;
  suggested_owner_team_member_id: string | null;
  suggested_owner_email: string | null;
}

export async function GET(_req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  const supabase = createServerClient();

  const [cfgRes, linesRes, accountsRes, membersRes] = await Promise.all([
    supabase
      .from("integration_configs")
      .select("config")
      .eq("provider", "quo")
      .maybeSingle(),
    supabase
      .from("quo_phone_lines")
      .select("*"),
    supabase
      .from("email_accounts")
      .select("id, name, email, icon, color, is_active")
      .eq("is_active", true),
    supabase
      .from("team_members")
      .select("id, name, email, initials, color, is_active")
      .eq("is_active", true),
  ]);

  const cfg: any = cfgRes.data;
  const knownPhoneNumbers: any[] = cfg?.config?.knownPhoneNumbers || [];
  const savedLines: any[] = linesRes.data || [];
  const accounts: any[] = accountsRes.data || [];
  const members: any[] = membersRes.data || [];

  // Index saved lines by quo_phone_number_id
  const savedByQuoId = new Map<string, any>();
  for (const l of savedLines) {
    savedByQuoId.set(l.quo_phone_number_id, l);
  }

  // Index members by email (case-insensitive)
  const memberByEmail = new Map<string, any>();
  for (const m of members) {
    if (m.email) memberByEmail.set(String(m.email).toLowerCase().trim(), m);
  }

  // Build the per-line view
  const lines: LineView[] = knownPhoneNumbers.map((pn: any) => {
    const quoPnId: string = pn.id;
    const number: string | null = pn.number || pn.phoneNumber || null;
    const displayName: string | null = pn.name || null;

    const saved = savedByQuoId.get(quoPnId) || null;

    // Compute auto-classification suggestion
    const cls = classifyLineName(displayName);
    let suggestedEmailAccountId: string | null = null;
    let suggestedOwnerEmail: string | null = null;
    let suggestedOwnerTeamMemberId: string | null = null;

    if (cls.line_type === "shared") {
      suggestedEmailAccountId = suggestEmailAccountId(
        cls.brand_hint,
        accounts.map((a) => ({ id: a.id, name: a.name }))
      );
    } else if (cls.line_type === "private") {
      suggestedOwnerEmail = suggestOwnerEmail(
        cls.person_hint,
        members.map((m) => ({ id: m.id, name: m.name, email: m.email })),
      );
      if (suggestedOwnerEmail) {
        const m = memberByEmail.get(suggestedOwnerEmail.toLowerCase().trim());
        if (m) suggestedOwnerTeamMemberId = m.id;
      }
    }

    return {
      quo_phone_number_id: quoPnId,
      number,
      display_name: displayName,
      line_id: saved?.id || null,
      line_type: saved?.line_type ?? null,
      email_account_id: saved?.email_account_id ?? null,
      primary_owner_team_member_id: saved?.primary_owner_team_member_id ?? null,
      is_active: saved?.is_active ?? true,
      notes: saved?.notes ?? null,
      suggested_line_type: cls.line_type,
      suggested_email_account_id: suggestedEmailAccountId,
      suggested_owner_team_member_id: suggestedOwnerTeamMemberId,
      suggested_owner_email: suggestedOwnerEmail,
    };
  });

  // Sort: shared first (by display name), then private (by display name)
  lines.sort((a, b) => {
    const aType = a.line_type || a.suggested_line_type;
    const bType = b.line_type || b.suggested_line_type;
    if (aType === "shared" && bType !== "shared") return -1;
    if (bType === "shared" && aType !== "shared") return 1;
    return (a.display_name || "").localeCompare(b.display_name || "");
  });

  return NextResponse.json({
    lines,
    email_accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      icon: a.icon,
      color: a.color,
    })),
    team_members: members
      .filter((m: any) => m.email)
      .map((m: any) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        initials: m.initials,
        color: m.color,
      })),
    classified_count: lines.filter((l) => l.line_type).length,
    total: lines.length,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!Array.isArray(body.lines)) {
    return NextResponse.json({ error: "body.lines must be an array" }, { status: 400 });
  }

  const supabase = createServerClient();

  // We need quo_phone_number_id → display_name + number from knownPhoneNumbers,
  // because PATCH may be the first time we're inserting a row for this line.
  const { data: cfgRes } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("provider", "quo")
    .maybeSingle();
  const knownPhoneNumbers: any[] = (cfgRes as any)?.config?.knownPhoneNumbers || [];
  const knownByQuoId = new Map<string, any>();
  for (const pn of knownPhoneNumbers) knownByQuoId.set(pn.id, pn);

  const upsertRows: any[] = [];
  for (const raw of body.lines as any[]) {
    if (!raw?.quo_phone_number_id || typeof raw.quo_phone_number_id !== "string") continue;
    const known = knownByQuoId.get(raw.quo_phone_number_id);
    const number = known?.number || known?.phoneNumber || null;
    const displayName = known?.name || null;

    const lineType: string = ["private", "shared", "unknown"].includes(raw.line_type)
      ? raw.line_type
      : "unknown";

    upsertRows.push({
      quo_phone_number_id: raw.quo_phone_number_id,
      number,
      display_name: displayName,
      line_type: lineType,
      email_account_id: raw.email_account_id || null,
      primary_owner_team_member_id: raw.primary_owner_team_member_id || null,
      is_active: typeof raw.is_active === "boolean" ? raw.is_active : true,
      notes: typeof raw.notes === "string" ? raw.notes : null,
    });
  }

  if (upsertRows.length === 0) {
    return NextResponse.json({ error: "No valid lines provided" }, { status: 400 });
  }

  const { error: upsertErr } = await supabase
    .from("quo_phone_lines")
    .upsert(upsertRows, { onConflict: "quo_phone_number_id" });

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, saved: upsertRows.length });
}
