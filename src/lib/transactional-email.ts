import nodemailer from "nodemailer";
import { createServerClient } from "@/lib/supabase";
import { refreshGoogleToken } from "@/lib/google-oauth";

/**
 * Shared transactional-email helper.
 *
 * Used by /api/invite (invitation emails) and /api/auth/forgot-password
 * (password reset emails). One pathway, one place to maintain.
 *
 * Sender selection:
 *   - PREFERRED_SENDER if active and connected
 *   - else first active account with usable credentials
 *
 * Auth selection per account:
 *   - google_oauth → SMTP via XOAUTH2 with a fresh access token
 *   - microsoft_oauth → not supported (would require Microsoft Graph send)
 *   - everything else → plain SMTP using stored smtp_password / imap_password
 *
 * To switch to a transactional service (Resend / SendGrid) later, just
 * replace the body of `sendTransactionalEmail()` — callers stay unchanged.
 */

// Change this to switch which mailbox transactional emails come from.
export const PREFERRED_SENDER = "operations@trytenkara.com";

export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
}

export interface TransactionalEmailResult {
  ok: boolean;
  senderEmail: string | null;
  error: string | null;
}

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

async function buildTransport(account: any) {
  if (account.provider === "google_oauth" && account.oauth_refresh_token) {
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
    throw new Error(
      "Sending from Microsoft OAuth accounts is not yet supported. " +
      "Use a Google or SMTP-credentialed account."
    );
  }

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

/**
 * Send a transactional email. Never throws — returns a result object so
 * callers can decide what to do (e.g. surface error in UI, fall back to
 * showing a manual link).
 */
export async function sendTransactionalEmail(
  message: TransactionalEmail
): Promise<TransactionalEmailResult> {
  const supabase = createServerClient();

  try {
    const account = await pickSenderAccount(supabase);
    if (!account) {
      return {
        ok: false,
        senderEmail: null,
        error: "No active email account available to send from.",
      };
    }

    const transport = await buildTransport(account);

    await transport.sendMail({
      from: `"Tenkara Inbox" <${account.email}>`,
      to: message.to,
      subject: message.subject,
      html: message.html,
    });

    return { ok: true, senderEmail: account.email, error: null };
  } catch (err: any) {
    console.error("Transactional email failed:", err);
    return {
      ok: false,
      senderEmail: null,
      error: err?.message || "Failed to send email",
    };
  }
}
