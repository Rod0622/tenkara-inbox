// ═══════════════════════════════════════════════════════
// TENKARA INBOX — Email Library (IMAP/SMTP)
// Standalone email client — no Gmail API dependency
// ═══════════════════════════════════════════════════════

import Imap from "imap";
import { simpleParser, ParsedMail } from "mailparser";
import nodemailer from "nodemailer";
import { createServerClient } from "@/lib/supabase";

export interface MailboxCredentials {
  id: string;
  email: string;
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_password: string;
  imap_tls: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string | null;
  smtp_password: string | null;
  smtp_tls: boolean;
  last_uid: string | null;
}

export interface ParsedEmail {
  uid: string;
  messageId: string;
  inReplyTo: string | null;
  references: string | null;
  fromName: string;
  fromEmail: string;
  to: string;
  cc: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  snippet: string;
  date: Date;
  hasAttachments: boolean;
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    content: Buffer;
  }>;
}

// ── Fetch emails via IMAP ────────────────────────────
export async function fetchEmails(
  creds: MailboxCredentials,
  limit: number = 50,
  sinceUid?: string
): Promise<ParsedEmail[]> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: creds.imap_user,
      password: creds.imap_password,
      host: creds.imap_host,
      port: creds.imap_port,
      tls: creds.imap_tls,
      tlsOptions: { rejectUnauthorized: false },
    });

    const emails: ParsedEmail[] = [];

    imap.once("ready", () => {
      imap.openBox("INBOX", true, (err, box) => {
        if (err) { imap.end(); return reject(err); }

        // Fetch recent messages (or since last UID)
        const fetchRange = sinceUid
          ? `${parseInt(sinceUid) + 1}:*`
          : `${Math.max(1, box.messages.total - limit + 1)}:*`;

        const fetch = imap.seq.fetch(fetchRange, {
          bodies: "",
          struct: true,
        });

        fetch.on("message", (msg, seqno) => {
          let uid = "";

          msg.on("attributes", (attrs) => {
            uid = String(attrs.uid);
          });

          msg.on("body", (stream) => {
            let buffer = "";
            stream.on("data", (chunk: Buffer) => { buffer += chunk.toString(); });
            stream.on("end", async () => {
              try {
                const parsed = await simpleParser(buffer);
                const fromAddr = parsed.from?.value?.[0];
                const toAddrs = parsed.to
                  ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to])
                      .flatMap((t) => t.value.map((v) => v.address))
                      .join(", ")
                  : "";
                const ccAddrs = parsed.cc
                  ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc])
                      .flatMap((t) => t.value.map((v) => v.address))
                      .join(", ")
                  : "";

                const bodyText = parsed.text || "";
                // Sanitize/cap stored HTML (strip base64 inline images) — see
                // sanitizeBodyHtml below. The outbound send path (mailOptions.html)
                // is intentionally NOT sanitized, so recipients still get images.
                const bodyHtml = sanitizeBodyHtml(parsed.html || "") || "";

                emails.push({
                  uid,
                  messageId: parsed.messageId || "",
                  inReplyTo: parsed.inReplyTo || null,
                  references: Array.isArray(parsed.references)
                    ? parsed.references.join(" ")
                    : parsed.references || null,
                  fromName: fromAddr?.name || fromAddr?.address || "Unknown",
                  fromEmail: fromAddr?.address || "",
                  to: toAddrs,
                  cc: ccAddrs,
                  subject: parsed.subject || "(no subject)",
                  bodyText,
                  bodyHtml,
                  snippet: bodyText.replace(/\s+/g, " ").trim().slice(0, 200),
                  date: parsed.date || new Date(),
                  hasAttachments: (parsed.attachments?.length || 0) > 0,
                  attachments: (parsed.attachments || []).map((att) => ({
                    filename: att.filename || "attachment",
                    contentType: att.contentType || "application/octet-stream",
                    size: att.size || 0,
                    content: att.content,
                  })),
                });
              } catch (parseErr) {
                console.error("Failed to parse email:", parseErr);
              }
            });
          });
        });

        fetch.once("error", (err) => {
          console.error("IMAP fetch error:", err);
        });

        fetch.once("end", () => {
          imap.end();
          resolve(emails.sort((a, b) => a.date.getTime() - b.date.getTime()));
        });
      });
    });

    imap.once("error", (err: Error) => {
      reject(err);
    });

    imap.connect();
  });
}

// ── Send email via SMTP ──────────────────────────────
export async function sendEmail(
  creds: MailboxCredentials,
  to: string,
  subject: string,
  bodyText: string,
  bodyHtml?: string,
  inReplyTo?: string,
  references?: string
) {
  const transporter = nodemailer.createTransport({
    host: creds.smtp_host,
    port: creds.smtp_port,
    secure: creds.smtp_port === 465,
    auth: {
      user: creds.smtp_user || creds.imap_user,
      pass: creds.smtp_password || creds.imap_password,
    },
    tls: { rejectUnauthorized: false },
  });

  const mailOptions: any = {
    from: `"${creds.email.split("@")[0]}" <${creds.email}>`,
    to,
    subject,
    text: bodyText,
  };

  if (bodyHtml) mailOptions.html = bodyHtml;
  if (inReplyTo) mailOptions.inReplyTo = inReplyTo;
  if (references) mailOptions.references = references;

  const result = await transporter.sendMail(mailOptions);
  return result;
}

