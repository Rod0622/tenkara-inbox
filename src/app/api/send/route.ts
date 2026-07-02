import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import nodemailer from "nodemailer";
import { runRulesForMessage } from "@/lib/rule-engine";
import { sendGraphEmail } from "@/lib/microsoft-graph";
import { notifyWatchers } from "@/lib/notifications";
import { cleanSubject as cleanSubjectFn } from "@/lib/email";
import { dispatchDraftWebhook } from "@/lib/api-token-webhook";
import { uploadAttachmentToStorage } from "@/lib/attachments-storage";
import { onNewConversationFromSync } from "@/lib/folder-labels";

const MICROSOFT_PROVIDERS = ["microsoft"];

function shouldSendViaGraph(account: any): boolean {
  if (account.provider === "microsoft") return true;
  // If account has IMAP/SMTP credentials, send via SMTP
  if (account.smtp_host && account.smtp_password) return false;
  if (account.microsoft_client_id) return true;
  return false;
}

export async function POST(req: NextRequest) {
  // Require an authenticated team member. This route sends live email, so it
  // must not be invokable without a session. Attribution is taken from the
  // session below — never trusted from the request body.
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Session-derived actor for all attribution (sent_by_user_id, activity log,
  // agent-draft webhook). Falls back to null if teamMember.id is somehow
  // missing, matching the prior behavior rather than failing the send.
  const actorId: string | null = session.teamMember.id || null;

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
    let bcc: string = body.bcc || "";
    let subject: string;
    let emailBody: string = body.body;
    let conversationId: string | null = body.conversation_id || null;

    // ── ChatGPT paste fix ───────────────────────────────────────────────
    // When users paste content from ChatGPT (or any source) into the
    // RichTextEditor, the contenteditable renders \n as visible line breaks
    // via white-space:pre-wrap styling — but the underlying innerHTML keeps
    // those \n characters AS-IS, without converting them to <br>/<p>.
    // The composer LOOKS right, but on send the body arrives here as plain
    // text with raw \n boundaries. When that gets stored in body_html and
    // later rendered via dangerouslySetInnerHTML, the browser collapses all
    // whitespace per HTML rules and the entire message becomes one blob
    // (no visible paragraph breaks). On refresh the Gmail/Graph sync
    // re-fetches the sent email — at which point the provider has already
    // wrapped paragraphs in proper HTML — and the render looks correct.
    //
    // We catch the plain-text-shaped case here and reconstruct paragraph
    // structure so:
    //   1. The recipient's mail client gets a properly-formatted email
    //   2. Our own UI's HTML render doesn't collapse whitespace
    //   3. The body_text derivation below also gets newline-preserving input
    //
    // The same trick is used in the AI Draft path (see ConversationDetail's
    // onInsert handler) — applying it here covers manual paste too.
    if (emailBody && /\n/.test(emailBody) && !/<(p|div|br|h[1-6]|blockquote|ul|ol|li|table)\b/i.test(emailBody)) {
      emailBody = emailBody
        .split(/\n{2,}/)
        .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
        .join("");
    }

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

      accountId = body.account_id || convo.email_account_id;
      subject = body.subject || `Re: ${convo.subject}`;

      if (body.to) {
        // Explicit recipient passed by client (Reply All, Forward, edited recipient)
        to = body.to;
      } else {
        // Auto-pick the right recipient. The old code used `convo.from_email`,
        // which fails for conversations that started outbound — those store our
        // OWN account email in from_email, causing replies to send to ourselves.
        // Correct priority:
        //   1. Latest inbound message → reply to its from_email
        //   2. Latest outbound message → reply to its first to_addresses (the
        //      same person we last wrote to)
        //   3. convo.from_email as last-ditch fallback (legacy behavior)
        const accountEmailLower = ((await supabase
          .from("email_accounts")
          .select("email")
          .eq("id", accountId)
          .single()).data?.email || "").toLowerCase();

        const { data: latestInbound } = await supabase
          .from("messages")
          .select("from_email, to_addresses, is_outbound, sent_at")
          .eq("conversation_id", body.conversation_id)
          .eq("is_outbound", false)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestInbound?.from_email && latestInbound.from_email.toLowerCase() !== accountEmailLower) {
          to = latestInbound.from_email;
        } else {
          // No inbound yet (we started the thread, they haven't replied) —
          // fall back to whoever we last wrote to.
          const { data: latestOutbound } = await supabase
            .from("messages")
            .select("to_addresses, sent_at")
            .eq("conversation_id", body.conversation_id)
            .eq("is_outbound", true)
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          const firstTo = (latestOutbound?.to_addresses || "").split(",")[0]?.trim();
          if (firstTo) {
            to = firstTo;
          } else {
            to = convo.from_email; // last-ditch (legacy behavior)
          }
        }
      }
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

    // Append signature if enabled and not already in body.
    //
    // The RichTextEditor inserts the signature wrapped in a stable marker
    // (`data-signature-block="true"`). If that marker is already present, the
    // signature is in the body — do NOT append again (that caused a duplicate
    // signature on send). We also keep a plain-text fallback check for bodies
    // composed outside the editor.
    let finalBody = emailBody;
    if (account.signature_enabled && account.signature) {
      const hasSignatureBlock = /data-signature-block\s*=\s*["']true["']/i.test(emailBody);
      const sigText = (account.signature || "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      const bodyText = emailBody.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
      const sigProbe = sigText.slice(0, 40);
      const alreadyHasSignature =
        hasSignatureBlock || (sigProbe.length > 0 && bodyText.includes(sigProbe));
      if (!alreadyHasSignature) {
        // Signature not in body yet — append it without border line
        finalBody = emailBody + '<br><div data-signature-block="true" style="padding-top: 8px; margin-top: 8px;">' + account.signature + '</div>';
      }
    }

    // Clean signature wrapper from RichTextEditor (dark theme styles)
    finalBody = finalBody
      .replace(/border-top:\s*1px solid #1E242C;?\s*/g, "")
      .replace(/border-top:\s*1px solid #ddd;?\s*/g, "");

    // ── HTML CLEANUP for email clients ──
    // Gmail clips emails > 102KB. The RTE contenteditable injects Tailwind CSS
    // variables on EVERY element (~2KB each), making even simple emails huge.
    // Solution: strip style attributes from most tags, but PRESERVE inline
    // styles on <img> (so signature image width / height stays intact) and
    // on tables (we re-add minimal table styles below either way).

    // Step 1: Strip style="..." from every tag EXCEPT <img>. The negative
    // lookbehind on "<img" lets the image's inline width/height survive.
    // (Bug fix: the previous blanket strip was nuking signature image sizes.)
    finalBody = finalBody.replace(
      /<(?!img\b)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)\s+style="[^"]*"([^>]*)>/g,
      "<$1$2$3>"
    );

    // Step 2: Strip data attributes
    finalBody = finalBody.replace(/\s*data-[a-z-]+="[^"]*"/g, "");

    // Step 3: Add clean email-safe styles back to tables
    finalBody = finalBody
      .replace(/<table/g, '<table style="width:100%;border-collapse:collapse;margin:8px 0"')
      .replace(/<th(?=[\s>])/g, '<th style="border:1px solid #ddd;padding:8px;background:#f5f5f5;text-align:left;font-size:14px"')
      .replace(/<td(?=[\s>])/g, '<td style="border:1px solid #ddd;padding:8px;font-size:14px"');

    // Step 4: Clean up empty tags and excessive whitespace
    finalBody = finalBody
      .replace(/<span>\s*<\/span>/g, "")
      .replace(/class="[^"]*"/g, "");

    // ── Step 5: Convert base64 images to CID inline attachments ──
    // Gmail clips emails > 102KB. Base64 images in signatures can be 50-200KB each.
    // Converting them to CID-attached inline images keeps HTML small.
    const cidAttachments: { cid: string; content: Buffer; contentType: string; filename: string }[] = [];
    const base64ImgRegex = /<img([^>]*)\ssrc="data:(image\/[^;]+);base64,([^"]+)"([^>]*)>/gi;
    let cidCounter = 0;
    finalBody = finalBody.replace(base64ImgRegex, (_match: string, before: string, mimeType: string, base64Data: string, after: string) => {
      cidCounter++;
      const ext = mimeType.split("/")[1] || "png";
      const cid = `img${cidCounter}_${Date.now()}@tenkara`;
      const filename = `image${cidCounter}.${ext}`;
      try {
        cidAttachments.push({
          cid,
          content: Buffer.from(base64Data, "base64"),
          contentType: mimeType,
          filename,
        });
        return `<img${before} src="cid:${cid}"${after}>`;
      } catch (e) {
        // If base64 decode fails, keep original (shouldn't happen)
        return _match;
      }
    });

    console.log(`[send] HTML size: ${finalBody.length} chars, ${cidAttachments.length} inline images extracted`);

    if (account.provider === "microsoft_oauth" && account.oauth_refresh_token) {
      // Send via Graph API with delegated token
      const { refreshMicrosoftToken } = await import("@/lib/microsoft-oauth");
      const token = await refreshMicrosoftToken(account.id);

      const toRecipients = to.split(",").map((addr: string) => ({ emailAddress: { address: addr.trim() } }));
      const ccRecipients = cc ? cc.split(",").map((addr: string) => ({ emailAddress: { address: addr.trim() } })) : [];
      const bccRecipients = bcc ? bcc.split(",").map((addr: string) => ({ emailAddress: { address: addr.trim() } })) : [];

      const graphBody: any = {
        message: {
          subject,
          body: { contentType: "HTML", content: finalBody },
          toRecipients,
          ccRecipients,
          bccRecipients,
        },
        saveToSentItems: true,
      };

      if (body.attachments?.length || cidAttachments.length > 0) {
        graphBody.message.attachments = [
          ...(body.attachments || []).map((att: any) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: att.name,
            contentType: att.type,
            contentBytes: att.data,
          })),
          ...cidAttachments.map((cid) => ({
            "@odata.type": "#microsoft.graph.fileAttachment",
            name: cid.filename,
            contentType: cid.contentType,
            contentBytes: cid.content.toString("base64"),
            isInline: true,
            contentId: cid.cid,
          })),
        ];
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
        body.attachments || undefined,
        cidAttachments.length > 0 ? cidAttachments : undefined
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
        bcc: bcc || undefined,
        subject,
        text: plainContent,
        html: htmlContent,
        attachments: [
          ...(body.attachments || []).map((att: any) => ({
            filename: att.name,
            content: Buffer.from(att.data, "base64"),
            contentType: att.type || "application/octet-stream",
          })),
          ...cidAttachments.map((cid) => ({
            filename: cid.filename,
            content: cid.content,
            contentType: cid.contentType,
            cid: cid.cid,
            contentDisposition: "inline" as const,
          })),
        ],
      });

      messageId = info.messageId;
    }

    // If compose (no existing conversation), create one in the INBOX folder.
    // Product decision: a first outreach we send lives in the account's Inbox
    // (under the account used), NOT in Sent. The Sent folder stays empty for
    // normal flow.
    if (!isReply) {
      // Look up the Inbox system folder for this account
      const { data: inboxFolder } = await supabase
        .from("folders")
        .select("id")
        .eq("email_account_id", accountId)
        .eq("is_system", true)
        .ilike("name", "inbox")
        .maybeSingle();

      // For outbound-originated conversations, from_email should be the
      // OTHER PARTY's address (who we're talking to), not our own — this
      // matches the convention for inbound conversations and lets the reply
      // route auto-pick the correct recipient. Parse the first recipient out
      // of `to` (supports "Name <email>" and bare email formats).
      const stripQ = (s: string) => s.trim().replace(/^["'\s]+|["'\s]+$/g, "");
      const firstRecipient = String(to || "").split(",")[0]?.trim() || "";
      const angle = firstRecipient.match(/^(.*?)\s*<\s*([^<>]+?)\s*>\s*$/);
      const otherPartyEmail = (angle ? stripQ(angle[2]) : stripQ(firstRecipient)).toLowerCase();
      const otherPartyName = angle ? stripQ(angle[1]) : (otherPartyEmail.split("@")[0] || "");

      const { data: newConvo } = await supabase
        .from("conversations")
        .insert({
          email_account_id: accountId,
          thread_id: messageId || "sent:" + Date.now(),
          subject: cleanSubjectFn(subject),
          from_name: otherPartyName || otherPartyEmail,
          from_email: otherPartyEmail || account.email,
          preview: emailBody.replace(/<[^>]*>/g, "").slice(0, 200),
          is_unread: false,
          status: "open",
          last_message_at: new Date().toISOString(),
          folder_id: inboxFolder?.id || null,
        })
        .select("id")
        .single();

      conversationId = newConvo?.id || null;

      // Apply the account + Inbox labels (and confirm Inbox folder) so a
      // composed first-outreach is consistent with sync-created conversations:
      // it lives in the account's Inbox with the right labels. Best-effort.
      if (conversationId) {
        try {
          await onNewConversationFromSync(conversationId, accountId, true);
        } catch (e: any) {
          console.error("[send] label/folder apply failed:", e?.message || e);
        }
      }
    }

    // Store sent message locally
    if (conversationId) {
      // Newline-preserving HTML→text strip. The previous naive
      // `replace(/<[^>]*>/g, "")` collapsed paragraph boundaries — pasted
      // ChatGPT content rendered as "well.I wanted to" with no break, even
      // though the HTML had <p> tags. We now convert block-level closers to
      // \n\n and <br> to \n BEFORE stripping tags, so the resulting
      // body_text retains visible structure for any UI path that falls
      // through to plain-text rendering with white-space:pre-wrap.
      const cleanBodyText = finalBody
        .replace(/<\/(p|div|h[1-6]|blockquote|li)>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]*>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const { data: insertedMsg } = await supabase.from("messages").insert({
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
        has_attachments: (body.attachments || []).length > 0 || cidAttachments.length > 0,
        sent_at: new Date().toISOString(),
        sent_by_user_id: actorId,
      })
      .select("id")
      .single();

      // ── Persist CID inline attachments to inbox.attachments ───────────
      // Background: the body_html we just stored contains
      //   <img src="cid:img1_...@tenkara">
      // references (we rewrote pasted base64 images to CID upstream so the
      // outgoing email stays small enough to avoid Gmail's 102KB clip).
      // Browsers can't resolve `cid:` URIs natively, so MessageBody.tsx
      // looks up each cid in inbox.attachments (by content_id) and
      // rewrites the <img src> at render time to a Tenkara /api/attachments
      // URL. For that lookup to work, the attachment row must exist.
      //
      // Inbound emails get this for free via the IMAP / Gmail / Graph sync
      // path — that path also calls uploadAttachmentToStorage. We just need
      // to do the same here for outbound, otherwise the sender's own UI
      // shows broken images until the provider's sync re-fetches the sent
      // email (which CAN take many minutes).
      if (insertedMsg?.id && cidAttachments.length > 0) {
        await Promise.all(cidAttachments.map((cid, i) =>
          uploadAttachmentToStorage(supabase, {
            accountId: account.id,
            messageId: insertedMsg.id,
            indexInMessage: i,
            attachment: {
              filename: cid.filename,
              contentType: cid.contentType,
              size: cid.content.length,
              isInline: true,
              contentId: cid.cid,
              checksum: null,
              content: cid.content,
            },
          }).catch((e: any) => {
            // Best-effort: a failed inline-attachment upload just means the
            // image stays broken in our UI until the provider's sync runs.
            // Don't fail the whole send over it.
            console.error("[send] CID attachment upload failed:", cid.cid, e?.message);
          })
        ));
      }

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
        actor_id: actorId,
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
          cc_addresses: cc || "",
          body_text: emailBody,
          email_account_id: accountId,
          has_attachments: (body.attachments?.length || 0) > 0,
        }, "outgoing");
      } catch (ruleErr: any) {
        console.error("Rule engine error on send:", ruleErr.message);
      }

      // Notify watchers about the outbound message (best-effort)
      try {
        const senderName = account.name || account.email || "Someone";
        await notifyWatchers(conversationId, "new_message", {
          title: `${senderName} sent a reply`,
          body: subject || undefined,
          actorId: actorId,
        });
      } catch (_e) { /* best-effort */ }

      // ── Phase 2: agent-drafted email tracking ──────────────────────
      // If this conversation has an agent-created draft, the operator just
      // sent it. Fire the draft.sent webhook to the partner so they know
      // the draft was used, then delete the draft. Both are best-effort:
      // failures don't roll back the successful send.
      try {
        const { data: agentDraft } = await supabase
          .from("email_drafts")
          .select("id, conversation_id, created_by_agent, email_account_id, subject, to_addresses")
          .eq("conversation_id", conversationId)
          .not("created_by_agent", "is", null)
          .maybeSingle();

        if (agentDraft) {
          // Fire webhook before deleting so audit row references a real draft id.
          dispatchDraftWebhook("draft.sent", agentDraft, {
            sent_by_user_id: actorId,
            message_id: messageId || null,
          }).catch((e) => console.error("[send] draft.sent webhook error:", e?.message));

          // Audit log
          supabase.from("activity_log").insert({
            conversation_id: conversationId,
            actor_id: actorId,
            action: "agent_draft_sent",
            details: {
              agent_name: agentDraft.created_by_agent,
              draft_id: agentDraft.id,
            },
          }).then(({ error: logErr }) => {
            if (logErr) console.error("[send] audit log failed:", logErr.message);
          });

          // Delete the agent draft. Pass discarded_by_send=1 wouldn't work
          // here because we're not going through the HTTP endpoint — but
          // we ARE bypassing the DELETE handler, so it won't double-fire
          // the discarded webhook.
          await supabase.from("email_drafts").delete().eq("id", agentDraft.id);
        }
      } catch (e: any) {
        console.error("[send] agent-draft handling error:", e?.message || e);
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