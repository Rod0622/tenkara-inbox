import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import nodemailer from "nodemailer";
import crypto from "crypto";
import { refreshGoogleToken } from "@/lib/google-oauth";

function getAppUrl() {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function makeInitials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function pickColor() {
  const colors = [
    "#4ADE80",
    "#58A6FF",
    "#BC8CFF",
    "#F0883E",
    "#F85149",
    "#39D2C0",
    "#F5D547",
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Batch 36: change this to switch which mailbox transactional emails come from.
// Set to a specific email to hardcode, or leave empty/undefined to fall back to
// "first account that can actually send" (less predictable, more brittle).
const PREFERRED_SENDER = "operations@trytenkara.com";

/**
 * Pick the email account that should send transactional emails (invites etc.).
 *
 * Strategy:
 *  1. Use PREFERRED_SENDER if it exists and is active
 *  2. Otherwise the first active account with usable credentials
 *
 * Returns null if no usable account is found.
 */
async function pickSenderAccount(supabase: any) {
  if (PREFERRED_SENDER) {
    const { data: preferred } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("email", PREFERRED_SENDER)
      .eq("is_active", true)
      .maybeSingle();
    if (preferred) return preferred;
  }
  const { data: accounts } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("is_active", true)
    .order("created_at", { ascending: true });
  return (accounts || [])[0] || null;
}

/**
 * Build a nodemailer transport for the given account, using whichever auth
 * mechanism the account actually supports.
 *
 * - google_oauth → SMTP via XOAUTH2 with a freshly-refreshed access token
 * - everything else → plain SMTP using stored smtp_password (or imap_password fallback)
 *
 * Microsoft OAuth accounts intentionally NOT supported here — they'd need
 * Microsoft Graph API send, which we can add later if needed. For now they fail
 * fast with a clear error so admins can fall back to the manual invite link.
 */
async function buildTransport(account: any) {
  if (account.provider === "google_oauth" && account.oauth_refresh_token) {
    // Get a fresh access token (expires every ~1 hour, so this is the safe path)
    const accessToken = await refreshGoogleToken(account.id, false);
    return nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 587,
      secure: false,
      auth: {
        type: "OAuth2",
        user: account.email,
        accessToken,
      },
    } as any);
  }

  if (account.provider === "microsoft_oauth") {
    // Not supported in this batch — Microsoft Graph send would be a separate change.
    throw new Error(
      "Sending invites from Microsoft OAuth accounts is not yet supported. " +
      "Use a Google or SMTP-credentialed account, or share the invite URL manually."
    );
  }

  // Plain SMTP path (App Password or password set during Connect via SMTP form)
  if (!account.smtp_host || !(account.smtp_password || account.imap_password)) {
    throw new Error("Account has no usable SMTP credentials");
  }
  return nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port || 587,
    secure: account.smtp_port === 465,
    auth: {
      user: account.smtp_user || account.imap_user || account.email,
      pass: account.smtp_password || account.imap_password,
    },
    tls: { rejectUnauthorized: false },
  });
}

