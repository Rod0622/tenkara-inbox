import Imap from "imap";
import { simpleParser, ParsedMail } from "mailparser";
import { createServerClient } from "@/lib/supabase";
import { runRulesForMessage } from "@/lib/rule-engine";
import { refreshGoogleToken, buildXOAuth2Token } from "@/lib/google-oauth";
import { onNewConversationFromSync } from "@/lib/folder-labels";
import { uploadAttachmentToStorage, type AttachmentUploadInput } from "@/lib/attachments-storage";
import { decodeEmailText, decodeEmailTextPreserveNewlines } from "@/lib/decode-email-text";

// ── Types ────────────────────────────────────────────
interface EmailAccount {
  id: string;
  email: string;
  name: string;
  provider: string;
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_password: string;
  imap_tls: boolean;
  last_sync_uid: string | null;
  oauth_refresh_token?: string | null;
  _xoauth2Token?: string; // Populated at runtime for OAuth accounts
}

interface ParsedEmail {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  fromName: string;
  fromEmail: string;
  toAddresses: string;
  ccAddresses: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  snippet: string;
  sentAt: Date;
  hasAttachments: boolean;
  // Raw attachment bytes + metadata, captured during IMAP parse and uploaded
  // to Supabase Storage by the sync loop. mailparser already decodes
  // base64/quoted-printable, so `content` here is the actual file bytes.
  attachments: ParsedAttachment[];
  gmailLabels: string[];
}

// What we capture from mailparser per attachment. We keep the original buffer
// in memory only long enough to upload to Storage in the sync loop, then drop it.
interface ParsedAttachment {
  filename: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentId: string | null;
  checksum: string | null;
  content: Buffer;
}

interface SyncResult {
  success: boolean;
  newMessages: number;
  newConversations: number;
  errors: string[];
  lastUid: number | null;
}

// ── Gmail detection ──────────────────────────────────
function isGmailAccount(account: EmailAccount): boolean {
  return (
    account.provider?.toLowerCase() === "gmail" ||
    account.imap_host?.toLowerCase().includes("gmail") ||
    account.imap_host?.toLowerCase().includes("imap.google") ||
    account.email?.toLowerCase().endsWith("@gmail.com") ||
    account.email?.toLowerCase().endsWith("@googlemail.com")
  );
}

// Non-primary Gmail categories to filter out
const GMAIL_NON_PRIMARY_CATEGORIES = [
  "promotions",
  "social",
  "updates",
  "forums",
  "category_promotions",
  "category_social",
  "category_updates",
  "category_forums",
];

