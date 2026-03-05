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
                const bodyHtml = parsed.html || "";

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
  const normalizedSubject = subject
    .replace(/^(Re|Fwd|Fw):\s*/gi, "")
    .trim()
    .toLowerCase();
  return `subject:${normalizedSubject}`;
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
