import Imap from "imap";
import { simpleParser } from "mailparser";
import { uploadAttachmentToStorage } from "@/lib/attachments-storage";

// ─── IMAP attachment backfill helper ────────────────────────────────────────
//
// Opens a single IMAP connection for an account and re-fetches the raw bodies
// of a batch of messages (identified by their IMAP UIDs), extracting and
// uploading their attachments to Supabase Storage.
//
// Why this exists:
//   The original imap-sync.ts captures attachments live as new mail arrives.
//   But for messages already in the database from BEFORE attachment storage
//   shipped, we need a way to retroactively pull their attachment bytes.
//   For Gmail OAuth accounts that were synced via the Gmail API path, we
//   can use the Gmail API. For everything else with an IMAP UID
//   (provider_message_id format "{accountId}:{uid}"), we re-open IMAP and
//   `UID FETCH` the raw body to re-parse.
//
// Authentication priority:
//   1. xoauth2Token (Google OAuth → pre-built SASL XOAUTH2 string) —
//      preferred, since App Passwords get invalidated when OAuth is set up
//      on the account. Per node-imap's documented config, the `xoauth2`
//      field takes the BASE64-ENCODED SASL string, NOT the raw access
//      token. Use buildXOAuth2Token(email, accessToken) to produce it.
//   2. imap_password (legacy App Password) — fallback only.
//   The route handler is responsible for refreshing the OAuth access token,
//   building the SASL string, and passing it as `xoauth2Token`.
//
// Connection lifecycle:
//   • One IMAP connection per chunk of work (don't reconnect per message)
//   • All UIDs fetched in a single search/fetch cycle when possible
//   • A connect/auth watchdog forces close if the server hangs mid-handshake
//     (rather than letting Vercel hit its 300s function ceiling)
//   • Connection always closed before the helper returns
// ────────────────────────────────────────────────────────────────────────────

export interface ImapAccount {
  id: string;
  email: string;
  imap_host: string | null;
  imap_port?: number | null;
  imap_user?: string | null;
  imap_password: string | null;
  imap_tls?: boolean | null;
  // The pre-built base64-encoded SASL XOAUTH2 string (NOT the raw access
  // token). When set, takes precedence over imap_password.
  //
  // Build it via buildXOAuth2Token(email, accessToken), which produces:
  //   base64("user=" + email + "\x01auth=Bearer " + accessToken + "\x01\x01")
  xoauth2Token?: string | null;
}

export interface ImapBackfillRequest {
  accountId: string;
  messages: { messageRowId: string; uid: number }[];  // DB UUID + IMAP UID
}

export interface ImapBackfillResult {
  // Indexed by DB messageRowId.
  // 'ok'        — message walked, attachments processed (or none found)
  // 'not_found' — UID no longer exists on the server (message was deleted)
  // 'error'     — fetch or parse failed; details in `errorReasons[messageRowId]`
  status: Record<string, "ok" | "not_found" | "error">;
  errorReasons: Record<string, string>;
  // Aggregated stats so callers don't have to recompute.
  uploadedCount: number;
  skippedCount: number;
}

/**
 * Open one IMAP connection, fetch the listed UIDs, parse their attachments,
 * and upload to Supabase Storage. Returns per-message status and
 * aggregated counts.
 *
 * Errors are NEVER thrown — every failure mode maps to an entry in the
 * returned `status` / `errorReasons` so the caller (the backfill route's
 * main loop) can keep going on the next message.
 */