// ── Thread emails by References/In-Reply-To ──────────
export function computeThreadKey(
  subject: string,
  messageId: string,
  inReplyTo: string | null,
  references: string | null
): string {
  // If we have references, use the first one (root message)
  if (references) {
    const refs = references.split(/\s+/);
    if (refs.length > 0) return refs[0];
  }
  // If replying to something, use that as thread key
  if (inReplyTo) return inReplyTo;
  // Otherwise, normalize subject as thread key
  const normalizedSubject = cleanSubject(subject).toLowerCase();
  return `subject:${normalizedSubject}`;
}

/**
 * cleanSubject — strip ALL leading reply/forward prefixes recursively.
 *
 * Email subjects accumulate prefixes through reply chains:
 *   "Inquiry for X"             — original
 *   "Re: Inquiry for X"         — first reply
 *   "Re: Re: Inquiry for X"     — counter-reply (some clients)
 *   "Fw: Re: Inquiry for X"     — forwarded reply
 *   "Fwd: Re: Re: Inquiry for X" — etc.
 *
 * A SINGLE-PASS strip would leave "Re: Re: ..." or "Fw: Re: ..." behind,
 * which then doesn't match the canonical subject. That's why we kept
 * seeing duplicate conversations: sync used a single-pass strip, /api/send
 * used a different (Re:-only) strip, and they produced different keys.
 *
 * Recursive strip handles every layered case. Also normalizes numbered
 * prefixes some mailers add — e.g. "Re[2]:" — for parity with sync's
 * older regex on line 1217.
 */
export function cleanSubject(raw: string): string {
  if (!raw) return "";
  let s = String(raw);
  // English reply/forward prefixes, e.g. "Re:", "Fwd:", "RE[2]:".
  const prefixRe = /^(Re|Fwd|Fw|RE|FW|FWD)(\[\d+\])?:\s*/i;
  // CJK reply/forward prefixes commonly seen from Chinese/Japanese/Korean
  // suppliers, e.g. "回复：" (reply), "答复：", "回覆：", "转发：" / "轉發："
  // (forward), "RE：" with a full-width colon. Without stripping these, each
  // reply produced a different cleaned subject and fragmented the thread.
  // Matches both full-width (：) and half-width (:) colons.
  const cjkPrefixRe = /^(回复|回複|回覆|答复|答覆|转发|轉發|轉发|轉寄|轉傳|回信)\s*[:：]\s*/;
  // Loop in case of multiple stacked prefixes ("Re: Fwd: Re: ...",
  // "回复：回复：..."). Bounded at 40 iterations for deeply-stacked input.
  for (let i = 0; i < 40; i++) {
    const next = s.replace(prefixRe, "").replace(cjkPrefixRe, "");
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

// ── Get mailbox credentials from Supabase ────────────
export async function getMailboxCredentials(mailboxId: string): Promise<MailboxCredentials | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("mailboxes")
    .select("*")
    .eq("id", mailboxId)
    .single();

  if (error || !data) return null;
  return data as MailboxCredentials;
}

// ── Get all active mailboxes ─────────────────────────
export async function getAllMailboxes(): Promise<MailboxCredentials[]> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("mailboxes")
    .select("*")
    .eq("sync_enabled", true);

  return (data || []) as MailboxCredentials[];
}
// ── Sanitize/cap email HTML before storage ───────────────────────────
// Why: the `messages.body_html` column was stored uncapped, and emails with
// base64-embedded inline images (data:image/...;base64,<huge>) ballooned the
// table to ~8 GB of TOAST across ~37k rows. That bloated every Realtime
// broadcast of a message row and pinned memory on the small instance.
//
// This strips base64 data-URIs (the main bloat source) down to a tiny
// placeholder and applies a hard length cap as a backstop. Inline images are
// still delivered to recipients on the OUTBOUND path (we don't sanitize what
// we send); this only affects what we STORE for synced/displayed mail, where a
// multi-MB base64 blob adds no readable value over a placeholder.
//
// Conservative by design: it only touches data: URIs and an overall size cap,
// leaving normal HTML (formatting, linked <img src="https://...">, text)
// untouched so the stored message still renders meaningfully.
const MAX_BODY_HTML_CHARS = 200000; // ~200 KB cap; normal emails are far smaller

export function sanitizeBodyHtml(html: string | null | undefined): string | null {
  if (html == null) return null;
  let out = String(html);

  // 1) Replace base64 data-URIs (images, fonts, etc.) with a 1x1 placeholder.
  //    Matches: data:<mime>;base64,<payload up to the closing quote/paren/space>
  //    This is where the multi-MB bloat lives.
  out = out.replace(
    /data:[a-zA-Z0-9.+/-]+;base64,[A-Za-z0-9+/=\s]+/g,
    "data:image/gif;base64,R0lGODlhAQABAAAAACwAAAAAAQABAAA=" // transparent 1x1
  );

  // 2) Backstop: hard length cap. After base64 removal almost everything fits
  //    well under the cap; this only catches pathological non-base64 bloat.
  if (out.length > MAX_BODY_HTML_CHARS) {
    out = out.slice(0, MAX_BODY_HTML_CHARS) +
      "\n<!-- [Tenkara: body truncated for storage] -->";
  }

  return out;
}