// ── Main sync function ───────────────────────────────
export async function syncEmailAccount(accountId: string): Promise<SyncResult> {
  const supabase = createServerClient();
  const result: SyncResult = {
    success: false,
    newMessages: 0,
    newConversations: 0,
    errors: [],
    lastUid: null,
  };

  try {
    // 1. Get account credentials
    console.log(`IMAP sync ${accountId}: starting sync...`);
    let { data: account, error: accError } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", accountId)
      .maybeSingle();

    if (accError || !account) {
      console.error(`IMAP sync ${accountId}: ID lookup failed (${accError?.message || "not found"}), skipping`);
      result.errors.push("Account not found: " + (accError?.message || "unknown"));
      return result;
    }

    const gmail = isGmailAccount(account as EmailAccount);

    console.log(`IMAP sync ${accountId}: connecting to ${account.imap_host}:${account.imap_port} as ${account.imap_user}`);

    // For OAuth accounts, use Gmail API directly instead of IMAP (more reliable)
    const acct = account as EmailAccount;
    if (account.provider === "google_oauth" && account.oauth_refresh_token) {
      try {
        const accessToken = await refreshGoogleToken(accountId, true);
        console.log(`IMAP sync ${accountId}: using Gmail API for OAuth account, token starts with: ${accessToken.slice(0, 20)}...`);

        // Quick test: verify token works with Gmail API
        const testRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!testRes.ok) {
          const testErr = await testRes.json().catch(() => ({}));
          console.error(`IMAP sync ${accountId}: Gmail API token test failed (${testRes.status}):`, JSON.stringify(testErr));
          // Try fetching a completely fresh token by clearing the stored one first
          const sb2 = createServerClient();
          await sb2.from("email_accounts").update({ oauth_access_token: null, oauth_expires_at: null }).eq("id", accountId);
          const freshToken = await refreshGoogleToken(accountId, true);
          console.log(`IMAP sync ${accountId}: retrying with cleared token, starts with: ${freshToken.slice(0, 20)}...`);
          const retryRes = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
            headers: { Authorization: `Bearer ${freshToken}` },
          });
          if (!retryRes.ok) {
            const retryErr = await retryRes.json().catch(() => ({}));
            throw new Error(`Gmail API auth failed after retry: ${retryErr.error?.message || retryRes.statusText}`);
          }
          // Use the fresh token for the rest
          var gmailToken = freshToken;
        } else {
          var gmailToken = accessToken;
        }
        let profileEmail = "unknown";
        if (testRes.ok) {
          const profileData = await testRes.json().catch(() => ({}));
          profileEmail = profileData.emailAddress || "unknown";
        }
        console.log(`IMAP sync ${accountId}: Gmail profile: ${profileEmail}`);

        // Fetch recent messages via Gmail API
        const sinceDate = account.last_sync_at
          ? new Date(account.last_sync_at)
          : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
        const afterEpoch = Math.floor(sinceDate.getTime() / 1000);
        const query = `after:${afterEpoch}`;

        const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=25`;
        const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${gmailToken}` } });
        if (!listRes.ok) {
          const err = await listRes.json().catch(() => ({}));
          throw new Error(`Gmail API list error: ${err.error?.message || listRes.statusText}`);
        }
        const listData = await listRes.json();
        const messageIds: string[] = (listData.messages || []).map((m: any) => m.id);
        console.log(`IMAP sync ${accountId}: Gmail API found ${messageIds.length} messages`);

        if (messageIds.length === 0) {
          result.success = true;
          await supabase.from("email_accounts").update({ last_sync_at: new Date().toISOString(), sync_error: null }).eq("id", accountId);
          return result;
        }

        // ── OPTIMIZATION: Batch existence check ──
        // Previously we ran one SELECT per message ID (50 queries). Now we ask
        // Supabase once which provider_message_ids already exist, then skip them.
        // This is roughly 50× fewer DB round-trips per sync run.
        const providerIds = messageIds.map((id) => `gmail:${id}`);
        const existingIds = new Set<string>();
        // Postgres IN list has a practical cap; we batch in chunks of 200 even
        // though we expect 50 here, so we don't accidentally break if BATCH_SIZE grows later.
        const BATCH = 200;
        for (let i = 0; i < providerIds.length; i += BATCH) {
          const slice = providerIds.slice(i, i + BATCH);
          const { data: existingRows } = await supabase
            .from("messages")
            .select("provider_message_id")
            .in("provider_message_id", slice);
          for (const row of (existingRows || [])) existingIds.add(row.provider_message_id);
        }

        // Filter down to only NEW message IDs we actually need to fetch from Gmail
        const newMessageIds = messageIds.filter((id) => !existingIds.has(`gmail:${id}`));
        if (newMessageIds.length === 0) {
          console.log(`IMAP sync ${accountId}: all ${messageIds.length} messages already synced`);
          result.success = true;
          await supabase.from("email_accounts").update({ last_sync_at: new Date().toISOString(), sync_error: null }).eq("id", accountId);
          return result;
        }
        console.log(`IMAP sync ${accountId}: ${newMessageIds.length} new messages to fetch (${existingIds.size} already synced, skipped)`);

        // ── OPTIMIZATION: Per-account time budget + mid-loop checkpointing ──
        // Previously, last_sync_at was only updated AFTER the entire loop finished.
        // If Vercel timed out mid-loop, last_sync_at stayed stuck at yesterday's value
        // and the next cron run would re-fetch all the same messages.
        // Now we update last_sync_at incrementally so progress is preserved on timeout.
        const ACCOUNT_BUDGET_MS = 25000; // Each account gets max 25s of work
        const accountStart = Date.now();
        let earliestProcessedAt: string | null = null;
        let processedCount = 0;
        const CHECKPOINT_EVERY = 5; // Save last_sync_at every N messages

        // Fetch each NEW message detail (skipping those we already have)
        for (const msgId of newMessageIds) {
          // Bail out early if we've used our per-account time budget
          if (Date.now() - accountStart > ACCOUNT_BUDGET_MS) {
            console.log(`IMAP sync ${accountId}: per-account budget reached after ${processedCount}/${newMessageIds.length} messages`);
            break;
          }
          try {
            const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`;
            const msgRes = await fetch(msgUrl, { headers: { Authorization: `Bearer ${gmailToken}` } });
            if (!msgRes.ok) continue;
            const msgData = await msgRes.json();

            const headers: Record<string, string> = {};
            for (const h of (msgData.payload?.headers || [])) {
              headers[h.name.toLowerCase()] = h.value;
            }

            const fromMatch = (headers.from || "").match(/^(.+?)\s*<(.+?)>$/);
            const fromName = fromMatch ? fromMatch[1].trim() : (headers.from || "Unknown");
            const fromEmail = fromMatch ? fromMatch[2].trim().toLowerCase() : (headers.from || "").toLowerCase();
            const isOutbound = fromEmail === account.email.toLowerCase();

            const toAddresses = headers.to || "";
            const ccAddresses = headers.cc || "";
            const subject = headers.subject || "(No Subject)";
            // Gmail's snippet field arrives HTML-entity-encoded (&#39; for
            // apostrophes, &nbsp; for spaces, etc.). Decode once at the
            // source so every downstream use (preview, snippet, body
            // fallback) renders correctly in the UI.
            const snippet = decodeEmailText(msgData.snippet || "");
            const sentAt = headers.date ? new Date(headers.date).toISOString() : new Date(parseInt(msgData.internalDate)).toISOString();
            const hasAttachments = (msgData.payload?.parts || []).some((p: any) => p.filename && p.filename.length > 0);

            // Extract HTML body from Gmail payload (nested MIME parts)
            const extractBody = (payload: any): { html: string; text: string } => {
              let html = "";
              let text = "";
              if (payload.mimeType === "text/html" && payload.body?.data) {
                html = Buffer.from(payload.body.data, "base64url").toString("utf-8");
              } else if (payload.mimeType === "text/plain" && payload.body?.data) {
                text = Buffer.from(payload.body.data, "base64url").toString("utf-8");
              }
              if (payload.parts) {
                for (const part of payload.parts) {
                  const sub = extractBody(part);
                  if (sub.html && !html) html = sub.html;
                  if (sub.text && !text) text = sub.text;
                }
              }
              return { html, text };
            };
            const extracted = extractBody(msgData.payload || {});
            let bodyHtml: string | null = extracted.html || null;
            let extractedText: string = extracted.text || "";

            // Some Gmail messages have a MIME structure my hand-rolled walker
            // can't decode — typically deeply nested multipart/related inside
            // multipart/alternative, or unusual content-transfer-encodings.
            // When the walker comes back empty AND a real snippet exists,
            // fall back to a second fetch using format=raw + mailparser,
            // which handles every MIME edge case correctly. This is the
            // same parser that handles the IMAP path, so behaviour is
            // consistent across providers.
            if (!extractedText && !bodyHtml && msgData.snippet) {
              try {
                const rawUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=raw`;
                const rawRes = await fetch(rawUrl, {
                  headers: { Authorization: `Bearer ${gmailToken}` },
                });
                if (rawRes.ok) {
                  const rawData = await rawRes.json();
                  if (rawData.raw) {
                    const rawBuf = Buffer.from(rawData.raw, "base64url");
                    const parsed = await simpleParser(rawBuf);
                    if (parsed.text) extractedText = parsed.text;
                    if (parsed.html && !bodyHtml) {
                      bodyHtml = typeof parsed.html === "string" ? parsed.html : null;
                    }
                  }
                }
              } catch (rawErr: any) {
                // Non-fatal — we'll fall through to snippet below.
                console.warn(`[gmail-sync] raw fallback failed for ${msgId}: ${rawErr?.message}`);
              }
            }

            // Body text fallback chain (in priority order):
            //   1. text/plain part from MIME walker (best — pure plaintext)
            //   2. text/plain from mailparser raw fallback (covers cases the
            //      hand-rolled walker missed)
            //   3. text/html stripped of tags
            //   4. snippet (last resort — capped at ~200 chars)
            const htmlStrippedText = bodyHtml
              ? bodyHtml
                  // Drop <script> and <style> blocks entirely (content too)
                  .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
                  // Replace <br> and <p> with newlines so paragraph structure survives
                  .replace(/<br\s*\/?>/gi, "\n")
                  .replace(/<\/p\s*>/gi, "\n\n")
                  // Strip remaining tags
                  .replace(/<[^>]*>/g, " ")
              : "";
            const bodyText = decodeEmailTextPreserveNewlines(
              extractedText || htmlStrippedText || snippet
            );

            // Check Gmail labels for category filtering
            const labels: string[] = msgData.labelIds || [];
            const isPromotions = labels.some((l: string) => l.toLowerCase().includes("promotions") || l === "CATEGORY_PROMOTIONS");
            const isSocial = labels.some((l: string) => l.toLowerCase().includes("social") || l === "CATEGORY_SOCIAL");
            const isUpdates = labels.some((l: string) => l.toLowerCase().includes("updates") || l === "CATEGORY_UPDATES");
            const isForums = labels.some((l: string) => l.toLowerCase().includes("forums") || l === "CATEGORY_FORUMS");
            if (isPromotions || isSocial || isUpdates || isForums) continue;

            // Thread into conversation
            const cleanSubject = subject.replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, "").trim();
            let conversationId: string | null = null;

            if (cleanSubject) {
              const { data: c } = await supabase.from("conversations").select("id")
                .eq("email_account_id", accountId).eq("subject", cleanSubject)
                .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
              if (c) conversationId = c.id;
            }

            if (!conversationId) {
              const { data: nc, error: ce } = await supabase.from("conversations").insert({
                email_account_id: accountId,
                thread_id: `gmail:${msgData.threadId || msgId}`,
                subject: cleanSubject || "(No Subject)",
                from_name: fromName, from_email: fromEmail,
                preview: snippet.slice(0, 200),
                is_unread: !isOutbound, status: "open",
                last_message_at: sentAt,
              }).select("id").single();
              if (ce) continue;
              conversationId = nc.id;
              result.newConversations++;

              // Auto-apply [account, Inbox] labels (or just [account] for outbound).
              // Best-effort — never throws. Use nc.id directly so TS narrows correctly.
              await onNewConversationFromSync(nc.id, accountId, isOutbound);
            }

            const { data: insertedGmailMsg, error: gmailInsertErr } = await supabase.from("messages").insert({
              conversation_id: conversationId,
              provider_message_id: `gmail:${msgId}`,
              from_name: fromName, from_email: fromEmail,
              to_addresses: toAddresses, cc_addresses: ccAddresses,
              subject, body_text: bodyText.slice(0, 5000), body_html: bodyHtml,
              snippet: snippet.slice(0, 200),
              is_outbound: isOutbound, has_attachments: hasAttachments,
              sent_at: sentAt,
            }).select("id").single();

            if (gmailInsertErr || !insertedGmailMsg) {
              result.errors.push(`Gmail message ${msgId}: ${gmailInsertErr?.message || "insert failed"}`);
              continue;
            }

            // Gmail API: walk MIME parts and capture each attachment's bytes.
            //
            // Two delivery shapes exist (per Gmail API docs):
            //   • Small attachments → `body.data` is base64url-encoded inline,
            //     no `attachmentId`. Decode directly — no extra fetch needed.
            //   • Larger attachments → `body.attachmentId` is present, `body.data`
            //     is empty. Must fetch via users.messages.attachments.get.
            //
            // We also handle parts WITHOUT a filename when they have a content
            // disposition or Content-ID — Yahoo and a few clients send images
            // that way ("Attached Image" with no filename header).
            if (hasAttachments) {
              const collectParts = (payload: any, out: any[] = []) => {
                if (!payload) return out;
                const body = payload.body || {};
                const hasBytes = !!body.attachmentId || !!body.data;
                const mime = String(payload.mimeType || "");
                // Skip text/html and text/plain body parts — those are the
                // message body, not attachments. Everything else with bytes
                // is a candidate.
                const isBodyText = mime === "text/plain" || mime === "text/html";
                if (!isBodyText && hasBytes && (payload.filename || mime.startsWith("image/") || mime.startsWith("application/"))) {
                  out.push(payload);
                }
                if (Array.isArray(payload.parts)) {
                  for (const p of payload.parts) collectParts(p, out);
                }
                return out;
              };
              const parts = collectParts(msgData.payload || {});
              for (let i = 0; i < parts.length; i++) {
                const p = parts[i];
                try {
                  let buf: Buffer | null = null;

                  if (p.body?.attachmentId) {
                    // Larger attachments: separate fetch
                    const attRes = await fetch(
                      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}/attachments/${p.body.attachmentId}`,
                      { headers: { Authorization: `Bearer ${gmailToken}` } }
                    );
                    if (!attRes.ok) {
                      result.errors.push(`Gmail attach fetch ${p.filename || "(unnamed)"} on ${msgId}: ${attRes.statusText}`);
                      continue;
                    }
                    const attJson = await attRes.json();
                    buf = Buffer.from(attJson.data || "", "base64url");
                  } else if (p.body?.data) {
                    // Small inline attachments: decode directly from the body
                    buf = Buffer.from(p.body.data, "base64url");
                  }

                  if (!buf || buf.length === 0) {
                    result.errors.push(`Gmail attach ${p.filename || "(unnamed)"} on ${msgId}: empty body`);
                    continue;
                  }

                  // Pull Content-ID and disposition out of the part headers so
                  // we know whether this is an inline image or a normal file.
                  const headersList: { name: string; value: string }[] = p.headers || [];
                  const findHeader = (n: string) =>
                    headersList.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value || "";
                  const disposition = findHeader("Content-Disposition").toLowerCase();
                  const contentIdRaw = findHeader("Content-ID");
                  const contentId = contentIdRaw ? contentIdRaw.replace(/^<|>$/g, "") : null;

                  // Derive a filename when the part doesn't carry one.
                  // Yahoo sometimes sends inline images with no filename header.
                  const fallbackName = (() => {
                    const mt = String(p.mimeType || "").toLowerCase();
                    const ext = mt.startsWith("image/") ? mt.split("/")[1] : "bin";
                    return contentId ? `${contentId}.${ext}` : `attachment-${i + 1}.${ext}`;
                  })();

                  const up = await uploadAttachmentToStorage(supabase, {
                    accountId,
                    messageId: insertedGmailMsg.id,
                    attachment: {
                      filename: p.filename || fallbackName,
                      contentType: p.mimeType || "application/octet-stream",
                      size: typeof p.body?.size === "number" ? p.body.size : buf.length,
                      // Disposition is authoritative for "inline." A
                      // Content-ID alone doesn't mean inline — Outlook and
                      // Graph routinely set Content-ID on regular file
                      // attachments. See longer comment in the IMAP path.
                      isInline: disposition.startsWith("inline"),
                      contentId,
                      checksum: null,
                      content: buf,
                    },
                    indexInMessage: i,
                  });
                  if (!up.ok && !up.skipped) {
                    result.errors.push(`Gmail attach upload ${p.filename || fallbackName} on ${msgId}: ${up.error}`);
                  }
                } catch (attErr: any) {
                  result.errors.push(`Gmail attach exception on ${msgId}: ${attErr?.message || "unknown"}`);
                }
              }
            }

            await supabase.from("conversations").update({
              preview: snippet.slice(0, 200),
              last_message_at: sentAt,
              is_unread: !isOutbound,
            }).eq("id", conversationId);

            result.newMessages++;
            processedCount++;
            // Track the OLDEST timestamp we've successfully processed.
            // (Gmail returns newest-first, so we keep the smallest sentAt we've seen.)
            // Setting last_sync_at to this guarantees we've fully processed everything
            // from this timestamp forward — the next run won't miss anything.
            if (!earliestProcessedAt || sentAt < earliestProcessedAt) {
              earliestProcessedAt = sentAt;
            }

            // Checkpoint: every N messages, save progress to last_sync_at.
            // This way if Vercel times out mid-loop, the next run picks up from where we left off
            // instead of re-fetching the same messages.
            if (processedCount % CHECKPOINT_EVERY === 0 && earliestProcessedAt) {
              await supabase.from("email_accounts").update({
                last_sync_at: earliestProcessedAt,
                sync_error: null,
              }).eq("id", accountId);
            }

            // Note: computeResponseTime moved out of the hot path. It adds 3-4 queries
            // per message and isn't time-critical. A separate background task can compute
            // response times asynchronously. (For now: skipping during sync.)
          } catch (msgErr: any) {
            result.errors.push(msgErr.message);
          }
        }

        result.success = true;
        // Use the OLDEST timestamp of any successfully processed message.
        // This guarantees we've fully processed everything from this timestamp forward —
        // the next run's Gmail query starts here and won't miss anything.
        // If we processed nothing (e.g. no new messages), advance to "now" so we don't re-query.
        const finalSyncAt = earliestProcessedAt || new Date().toISOString();
        await supabase.from("email_accounts").update({
          last_sync_at: finalSyncAt,
          sync_error: result.errors.length > 0 ? result.errors[0] : null,
        }).eq("id", accountId);
        return result;

      } catch (apiErr: any) {
        console.error(`IMAP sync ${accountId}: Gmail API failed:`, apiErr.message);
        await supabase.from("email_accounts").update({ sync_error: "Gmail API: " + apiErr.message }).eq("id", accountId);
        result.errors.push("Gmail API: " + apiErr.message);
        return result;
      }
    }

    // 2. Connect to IMAP and fetch emails (with retry for transient errors)
    const TRANSIENT_ERRORS = ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNREFUSED", "timed out", "socket hang up"];
    const MAX_RETRIES = 2;
    let emails: ParsedEmail[] = [];
    let lastImapErr: any = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const backoffMs = attempt * 2000;
          console.log(`IMAP sync ${accountId}: retry ${attempt}/${MAX_RETRIES} after ${backoffMs}ms backoff...`);
          await new Promise(r => setTimeout(r, backoffMs));
        }
        emails = await fetchEmailsViaImap(acct);
        console.log(`IMAP sync ${accountId}: fetched ${emails.length} emails${attempt > 0 ? ` (retry ${attempt})` : ""}`);
        lastImapErr = null;
        break;
      } catch (imapErr: any) {
        lastImapErr = imapErr;
        const isTransient = TRANSIENT_ERRORS.some(e => imapErr.message?.toLowerCase().includes(e.toLowerCase()));
        if (isTransient && attempt < MAX_RETRIES) {
          console.warn(`IMAP sync ${accountId}: transient error (attempt ${attempt + 1}): ${imapErr.message} — will retry`);
          continue;
        }
        console.error(`IMAP sync ${accountId}: connection failed after ${attempt + 1} attempt(s):`, imapErr.message);
        break;
      }
    }

    if (lastImapErr) {
      await supabase.from("email_accounts").update({ sync_error: lastImapErr.message }).eq("id", accountId);
      result.errors.push(lastImapErr.message);
      return result;
    }

    if (emails.length === 0) {
      result.success = true;
      await supabase
        .from("email_accounts")
        .update({ last_sync_at: new Date().toISOString(), sync_error: null })
        .eq("id", accountId);
      return result;
    }

    // 3. Filter to primary inbox for Gmail accounts (post-fetch filtering)
    let filteredEmails = emails;
    if (gmail) {
      filteredEmails = emails.filter((email) => {
        // If we got Gmail labels, check them
        if (email.gmailLabels.length > 0) {
          const labelsLower = email.gmailLabels.map((l) => l.toLowerCase());
          // Exclude if any non-primary category label is present
          const isNonPrimary = labelsLower.some((label) =>
            GMAIL_NON_PRIMARY_CATEGORIES.some((cat) => label.includes(cat))
          );
          return !isNonPrimary;
        }
        // No labels info — include by default
        return true;
      });
      console.log(
        `Gmail filter: ${emails.length} total → ${filteredEmails.length} primary`
      );
    }

    // 4. Process each email - thread into conversations and store
    for (const email of filteredEmails) {
      try {
        // Check if message already exists (dedupe)
        const existingCheck = await supabase
          .from("messages")
          .select("id")
          .eq("provider_message_id", `${accountId}:${email.uid}`)
          .maybeSingle();

        if (existingCheck.data) continue; // Already synced

        // Find or create conversation
        const conversationId = await findOrCreateConversation(
          supabase, accountId, email, account.email
        );

        // Insert message — capture the row ID so we can attach files below.
        // (Previously this was a fire-and-forget insert; we now need to know
        // which message_id to link attachments to.)
        const { data: insertedMsg, error: msgError } = await supabase
          .from("messages")
          .insert({
            conversation_id: conversationId,
            provider_message_id: `${accountId}:${email.uid}`,
            from_name: email.fromName,
            from_email: email.fromEmail,
            to_addresses: email.toAddresses,
            cc_addresses: email.ccAddresses,
            subject: email.subject,
            body_text: email.bodyText,
            body_html: email.bodyHtml,
            snippet: email.snippet,
            is_outbound: isOutbound(email.fromEmail, account.email),
            has_attachments: email.hasAttachments,
            sent_at: email.sentAt.toISOString(),
          })
          .select("id")
          .single();

        if (msgError || !insertedMsg) {
          result.errors.push(`Message ${email.uid}: ${msgError?.message || "insert failed"}`);
          continue;
        }

        // Upload attachments to Supabase Storage. Best-effort: a failure on
        // any single attachment is logged in result.errors but does not abort
        // the rest of the sync. Inline attachments are stored too so that
        // signature images / cid: references can resolve later, but they're
        // flagged in the table for the UI to filter out by default.
        if (email.attachments && email.attachments.length > 0) {
          for (let i = 0; i < email.attachments.length; i++) {
            const att = email.attachments[i];
            const up = await uploadAttachmentToStorage(supabase, {
              accountId,
              messageId: insertedMsg.id,
              attachment: att as AttachmentUploadInput,
              indexInMessage: i,
            });
            if (!up.ok && !up.skipped) {
              result.errors.push(`Attachment ${att.filename} on msg ${email.uid}: ${up.error || "unknown"}`);
            }
          }
        }

        // Update conversation with latest message info
        const convoUpdate: any = {
          preview: email.snippet || email.bodyText?.slice(0, 200),
          last_message_at: email.sentAt.toISOString(),
          is_unread: !isOutbound(email.fromEmail, account.email),
        };
        if (email.hasAttachments) convoUpdate.has_attachments = true;

        await supabase
          .from("conversations")
          .update(convoUpdate)
          .eq("id", conversationId);

        // Run rules engine against this message
        try {
          const triggerType = isOutbound(email.fromEmail, account.email) ? "outgoing" : "incoming";
          await runRulesForMessage(conversationId, {
            conversation_id: conversationId,
            subject: email.subject,
            from_email: email.fromEmail,
            from_name: email.fromName,
            to_addresses: email.toAddresses,
            cc_addresses: email.ccAddresses || "",
            body_text: email.bodyText,
            email_account_id: accountId,
            has_attachments: !!email.hasAttachments,
          }, triggerType);
        } catch (ruleErr: any) {
          console.error(`Rule engine error for ${email.uid}:`, ruleErr.message);
        }

        result.newMessages++;
        result.lastUid = Math.max(result.lastUid || 0, email.uid);

        // Compute response time for this new message
        try {
          await computeResponseTime(supabase, conversationId);
        } catch (_rtErr) { /* best-effort */ }
      } catch (emailErr: any) {
        result.errors.push(`Email ${email.uid}: ${emailErr.message}`);
      }
    }

    // 5. Update account sync state
    // Use highest UID from ALL fetched emails (not just filtered)
    // so incremental sync doesn't re-fetch filtered-out messages
    const highestUid = emails.reduce((max, e) => Math.max(max, e.uid), 0);

    await supabase
      .from("email_accounts")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_uid: (highestUid || result.lastUid)?.toString() || account.last_sync_uid,
        sync_error: result.errors.length > 0 ? result.errors[0] : null,
      })
      .eq("id", accountId);

    result.success = true;
  } catch (err: any) {
    result.errors.push(err.message);

    // Update account with error
    const supabase2 = createServerClient();
    await supabase2
      .from("email_accounts")
      .update({ sync_error: err.message })
      .eq("id", accountId);
  }

  return result;
}

// ── IMAP Connection & Fetch ──────────────────────────
function fetchEmailsViaImap(account: EmailAccount): Promise<ParsedEmail[]> {
  return new Promise((resolve, reject) => {
    const emails: ParsedEmail[] = [];
    const lastUid = account.last_sync_uid ? parseInt(account.last_sync_uid) : 0;
    const gmail = isGmailAccount(account);

    const imapConfig: any = {
      user: account.imap_user || account.email,
      host: account.imap_host,
      port: account.imap_port || 993,
      tls: account.imap_tls !== false,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000,
      authTimeout: 10000,
    };

    // Use XOAUTH2 for OAuth accounts, password for others
    if (account._xoauth2Token) {
      // node-imap handles the XOAUTH2 SASL encoding internally when xoauth2 is set
      // Pass the raw access token — the library builds the SASL string itself
      imapConfig.xoauth2 = account._xoauth2Token;
      // Also try setting xoauth as alternative for some library versions
      imapConfig.xoauth = account._xoauth2Token;
    } else {
      imapConfig.password = account.imap_password;
    }

    const imap = new Imap(imapConfig);

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) {
          imap.end();
          return reject(new Error(`Failed to open INBOX: ${err.message}`));
        }

        // Standard IMAP search — works on all providers
        let searchCriteria: any[];
        if (lastUid > 0) {
          searchCriteria = [["UID", `${lastUid + 1}:*`]];
        } else {
          // Initial sync: fetch last 30 days instead of ALL to avoid Gmail IMAP hanging
          const since = new Date();
          since.setDate(since.getDate() - 30);
          searchCriteria = [["SINCE", since]];
        }

        imap.search(searchCriteria, (searchErr, uids) => {
          if (searchErr) {
            imap.end();
            return reject(new Error(`Search failed: ${searchErr.message}`));
          }

          if (!uids || uids.length === 0) {
            imap.end();
            return resolve([]);
          }

          // Filter out UIDs we've already seen
          const newUids = lastUid > 0 ? uids.filter((u) => u > lastUid) : uids;
          if (newUids.length === 0) {
            imap.end();
            return resolve([]);
          }

          // First sync: take last 50. Incremental: take last 100.
          const limit = lastUid > 0 ? 100 : 50;
          const fetchUids = newUids.slice(-limit);

          // For Gmail, also fetch X-GM-LABELS to enable post-fetch filtering
          const fetchOptions: any = {
            bodies: gmail ? ["HEADER", ""] : "",
            struct: true,
          };

          const fetch = imap.fetch(fetchUids, fetchOptions);

          fetch.on("message", (msg, seqno) => {
            let uid = 0;
            let rawBuffer = Buffer.alloc(0);
            let headerBuffer = Buffer.alloc(0);

            msg.on("attributes", (attrs) => {
              uid = attrs.uid;
            });

            msg.on("body", (stream, info) => {
              const chunks: Buffer[] = [];
              stream.on("data", (chunk: Buffer) => chunks.push(chunk));
              stream.on("end", () => {
                const buf = Buffer.concat(chunks);
                if (gmail && info.which === "HEADER") {
                  headerBuffer = buf;
                } else {
                  rawBuffer = buf;
                }
              });
            });

            msg.once("end", async () => {
              try {
                const parsed = await simpleParser(rawBuffer.length > 0 ? rawBuffer : headerBuffer);
                const email = parseMail(parsed, uid);

                // Extract Gmail labels from X-GM-LABELS if available
                if (gmail && headerBuffer.length > 0) {
                  const headerStr = headerBuffer.toString("utf-8");
                  const labelMatch = headerStr.match(/X-Gmail-Labels:\s*(.+)/i);
                  if (labelMatch) {
                    email.gmailLabels = labelMatch[1]
                      .split(",")
                      .map((l) => l.trim())
                      .filter(Boolean);
                  }
                }

                emails.push(email);
              } catch (parseErr: any) {
                console.error(`Parse error for UID ${uid}:`, parseErr.message);
              }
            });
          });

          fetch.once("error", (fetchErr) => {
            imap.end();
            reject(new Error(`Fetch error: ${fetchErr.message}`));
          });

          fetch.once("end", () => {
            setTimeout(() => {
              imap.end();
              emails.sort((a, b) => a.uid - b.uid);
              resolve(emails);
            }, 500);
          });
        });
      });
    });

    imap.once("error", (err: any) => {
      clearTimeout(timeout);
      console.error(`IMAP sync error for ${account.email}:`, err.message);
      reject(new Error(`IMAP connection error: ${err.message}`));
    });

    imap.once("end", () => {});

    const timeout = setTimeout(() => {
      try { imap.end(); } catch {}
      reject(new Error("IMAP sync timed out (15s)"));
    }, 15000);

    imap.once("ready", () => clearTimeout(timeout));

    imap.connect();
  });
}

// ── Parse email from mailparser ──────────────────────
function parseMail(parsed: ParsedMail, uid: number): ParsedEmail {
  const fromAddr = parsed.from?.value?.[0];
  const toAddrs = parsed.to
    ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
        .flatMap((t) => t.value.map((v) => v.address))
        .filter(Boolean)
        .join(", ")
    : "";
  const ccAddrs = parsed.cc
    ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc])
        .flatMap((c) => c.value.map((v) => v.address))
        .filter(Boolean)
        .join(", ")
    : "";

  const bodyText = parsed.text || "";
  const bodyHtml = parsed.html || "";
  const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 200);

  const references = parsed.references
    ? Array.isArray(parsed.references)
      ? parsed.references
      : [parsed.references]
    : [];

  // Map mailparser's attachment objects into our internal shape. We keep
  // raw Buffer content here so the sync loop can stream it to Storage; it
  // gets dropped after upload so we don't blow up memory on big mailboxes.
  const attachments: ParsedAttachment[] = (parsed.attachments || []).map((a: any) => ({
    filename: String(a.filename || a.cid || "attachment").slice(0, 240),
    contentType: String(a.contentType || "application/octet-stream"),
    size: typeof a.size === "number" ? a.size : (Buffer.isBuffer(a.content) ? a.content.length : 0),
    // mailparser sets contentDisposition='inline' for body-rendered parts.
    // Disposition is the AUTHORITATIVE signal for "this is inline content,
    // not a downloadable attachment." A Content-ID alone is NOT enough —
    // many clients (Outlook, Microsoft Graph) attach Content-ID headers to
    // ordinary downloadable attachments. Treating those as inline causes
    // legitimate PDFs/spreadsheets to be hidden from the attachment list.
    isInline: a.contentDisposition === "inline",
    contentId: a.cid || a.contentId || null,
    checksum: a.checksum || null,
    content: Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content || ""),
  }));

  return {
    uid,
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references,
    fromName: fromAddr?.name || fromAddr?.address || "Unknown",
    fromEmail: fromAddr?.address || "",
    toAddresses: toAddrs,
    ccAddresses: ccAddrs,
    subject: parsed.subject || "(No Subject)",
    bodyText,
    bodyHtml: typeof bodyHtml === "string" ? bodyHtml : "",
    snippet,
    sentAt: parsed.date || new Date(),
    hasAttachments: attachments.length > 0,
    attachments,
    gmailLabels: [],
  };
}

// ── Conversation threading ───────────────────────────
async function findOrCreateConversation(
  supabase: any,
  accountId: string,
  email: ParsedEmail,
  accountEmail: string
): Promise<string> {
  // Strategy 1: Match by In-Reply-To header
  if (email.inReplyTo) {
    const { data: existingMsg } = await supabase
      .from("messages")
      .select("conversation_id")
      .or(`provider_message_id.eq.${email.inReplyTo}`)
      .limit(1)
      .maybeSingle();
  }

  // Strategy 2: Match by References headers
  if (email.references.length > 0) {
    for (const ref of email.references) {
      const { data: refMsg } = await supabase
        .from("messages")
        .select("conversation_id")
        .like("provider_message_id", `%${ref}%`)
        .limit(1)
        .maybeSingle();

      if (refMsg?.conversation_id) {
        return refMsg.conversation_id;
      }
    }
  }

  // Strategy 3: Match by normalized subject + email account
  const normalizedSubject = normalizeSubject(email.subject);
  if (normalizedSubject) {
    const { data: subjectMatch } = await supabase
      .from("conversations")
      .select("id")
      .eq("email_account_id", accountId)
      .eq("subject", normalizedSubject)
      .gte(
        "last_message_at",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      )
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subjectMatch?.id) {
      return subjectMatch.id;
    }
  }

  // Strategy 4: Create new conversation
  const { data: newConvo, error } = await supabase
    .from("conversations")
    .insert({
      email_account_id: accountId,
      thread_id: email.messageId || `uid:${email.uid}`,
      subject: normalizedSubject || email.subject,
      from_name: email.fromName,
      from_email: email.fromEmail,
      preview: email.snippet,
      is_unread: true,
      status: "open",
      last_message_at: email.sentAt.toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(`Create conversation failed: ${error.message}`);

  // Newly created — apply [account, Inbox] auto-labels.
  // The caller passes the account.email so we can determine inbound vs outbound here.
  // Best-effort — never throws, so we don't bail the sync over a labeling issue.
  await onNewConversationFromSync(
    newConvo.id,
    accountId,
    isOutbound(email.fromEmail, accountEmail)
  );

  return newConvo.id;
}

// ── Helpers ──────────────────────────────────────────
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, "")
    .replace(/^(Re|Fwd|Fw|RE|FW|FWD)\[\d+\]:\s*/gi, "")
    .trim();
}

function isOutbound(fromEmail: string, accountEmail: string): boolean {
  return fromEmail.toLowerCase() === accountEmail.toLowerCase();
}

// ── Compute response time for latest message in a conversation ──
async function computeResponseTime(supabase: any, conversationId: string) {
  try {
    // Fetch conversation metadata
    const { data: convo } = await supabase
      .from("conversations")
      .select("id, email_account_id, assignee_id")
      .eq("id", conversationId)
      .single();
    if (!convo) return;

    // Fetch last few messages to find the response pair
    const { data: messages } = await supabase
      .from("messages")
      .select("id, from_email, is_outbound, sent_at, sent_by_user_id")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });

    if (!messages || messages.length < 2) return;

    const newMsg = messages[messages.length - 1];
    // Look backwards for the most recent message in the opposite direction
    let triggerMsg = null;
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].is_outbound !== newMsg.is_outbound) {
        triggerMsg = messages[i];
        break;
      }
    }
    if (!triggerMsg) return;

    const diffMinutes = (new Date(newMsg.sent_at).getTime() - new Date(triggerMsg.sent_at).getTime()) / (1000 * 60);
    if (diffMinutes <= 0 || diffMinutes > 30 * 24 * 60) return;

    // Check if this pair already exists
    const { data: existing } = await supabase
      .from("response_times")
      .select("id")
      .eq("trigger_message_id", triggerMsg.id)
      .eq("response_message_id", newMsg.id)
      .maybeSingle();
    if (existing) return;

    const supplierEmail = triggerMsg.is_outbound
      ? newMsg.from_email?.toLowerCase()
      : triggerMsg.from_email?.toLowerCase();
    const supplierDomain = supplierEmail ? supplierEmail.split("@")[1] || null : null;
    const direction = triggerMsg.is_outbound ? "supplier_reply" : "team_reply";
    const teamMemberId = direction === "team_reply"
      ? (newMsg.sent_by_user_id || convo.assignee_id || null)
      : null;

    await supabase.from("response_times").insert({
      conversation_id: conversationId,
      email_account_id: convo.email_account_id,
      direction,
      trigger_message_id: triggerMsg.id,
      trigger_sent_at: triggerMsg.sent_at,
      response_message_id: newMsg.id,
      response_sent_at: newMsg.sent_at,
      response_minutes: Math.round(diffMinutes * 10) / 10,
      response_business_minutes: null,
      supplier_email: supplierEmail || null,
      supplier_domain: supplierDomain || null,
      team_member_id: teamMemberId,
    });
  } catch (err: any) {
    // Non-critical — silently ignore
  }
}