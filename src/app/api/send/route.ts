import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import nodemailer from "nodemailer";
import { runRulesForMessage } from "@/lib/rule-engine";
import { sendGraphEmail } from "@/lib/microsoft-graph";

const MICROSOFT_PROVIDERS = ["microsoft"];

function shouldSendViaGraph(account: any): boolean {
  if (account.provider === "microsoft") return true;
  // If account has IMAP/SMTP credentials, send via SMTP
  if (account.smtp_host && account.smtp_password) return false;
  if (account.microsoft_client_id) return true;
  return false;
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  // Two modes:
  // 1. Reply: { conversation_id, body }
  // 2. Compose: { account_id, to, cc, subject, body }
  const isReply = !!body.conversation_id;

  try {
    let accountId: string;
    let to: string;
    let cc: string = body.cc || "";
    let subject: string;
    let emailBody: string = body.body;
    let conversationId: string | null = body.conversation_id || null;

    if (isReply) {
      // Get conversation to find account and recipient
      const { data: convo, error: convoErr } = await supabase
        .from("conversations")
        .select("*")
        .eq("id", body.conversation_id)
        .single();

      if (convoErr || !convo) {
        return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
      }

      accountId = convo.email_account_id;
      to = convo.from_email;
      subject = `Re: ${convo.subject}`;
    } else {
      // Compose mode
      accountId = body.account_id;
      to = body.to;
      subject = body.subject;

      if (!accountId || !to || !subject) {
        return NextResponse.json(
          { error: "account_id, to, and subject are required for compose" },
          { status: 400 }
        );
      }
    }

    // Get account SMTP settings
    const { data: account, error: accErr } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", accountId)
      .single();

    if (accErr || !account) {
      return NextResponse.json({ error: "Email account not found" }, { status: 404 });
    }

    // Send via Graph API or SMTP depending on provider
    let messageId: string | undefined;

    // Append signature if enabled and not already in body
    let finalBody = emailBody;
    if (account.signature_enabled && account.signature) {
      const sigText = (account.signature || "").replace(/<[^>]*>/g, "").trim();
      if (sigText && !emailBody.includes(sigText.slice(0, 30))) {
        finalBody = `${emailBody}<br><div style="border-top: 1px solid #ddd; padding-top: 8px; margin-top: 16px;">${account.signature}</div>`;
      }
    }

    if (shouldSendViaGraph(account)) {
      // Microsoft Graph API
      const graphResult = await sendGraphEmail(
        account.email,
        to,
        subject,
        finalBody,
        cc || undefined,
        body.attachments || undefined
      );

      if (!graphResult.success) {
        return NextResponse.json(
          { error: graphResult.error || "Failed to send via Microsoft Graph" },
          { status: 500 }
        );
      }

      messageId = `graph:${Date.now()}`;
    } else {
      // Traditional SMTP (with XOAUTH2 support for google_oauth)
      const smtpAuth: any = {
        user: account.smtp_user || account.imap_user || account.email,
      };

      if (account.provider === "google_oauth" && account.oauth_refresh_token) {
        // Use XOAUTH2 for Google OAuth accounts
        const { refreshGoogleToken, buildXOAuth2Token } = await import("@/lib/google-oauth");
        const accessToken = await refreshGoogleToken(account.id);
        smtpAuth.type = "OAuth2";
        smtpAuth.accessToken = accessToken;
      } else {
        smtpAuth.pass = account.smtp_password || account.imap_password;
      }

      const transport = nodemailer.createTransport({
        host: account.smtp_host,
        port: account.smtp_port || 587,
        secure: account.smtp_port === 465,
        auth: smtpAuth,
        tls: { rejectUnauthorized: false },
      });

      // Detect if body is already HTML
      const isHtmlBody = finalBody.trim().startsWith("<") || finalBody.includes("<br") || finalBody.includes("<div") || finalBody.includes("<p");
      const htmlContent = isHtmlBody ? finalBody : finalBody.replace(/\n/g, "<br>");
      const plainContent = isHtmlBody ? finalBody.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() : finalBody;

      const info = await transport.sendMail({
        from: `"${account.name}" <${account.email}>`,
        to,
        cc: cc || undefined,
        subject,
        text: plainContent,
        html: htmlContent,
        attachments: (body.attachments || []).map((att: any) => ({
          filename: att.name,
          content: Buffer.from(att.data, "base64"),
          contentType: att.type || "application/octet-stream",
        })),
      });

      messageId = info.messageId;
    }

    // If compose (no existing conversation), create one
    if (!isReply) {
      const { data: newConvo } = await supabase
        .from("conversations")
        .insert({
          email_account_id: accountId,
          thread_id: messageId || `sent:${Date.now()}`,
          subject: subject.replace(/^Re:\s*/i, ""),
          from_name: account.name,
          from_email: account.email,
          preview: emailBody.slice(0, 200),
          is_unread: false,
          status: "open",
          last_message_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      conversationId = newConvo?.id || null;
    }

    // Store sent message locally
    if (conversationId) {
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        provider_message_id: messageId || `sent:${Date.now()}`,
        from_name: account.name,
        from_email: account.email,
        to_addresses: to,
        cc_addresses: cc,
        subject,
        body_text: emailBody,
        body_html: emailBody.replace(/\n/g, "<br>"),
        snippet: emailBody.slice(0, 200),
        is_outbound: true,
        has_attachments: false,
        sent_at: new Date().toISOString(),
      });

      // Update conversation
      await supabase
        .from("conversations")
        .update({
          preview: emailBody.slice(0, 200),
          last_message_at: new Date().toISOString(),
        })
        .eq("id", conversationId);

      // Log activity
      await supabase.from("activity_log").insert({
        conversation_id: conversationId,
        actor_id: body.actor_id || null,
        action: isReply ? "reply_sent" : "email_composed",
        details: { to, subject, preview: emailBody.slice(0, 80) },
      });

      // Run outgoing rules against this sent message
      try {
        await runRulesForMessage(conversationId, {
          conversation_id: conversationId,
          subject: subject,
          from_email: account.email,
          from_name: account.name,
          to_addresses: to,
          body_text: emailBody,
        }, "outgoing");
      } catch (ruleErr: any) {
        console.error("Rule engine error on send:", ruleErr.message);
      }
    }

    return NextResponse.json({
      success: true,
      messageId,
      conversationId,
    });
  } catch (err: any) {
    console.error("Send email error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to send email" },
      { status: 500 }
    );
  }
}