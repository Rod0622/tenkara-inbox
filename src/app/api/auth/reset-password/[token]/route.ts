import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import bcrypt from "bcryptjs";

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return true;
  try {
    return new Date(expiresAt).getTime() < Date.now();
  } catch {
    return true;
  }
}

// GET /api/auth/reset-password/{token} — look up reset token
export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const token = String(params?.token || "").trim();
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data: member, error } = await supabase
    .from("team_members")
    .select("id, email, name, is_active, password_reset_expires_at")
    .eq("password_reset_token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json(
      { error: "Invalid or already-used reset link" },
      { status: 404 }
    );
  }

  if (!member.is_active) {
    return NextResponse.json(
      { error: "This account has been deactivated" },
      { status: 410 }
    );
  }

  if (isExpired(member.password_reset_expires_at)) {
    return NextResponse.json(
      { error: "This reset link has expired. Request a new one." },
      { status: 410 }
    );
  }

  return NextResponse.json({
    reset: {
      email: member.email,
      name: member.name,
    },
  });
}

// POST /api/auth/reset-password/{token} — set new password
export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const token = String(params?.token || "").trim();
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
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  if (password !== confirmPassword) {
    return NextResponse.json(
      { error: "Passwords do not match" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  // Re-validate token (prevents tampering between GET and POST)
  const { data: member, error: lookupErr } = await supabase
    .from("team_members")
    .select("id, email, is_active, password_reset_expires_at")
    .eq("password_reset_token", token)
    .maybeSingle();

  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json(
      { error: "Invalid or already-used reset link" },
      { status: 404 }
    );
  }

  if (!member.is_active) {
    return NextResponse.json(
      { error: "This account has been deactivated" },
      { status: 410 }
    );
  }

  if (isExpired(member.password_reset_expires_at)) {
    return NextResponse.json(
      { error: "This reset link has expired" },
      { status: 410 }
    );
  }

  const password_hash = await bcrypt.hash(password, 10);

  // Apply the new password and consume the reset token (single-use)
  const { error: updateErr } = await supabase
    .from("team_members")
    .update({
      password_hash,
      password_reset_token: null,
      password_reset_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", member.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, email: member.email });
}