export async function backfillAttachmentsViaImap(
  supabase: any,
  account: ImapAccount,
  request: ImapBackfillRequest,
): Promise<ImapBackfillResult> {
  const result: ImapBackfillResult = {
    status: {},
    errorReasons: {},
    uploadedCount: 0,
    skippedCount: 0,
  };

  if (request.messages.length === 0) return result;
  if (!account.xoauth2Token && !account.imap_password) {
    console.warn("[imap-backfill] no credentials on account", account.email);
    for (const m of request.messages) {
      result.status[m.messageRowId] = "error";
      result.errorReasons[m.messageRowId] = "Account has neither XOAUTH2 nor IMAP password";
    }
    return result;
  }

  console.log("[imap-backfill] starting", {
    account: account.email,
    host: account.imap_host,
    port: account.imap_port || 993,
    user: account.imap_user || account.email,
    tls: account.imap_tls !== false,
    authMethod: account.xoauth2Token ? "xoauth2" : "password",
    messageCount: request.messages.length,
    firstFewUids: request.messages.slice(0, 3).map((m) => m.uid),
  });

  // Build a lookup so we can map UID → messageRowId quickly during fetch.
  const uidToRowId = new Map<number, string>();
  for (const m of request.messages) uidToRowId.set(m.uid, m.messageRowId);
  const allUids = request.messages.map((m) => m.uid);

  return new Promise<ImapBackfillResult>((resolve) => {
    let resolved = false;
    let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (handshakeTimer) clearTimeout(handshakeTimer);
      try { imap.end(); } catch { /* already closed */ }
      // Fill in 'not_found' for any UIDs we never heard back about.
      for (const m of request.messages) {
        if (!result.status[m.messageRowId]) {
          result.status[m.messageRowId] = "not_found";
        }
      }
      resolve(result);
    };

    const imapConfig: any = {
      user: account.imap_user || account.email,
      host: account.imap_host,
      port: account.imap_port || 993,
      tls: account.imap_tls !== false,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 15000,
      authTimeout: 15000,
    };
    // OAuth via SASL XOAUTH2 when we have it. App Passwords are unreliable
    // for Gmail accounts once OAuth is set up — Google often invalidates
    // them.
    //
    // Per node-imap's documented config:
    //   "xoauth2 - string - Base64-encoded OAuth2 token for The SASL XOAUTH2
    //    Mechanism"
    // So this field takes the pre-built SASL string from buildXOAuth2Token,
    // NOT the raw access token. (The library does NOT do the encoding for
    // you — that's what the `xoauth` field does, but `xoauth` is XOAUTH1,
    // a totally different and obsolete mechanism. Setting `xoauth` here
    // would make Gmail receive a malformed SASL argument.)
    if (account.xoauth2Token) {
      imapConfig.xoauth2 = account.xoauth2Token;
    } else {
      imapConfig.password = account.imap_password;
    }
    const imap = new Imap(imapConfig);

    // Hard watchdog: if the connect+auth handshake doesn't complete within
    // 30 seconds we force-end the connection. Otherwise a silent hang
    // (e.g. malformed XOAUTH2 → server stops responding) would burn the
    // entire Vercel function budget waiting for a response that never
    // arrives, leaving the user with zero feedback.
    const HANDSHAKE_TIMEOUT_MS = 30_000;
    handshakeTimer = setTimeout(() => {
      if (resolved) return;
      console.error("[imap-backfill] handshake timeout — server never completed auth", {
        account: account.email,
        host: account.imap_host,
        authMethod: account.xoauth2Token ? "xoauth2" : "password",
      });
      for (const m of request.messages) {
        if (!result.status[m.messageRowId]) {
          result.status[m.messageRowId] = "error";
          result.errorReasons[m.messageRowId] = "IMAP handshake timed out (likely malformed auth credentials)";
        }
      }
      finish();
    }, HANDSHAKE_TIMEOUT_MS);
    // Cleared in `ready` and `finish` paths.

    imap.once("error", (err: any) => {
      // Log raw error so we can see the actual reason in Vercel logs.
      console.error("[imap-backfill] connection error:", {
        account: account.email,
        host: account.imap_host,
        user: imapConfig.user,
        err_message: err?.message,
        err_source: err?.source,
        err_type: err?.type,
        err_code: err?.code,
      });
      // Connection-level error: every requested UID gets marked errored.
      for (const m of request.messages) {
        if (!result.status[m.messageRowId]) {
          result.status[m.messageRowId] = "error";
          result.errorReasons[m.messageRowId] = `IMAP error: ${err?.message || "unknown"}`;
        }
      }
      finish();
    });

    imap.once("end", () => finish());

    imap.once("ready", () => {
      if (handshakeTimer) clearTimeout(handshakeTimer);
      imap.openBox("INBOX", true, (boxErr) => {
        if (boxErr) {
          for (const m of request.messages) {
            result.status[m.messageRowId] = "error";
            result.errorReasons[m.messageRowId] = `openBox failed: ${boxErr.message}`;
          }
          return finish();
        }

        // `imap.fetch` with `bodies: ""` returns the full RFC822 message,
        // which mailparser can decode into attachments + content. This is
        // the same shape the live sync uses, so attachment handling is
        // identical to what new mail receives.
        const fetchStream = imap.fetch(allUids, { bodies: "", struct: false });

        // Track outstanding parses so we don't `finish()` before they
        // all complete. Promises are chained off the fetchStream events.
        const pending: Promise<void>[] = [];

        fetchStream.on("message", (msg, seqno) => {
          let uid = 0;
          let rawBuf = Buffer.alloc(0);

          msg.on("attributes", (attrs) => {
            uid = attrs.uid;
          });

          msg.on("body", (stream) => {
            stream.on("data", (chunk: Buffer) => {
              rawBuf = Buffer.concat([rawBuf, chunk]);
            });
          });

          msg.once("end", () => {
            // Defer the parse/upload work into the pending list. We can't
            // await directly here because node-imap uses callbacks.
            const work = (async () => {
              const rowId = uidToRowId.get(uid);
              if (!rowId) return; // UID we didn't ask for — ignore.
              try {
                const parsed = await simpleParser(rawBuf);
                const attachments = parsed.attachments || [];
                if (attachments.length === 0) {
                  // Successfully parsed, no attachments found. Mark ok so
                  // the caller can clear the false-positive flag.
                  result.status[rowId] = "ok";
                  return;
                }
                for (let i = 0; i < attachments.length; i++) {
                  const a: any = attachments[i];
                  const buf: Buffer = Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content || "");
                  if (buf.length === 0) continue;
                  const up = await uploadAttachmentToStorage(supabase, {
                    accountId: account.id,
                    messageId: rowId,
                    attachment: {
                      filename: String(a.filename || a.cid || `attachment-${i + 1}`).slice(0, 240),
                      contentType: String(a.contentType || "application/octet-stream"),
                      size: typeof a.size === "number" ? a.size : buf.length,
                      // Disposition is the authoritative signal for "inline."
                      // A Content-ID alone does NOT mean inline — many email
                      // clients (especially Outlook/Microsoft Graph) attach
                      // Content-ID headers to ordinary file attachments
                      // (PDFs, spreadsheets). Treating those as inline
                      // causes legitimate downloadable attachments to be
                      // hidden from the message panel.
                      isInline: a.contentDisposition === "inline",
                      contentId: a.cid || a.contentId || null,
                      checksum: a.checksum || null,
                      content: buf,
                    },
                    indexInMessage: i,
                  });
                  if (up.ok && !up.skipped) result.uploadedCount++;
                  else if (up.skipped) result.skippedCount++;
                }
                result.status[rowId] = "ok";
              } catch (parseErr: any) {
                result.status[rowId] = "error";
                result.errorReasons[rowId] = `Parse failed: ${parseErr?.message || "unknown"}`;
              }
            })();
            pending.push(work);
          });
        });

        fetchStream.once("error", (fetchErr: any) => {
          // Per-fetch error — usually means one or more UIDs no longer exist.
          // We can't tell which from a single error event, so we wait for end
          // and let the leftover-marker in `finish()` mark unanswered UIDs
          // as not_found.
          console.warn("[imap-backfill] fetch error:", fetchErr?.message);
        });

        fetchStream.once("end", async () => {
          // Wait for all in-flight parse/upload work before closing the
          // connection. Otherwise we'd cut off uploads mid-stream.
          await Promise.all(pending);
          finish();
        });
      });
    });

    imap.connect();
  });
}