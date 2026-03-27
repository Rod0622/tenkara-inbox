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
        // Signature not in body yet — append it without border line
        finalBody = emailBody + '<br><div style="padding-top: 8px; margin-top: 8px;">' + account.signature + '</div>';
      }
    }

    // Clean signature wrapper from RichTextEditor (dark theme border)
    finalBody = finalBody
      .replace(/border-top:\s*1px solid #1E242C;?\s*/g, "")
      .replace(/color:\s*#7D8590;?\s*/g, "")
      .replace(/border-top:\s*1px solid #ddd;?\s*/g, "");

    // Clean HTML for email clients: strip Tailwind CSS vars, convert dark theme to light
    finalBody = finalBody
      .replace(/style="[^"]*--tw-[^"]*"/g, (match: string) => {
        return match.replace(/--tw-[^;:]+:[^;]+;?\s*/g, "");
      })
      .replace(/rgb\(22,\s*27,\s*34\)/g, "#f0f0f0")
      .replace(/rgb\(30,\s*36,\s*44\)/g, "#ddd")
      .replace(/rgb\(11,\s*14,\s*17\)/g, "#ffffff")
      .replace(/rgb\(230,\s*237,\s*243\)/g, "#333333")
      .replace(/font-size:\s*12px/g, "font-size: 14px")
      .replace(/resize:\s*horizontal;?/g, "")
      .replace(/data-editor-table="true"\s*/g, "");

    if (account.provider === "microsoft_oauth" && account.oauth_refresh_token) {
      // Send via Graph API with delegated token
      const { refreshMicrosoftToken } = await import("@/lib/microsoft-oauth");
      const token = await refreshMicrosoftToken(account.id);

      const toRecipients = to.split(",").map((addr: string) => ({ emailAddress: { address: addr.trim() } }));
      const ccRecipients = cc ? cc.split(",").map((addr: string) => ({ emailAddress: { address: addr.trim() } })) : [];

      const graphBody: any = {
        message: {
          subject,
          body: { contentType: "HTML", content: finalBody },
          toRecipients,
          ccRecipients,
        },
        saveToSentItems: true,
      };

      if (body.attachments?.length) {
        graphBody.message.attachments = body.attachments.map((att: any) => ({
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: att.name,
          contentType: att.type,
          contentBytes: att.data,
        }));
      }

      const sendRes = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(graphBody),
      });

      if (!sendRes.ok) {
        const err = await sendRes.json().catch(() => ({}));
        return NextResponse.json({ error: "Graph send failed: " + (err.error?.message || sendRes.statusText) }, { status: 500 });
      }

      messageId = "graph-oauth:" + Date.now();
    } else if (shouldSendViaGraph(account)) {
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

    // If compose (no existing conversation), create one in Sent folder
    if (!isReply) {
      // Look up the Sent system folder for this account
      const { data: sentFolder } = await supabase
        .from("folders")
        .select("id")
        .eq("email_account_id", accountId)
        .eq("is_system", true)
        .ilike("name", "sent")
        .maybeSingle();

      const { data: newConvo } = await supabase
        .from("conversations")
        .insert({
          email_account_id: accountId,
          thread_id: messageId || "sent:" + Date.now(),
          subject: subject.replace(/^Re:\s*/i, ""),
          from_name: account.name,
          from_email: account.email,
          preview: emailBody.replace(/<[^>]*>/g, "").slice(0, 200),
          is_unread: false,
          status: "open",
          last_message_at: new Date().toISOString(),
          folder_id: sentFolder?.id || null,
        })
        .select("id")
        .single();

      conversationId = newConvo?.id || null;
    }

    // Store sent message locally
    if (conversationId) {
      const cleanBodyText = finalBody.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        provider_message_id: messageId || "sent:" + Date.now(),
        from_name: account.name,
        from_email: account.email,
        to_addresses: to,
        cc_addresses: cc,
        subject,
        body_text: cleanBodyText.slice(0, 5000),
        body_html: finalBody,
        snippet: cleanBodyText.slice(0, 200),
        is_outbound: true,
        has_attachments: (body.attachments || []).length > 0,
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