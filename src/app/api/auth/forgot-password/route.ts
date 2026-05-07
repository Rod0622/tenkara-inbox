import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import crypto from "crypto";
import { sendTransactionalEmail } from "@/lib/transactional-email";

function getAppUrl() {
  if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

function resetEmailHtml({ resetUrl, name }: { resetUrl: string; name: string }) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:40px 20px;">
      <div style="text-align:center;margin-bottom:32px;">
        <div style="display:inline-block;width:56px;height:56px;border-radius:16px;background:linear-gradient(135deg,#4ADE80,#39D2C0);line-height:56px;text-align:center;font-size:28px;font-weight:900;color:#0B0E11;">T</div>
      </div>
      <h1 style="font-size:24px;font-weight:700;color:#111827;text-align:center;margin-bottom:8px;">
        Reset your password
      </h1>
      <p style="font-size:15px;color:#4B5563;text-align:center;margin-bottom:28px;line-height:1.6;">
        Hi ${name}, someone (hopefully you) requested a password reset for your Tenkara Inbox account.
      </p>
      <div style="text-align:center;margin-bottom:28px;">
        <a href="${resetUrl}" style="display:inline-block;padding:14px 28px;background:#4ADE80;color:#0B0E11;border-radius:10px;font-size:15px;font-weight:700;text-decoration:none;">
          Reset Password
        </a>
      </div>
      <p style="font-size:13px;color:#6B7280;text-align:center;line-height:1.6;">
        This link expires in 1 hour.<br/>
        If you didn't request this, ignore this email — your password will not change.<br/><br/>
        If the button does not work, open this link:<br/>
        <span style="word-break:break-all;">${resetUrl}</span>
      </p>
    </div>
  `;
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const normalizedEmail = String(body?.email || "").trim().toLowerCase();
  if (!normalizedEmail) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const { data: member, error } = await supabase
    .from("team_members")
    .select("id, name, email, is_active, accepted_at")
    .eq("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Per design: small internal team tool, so we tell the user clearly when an
  // account doesn't exist instead of silently pretending it does.
  if (!member) {
    return NextResponse.json(
      { error: "No account with that email" },
      { status: 404 }
    );
  }

  if (!member.is_active) {
    return NextResponse.json(
      { error: "This account has been deactivated. Contact an admin." },
      { status: 410 }
    );
  }

  if (!member.accepted_at) {
    return NextResponse.json(
      { error: "This account hasn't completed initial setup. Use the original invite link or ask an admin to re-invite." },
      { status: 409 }
    );
  }

  // Generate token, store, and send email
  const resetToken = crypto.randomBytes(32).toString("hex");
  const resetExpiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString(); // 1 hour

  const { error: updateErr } = await supabase
    .from("team_members")
    .update({
      password_reset_token: resetToken,
      password_reset_expires_at: resetExpiresAt,
    })
    .eq("id", member.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const resetUrl = `${getAppUrl()}/reset-password/${resetToken}`;

  const sent = await sendTransactionalEmail({
    to: normalizedEmail,
    subject: "Reset your Tenkara Inbox password",
    html: resetEmailHtml({ resetUrl, name: member.name || "there" }),
  });

  return NextResponse.json({
    success: true,
    emailSent: sent.ok,
    emailError: sent.error,
    senderEmail: sent.senderEmail,
    // Reset URL only included in response when email failed, so admins can
    // share it manually if needed. We deliberately don't surface it on success
    // — the user should get it via email like a normal flow.
    inviteUrl: sent.ok ? null : resetUrl,
    message: sent.ok
      ? `Reset link sent to ${normalizedEmail}. Check your inbox.`
      : `Email failed. Share this link manually: ${resetUrl}`,
  });
}
