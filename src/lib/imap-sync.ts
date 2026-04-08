import Imap from "imap";
import { simpleParser, ParsedMail } from "mailparser";
import { createServerClient } from "@/lib/supabase";
import { runRulesForMessage } from "@/lib/rule-engine";
import { refreshGoogleToken, buildXOAuth2Token } from "@/lib/google-oauth";

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
  gmailLabels: string[];
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
        console.log(`IMAP sync ${accountId}: using Gmail API for OAuth account`);

        // Fetch recent messages via Gmail API
        const sinceDate = account.last_sync_at
          ? new Date(account.last_sync_at)
          : (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d; })();
        const afterEpoch = Math.floor(sinceDate.getTime() / 1000);
        const query = `after:${afterEpoch}`;

        const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(query)}&maxResults=50`;
        const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
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

        // Fetch each message detail
        for (const msgId of messageIds) {
          try {
            // Check if already synced
            const { data: existing } = await supabase.from("messages")
              .select("id").eq("provider_message_id", `gmail:${msgId}`).maybeSingle();
            if (existing) continue;

            const msgUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=Message-ID`;
            const msgRes = await fetch(msgUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
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
            const snippet = msgData.snippet || "";
            const sentAt = headers.date ? new Date(headers.date).toISOString() : new Date(parseInt(msgData.internalDate)).toISOString();
            const hasAttachments = (msgData.payload?.parts || []).some((p: any) => p.filename && p.filename.length > 0);

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
            }

            await supabase.from("messages").insert({
              conversation_id: conversationId,
              provider_message_id: `gmail:${msgId}`,
              from_name: fromName, from_email: fromEmail,
              to_addresses: toAddresses, cc_addresses: ccAddresses,
              subject, body_text: snippet, body_html: null,
              snippet: snippet.slice(0, 200),
              is_outbound: isOutbound, has_attachments: hasAttachments,
              sent_at: sentAt,
            });

            await supabase.from("conversations").update({
              preview: snippet.slice(0, 200),
              last_message_at: sentAt,
              is_unread: !isOutbound,
            }).eq("id", conversationId);

            result.newMessages++;
          } catch (msgErr: any) {
            result.errors.push(msgErr.message);
          }
        }

        result.success = true;
        await supabase.from("email_accounts").update({
          last_sync_at: new Date().toISOString(),
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

    // 2. Connect to IMAP and fetch emails
    let emails: ParsedEmail[];
    try {
      emails = await fetchEmailsViaImap(acct);
      console.log(`IMAP sync ${accountId}: fetched ${emails.length} emails`);
    } catch (imapErr: any) {
      console.error(`IMAP sync ${accountId}: connection failed:`, imapErr.message);
      await supabase.from("email_accounts").update({ sync_error: imapErr.message }).eq("id", accountId);
      result.errors.push(imapErr.message);
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
          supabase, accountId, email
        );

        // Insert message
        const { error: msgError } = await supabase.from("messages").insert({
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
        });

        if (msgError) {
          result.errors.push(`Message ${email.uid}: ${msgError.message}`);
          continue;
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
            body_text: email.bodyText,
          }, triggerType);
        } catch (ruleErr: any) {
          console.error(`Rule engine error for ${email.uid}:`, ruleErr.message);
        }

        result.newMessages++;
        result.lastUid = Math.max(result.lastUid || 0, email.uid);
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

    imap.once("error", (err: Error) => {
      reject(new Error(`IMAP connection error: ${err.message}`));
    });

    imap.once("end", () => {});

    imap.once("error", (err: any) => {
      clearTimeout(timeout);
      console.error(`IMAP sync error for ${account.email}:`, err.message);
      reject(new Error(`IMAP connection error: ${err.message}`));
    });

    const timeout = setTimeout(() => {
      try { imap.end(); } catch {}
      reject(new Error("IMAP sync timed out (10s)"));
    }, 10000);

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
    hasAttachments: (parsed.attachments?.length || 0) > 0,
    gmailLabels: [],
  };
}

// ── Conversation threading ───────────────────────────
async function findOrCreateConversation(
  supabase: any,
  accountId: string,
  email: ParsedEmail
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

  return newConvo.id;
}

// ── Helpers ──────────────────────────────────────────
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, "")
    .replace(/^(Re|Fwd|Fw|RE|FW|FWD)\[\d+\]:\s*/gi, "")
    .trim();
}

}