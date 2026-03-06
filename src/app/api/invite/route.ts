import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import nodemailer from "nodemailer";
import crypto from "crypto";

// POST /api/invite — invite a new team member
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { email, name, role, department, invited_by } = body;

  if (!email?.trim() || !name?.trim()) {
    return NextResponse.json({ error: "Email and name are required" }, { status: 400 });
  }

  // Check if user already exists
  const { data: existing } = await supabase
    .from("team_members")
    .select("id, email, is_active")
    .eq("email", email.trim().toLowerCase())
    .single();

  if (existing) {
    return NextResponse.json(
      { error: existing.is_active ? "User already exists" : "User was previously deactivated. Reactivate them instead." },
      { status: 409 }
    );
  }

  // Generate invite token
  const inviteToken = crypto.randomBytes(32).toString("hex");
  const initials = name
    .trim()
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Random avatar color
  const colors = ["#4ADE80", "#58A6FF", "#BC8CFF", "#F0883E", "#F85149", "#39D2C0", "#F5D547"];
  const color = colors[Math.floor(Math.random() * colors.length)];

  // Insert the team member with invite_token (password_hash is null = pending)
  const { data: member, error: insertErr } = await supabase
    .from("team_members")
    .insert({
      email: email.trim().toLowerCase(),
      name: name.trim(),
      initials,
      color,
      role: role || "member",
      department: department || "Uncategorized",
      is_active: true,
      password_hash: null,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  // Try to send invite email via first active email account
  let emailSent = false;
  try {
    const { data: accounts } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("is_active", true)
      .limit(1);

    const account = accounts?.[0];
    if (account?.smtp_host && account?.smtp_password) {
      const appUrl = process.env.NEXTAUTH_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";

      const transport = nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port || 587,
        secure: account.smtp_port === 465,
        auth: {
          user: account.smtp_user || account.imap_user || account.email,
          pass: account.smtp_password || account.imap_password,
        },
        tls: { rejectUnauthorized: false },
      });

      await transport.sendMail({
        from: `"Tenkara Inbox" <${account.email}>`,
        to: email.trim(),
        subject: "You've been invited to Tenkara Inbox",
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <div style="display: inline-block; width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #4ADE80, #39D2C0); line-height: 56px; text-align: center; font-size: 28px; font-weight: 900; color: #0B0E11;">T</div>
            </div>
            <h1 style="font-size: 24px; font-weight: 700; color: #1a1a1a; text-align: center; margin-bottom: 8px;">
              You're invited to Tenkara Inbox
            </h1>
            <p style="font-size: 15px; color: #666; text-align: center; margin-bottom: 32px; line-height: 1.5;">
              ${invited_by || "An admin"} has invited you to join the team. Sign in with your email and create a password to get started.
            </p>
            <div style="text-align: center; margin-bottom: 32px;">
              <a href="${appUrl}/login" style="display: inline-block; padding: 14px 32px; background: #4ADE80; color: #0B0E11; border-radius: 10px; font-size: 15px; font-weight: 700; text-decoration: none;">
                Sign In to Tenkara Inbox
              </a>
            </div>
            <p style="font-size: 13px; color: #999; text-align: center; line-height: 1.5;">
              Your email: <strong>${email.trim()}</strong><br>
              Use this email to sign in. On your first login, choose any password — it will be saved automatically.
            </p>
          </div>
        `,
      });
      emailSent = true;
    }
  } catch (emailErr: any) {
    console.error("Invite email failed:", emailErr.message);
    // Don't fail the invite — user was created, just no email sent
  }

  return NextResponse.json({
    member,
    emailSent,
    message: emailSent
      ? `Invitation sent to ${email.trim()}`
      : `User created. Email could not be sent — share the login link manually.`,
  });
}

// DELETE /api/invite — deactivate a team member
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { member_id } = body;

  if (!member_id) {
    return NextResponse.json({ error: "member_id is required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("team_members")
    .update({ is_active: false })
    .eq("id", member_id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// PATCH /api/invite — update a team member's role/department
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { member_id, role, department, is_active } = body;

  if (!member_id) {
    return NextResponse.json({ error: "member_id is required" }, { status: 400 });
  }

  const update: any = {};
  if (role !== undefined) update.role = role;
  if (department !== undefined) update.department = department;
  if (is_active !== undefined) update.is_active = is_active;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("team_members")
    .update(update)
    .eq("id", member_id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ member: data });
}