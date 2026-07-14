import { createServerClient } from "@/lib/supabase";
import { onNewConversationFromSync, onIncomingMessageReopenCheck } from "@/lib/folder-labels";
import { decodeEmailText, decodeEmailTextPreserveNewlines } from "@/lib/decode-email-text";
import { cleanSubject as cleanSubjectFn, sanitizeBodyHtml } from "@/lib/email";
import { ensureSupplierContact, loadInternalContext, extractFirstEmail, type InternalContext } from "@/lib/supplier-contact-resolver";
import { dispatchMessageReceivedWebhook } from "@/lib/api-token-webhook";
import { uploadAttachmentToStorage } from "@/lib/attachments-storage";

// ── Microsoft Graph Client Credentials ──────────────
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || "";
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface GraphToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GraphMessage {
  id: string;
  subject: string;
  from: { emailAddress: { name: string; address: string } };
  toRecipients: { emailAddress: { name: string; address: string } }[];
  ccRecipients: { emailAddress: { name: string; address: string } }[];
  body: { contentType: string; content: string };
  bodyPreview: string;
  receivedDateTime: string;
  sentDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  conversationId: string;
  internetMessageId: string;
  parentFolderId: string;
}

// ── Get access token via client credentials flow ─────
export async function getGraphToken(
  credentials?: { clientId?: string; tenantId?: string; clientSecret?: string }
): Promise<string> {
  const clientId = credentials?.clientId || MICROSOFT_CLIENT_ID;
  const tenantId = credentials?.tenantId || MICROSOFT_TENANT_ID;
  const clientSecret = credentials?.clientSecret || MICROSOFT_CLIENT_SECRET;

  if (!clientId || !tenantId || !clientSecret) {
    throw new Error("Microsoft Graph credentials not configured. Provide per-account credentials or set MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_SECRET env vars.");
  }

  const tokenUrl = "https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/token";

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "https://graph.microsoft.com/.default",
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error("Token request failed: " + (err.error_description || err.error || res.statusText));
  }

  const data: GraphToken = await res.json();
  return data.access_token;
}

// Helper to get credentials for a specific account from Supabase
export async function getAccountCredentials(accountId: string) {
  const supabase = createServerClient();
  const { data: account } = await supabase
    .from("email_accounts")
    .select("microsoft_client_id, microsoft_tenant_id, microsoft_client_secret")
    .eq("id", accountId)
    .single();

  if (account?.microsoft_client_id && account?.microsoft_tenant_id && account?.microsoft_client_secret) {
    return {
      clientId: account.microsoft_client_id,
      tenantId: account.microsoft_tenant_id,
      clientSecret: account.microsoft_client_secret,
    };
  }
  return undefined; // Fall back to env vars
}

// Get token for a specific email account (checks per-account creds first, then env vars)
export async function getGraphTokenForAccount(accountId: string): Promise<string> {
  const creds = await getAccountCredentials(accountId);
  return getGraphToken(creds);
}

// Get token by email address (looks up account in DB)
export async function getGraphTokenForEmail(email: string): Promise<string> {
  const supabase = createServerClient();
  const { data: account } = await supabase
    .from("email_accounts")
    .select("microsoft_client_id, microsoft_tenant_id, microsoft_client_secret")
    .eq("email", email.toLowerCase())
    .single();

  const creds = (account?.microsoft_client_id && account?.microsoft_tenant_id && account?.microsoft_client_secret)
    ? { clientId: account.microsoft_client_id, tenantId: account.microsoft_tenant_id, clientSecret: account.microsoft_client_secret }
    : undefined;

  return getGraphToken(creds);
}

