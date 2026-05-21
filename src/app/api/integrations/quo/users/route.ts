// src/app/api/integrations/quo/users/route.ts
//
// GET   /api/integrations/quo/users
//   Returns the list of Quo workspace users (extracted from saved
//   knownPhoneNumbers data — no extra Quo API call needed), cross-referenced
//   with the saved quo_user_email_map and your team_members list.
//
// PATCH /api/integrations/quo/users
//   body: { map: { [quoUserId]: emailOrNull } }
//   Replaces the entire mapping with the provided object. To clear one entry,
//   send its email as null. To clear all entries, send an empty object.
//
// Admin-only (matches the rest of /api/integrations/quo/...).
//
// Why no separate Quo API call: GET /v1/phone-numbers returns each phone
// number's assigned users inline. Batch 1A already saves that response into
// config.knownPhoneNumbers. We extract unique users from there.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

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

interface QuoUserView {
  quo_user_id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  phone_numbers: Array<{ id: string; number: string | null; name: string | null }>;
  // Current mapping
  mapped_email: string | null;
  mapped_team_member: { id: string; name: string; initials: string; color: string } | null;
  // Suggested team member when no explicit mapping exists (email match)
  suggested_team_member: { id: string; name: string; initials: string; color: string } | null;
}

export async function GET(_req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  const supabase = createServerClient();

  const [cfgRes, membersRes] = await Promise.all([
    supabase
      .from("integration_configs")
      .select("config")
      .eq("provider", "quo")
      .maybeSingle(),
    supabase
      .from("team_members")
      .select("id, name, email, initials, color, is_active")
      .eq("is_active", true),
  ]);

  const cfg: any = cfgRes.data;
  if (!cfg) {
    return NextResponse.json({
      users: [],
      total_team_members: 0,
      mapped_count: 0,
      message: "Quo integration not configured yet",
    });
  }

  const knownPhoneNumbers: any[] = cfg.config?.knownPhoneNumbers || [];
  const userEmailMap: Record<string, string> = cfg.config?.quo_user_email_map || {};
  const members: any[] = membersRes.data || [];

  // Build email → member lookup (case-insensitive)
  const memberByEmail = new Map<string, any>();
  for (const m of members) {
    if (m.email) memberByEmail.set(String(m.email).toLowerCase().trim(), m);
  }

  // Extract unique Quo users from knownPhoneNumbers. The same userId can
  // appear under multiple phone numbers — we dedupe by quo_user_id and
  // collect all the phone numbers they're assigned to.
  const userMap = new Map<string, QuoUserView>();
  for (const pn of knownPhoneNumbers) {
    const pnId = pn.id;
    const pnNumber = pn.number || pn.phoneNumber || null;
    const pnName = pn.name || null;
    const usersOnNumber: any[] = Array.isArray(pn.users) ? pn.users : [];

    for (const u of usersOnNumber) {
      if (!u?.id) continue;
      let view = userMap.get(u.id);
      if (!view) {
        view = {
          quo_user_id: u.id,
          email: u.email || null,
          firstName: u.firstName || null,
          lastName: u.lastName || null,
          role: u.role || null,
          phone_numbers: [],
          mapped_email: null,
          mapped_team_member: null,
          suggested_team_member: null,
        };
        userMap.set(u.id, view);
      }
      // Add this phone number to the user's list (dedupe by phone id)
      if (!view.phone_numbers.find((p) => p.id === pnId)) {
        view.phone_numbers.push({ id: pnId, number: pnNumber, name: pnName });
      }
    }
  }

  // Populate mapped + suggested team members per Quo user.
  // NOTE: avoid `for...of` over Map.values() — fails at our TypeScript target
  // level. Use Array.from(...).forEach instead.
  Array.from(userMap.values()).forEach((view) => {
    const mappedEmail = userEmailMap[view.quo_user_id] || null;
    if (mappedEmail) {
      view.mapped_email = mappedEmail;
      const m = memberByEmail.get(mappedEmail.toLowerCase().trim());
      if (m) {
        view.mapped_team_member = {
          id: m.id, name: m.name, initials: m.initials, color: m.color,
        };
      }
    } else if (view.email) {
      // Auto-suggest by email match (only when no explicit mapping exists)
      const m = memberByEmail.get(view.email.toLowerCase().trim());
      if (m) {
        view.suggested_team_member = {
          id: m.id, name: m.name, initials: m.initials, color: m.color,
        };
      }
    }
  });

  // Sort by display name
  const users = Array.from(userMap.values()).sort((a, b) => {
    const an = `${a.firstName || ""} ${a.lastName || ""}`.trim() || a.email || "";
    const bn = `${b.firstName || ""} ${b.lastName || ""}`.trim() || b.email || "";
    return an.localeCompare(bn);
  });

  // Also surface team members in the response so the UI can populate the
  // mapping <select> dropdowns without a separate fetch.
  const teamMembers = members
    .filter((m: any) => m.email)
    .map((m: any) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      initials: m.initials || (m.name || "").slice(0, 2).toUpperCase(),
      color: m.color || "#888",
    }));

  return NextResponse.json({
    users,
    team_members: teamMembers,
    total_team_members: members.length,
    mapped_count: users.filter((u) => u.mapped_team_member).length,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.map || typeof body.map !== "object") {
    return NextResponse.json({ error: "body.map must be an object" }, { status: 400 });
  }

  // Validate: each value is a string (email) or null. Filter out nulls/empties.
  const newMap: Record<string, string> = {};
  for (const [quoUserId, raw] of Object.entries(body.map as Record<string, any>)) {
    if (typeof quoUserId !== "string" || !quoUserId.trim()) continue;
    if (raw === null || raw === undefined || raw === "") continue;
    if (typeof raw !== "string") continue;
    newMap[quoUserId.trim()] = raw.toLowerCase().trim();
  }

  const supabase = createServerClient();

  // Read current config, merge in the new map, write back
  const { data: existing, error: readErr } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("provider", "quo")
    .maybeSingle();

  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Quo not configured" }, { status: 404 });

  const currentConfig = (existing as any).config || {};
  const updatedConfig = { ...currentConfig, quo_user_email_map: newMap };

  const { error: updErr } = await supabase
    .from("integration_configs")
    .update({ config: updatedConfig })
    .eq("provider", "quo");

  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, mapped_count: Object.keys(newMap).length });
}
