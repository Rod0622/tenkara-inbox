import Imap from "imap";
import { simpleParser, ParsedMail } from "mailparser";
import { createServerClient } from "@/lib/supabase";
import { runRulesForMessage } from "@/lib/rule-engine";
import { refreshGoogleToken, buildXOAuth2Token } from "@/lib/google-oauth";
import { onNewConversationFromSync, onIncomingMessageReopenCheck } from "@/lib/folder-labels";
import { uploadAttachmentToStorage, type AttachmentUploadInput } from "@/lib/attachments-storage";
import { decodeEmailText, decodeEmailTextPreserveNewlines } from "@/lib/decode-email-text";
import { cleanSubject as cleanSubjectFn } from "@/lib/email";
import { mergeConversation } from "@/lib/merge-conversations";
import { ensureSupplierContact, loadInternalContext, extractFirstEmail, type InternalContext } from "@/lib/supplier-contact-resolver";
import { dispatchMessageReceivedWebhook } from "@/lib/api-token-webhook";

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

  // Load internal context once per sync run — used by every new-conversation
  // insert below to classify the supplier email correctly. Cheap (~few rows
  // from team_members + email_accounts) but doing this per-message would be
  // wasteful.
  const internalCtx: InternalContext = await loadInternalContext(supabase);

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

        // ── Window selection ─────────────────────────────────────
        // Incremental: use last_sync_at as the `after:` cutoff.
        // First sync (no last_sync_at): default to 365 days back. Old
        // default of 30 was too narrow for newly-added group inboxes
        // that had months of history — most messages would never be
        // pulled because the next sync would advance last_sync_at past
        // them. For accounts that need >1 year of history, use
        // `POST /api/admin/backfill-account` separately.
        const isFirstSync = !account.last_sync_at;
        const sinceDate = account.last_sync_at
          ? new Date(account.last_sync_at)
          : (() => { const d = new Date(); d.setDate(d.getDate() - 365); return d; })();
        const afterEpoch = Math.floor(sinceDate.getTime() / 1000);
        // `in:anywhere -in:trash` — by default Gmail's API excludes Spam and
        // Trash. That meant legitimate emails Gmail mis-classified as spam
        // (e.g., supplier auto-responders with token-style From addresses)
        // never reached Tenkara. We now include everything except Trash, and
        // route SPAM-labeled messages to Tenkara's Spam folder so users can
        // review them rather than lose them silently.
        const query = `after:${afterEpoch} in:anywhere -in:trash`;

        // ── Pagination ──────────────────────────────────────────
        // Incremental syncs (last_sync_at set): one page only. Catching
        // up is normally well within 100 messages; the next cron pass
        // grabs anything more.
        // First sync: paginate fully up to 2000 messages, so a freshly-
        // added inbox actually gets its year of history imported in one
        // pass instead of being silently truncated by the maxResults=100
        // ceiling. Beyond 2000, use the admin backfill endpoint.
        const FIRST_SYNC_CAP = 2000;
        let messageIds: string[] = [];
        let pageToken: string | undefined;
        do {
          const url =
            `https://gmail.googleapis.com/gmail/v1/users/me/messages` +
            `?q=${encodeURIComponent(query)}&maxResults=100` +
            (pageToken ? `&pageToken=${pageToken}` : "");
          const listRes = await fetch(url, { headers: { Authorization: `Bearer ${gmailToken}` } });
          if (!listRes.ok) {
            const err = await listRes.json().catch(() => ({}));
            throw new Error(`Gmail API list error: ${err.error?.message || listRes.statusText}`);
          }
          const listData = await listRes.json();
          const pageIds: string[] = (listData.messages || []).map((m: any) => m.id);
          messageIds.push(...pageIds);
          pageToken = listData.nextPageToken;
          // Only paginate on first sync. Stop once we hit cap or the
          // last page (no nextPageToken). Incremental sync always exits
          // after the first iteration regardless.
          if (!isFirstSync) break;
          if (messageIds.length >= FIRST_SYNC_CAP) break;
        } while (pageToken);

        if (isFirstSync && messageIds.length >= FIRST_SYNC_CAP) {
          console.log(
            `IMAP sync ${accountId}: first-sync cap hit (${FIRST_SYNC_CAP}); ` +
            `older messages need /api/admin/backfill-account`
          );
        }
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
            // has_attachments must capture: parts with a filename (regular files),
            // and parts that are nested forwarded emails (message/rfc822 — these
            // often have NO filename header). Without the rfc822 case, forwarded-
            // as-attachment emails get dropped silently.
            const hasAttachmentsCheck = (parts: any[]): boolean => {
              for (const p of parts) {
                if (p.filename && p.filename.length > 0) return true;
                const mt = String(p.mimeType || "").toLowerCase();
                if (mt === "message/rfc822") return true;
                if (Array.isArray(p.parts) && hasAttachmentsCheck(p.parts)) return true;
              }
              return false;
            };
            const hasAttachments = hasAttachmentsCheck(msgData.payload?.parts || []);

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
                    if (parsed.text) {
                      // Defensive HTML strip — malformed HTML emails can
                      // leak tag fragments into parsed.text, which then
                      // render as literal markup in the UI. See same
                      // strip logic in /api/messages/refresh-body.
                      extractedText = (parsed.text || "")
                        .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
                        .replace(/<br\s*\/?>/gi, "\n")
                        .replace(/<\/p\s*>/gi, "\n\n")
                        .replace(/<[^>]+>/g, " ");
                    }
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

            // Check Gmail labels.
            //   SPAM       → captured but routed to Tenkara's Spam folder (status="spam")
            //   PROMOTIONS → skipped (marketing noise)
            //   UPDATES    → CAPTURED (Rod's call: transactional emails like
            //                  supplier auto-responders from tenderapp.com /
            //                  Alibaba RFQ confirmations / order tracking are
            //                  business-critical. Previous filter was dropping
            //                  these silently — the PureBulk inquiry confirmations
            //                  that never showed up were CATEGORY_UPDATES.)
            //   SOCIAL     → CAPTURED (rare in B2B but harmless)
            //   FORUMS     → CAPTURED (rare in B2B but harmless)
            const labels: string[] = msgData.labelIds || [];
            const isSpam = labels.some((l: string) => l === "SPAM" || l.toLowerCase() === "spam");
            const isPromotions = labels.some((l: string) => l.toLowerCase().includes("promotions") || l === "CATEGORY_PROMOTIONS");
            // SPAM wins — capture spam-flagged messages even if also Promotional.
            if (!isSpam && isPromotions) continue;

            // Thread into conversation
            const cleanSubject = cleanSubjectFn(subject);
            let conversationId: string | null = null;

            // Match #1 — Gmail thread id (the reliable key). Gmail groups a real
            // email thread under one threadId regardless of how the subject
            // mutates (stacked "Re:"/"Fwd:" chains, foreign-language reply
            // prefixes like "回复：", edited subjects). Matching on subject alone
            // fragmented one thread into several conversations whenever the
            // subject drifted; threadId-first prevents that. Subject is only a
            // fallback for messages that arrive without a usable threadId.
            const gmailThreadId = msgData.threadId
              ? `gmail:${msgData.threadId}`
              : null;
            if (gmailThreadId) {
              const { data: t } = await supabase.from("conversations").select("id, merged_into")
                .eq("email_account_id", accountId).eq("thread_id", gmailThreadId)
                .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
              if (t) {
                conversationId = t.merged_into
                  ? await resolveMergedInto(supabase, t.merged_into)
                  : t.id;
              }
            }

            // Match #2 — cleaned-subject fallback (only if no threadId match).
            // GUARD: subject equality alone is NOT enough to thread a message
            // into an existing conversation. A different supplier can reply (or
            // be emailed) with a subject that equals another supplier's thread
            // subject (e.g. a quoted/forwarded "Re: <Company> …" line). Matching
            // on account+subject only would glue that foreign supplier's message
            // onto the wrong conversation — a cross-supplier leak. So before
            // attaching, require that the matched conversation already involves
            // THIS message's supplier (same sender/recipient email or domain).
            // If it doesn't, skip the subject match and fall through to create a
            // new conversation.
            if (!conversationId && cleanSubject) {
              const { data: c } = await supabase.from("conversations").select("id, merged_into, from_email, primary_contact_email")
                .eq("email_account_id", accountId).eq("subject", cleanSubject)
                .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
              if (c) {
                const candidateConvId = c.merged_into
                  ? await resolveMergedInto(supabase, c.merged_into)
                  : c.id;

                // The supplier for THIS message: sender for inbound, primary
                // recipient for outbound.
                const msgSupplierEmail = (
                  isOutbound ? extractFirstEmail(toAddresses) : fromEmail
                )?.toLowerCase() || "";
                const msgSupplierDomain = msgSupplierEmail.split("@")[1] || "";

                // Does the matched conversation already involve this supplier?
                // Check the conversation's own from_email/primary_contact_email,
                // and (authoritatively) whether any message in it is from/to
                // this supplier email or domain.
                let supplierConsistent = false;
                if (msgSupplierEmail) {
                  const convFromEmail = (c.from_email || "").toLowerCase();
                  const convPrimary = (c.primary_contact_email || "").toLowerCase();
                  if (
                    convFromEmail === msgSupplierEmail ||
                    convPrimary === msgSupplierEmail ||
                    (msgSupplierDomain &&
                      (convFromEmail.endsWith("@" + msgSupplierDomain) ||
                        convPrimary.endsWith("@" + msgSupplierDomain)))
                  ) {
                    supplierConsistent = true;
                  } else {
                    // Authoritative check: any message in the candidate
                    // conversation from/to this supplier email or domain.
                    const { data: existingMsgs } = await supabase
                      .from("messages")
                      .select("from_email, to_addresses")
                      .eq("conversation_id", candidateConvId)
                      .limit(200);
                    if (existingMsgs && existingMsgs.length > 0) {
                      supplierConsistent = existingMsgs.some((m: any) => {
                        const f = (m.from_email || "").toLowerCase();
                        const t = (m.to_addresses || "").toLowerCase();
                        if (f === msgSupplierEmail) return true;
                        if (msgSupplierEmail && t.includes(msgSupplierEmail)) return true;
                        if (msgSupplierDomain) {
                          if (f.endsWith("@" + msgSupplierDomain)) return true;
                          if (t.includes("@" + msgSupplierDomain)) return true;
                        }
                        return false;
                      });
                    } else {
                      // No messages yet (shell) — allow the match.
                      supplierConsistent = true;
                    }
                  }
                }

                if (supplierConsistent) {
                  conversationId = candidateConvId;
                } else {
                  console.warn(
                    "imap-sync: SKIPPED subject-match (different supplier) " +
                    "subject=" + JSON.stringify(cleanSubject) +
                    " candidate=" + candidateConvId +
                    " msgSupplier=" + msgSupplierEmail +
                    " — creating new conversation to avoid cross-supplier leak"
                  );
                }
              }
            }

            if (!conversationId) {
              // Resolve supplier_contact_id at conversation-create time.
              // For inbound messages, the supplier is the sender (fromEmail).
              // For outbound messages, the supplier is the primary recipient
              // (first email extracted from to_addresses).
              const supplierEmailForLookup = isOutbound
                ? extractFirstEmail(toAddresses)
                : fromEmail;
              const supplierContactId = await ensureSupplierContact(
                supabase,
                supplierEmailForLookup,
                isOutbound ? null : fromName,
                internalCtx
              );

              const { data: nc, error: ce } = await supabase.from("conversations").insert({
                email_account_id: accountId,
                thread_id: `gmail:${msgData.threadId || msgId}`,
                subject: cleanSubject || "(No Subject)",
                from_name: fromName, from_email: fromEmail,
                preview: snippet.slice(0, 200),
                is_unread: !isOutbound,
                // Spam-flagged messages create conversations with status="spam"
                // so they show up in Tenkara's virtual Spam folder rather than
                // the user's main inbox. Same column the "Mark as spam" button
                // uses today.
                status: isSpam ? "spam" : "open",
                last_message_at: sentAt,
                // Seed last_inbound_at when the FIRST message of a brand-new
                // conversation is inbound — otherwise the conversation would
                // misclassify as Sent until the next inbound reply arrives.
                last_inbound_at: !isOutbound ? sentAt : null,
                // Link to supplier_contacts (may be null if internal/transactional/noreply)
                supplier_contact_id: supplierContactId,
              }).select("id").single();
              if (ce) continue;
              conversationId = nc.id;
              result.newConversations++;

              // Auto-apply [account, Inbox] labels (or just [account] for outbound).
              // Best-effort — never throws. Use nc.id directly so TS narrows correctly.
              await onNewConversationFromSync(nc.id, accountId, isOutbound);
            }

            // Reconcile against locally-stored outbound messages.
            // When we send via /api/send, the message is stored locally with
            // provider_message_id = info.messageId (the RFC822 Message-ID). When
            // Gmail then syncs it back from the Sent folder, its API id is the
            // Gmail UID (different value). Without this check we'd insert a
            // duplicate. If we find a local row matching by Message-ID, we
            // upgrade its provider_message_id to gmail:<uid> instead of inserting.
            const rfc822 = (headers["message-id"] || "").trim();
            let reconciledMessageId: string | null = null;

            // Reconcile attempt #0: GLOBAL RFC822 Message-ID match across the
            // account. If a local outbound row exists with this Message-ID in
            // a DIFFERENT conversation than the one we just subject-matched,
            // that means /api/send created its own conversation (with a slightly
            // different subject) and sync's subject-match landed on yet another
            // one — i.e., we have a duplicate. Merge the two so the thread is
            // unified, then proceed in the canonical conversation.
            //
            // The canonical (primary) conversation is the one /api/send
            // created — it has the FULL outbound message context (recipients,
            // attachments, drafts, activity). The conversation found by
            // subject-match (which only has the inbound side so far) becomes
            // the duplicate to merge in.
            if (rfc822 && conversationId) {
              const { data: globalExisting } = await supabase
                .from("messages")
                .select("id, conversation_id, conversation:conversations(email_account_id)")
                .eq("provider_message_id", rfc822)
                .limit(5);
              const sameAccountMatch = (globalExisting || []).find((r: any) =>
                r?.conversation?.email_account_id === accountId
              );
              if (sameAccountMatch && sameAccountMatch.conversation_id !== conversationId) {
                // SAFETY GUARD (critical): an rfc822 Message-ID match is NOT
                // sufficient justification to merge two whole conversations.
                // Merging unrelated suppliers leaks confidential email between
                // them. Before merging, require that the two conversations are
                // genuinely the same thread: same supplier contact, OR matching
                // cleaned subject. If neither holds, we DO NOT merge — a stray
                // duplicate message is far less harmful than a cross-supplier leak.
                const [primaryConvoRes, dupConvoRes] = await Promise.all([
                  supabase.from("conversations")
                    .select("id, supplier_contact_id, subject, from_email")
                    .eq("id", sameAccountMatch.conversation_id).maybeSingle(),
                  supabase.from("conversations")
                    .select("id, supplier_contact_id, subject, from_email")
                    .eq("id", conversationId).maybeSingle(),
                ]);
                const pc: any = primaryConvoRes.data;
                const dc: any = dupConvoRes.data;

                const sameSupplier =
                  !!pc && !!dc &&
                  ((pc.supplier_contact_id && dc.supplier_contact_id &&
                    pc.supplier_contact_id === dc.supplier_contact_id) ||
                   (pc.from_email && dc.from_email &&
                    pc.from_email.toLowerCase() === dc.from_email.toLowerCase()));

                const sameSubject =
                  !!pc && !!dc &&
                  cleanSubjectFn(pc.subject || "") !== "" &&
                  cleanSubjectFn(pc.subject || "") === cleanSubjectFn(dc.subject || "");

                const safeToMerge = sameSupplier || sameSubject;

                if (!safeToMerge) {
                  // Conversations are not demonstrably the same thread. Skip the
                  // merge to avoid a cross-supplier leak. Keep working in the
                  // subject-matched conversation (the reconcile below still
                  // upgrades the local outbound row's id if applicable).
                  console.warn(
                    "imap-sync: SKIPPED unsafe auto-merge (different supplier/subject) " +
                    "primary=" + sameAccountMatch.conversation_id +
                    " dup=" + conversationId +
                    " primarySupplier=" + (pc?.supplier_contact_id || "?") +
                    " dupSupplier=" + (dc?.supplier_contact_id || "?")
                  );
                } else {
                // The local outbound row lives in a different conversation.
                // Treat that conversation as canonical (it has the send-side
                // context); merge the subject-matched conversation into it.
                try {
                  const mergeRes = await mergeConversation(
                    supabase,
                    sameAccountMatch.conversation_id, // primary
                    conversationId,                   // duplicate (subject-match result)
                    null                              // system-initiated, no actor
                  );
                  if (mergeRes.success) {
                    // Continue work in the canonical conversation. All
                    // subsequent inserts/updates target that one.
                    conversationId = sameAccountMatch.conversation_id;
                    reconciledMessageId = sameAccountMatch.id;
                    // Upgrade the local outbound row's provider_message_id
                    // to the Gmail UID now that we've matched it.
                    await supabase
                      .from("messages")
                      .update({
                        provider_message_id: `gmail:${msgId}`,
                        body_html: bodyHtml || undefined,
                        body_text: bodyText.slice(0, 5000) || undefined,
                        has_attachments: hasAttachments,
                      })
                      .eq("id", sameAccountMatch.id);
                  } else if (mergeRes.error) {
                    console.warn(`[sync-merge] could not merge ${conversationId} -> ${sameAccountMatch.conversation_id}: ${mergeRes.error}`);
                  }
                } catch (mergeErr: any) {
                  console.error(`[sync-merge] exception: ${mergeErr?.message}`);
                }
                } // end else (safeToMerge)
              }
            }

            // Reconcile attempt #1: exact RFC822 Message-ID match within
            // the current conversation. Only runs if attempt #0 didn't
            // already reconcile (which would happen when the local outbound
            // was in a different conversation that we just merged).
            if (!reconciledMessageId && rfc822) {
              const { data: existingLocal } = await supabase
                .from("messages")
                .select("id")
                .eq("conversation_id", conversationId)
                .eq("provider_message_id", rfc822)
                .maybeSingle();
              if (existingLocal?.id) {
                await supabase
                  .from("messages")
                  .update({
                    provider_message_id: `gmail:${msgId}`,
                    body_html: bodyHtml || undefined,
                    body_text: bodyText.slice(0, 5000) || undefined,
                    has_attachments: hasAttachments,
                  })
                  .eq("id", existingLocal.id);
                reconciledMessageId = existingLocal.id;
              }
            }

            // Reconcile attempt #2: content-fingerprint fallback for outbound
            // messages whose locally-stored row used a non-RFC822 id (e.g.
            // "sent:<timestamp>"). Match by (conversation, our-account-as-from,
            // subject, is_outbound) and sent_at within ±5 minutes of the synced
            // message. This catches duplicates regardless of the local id format.
            if (!reconciledMessageId && isOutbound) {
              const windowMs = 5 * 60 * 1000;
              const lo = new Date(new Date(sentAt).getTime() - windowMs).toISOString();
              const hi = new Date(new Date(sentAt).getTime() + windowMs).toISOString();
              const { data: candidates } = await supabase
                .from("messages")
                .select("id, provider_message_id")
                .eq("conversation_id", conversationId)
                .eq("is_outbound", true)
                .eq("subject", subject)
                .ilike("from_email", account.email)
                .gte("sent_at", lo)
                .lte("sent_at", hi)
                .limit(5);
              // Prefer a candidate whose provider_message_id does NOT already
              // start with "gmail:" (i.e. a local synthetic id) — that's the
              // pre-sync version we want to upgrade.
              const local = (candidates || []).find((r: any) =>
                !String(r.provider_message_id || "").startsWith("gmail:"));
              if (local?.id) {
                await supabase
                  .from("messages")
                  .update({
                    provider_message_id: `gmail:${msgId}`,
                    body_html: bodyHtml || undefined,
                    body_text: bodyText.slice(0, 5000) || undefined,
                    has_attachments: hasAttachments,
                  })
                  .eq("id", local.id);
                reconciledMessageId = local.id;
              }
            }

            let insertedGmailMsg: { id: string } | null = null;
            let gmailInsertErr: any = null;
            if (reconciledMessageId) {
              insertedGmailMsg = { id: reconciledMessageId };
            } else {
              const ins = await supabase.from("messages").insert({
                conversation_id: conversationId,
                provider_message_id: `gmail:${msgId}`,
                from_name: fromName, from_email: fromEmail,
                to_addresses: toAddresses, cc_addresses: ccAddresses,
                subject, body_text: bodyText.slice(0, 5000), body_html: bodyHtml,
                snippet: snippet.slice(0, 200),
                is_outbound: isOutbound, has_attachments: hasAttachments,
                sent_at: sentAt,
              }).select("id").single();
              insertedGmailMsg = ins.data;
              gmailInsertErr = ins.error;
            }

            if (gmailInsertErr || !insertedGmailMsg) {
              result.errors.push(`Gmail message ${msgId}: ${gmailInsertErr?.message || "insert failed"}`);
              continue;
            }
            // Phase 3 — agent reply loop. For NEW inbound messages (i.e. not
            // a reconciliation of a previously-stored local outbound), fire
            // message.received so any agent involved in the conversation can
            // compose a reply. The webhook side filters to convs that have
            // current/sent agent drafts, so this is a cheap no-op for the
            // vast majority of inbound traffic. Fire-and-forget.
            // (conversationId is typed `string | null` here from the find-or-
            // create flow; by this point a message insert has already
            // succeeded with it, so it cannot be null in practice — narrow
            // explicitly to keep TypeScript happy.)
            if (!reconciledMessageId && !isOutbound && conversationId) {
              dispatchMessageReceivedWebhook({
                conversationId,
                messageId: insertedGmailMsg.id,
                fromEmail,
                fromName,
                subject,
                bodyText: bodyText.slice(0, 5000),
                bodyHtml,
                receivedAt: sentAt,
              }).catch((e) => console.error("[gmail-sync] agent webhook failed:", e?.message));
            }

            // Reopen rule: if this inbound message landed on an existing
            // CLOSED conversation, reopen it (and auto-assign to the last
            // closer if it's unassigned and was closed within 3 business
            // days). Self-guards on status==="closed", so it's a cheap no-op
            // for the common open/new-conversation case. Best-effort.
            if (!isOutbound && conversationId) {
              await onIncomingMessageReopenCheck(conversationId, isOutbound);
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
                //
                // message/rfc822 = a nested email (Gmail "Forward as
                // attachment", inline forwards, etc). These often have NO
                // filename header — Gmail's web UI invents one on download.
                // We allow them through and synthesize a filename below.
                const isBodyText = mime === "text/plain" || mime === "text/html";
                const isNestedEmail = mime === "message/rfc822";
                if (!isBodyText && hasBytes && (payload.filename || isNestedEmail || mime.startsWith("image/") || mime.startsWith("application/"))) {
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
                  // Gmail "Forward as attachment" sends message/rfc822 parts
                  // with no filename — invent one from the nested Subject header
                  // when possible, fall back to "forwarded-message.eml".
                  const fallbackName = (() => {
                    const mt = String(p.mimeType || "").toLowerCase();
                    if (mt === "message/rfc822") {
                      // Walk the nested part's headers for a Subject. Gmail
                      // exposes them in p.parts[0].headers for the inner
                      // RFC822 part — check both top-level and nested headers.
                      const findSubject = (node: any): string | null => {
                        const hdrs: any[] = node?.headers || [];
                        const subj = hdrs.find((h) => h.name?.toLowerCase() === "subject")?.value;
                        if (subj) return subj;
                        if (Array.isArray(node?.parts)) {
                          for (const child of node.parts) {
                            const found = findSubject(child);
                            if (found) return found;
                          }
                        }
                        return null;
                      };
                      const subj = findSubject(p);
                      // Sanitize for filesystem: remove / \ : * ? " < > | and trim
                      const safe = (subj || "forwarded-message")
                        .replace(/[\/\\:*?"<>|\r\n]+/g, "")
                        .trim()
                        .slice(0, 100);
                      return `${safe || "forwarded-message"}.eml`;
                    }
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

            // Build the conversation update. For INBOUND messages we ALSO
            // set last_inbound_at — this is what flips a previously-outbound
            // conversation back into the Inbox view. The sidebar's isOutbound
            // check treats `last_inbound_at IS NULL` as "still sent-only".
            const convoUpdate: any = {
              preview: snippet.slice(0, 200),
              last_message_at: sentAt,
              is_unread: !isOutbound,
            };
            if (!isOutbound) {
              convoUpdate.last_inbound_at = sentAt;

              // ── Auto-update primary contact (when in auto mode) ──
              // The primary_contact line shown under the conversation subject
              // tracks the latest external sender. Skip if:
              //   - the conversation has been manually locked
              //   - the sender's email matches one of our connected accounts
              //     (would mean we replied to ourselves)
              //   - the sender's email matches a team_members row
              //
              // We check current mode + accounts/team_members inline here.
              // It's an extra small query but it keeps the auto-update logic
              // co-located with the inbound flag we already have.
              try {
                const { data: convoState } = await supabase
                  .from("conversations")
                  .select("primary_contact_is_manual")
                  .eq("id", conversationId)
                  .maybeSingle();
                if (!convoState?.primary_contact_is_manual) {
                  const lowerFrom = (fromEmail || "").toLowerCase();
                  // Check if sender is our own account or a team member.
                  // These are small lookups against tiny tables; not a concern.
                  const { data: ownAcct } = await supabase
                    .from("email_accounts")
                    .select("id")
                    .eq("email", lowerFrom)
                    .maybeSingle();
                  let isInternal = !!ownAcct;
                  if (!isInternal) {
                    const { data: teamMember } = await supabase
                      .from("team_members")
                      .select("id")
                      .eq("email", lowerFrom)
                      .maybeSingle();
                    isInternal = !!teamMember;
                  }
                  if (!isInternal && lowerFrom && lowerFrom !== "internal") {
                    convoUpdate.primary_contact_name = fromName || lowerFrom.split("@")[0];
                    convoUpdate.primary_contact_email = lowerFrom;
                  }
                }
              } catch (e: any) {
                // Best-effort — don't block the message insert if this fails.
                console.error("[primary-contact auto-update]", e?.message);
              }

              // If the conversation is currently sitting in the system Sent
              // folder (because /api/send put it there), move it to the
              // account's INBOX folder. We can't just set folder_id=null —
              // ConversationList's unassigned-view filter requires a strict
              // `folder_id === activeFolder` match, and rows with NULL get
              // rejected even though page.tsx's filter would accept them.
              // Custom folder placements are NOT touched.
              const { data: convoRow } = await supabase
                .from("conversations")
                .select("folder_id, folder:folders(is_system, name)")
                .eq("id", conversationId)
                .maybeSingle();
              const folder: any = (convoRow as any)?.folder;
              const isInSentSystemFolder =
                folder && folder.is_system === true &&
                String(folder.name || "").toLowerCase() === "sent";
              if (isInSentSystemFolder) {
                // Look up this account's Inbox folder id.
                const { data: inboxFolder } = await supabase
                  .from("folders")
                  .select("id")
                  .eq("email_account_id", accountId)
                  .eq("is_system", true)
                  .ilike("name", "inbox")
                  .maybeSingle();
                if (inboxFolder?.id) {
                  convoUpdate.folder_id = inboxFolder.id;
                } else {
                  // No Inbox folder for this account (shouldn't happen,
                  // but fail safe: clear folder_id rather than leaving
                  // it stuck in Sent).
                  convoUpdate.folder_id = null;
                }
              }
            }
            await supabase.from("conversations").update(convoUpdate).eq("id", conversationId);

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
        // Phase 3 — agent reply loop. Fire message.received for new inbound
        // IMAP messages. The webhook side filters to convs with agent
        // involvement, so this is a no-op for non-agent convs.
        if (!isOutbound(email.fromEmail, account.email)) {
          dispatchMessageReceivedWebhook({
            conversationId,
            messageId: insertedMsg.id,
            fromEmail: email.fromEmail,
            fromName: email.fromName,
            subject: email.subject,
            bodyText: email.bodyText,
            bodyHtml: email.bodyHtml,
            receivedAt: email.sentAt.toISOString(),
          }).catch((e) => console.error("[imap-sync] agent webhook failed:", e?.message));
        }

        // Reopen rule: inbound message on an existing CLOSED conversation
        // reopens it (auto-assign to last closer if unassigned & closed within
        // 3 business days). Self-guards on status==="closed". Best-effort.
        if (!isOutbound(email.fromEmail, account.email)) {
          await onIncomingMessageReopenCheck(conversationId, false);
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
          // Initial sync: fetch the last 365 days (was 30). 30 days silently
          // truncated history for mailboxes added long after their mail
          // arrived. We page through the rest oldest-first across successive
          // cron runs (see fetchUids below), so the window can be wide.
          const since = new Date();
          since.setDate(since.getDate() - 365);
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

          // Filter out UIDs we've already seen, then sort ascending so the
          // oldest-first slice below is guaranteed regardless of the order the
          // IMAP server returned search results in.
          const newUids = (lastUid > 0 ? uids.filter((u) => u > lastUid) : uids)
            .slice()
            .sort((a, b) => a - b);
          if (newUids.length === 0) {
            imap.end();
            return resolve([]);
          }

          // Batch selection.
          //   • Incremental (lastUid > 0): take the newest 100 of whatever is
          //     newer than our high-water mark — recent mail, as before.
          //   • First sync (lastUid === 0): take the OLDEST 150 within the
          //     365-day window. Oldest-first is deliberate: the caller advances
          //     last_sync_uid to the highest UID it fetched, so taking the
          //     oldest chunk lets the high-water mark walk *forward* through
          //     history over successive cron runs (150/run) until it reaches
          //     present. Taking the newest chunk instead would seal off every
          //     older message permanently — the original truncation bug.
          //     150 keeps both the IMAP fetch and the per-message downstream
          //     work (insert + attachments + rules + response-time) inside the
          //     function budget; larger batches risk re-introducing a timeout.
          const fetchUids =
            lastUid > 0 ? newUids.slice(-100) : newUids.slice(0, 150);

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

  // Defensive HTML strip — see /api/messages/refresh-body for rationale.
  // Malformed HTML emails can leak tag fragments into parsed.text.
  const rawBodyText = parsed.text || "";
  const bodyText = rawBodyText
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ");
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
// Resolve a conversation ID through the merged_into chain. If conv X has
// merged_into = Y, return Y. If Y is also merged into Z, return Z. Etc.
// Caps at 5 hops to defend against pathological cycles (shouldn't happen
// but cheap insurance). Returns the input id unchanged if no chain.
//
// This MUST be called whenever we match a conversation from history (by
// In-Reply-To, References, or subject) so that incoming messages on a
// merged thread go to the surviving primary, not the empty shell.
async function resolveMergedInto(supabase: any, conversationId: string): Promise<string> {
  let current = conversationId;
  for (let hops = 0; hops < 5; hops++) {
    const { data } = await supabase
      .from("conversations")
      .select("merged_into")
      .eq("id", current)
      .maybeSingle();
    if (!data?.merged_into) return current;
    current = data.merged_into;
  }
  return current;
}

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
    if (existingMsg?.conversation_id) {
      // Walk merged_into chain so incoming messages land on the surviving
      // primary, not the empty shell of a merged conversation.
      return resolveMergedInto(supabase, existingMsg.conversation_id);
    }
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
        return resolveMergedInto(supabase, refMsg.conversation_id);
      }
    }
  }

  // Strategy 3: Match by normalized subject + email account + SENDER.
  //
  // CRITICAL: this also requires from_email to match. Without that check,
  // two completely different suppliers sending the same generic subject
  // (e.g. "Customer account confirmation" auto-sent by Shopify and similar
  // e-commerce platforms) would get folded into the same conversation,
  // making the thread show messages from multiple unrelated companies.
  //
  // The normal case (a supplier replying to a previous thread) goes through
  // Strategy 1 or 2 thanks to In-Reply-To / References headers. Strategy 3
  // is only for mail systems that strip those headers — and there the
  // strongest available signal of "same conversation" is "same sender +
  // same subject", not subject alone.
  const normalizedSubject = normalizeSubject(email.subject);
  if (normalizedSubject && email.fromEmail) {
    const { data: subjectMatch } = await supabase
      .from("conversations")
      .select("id, merged_into")
      .eq("email_account_id", accountId)
      .eq("subject", normalizedSubject)
      .eq("from_email", email.fromEmail.toLowerCase())
      .gte(
        "last_message_at",
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      )
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (subjectMatch?.id) {
      // If the subject-matched conversation was itself merged into another,
      // walk to the primary. Strategy 3 should never resurrect an empty shell.
      if (subjectMatch.merged_into) {
        return resolveMergedInto(supabase, subjectMatch.merged_into);
      }
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
  // Delegate to the canonical helper in @/lib/email. Previously this was
  // a single-pass strip that left "Re: Re: ..." chains intact, which
  // contributed to duplicate-conversation bugs.
  return cleanSubjectFn(subject);
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