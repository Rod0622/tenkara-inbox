// src/app/api/integrations/quo/lines/auto-classify/route.ts
//
// POST /api/integrations/quo/lines/auto-classify
//   body: { overwrite?: boolean }  default: false
//
// Walks all Quo phone numbers from integration_configs.config.knownPhoneNumbers,
// applies the classifier, and upserts a quo_phone_lines row for each.
//
// By default (overwrite=false), lines that already have a saved classification
// are skipped. With overwrite=true, all lines are replaced with the
// auto-classified version.
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

async function requireAdmin(): Promise<{ ok: boolean; resp?: NextResponse }> {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return { ok: false, resp: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.teamMember.role !== "admin") {
    return { ok: false, resp: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }
  const overwrite: boolean = !!body.overwrite;

  const supabase = createServerClient();

  const [cfgRes, existingRes, accountsRes, membersRes] = await Promise.all([
    supabase
      .from("integration_configs")
      .select("config")
      .eq("provider", "quo")
      .maybeSingle(),
    supabase
      .from("quo_phone_lines")
      .select("quo_phone_number_id"),
    supabase
      .from("email_accounts")
      .select("id, name, is_active")
      .eq("is_active", true),
    supabase
      .from("team_members")
      .select("id, name, email, is_active")
      .eq("is_active", true),
  ]);

  const cfg: any = cfgRes.data;
  const knownPhoneNumbers: any[] = cfg?.config?.knownPhoneNumbers || [];
  const existingIds = new Set<string>(
    ((existingRes.data || []) as any[]).map((r) => r.quo_phone_number_id)
  );
  const accounts = (accountsRes.data || []) as any[];
  const members = (membersRes.data || []) as any[];
  const memberByEmail = new Map<string, any>();
  for (const m of members) {
    if (m.email) memberByEmail.set(String(m.email).toLowerCase().trim(), m);
  }

  if (knownPhoneNumbers.length === 0) {
    return NextResponse.json({ error: "No Quo phone numbers known. Run Test Connection first." }, { status: 400 });
  }

  const upserts: any[] = [];
  let skipped = 0;

  for (const pn of knownPhoneNumbers) {
    if (!pn?.id) continue;
    if (!overwrite && existingIds.has(pn.id)) {
      skipped++;
      continue;
    }

    const cls = classifyLineName(pn.name);
    let emailAccountId: string | null = null;
    let primaryOwnerTeamMemberId: string | null = null;

    if (cls.line_type === "shared") {
      emailAccountId = suggestEmailAccountId(
        cls.brand_hint,
        accounts.map((a) => ({ id: a.id, name: a.name })),
      );
    } else if (cls.line_type === "private") {
      const email = suggestOwnerEmail(
        cls.person_hint,
        members.map((m) => ({ id: m.id, name: m.name, email: m.email })),
      );
      if (email) {
        const m = memberByEmail.get(email.toLowerCase().trim());
        if (m) primaryOwnerTeamMemberId = m.id;
      }
    }

    upserts.push({
      quo_phone_number_id: pn.id,
      number: pn.number || pn.phoneNumber || null,
      display_name: pn.name || null,
      line_type: cls.line_type,
      email_account_id: emailAccountId,
      primary_owner_team_member_id: primaryOwnerTeamMemberId,
      is_active: true,
    });
  }

  if (upserts.length === 0) {
    return NextResponse.json({
      ok: true,
      classified: 0,
      skipped,
      message: overwrite ? "Nothing to classify" : "All lines already classified (use overwrite=true to re-run)",
    });
  }

  const { error } = await supabase
    .from("quo_phone_lines")
    .upsert(upserts, { onConflict: "quo_phone_number_id" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    classified: upserts.length,
    skipped,
  });
}