// POST /api/invite
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const {
    email,
    name,
    role,
    department,
    invited_by,
    email_account_ids = [],
    can_send = true,
    can_manage = false,
  } = body || {};

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedName = String(name || "").trim();

  if (!normalizedEmail || !normalizedName) {
    return NextResponse.json(
      { error: "Email and name are required" },
      { status: 400 }
    );
  }

  const { data: existing, error: existingError } = await supabase
    .from("team_members")
    .select("id, email, is_active, accepted_at")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json(
      { error: existingError.message },
      { status: 500 }
    );
  }

  if (existing?.accepted_at && existing?.is_active) {
    return NextResponse.json(
      { error: "User already exists and is active" },
      { status: 409 }
    );
  }

  const inviteToken = crypto.randomBytes(32).toString("hex");
  const inviteExpiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(); // 7 days
  const initials = makeInitials(normalizedName);
  const color = pickColor();

  let memberId: string | null = null;

  if (existing?.id) {
    const { data: updated, error: updateErr } = await supabase
      .from("team_members")
      .update({
        name: normalizedName,
        initials,
        color,
        role: role || "member",
        department: department || "Uncategorized",
        is_active: true,
        invite_token: inviteToken,
        invite_expires_at: inviteExpiresAt,
        invited_at: new Date().toISOString(),
        accepted_at: null,
        password_hash: null,
      })
      .eq("id", existing.id)
      .select("id")
      .single();

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    memberId = updated.id;
  } else {
    const { data: member, error: insertErr } = await supabase
      .from("team_members")
      .insert({
        email: normalizedEmail,
        name: normalizedName,
        initials,
        color,
        role: role || "member",
        department: department || "Uncategorized",
        is_active: true,
        password_hash: null,
        invite_token: inviteToken,
        invite_expires_at: inviteExpiresAt,
        invited_at: new Date().toISOString(),
        accepted_at: null,
      })
      .select("id")
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    memberId = member.id;
  }

  if (!memberId) {
    return NextResponse.json(
      { error: "Failed to create invited member" },
      { status: 500 }
    );
  }

  if (Array.isArray(email_account_ids) && email_account_ids.length > 0) {
    await supabase.from("account_access").delete().eq("team_member_id", memberId);

    const rows = email_account_ids.map((email_account_id: string) => ({
      team_member_id: memberId,
      email_account_id,
      can_send: Boolean(can_send),
      can_manage: Boolean(can_manage),
    }));

    const { error: accessErr } = await supabase
      .from("account_access")
      .insert(rows);

    if (accessErr) {
      return NextResponse.json({ error: accessErr.message }, { status: 500 });
    }
  }

  const appUrl = getAppUrl();
  const acceptUrl = `${appUrl}/accept-invite/${inviteToken}`;

  // ── Send invite email via the appropriate auth method ────────────────────
  let emailSent = false;
  let emailError: string | null = null;
  let senderEmail: string | null = null;

  try {
    const account = await pickSenderAccount(supabase);
    if (!account) {
      emailError = "No active email account available to send invite from.";
    } else {
      senderEmail = account.email;
      const transport = await buildTransport(account);

      await transport.sendMail({
        from: `"Tenkara Inbox" <${account.email}>`,
        to: normalizedEmail,
        subject: "You've been invited to Tenkara Inbox",
        html: `
          <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;">
            <div style="text-align:center;margin-bottom:32px;">
              <div style="display:inline-block;width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#4ADE80,#39D2C0);line-height:56px;text-align:center;font-size:28px;font-weight:900;color:#0B0E11;">T</div>
            </div>
            <h1 style="font-size:24px;font-weight:700;color:#111827;text-align:center;margin-bottom:8px;">
              You're invited to Tenkara Inbox
            </h1>
            <p style="font-size:15px;color:#4B5563;text-align:center;margin-bottom:28px;line-height:1.6;">
              ${invited_by || "An admin"} invited you to access the shared inbox app.
            </p>
            <div style="text-align:center;margin-bottom:28px;">
              <a href="${acceptUrl}" style="display:inline-block;padding:14px 28px;background:#4ADE80;color:#0B0E11;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">
                Accept Invite
              </a>
            </div>
            <p style="font-size:13px;color:#6B7280;text-align:center;line-height:1.6;">
              This invite expires in 7 days.<br/>
              If the button does not work, open this link:<br/>
              <span style="word-break:break-all;">${acceptUrl}</span>
            </p>
          </div>
        `,
      });

      emailSent = true;
    }
  } catch (err: any) {
    console.error("Invite email failed:", err);
    emailError = err?.message || "Failed to send invite email";
  }

  return NextResponse.json({
    success: true,
    emailSent,
    emailError,
    inviteUrl: acceptUrl,
    senderEmail,
    message: emailSent
      ? `Invitation sent to ${normalizedEmail} from ${senderEmail || "Tenkara"}`
      : `Invite created. Share this link manually: ${acceptUrl}`,
  });
}

// DELETE /api/invite
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { member_id } = body || {};

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

// PATCH /api/invite
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { member_id, role, department, is_active } = body || {};

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