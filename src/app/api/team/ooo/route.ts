export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/team/ooo
//   - no params: returns all users + their OOO status (used by sidebar Team list)
//   - ?user_id=xxx: returns the specific user's OOO periods (used by popover)
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const userId = req.nextUrl.searchParams.get("user_id");

  if (userId) {
    // Return all OOO periods for this user, plus current status
    const { data: periods, error } = await supabase
      .from("user_ooo")
      .select("*")
      .eq("user_id", userId)
      .order("start_date", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Compute "is currently OOO"
    const now = new Date();
    const isOOO = (periods || []).some((p: any) => {
      if (p.is_active_indefinite) return true;
      const start = new Date(p.start_date);
      const end = p.end_date ? new Date(p.end_date) : null;
      return start <= now && (!end || end >= now);
    });

    return NextResponse.json({ periods: periods || [], is_currently_ooo: isOOO });
  }

  // No user_id: return all team members with their OOO status (for sidebar list)
  const { data: members, error: mErr } = await supabase
    .from("team_members")
    .select("id, name, initials, color, role, department, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  // Get all currently-active OOO rows in one query
  const nowIso = new Date().toISOString();
  const { data: oooRows } = await supabase
    .from("user_ooo")
    .select("user_id, end_date, note, is_active_indefinite, start_date");

  // Build a per-user OOO summary
  const oooByUser = new Map<string, { is_currently_ooo: boolean; end_date: string | null; note: string | null }>();
  for (const r of (oooRows || [])) {
    const isActive = r.is_active_indefinite ||
      (new Date(r.start_date) <= new Date(nowIso) && (!r.end_date || new Date(r.end_date) >= new Date(nowIso)));
    if (!isActive) continue;
    const existing = oooByUser.get(r.user_id);
    // If indefinite, always wins
    if (r.is_active_indefinite || !existing) {
      oooByUser.set(r.user_id, {
        is_currently_ooo: true,
        end_date: r.is_active_indefinite ? null : r.end_date,
        note: r.note,
      });
    }
  }

  const enriched = (members || []).map((m: any) => ({
    ...m,
    is_currently_ooo: !!oooByUser.get(m.id)?.is_currently_ooo,
    ooo_end_date: oooByUser.get(m.id)?.end_date || null,
    ooo_note: oooByUser.get(m.id)?.note || null,
  }));

  return NextResponse.json({ members: enriched });
}

// POST /api/team/ooo — create new OOO period
// Body: { user_id, start_date?, end_date?, is_active_indefinite?, note?, created_by? }
// Permission: user can set their own; admins can set anyone's
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { user_id, start_date, end_date, is_active_indefinite, note, created_by } = body;

  if (!user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  // Permission check: created_by must be the same user OR an admin
  if (created_by && created_by !== user_id) {
    const { data: actor } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", created_by)
      .maybeSingle();
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "Only the user themselves or an admin can set OOO" }, { status: 403 });
    }
  }

  // Validate: indefinite => end_date must be null
  const indefinite = !!is_active_indefinite;
  const cleanedEnd = indefinite ? null : (end_date || null);
  const cleanedStart = start_date || new Date().toISOString();

  // Validate range
  if (!indefinite && cleanedEnd && new Date(cleanedEnd) < new Date(cleanedStart)) {
    return NextResponse.json({ error: "end_date must be on or after start_date" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("user_ooo")
    .insert({
      user_id,
      start_date: cleanedStart,
      end_date: cleanedEnd,
      is_active_indefinite: indefinite,
      note: note || null,
      created_by: created_by || user_id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ period: data }, { status: 201 });
}

// PATCH /api/team/ooo — update an existing OOO period (e.g., change end_date or toggle indefinite)
// Body: { id, ...fields, actor_id }
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { id, actor_id, ...updates } = body;

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Get existing row to verify permission
  const { data: existing } = await supabase
    .from("user_ooo")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Permission check
  if (actor_id && actor_id !== existing.user_id) {
    const { data: actor } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", actor_id)
      .maybeSingle();
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  // Sanitize updates
  const allowed: any = {};
  if ("start_date" in updates) allowed.start_date = updates.start_date;
  if ("end_date" in updates) allowed.end_date = updates.end_date;
  if ("is_active_indefinite" in updates) allowed.is_active_indefinite = !!updates.is_active_indefinite;
  if ("note" in updates) allowed.note = updates.note;

  // If becoming indefinite, force end_date to null
  if (allowed.is_active_indefinite === true) {
    allowed.end_date = null;
  }

  const { data, error } = await supabase
    .from("user_ooo")
    .update(allowed)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ period: data });
}

// DELETE /api/team/ooo?id=xxx&actor_id=yyy — remove an OOO period
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");
  const actor_id = req.nextUrl.searchParams.get("actor_id");

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Permission check
  const { data: existing } = await supabase
    .from("user_ooo")
    .select("user_id")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (actor_id && actor_id !== existing.user_id) {
    const { data: actor } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", actor_id)
      .maybeSingle();
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { error } = await supabase.from("user_ooo").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
