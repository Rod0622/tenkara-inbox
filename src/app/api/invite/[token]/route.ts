import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import bcrypt from "bcryptjs";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createServerClient();
  const token = params.token;

  const { data: member, error } = await supabase
    .from("team_members")
    .select("id, email, name, role, department, invite_expires_at, accepted_at")
    .eq("invite_token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  if (member.accepted_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 409 });
  }

  if (
    member.invite_expires_at &&
    new Date(member.invite_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  return NextResponse.json({
    invite: {
      email: member.email,
      name: member.name,
      role: member.role,
      department: member.department,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const supabase = createServerClient();
  const token = params.token;
  const body = await req.json();

  const password = String(body?.password || "");
  const confirmPassword = String(body?.confirmPassword || "");

  if (!password || password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  if (password !== confirmPassword) {
    return NextResponse.json({ error: "Passwords do not match" }, { status: 400 });
  }

  const { data: member, error } = await supabase
    .from("team_members")
    .select("id, email, invite_expires_at, accepted_at")
    .eq("invite_token", token)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!member) {
    return NextResponse.json({ error: "Invalid invite" }, { status: 404 });
  }

  if (member.accepted_at) {
    return NextResponse.json({ error: "Invite already used" }, { status: 409 });
  }

  if (
    member.invite_expires_at &&
    new Date(member.invite_expires_at).getTime() < Date.now()
  ) {
    return NextResponse.json({ error: "Invite expired" }, { status: 410 });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { error: updateError } = await supabase
    .from("team_members")
    .update({
      password_hash: passwordHash,
      accepted_at: new Date().toISOString(),
      invite_token: null,
      invite_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", member.id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, email: member.email });
}