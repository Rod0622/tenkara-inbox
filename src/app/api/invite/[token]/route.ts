import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import bcrypt from "bcryptjs";

/**
 * Token-based invite endpoints.
 *
 * Batch 34: this file previously contained a copy-paste of the parent
 * /api/invite/route.ts (POST/DELETE/PATCH), which meant the token-based
 * accept-invite flow was never actually implemented. The frontend page at
 * /accept-invite/[token] was calling endpoints that didn't exist.
 *
 * GET  /api/invite/{token} — look up an outstanding invite by token
 * POST /api/invite/{token} — accept the invite (set password)
 */

interface RouteContext {
  params: Promise<{ token: string }> | { token: string };
}

async function resolveToken(context: RouteContext): Promise<string> {
  const params = await context.params;
  return String(params?.token || "").trim();
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  try {
    return new Date(expiresAt).getTime() < Date.now();
  } catch {
    return true;
  }
}

// ─── GET: look up invite by token ─────────────────────────────────────────────
export async function GET(_req: NextRequest, context: RouteContext) {
  const token = await resolveToken(context);
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: member, error } = await supabase
    .from("team_members")
    .select("id, email, name, role, department, is_active, accepted_at, invite_expires_at")
    .eq("invite_token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });
  }

  if (!member.is_active) {
    return NextResponse.json({ error: "This account has been deactivated" }, { status: 410 });
  }

  if (member.accepted_at) {
    return NextResponse.json({ error: "This invite has already been accepted" }, { status: 410 });
  }

  if (isExpired(member.invite_expires_at)) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  // Return only the safe fields needed to display the form
  return NextResponse.json({
    invite: {
      email: member.email,
      name: member.name,
      role: member.role,
      department: member.department,
    },
  });
}

// ─── POST: accept invite, set password ───────────────────────────────────────
export async function POST(req: NextRequest, context: RouteContext) {
  const token = await resolveToken(context);
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const password = String(body?.password || "");
  const confirmPassword = String(body?.confirmPassword || "");

  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Re-validate the token (someone could have tampered with the form between GET and POST)
  const { data: member, error: lookupErr } = await supabase
    .from("team_members")
    .select("id, is_active, accepted_at, invite_expires_at")
    .eq("invite_token", token)
    .maybeSingle();

  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });
  }

  if (!member.is_active) {
    return NextResponse.json({ error: "This account has been deactivated" }, { status: 410 });
  }

  if (member.accepted_at) {
    return NextResponse.json({ error: "This invite has already been accepted" }, { status: 410 });
  }

  if (isExpired(member.invite_expires_at)) {
    return NextResponse.json({ error: "This invite has expired" }, { status: 410 });
  }

  // Hash the password and mark the invite accepted. Clear the invite_token so
  // the link is single-use.
  const password_hash = await bcrypt.hash(password, 10);
  const acceptedAt = new Date().toISOString();

  const { error: updateErr } = await supabase
    .from("team_members")
    .update({
      password_hash,
      accepted_at: acceptedAt,
      invite_token: null,
      invite_expires_at: null,
    })
    .eq("id", member.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}