// ── Fetch emails from a mailbox ─────────────────────
export async function fetchGraphEmails(
  userEmail: string,
  sinceDateTime?: string,
  top: number = 50
): Promise<GraphMessage[]> {
  const token = await getGraphTokenForEmail(userEmail);

  // Per-page size (Graph max is 1000, but 50 is safe for body content)
  const pageSize = Math.min(top, 50);
  let url = `${GRAPH_BASE}/users/${userEmail}/messages?$top=${pageSize}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,conversationId,internetMessageId,parentFolderId`;

  // Only fetch emails since last sync
  if (sinceDateTime) {
    // Graph API requires format: yyyy-MM-ddTHH:mm:ssZ (no milliseconds)
    const cleanDate = new Date(sinceDateTime).toISOString().replace(/\.\d{3}Z$/, "Z");
    url += `&$filter=receivedDateTime ge ${cleanDate}`;
  }

  const messages: GraphMessage[] = [];
  let nextLink: string | null = url;

  while (nextLink) {
    const res: Response = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Graph API error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    messages.push(...(data.value || []));

    // Pagination
    nextLink = data["@odata.nextLink"] || null;

    // Safety limit
    if (messages.length >= top) break;
  }

  return messages;
}

// ── Send email via Graph API ────────────────────────
export async function sendGraphEmail(
  fromEmail: string,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  attachments?: { name: string; type: string; data: string }[],
  inlineAttachments?: { cid: string; content: Buffer; contentType: string; filename: string }[],
  replyToInternetMessageId?: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const token = await getGraphTokenForEmail(fromEmail);

  // Threaded reply first (see sendGraphReplyViaToken): /sendMail cannot set
  // In-Reply-To, so when the caller knows which message is being replied
  // to, go through createReply. Any failure falls through to the regular
  // sendMail below — sent-but-unthreaded beats not sent.
  if (replyToInternetMessageId) {
    const replyRes = await sendGraphReplyViaToken(
      token,
      `users/${fromEmail}`,
      replyToInternetMessageId,
      { subject, bodyHtml: body.replace(/\n/g, "<br>"), to, cc, attachments, inlineAttachments }
    );
    if (replyRes.success) return { success: true };
    console.error("[sendGraphEmail] threaded reply failed, falling back to sendMail:", replyRes.error);
  }

  const toRecipients = to.split(",").map((addr) => ({
    emailAddress: { address: addr.trim() },
  }));

  const ccRecipients = cc
    ? cc.split(",").map((addr) => ({
        emailAddress: { address: addr.trim() },
      }))
    : [];

  const message: any = {
    subject,
    body: {
      contentType: "HTML",
      content: body.replace(/\n/g, "<br>"),
    },
    toRecipients,
  };

  if (ccRecipients.length > 0) {
    message.ccRecipients = ccRecipients;
  }

  if (attachments && attachments.length > 0) {
    message.attachments = attachments.map((att) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.name,
      contentType: att.type || "application/octet-stream",
      contentBytes: att.data,
    }));
  }

  // Add inline CID attachments (for signature images)
  if (inlineAttachments && inlineAttachments.length > 0) {
    if (!message.attachments) message.attachments = [];
    for (const cid of inlineAttachments) {
      message.attachments.push({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: cid.filename,
        contentType: cid.contentType,
        contentBytes: cid.content.toString("base64"),
        isInline: true,
        contentId: cid.cid,
      });
    }
  }

  const res = await fetch(`${GRAPH_BASE}/users/${fromEmail}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return {
      success: false,
      error: err.error?.message || res.statusText,
    };
  }

  return { success: true };
}


// ── Sync a Microsoft account (multi-batch for Pro 60s timeout) ──
export async function syncMicrosoftAccount(accountId: string, timeBudgetMs?: number): Promise<{
  success: boolean;
  newMessages: number;
  newConversations: number;
  errors: string[];
  hasMore?: boolean;
}> {
  const supabase = createServerClient();
  const result = { success: false, newMessages: 0, newConversations: 0, errors: [] as string[], hasMore: false };

  // Load internal context once per sync run (used for supplier classification)
  const internalCtx: InternalContext = await loadInternalContext(supabase);

  try {
    // Explicit columns only — NEVER `select("*")` on email_accounts (it
    // drags OAuth/refresh tokens into memory and logs; this exact pattern
    // caused the Sierra token exposure). Graph credentials are fetched
    // separately by getGraphTokenForAccount with its own targeted select.
    const { data: account, error: accErr } = await supabase
      .from("email_accounts")
      .select("id, email, provider, last_sync_at, last_sync_uid")
      .eq("id", accountId)
      .single();

    if (accErr || !account) { result.errors.push("Account not found"); return result; }

    const BATCH_SIZE = 50;
    const MAX_BATCHES = 20; // Can be high since dupe batches are <1s each
    const TIME_LIMIT_MS = timeBudgetMs ? Math.min(timeBudgetMs - 5000, 40000) : 35000; // Conservative: stop at 35s
    const syncStart = Date.now();
    const token = await getGraphTokenForAccount(accountId);
    const isInitialSync = !account.last_sync_at;

    // Skip rules during bulk initial sync to save time
    let runRulesFn: any = null;
    if (!isInitialSync) {
      const mod = await import("@/lib/rule-engine");
      runRulesFn = mod.runRulesForMessage;
    }

    let batchCount = 0;
    let consecutiveDupeBatches = 0;
    let currentSkipOffset = parseInt(account.last_sync_uid || "0") || 0;

    while (batchCount < MAX_BATCHES) {
      // Time check — stop if we're running out of time
      if (Date.now() - syncStart > TIME_LIMIT_MS) {
        console.log(`[graph-sync] ${account.email}: time limit reached after ${batchCount} batches`);
        result.hasMore = true;
        break;
      }

      let emails: GraphMessage[];

      if (isInitialSync) {
        // Initial bulk sync with skip offset
        const pageUrl = `${GRAPH_BASE}/users/${account.email}/messages?$top=${BATCH_SIZE}&$skip=${currentSkipOffset}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,conversationId,internetMessageId`;

        const res: Response = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(`Graph API error: ${err.error?.message || res.statusText}`);
        }
        const data = await res.json();
        emails = data.value || [];
        result.hasMore = emails.length >= BATCH_SIZE;
      } else {
        // Incremental sync — fetch all new emails since last sync, one batch only
        emails = await fetchGraphEmails(account.email, account.last_sync_at, BATCH_SIZE);
        // Incremental doesn't loop
        batchCount = MAX_BATCHES; // Will exit loop after processing
      }

      if (emails.length === 0) {
        result.hasMore = false;
        break;
      }

      // Process emails in this batch
      let batchNewCount = 0;

      // For initial sync: advance offset and save BEFORE processing
      // This ensures progress is saved even if we time out during email processing
      if (isInitialSync) {
        currentSkipOffset += emails.length;
        const { error: saveErr } = await supabase.from("email_accounts").update({
          last_sync_uid: currentSkipOffset.toString(),
        }).eq("id", accountId);
        if (saveErr) console.error(`[graph-sync] ${account.email}: FAILED to save offset ${currentSkipOffset}:`, saveErr.message);
        else console.log(`[graph-sync] ${account.email}: saved offset ${currentSkipOffset}`);
      }

      // Bulk duplicate check — get all existing message IDs in one query
      const msgIds = emails.map((e) => `ms:${e.internetMessageId || e.id}`);
      const { data: existingMsgs } = await supabase.from("messages")
        .select("provider_message_id")
        .in("provider_message_id", msgIds);
      const existingSet = new Set((existingMsgs || []).map((m: any) => m.provider_message_id));

      // If entire batch is duplicates, skip processing entirely
      const newEmails = emails.filter((e) => !existingSet.has(`ms:${e.internetMessageId || e.id}`));
      if (newEmails.length === 0) {
        consecutiveDupeBatches++;
        batchCount++;
        console.log(`[graph-sync] ${account.email}: batch ${batchCount}, offset ${currentSkipOffset}, SKIP (all dupes x${consecutiveDupeBatches}), ${Date.now() - syncStart}ms`);
        if (!result.hasMore) break;
        continue;
      }
      consecutiveDupeBatches = 0;

      for (const email of newEmails) {
        try {
          const msgId = email.internetMessageId || email.id;
          const isOutbound = email.from?.emailAddress?.address?.toLowerCase() === account.email.toLowerCase();
          let conversationId: string | null = null;

          // Thread by Graph conversationId
          if (email.conversationId) {
            const { data: c } = await supabase.from("conversations").select("id")
              .eq("thread_id", `ms:${email.conversationId}`).eq("email_account_id", accountId).maybeSingle();
            if (c) conversationId = c.id;
          }

          // Thread by subject
          if (!conversationId) {
            const subj = cleanSubjectFn(email.subject || "");
            if (subj) {
              const { data: m } = await supabase.from("conversations").select("id")
                .eq("email_account_id", accountId).eq("subject", subj)
                .gte("last_message_at", new Date(Date.now() - 30*24*60*60*1000).toISOString())
                .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
              if (m) conversationId = m.id;
            }
          }

          // Create conversation
          if (!conversationId) {
            const subj = cleanSubjectFn(email.subject || "") || "(No Subject)";
            const inboundTs = email.receivedDateTime || new Date().toISOString();
            // Resolve supplier_contact_id: from sender if inbound, first recipient if outbound.
            const fromEmail = email.from?.emailAddress?.address || "";
            const fromName  = email.from?.emailAddress?.name    || "";
            const toAddrForLookup = (email.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean).join(", ");
            const supplierEmailForLookup = isOutbound ? extractFirstEmail(toAddrForLookup) : fromEmail;
            const supplierContactId = await ensureSupplierContact(
              supabase,
              supplierEmailForLookup,
              isOutbound ? null : fromName,
              internalCtx
            );
            const { data: nc, error: ce } = await supabase.from("conversations").insert({
              email_account_id: accountId,
              thread_id: email.conversationId ? `ms:${email.conversationId}` : `ms:${email.id}`,
              subject: subj,
              from_name: fromName || fromEmail || "Unknown",
              from_email: fromEmail,
              preview: decodeEmailText(email.bodyPreview || "").slice(0, 200),
              is_unread: !isOutbound, status: "open",
              last_message_at: inboundTs,
              // Seed last_inbound_at for new INBOUND conversations.
              last_inbound_at: !isOutbound ? inboundTs : null,
              // Link to supplier_contacts (may be null if internal/transactional/noreply)
              supplier_contact_id: supplierContactId,
            }).select("id").single();
            if (ce) { result.errors.push(ce.message); continue; }
            conversationId = nc.id;
            result.newConversations++;

            // Auto-apply [account, Inbox] labels (or just [account] for outbound).
            // Best-effort — never throws. Use nc.id directly so TS narrows correctly.
            await onNewConversationFromSync(nc.id, accountId, isOutbound);
          }

          // Body extraction — Graph returns body.contentType as "html" OR "text".
          // The old code only honored "html" and fell back to bodyPreview (which
          // Graph caps at ~255 chars) for everything else, so plain-text emails
          // ended up truncated. Now we handle both formats:
          //   1. contentType === "html" → store full HTML, derive body_text by
          //      stripping tags + collapsing whitespace.
          //   2. contentType === "text" → store full text in body_text. Derive
          //      a simple HTML by escaping + replacing newlines with <br> so the
          //      MessageBody renderer can display it as expected.
          //   3. No body content at all → fall back to bodyPreview (truncated).
          const rawBodyContent: string = email.body?.content || "";
          const bodyContentType = (email.body?.contentType || "").toLowerCase();
          const escapeHtml = (s: string) =>
            s
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;")
              .replace(/"/g, "&quot;")
              .replace(/'/g, "&#39;");

          let emailBodyHtml: string | null = null;
          let rawBodyText: string;
          if (bodyContentType === "html" && rawBodyContent) {
            emailBodyHtml = rawBodyContent;
            // Strip <style> and <script> tags AND their contents — otherwise
            // marketing emails with a giant <style> block at the top leak CSS
            // rules into body_text/snippet/preview. The "&nbsp;" and similar
            // entities are decoded downstream by decodeEmailText.
            rawBodyText = rawBodyContent
              .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
              .replace(/<[^>]*>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
          } else if (bodyContentType === "text" && rawBodyContent) {
            // Plain text body — preserve newlines for body_text, build minimal
            // HTML for the renderer.
            rawBodyText = rawBodyContent;
            emailBodyHtml = "<div style=\"white-space: pre-wrap;\">" + escapeHtml(rawBodyContent) + "</div>";
          } else {
            // Last resort — Graph's bodyPreview, which is capped at ~255 chars.
            // This is the OLD behaviour and only fires when the body itself is
            // genuinely empty or has an unknown contentType.
            rawBodyText = email.bodyPreview || "";
            emailBodyHtml = null;
          }
          // Sanitize/cap stored HTML (strip base64 inline images) before insert.
          emailBodyHtml = sanitizeBodyHtml(emailBodyHtml);
          const bodyText = decodeEmailTextPreserveNewlines(rawBodyText);
          const toAddr = (email.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean).join(", ");
          const ccAddr = (email.ccRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean).join(", ");

          // Reconcile against locally-stored outbound messages so we don't
          // create duplicates. /api/send stores the row with a synthetic id
          // like "graph:<ts>" or "graph-oauth:<ts>" (Graph's sendMail doesn't
          // expose the InternetMessageId), so we match by content fingerprint:
          // same conversation, same subject, sent within ±5 minutes, outbound.
          const msSentAt = email.sentDateTime || email.receivedDateTime || new Date().toISOString();
          const fromEmailLower = (email.from?.emailAddress?.address || "").toLowerCase();
          const isOurAccount = fromEmailLower && fromEmailLower === account.email.toLowerCase();
          let reconciledMsMessageId: string | null = null;
          if (isOutbound && isOurAccount) {
            const windowMs = 5 * 60 * 1000;
            const lo = new Date(new Date(msSentAt).getTime() - windowMs).toISOString();
            const hi = new Date(new Date(msSentAt).getTime() + windowMs).toISOString();
            const { data: candidates } = await supabase
              .from("messages")
              .select("id, provider_message_id")
              .eq("conversation_id", conversationId)
              .eq("is_outbound", true)
              .eq("subject", email.subject || "(No Subject)")
              .ilike("from_email", account.email)
              .gte("sent_at", lo)
              .lte("sent_at", hi)
              .limit(5);
            const local = (candidates || []).find((r: any) =>
              !String(r.provider_message_id || "").startsWith("ms:"));
            if (local?.id) {
              await supabase
                .from("messages")
                .update({
                  provider_message_id: `ms:${msgId}`,
                  body_html: emailBodyHtml || undefined,
                  body_text: bodyText.slice(0, 5000) || undefined,
                  has_attachments: email.hasAttachments || false,
                })
                .eq("id", local.id);
              reconciledMsMessageId = local.id;
            }
          }

          let newMsMessageId: string | null = null;
          if (!reconciledMsMessageId) {
            const { data: insMs, error: me } = await supabase.from("messages").insert({
              conversation_id: conversationId, provider_message_id: `ms:${msgId}`,
              from_name: email.from?.emailAddress?.name || "Unknown",
              from_email: email.from?.emailAddress?.address || "",
              to_addresses: toAddr, cc_addresses: ccAddr,
              subject: email.subject || "(No Subject)",
              body_text: bodyText.slice(0, 5000),
              body_html: emailBodyHtml,
              snippet: bodyText.slice(0, 200),
              is_outbound: isOutbound, has_attachments: email.hasAttachments || false,
              sent_at: msSentAt,
            }).select("id").single();
            if (me || !insMs) { result.errors.push(me?.message || "ms insert failed"); continue; }
            newMsMessageId = insMs.id;
          }
          // The DB message this Graph email landed on (new insert OR the
          // reconciled local outbound row) — attachments link to this.
          const msDbMessageId = reconciledMsMessageId || newMsMessageId;

          // ── Attachment capture (Option A: incremental syncs only) ──
          // Fetch attachment bytes from Graph and store them via
          // uploadAttachmentToStorage so the attachments table / Storage /
          // external API behave identically to Gmail and IMAP accounts.
          //
          // Skipped during initial bulk sync (same precedent as the rules
          // engine above: isInitialSync skips runRulesFn) — historical
          // backfill is a separate deferred roadmap item; the UI's live
          // Graph fallback still covers old messages.
          //
          // Uses email.id (the Graph message id) directly — no
          // internetMessageId resolution needed at sync time. fileAttachment
          // entries carry base64 contentBytes in the list response; if a
          // large one omits it, we fetch that attachment individually.
          // itemAttachment / referenceAttachment have no contentBytes — skipped.
          //
          // The whole block is wrapped in try/catch so an unexpected throw
          // can NEVER skip the webhook dispatch below — an email with no
          // webhook at all is worse than one with an empty attachments array.
          try {
            if (!isInitialSync && email.hasAttachments && msDbMessageId) {
              const listRes = await fetch(
                `${GRAPH_BASE}/users/${account.email}/messages/${email.id}/attachments`,
                { headers: { Authorization: `Bearer ${token}` } }
              );
              if (!listRes.ok) {
                const gerr = await listRes.json().catch(() => ({}));
                result.errors.push(`Graph attach list on ${msgId}: ${gerr.error?.message || listRes.statusText}`);
              } else {
                const listData = await listRes.json();
                const atts: any[] = listData.value || [];
                for (let ai = 0; ai < atts.length; ai++) {
                  const att = atts[ai];
                  try {
                    const odataType = String(att["@odata.type"] || "");
                    if (odataType && !odataType.includes("fileAttachment")) {
                      // Nested emails / reference links — no contentBytes.
                      console.log(`[graph-sync] skipping non-file attachment (${odataType}) on ${msgId}`);
                      continue;
                    }
                    let contentBytes: string | null = att.contentBytes || null;
                    if (!contentBytes && att.id) {
                      // Large attachment — list omitted the bytes; fetch it.
                      const oneRes = await fetch(
                        `${GRAPH_BASE}/users/${account.email}/messages/${email.id}/attachments/${att.id}`,
                        { headers: { Authorization: `Bearer ${token}` } }
                      );
                      if (oneRes.ok) {
                        const oneData = await oneRes.json();
                        contentBytes = oneData.contentBytes || null;
                      }
                    }
                    if (!contentBytes) {
                      result.errors.push(`Graph attach ${att.name || "(unnamed)"} on ${msgId}: no contentBytes`);
                      continue;
                    }
                    const buf = Buffer.from(contentBytes, "base64");
                    if (buf.length === 0) {
                      result.errors.push(`Graph attach ${att.name || "(unnamed)"} on ${msgId}: empty body`);
                      continue;
                    }
                    const up = await uploadAttachmentToStorage(supabase, {
                      accountId,
                      messageId: msDbMessageId,
                      attachment: {
                        filename: att.name || `attachment-${ai + 1}.bin`,
                        contentType: att.contentType || "application/octet-stream",
                        size: typeof att.size === "number" ? att.size : buf.length,
                        // Graph's isInline is authoritative here (unlike raw
                        // MIME, where only the disposition header is —
                        // Outlook sets Content-ID on regular files too).
                        isInline: !!att.isInline,
                        contentId: att.contentId || null,
                        checksum: null,
                        content: buf,
                      },
                      indexInMessage: ai,
                    });
                    if (!up.ok && !up.skipped) {
                      result.errors.push(`Graph attach upload ${att.name || "(unnamed)"} on ${msgId}: ${up.error}`);
                    }
                  } catch (attErr: any) {
                    result.errors.push(`Graph attach exception on ${msgId}: ${attErr?.message || "unknown"}`);
                  }
                }
              }
            }
          } catch (attBlockErr: any) {
            result.errors.push(`Graph attachments block on ${msgId}: ${attBlockErr?.message || "unknown"}`);
          }

          // Phase 3 — agent reply loop. Fire message.received for new
          // inbound MS Graph messages. Webhook side filters to convs with
          // agent involvement, so no-op for non-agent convs.
          //
          // Deliberately placed AFTER the attachment capture block (and
          // outside any try/catch a capture error could short-circuit) so
          // the webhook payload's attachments array is populated.
          // Fire-and-forget — never blocks sync.
          // (conversationId is `string | null` at this scope; by here a
          // successful insert means it isn't null in practice — narrow
          // explicitly for TypeScript.)
          if (newMsMessageId && !isOutbound && conversationId) {
            const webhookMessageId = newMsMessageId;
            dispatchMessageReceivedWebhook({
              conversationId,
              messageId: webhookMessageId,
              fromEmail: email.from?.emailAddress?.address || "",
              fromName: email.from?.emailAddress?.name || null,
              subject: email.subject || null,
              bodyText: bodyText.slice(0, 5000),
              bodyHtml: emailBodyHtml,
              receivedAt: msSentAt,
            }).catch((e) => console.error("[ms-graph-sync] agent webhook failed:", e?.message));
          }

          const convoUpdate: any = {
            preview: decodeEmailText(email.bodyPreview || bodyText).slice(0, 200),
            last_message_at: email.receivedDateTime || new Date().toISOString(),
            is_unread: !isOutbound,
          };
          // For INBOUND messages, set last_inbound_at so the conversation
          // moves out of Sent and into Inbox.
          if (!isOutbound) {
            convoUpdate.last_inbound_at = email.receivedDateTime || new Date().toISOString();
            // If the conversation is currently in the system Sent folder,
            // move it to the account's Inbox folder. We can't use NULL here
            // because ConversationList's strict filter would hide it.
            // Custom folder placements are NOT touched.
            const { data: convoRow } = await supabase
              .from("conversations")
              .select("folder_id, folder:folders(is_system, name)")
              .eq("id", conversationId)
              .maybeSingle();
            const folder: any = (convoRow as any)?.folder;
            const hasNoFolder = !((convoRow as any)?.folder_id);
            const isInSentSystemFolder =
              folder && folder.is_system === true &&
              String(folder.name || "").toLowerCase() === "sent";
            if (isInSentSystemFolder || hasNoFolder) {
              const { data: inboxFolder } = await supabase
                .from("folders")
                .select("id")
                .eq("email_account_id", accountId)
                .eq("is_system", true)
                .ilike("name", "inbox")
                .maybeSingle();
              if (inboxFolder?.id) {
                convoUpdate.folder_id = inboxFolder.id;
              }
              // If no Inbox folder found, leave folder_id as-is (don't force null).
            }
          }
          if (email.hasAttachments) convoUpdate.has_attachments = true;

          await supabase.from("conversations").update(convoUpdate).eq("id", conversationId);

          // Reopen rule: inbound message on an existing CLOSED conversation
          // reopens it (auto-assign to last closer if unassigned & closed
          // within 3 business days). Self-guards on status==="closed".
          if (!isOutbound && conversationId) {
            await onIncomingMessageReopenCheck(conversationId, false);
          }

          if (runRulesFn && conversationId) {
            try {
              await runRulesFn(conversationId, {
                conversation_id: conversationId, subject: email.subject || "",
                from_email: email.from?.emailAddress?.address || "",
                from_name: email.from?.emailAddress?.name || "",
                to_addresses: toAddr, body_text: bodyText,
                cc_addresses: (email.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", "),
                email_account_id: accountId,
                has_attachments: !!email.hasAttachments,
              }, isOutbound ? "outgoing" : "incoming");
            } catch (re: any) { console.error("Rule error:", re.message); }
          }

          result.newMessages++;
          batchNewCount++;
        } catch (ee: any) { result.errors.push(ee.message); }
      }

      batchCount++;
      console.log(`[graph-sync] ${account.email}: batch ${batchCount}, offset ${currentSkipOffset}, +${batchNewCount} new (${result.newMessages} total), ${Date.now() - syncStart}ms`);

      // If this batch was less than full, we've reached the end
      if (!result.hasMore) break;
    }

    // Final sync state update
    if (isInitialSync && !result.hasMore) {
      // Initial sync complete — set last_sync_at so future syncs are incremental
      await supabase.from("email_accounts").update({
        last_sync_at: new Date().toISOString(),
        last_sync_uid: currentSkipOffset.toString(),
        sync_error: null,
      }).eq("id", accountId);
      console.log(`[graph-sync] ${account.email}: initial sync COMPLETE at offset ${currentSkipOffset}`);
    } else if (!isInitialSync) {
      await supabase.from("email_accounts").update({
        last_sync_at: new Date().toISOString(),
        sync_error: result.errors.length > 0 ? result.errors[0] : null,
      }).eq("id", accountId);
    }

    result.success = true;
  } catch (err: any) {
    result.errors.push(err.message);
    const s2 = createServerClient();
    await s2.from("email_accounts").update({ sync_error: err.message }).eq("id", accountId);
  }

  return result;
}
// ── Send a threaded reply via Graph createReply ─────────────────────────
//
// Graph's /sendMail cannot set In-Reply-To / References (custom
// internetMessageHeaders must start with "x-"), so a "reply" sent through
// it is a brand-new thread for every recipient. The only way to send a
// properly-threaded reply through Graph is the draft flow:
//   resolve internetMessageId → graph id → createReply → PATCH the draft
//   (subject/body/recipients) → add attachments → send.
//
// userSegment is "me" (delegated / microsoft_oauth tokens) or
// "users/<email>" (client-credential tokens). Returns { success:false }
// on any failure so callers can FALL BACK to the untheaded sendMail path —
// a sent-but-unthreaded email beats a failed send.
export async function sendGraphReplyViaToken(
  token: string,
  userSegment: string,
  replyToInternetMessageId: string,
  opts: {
    subject: string;
    bodyHtml: string;
    to: string;
    cc?: string;
    bcc?: string;
    attachments?: { name: string; type: string; data: string }[];
    inlineAttachments?: { cid: string; content: Buffer; contentType: string; filename: string }[];
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const seg = userSegment.replace(/\/+$/, "");
    // 1. Resolve the Graph message id from the RFC822 internetMessageId
    //    (that's what sync stores in provider_message_id as "ms:<id>").
    const filterId = replyToInternetMessageId.replace(/'/g, "''");
    const findRes = await fetch(
      `${GRAPH_BASE}/${seg}/messages?$filter=internetMessageId eq '${encodeURIComponent(filterId)}'&$select=id`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!findRes.ok) return { success: false, error: `resolve failed (${findRes.status})` };
    const found = await findRes.json();
    const graphId: string | undefined = found?.value?.[0]?.id;
    if (!graphId) return { success: false, error: "reply target not found in mailbox" };

    // 2. Create the reply draft (inherits ConversationId + References).
    const createRes = await fetch(`${GRAPH_BASE}/${seg}/messages/${graphId}/createReply`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!createRes.ok) return { success: false, error: `createReply failed (${createRes.status})` };
    const draft = await createRes.json();
    const draftId: string | undefined = draft?.id;
    if (!draftId) return { success: false, error: "createReply returned no draft id" };

    // 3. Overwrite the draft with our content and recipients. Our body
    //    already contains the app-composed quoted history, so we replace
    //    Graph's auto-quoted body entirely.
    const mkRecipients = (s?: string) =>
      (s || "")
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean)
        .map((address) => ({ emailAddress: { address } }));
    const patchBody: any = {
      subject: opts.subject,
      body: { contentType: "HTML", content: opts.bodyHtml },
      toRecipients: mkRecipients(opts.to),
    };
    const ccR = mkRecipients(opts.cc);
    const bccR = mkRecipients(opts.bcc);
    if (ccR.length > 0) patchBody.ccRecipients = ccR;
    if (bccR.length > 0) patchBody.bccRecipients = bccR;

    const patchRes = await fetch(`${GRAPH_BASE}/${seg}/messages/${draftId}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(patchBody),
    });
    if (!patchRes.ok) return { success: false, error: `draft patch failed (${patchRes.status})` };

    // 4. Attachments (regular + inline CID) one POST each.
    const allAtts = [
      ...((opts.attachments || []).map((a) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: a.name,
        contentType: a.type || "application/octet-stream",
        contentBytes: a.data,
      }))),
      ...((opts.inlineAttachments || []).map((c) => ({
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: c.filename,
        contentType: c.contentType,
        contentBytes: c.content.toString("base64"),
        isInline: true,
        contentId: c.cid,
      }))),
    ];
    for (const att of allAtts) {
      const attRes = await fetch(`${GRAPH_BASE}/${seg}/messages/${draftId}/attachments`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(att),
      });
      if (!attRes.ok) return { success: false, error: `attachment upload failed (${attRes.status})` };
    }

    // 5. Send.
    const sendRes = await fetch(`${GRAPH_BASE}/${seg}/messages/${draftId}/send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!sendRes.ok) return { success: false, error: `send failed (${sendRes.status})` };

    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message || "unknown" };
  }
}