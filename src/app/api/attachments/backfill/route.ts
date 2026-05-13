export const dynamic = "force-dynamic";
// Vercel: set a generous function timeout so the UI has time to do real work
// before we self-bail. The actual stop signal is the internal time budget
// below — Vercel's hard ceiling is 300s on the Pro plan.
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { refreshGoogleToken, buildXOAuth2Token } from "@/lib/google-oauth";
import { uploadAttachmentToStorage } from "@/lib/attachments-storage";
import { backfillAttachmentsViaImap } from "@/lib/imap-attachment-backfill";

// ─── Attachment backfill ────────────────────────────────────────────────────
//
// POST /api/attachments/backfill
// Body: {
//   account_id?: string,            // scope to one account
//   conversation_id?: string,       // scope to one thread
//   limit?: number,                 // max messages SCANNED per call (cap below)
// }
//
// The endpoint is CHUNKED: it processes for up to ~240 seconds, then returns
// with `done` set to false (and the partial stats accumulated). The client is
// expected to call back in a loop until `done` is true. Each call is
// independent — there's no persistent cursor on the server; we rely on the
// dedup index in inbox.attachments to make "already done" messages free to
// skip on the next pass.
//
// Provider support:
//   • google_oauth (Gmail) — fetch via Gmail API
//   • microsoft / godaddy / outlook_com — fetch via Microsoft Graph
//   • IMAP (App Password) — not yet implemented; falls through with an error
// ────────────────────────────────────────────────────────────────────────────

// Provider names actually used by the sync engine for Microsoft accounts.
// `microsoft_oauth` is the canonical name written by the OAuth flow; the
// other strings are kept for any legacy or alternate-tenant variants.
const MICROSOFT_PROVIDERS = ["microsoft_oauth", "microsoft", "godaddy", "outlook_com"];
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Tunables. Numbers chosen so a single call can make meaningful progress
// without bumping into Vercel's hard 300s ceiling.
const SOFT_TIME_BUDGET_MS = 240_000; // 240s — leaves 60s headroom under Vercel's 300s
const MAX_MESSAGES_PER_CALL = 500;   // We never scan more than this per call

interface BackfillStats {
  scanned: number;
  alreadyBackfilled: number;
  attachmentsUploaded: number;
  attachmentsSkipped: number;
  errors: { message_id: string; reason: string }[];
  messagesProcessed: number;
}

interface BackfillResponse {
  ok: boolean;
  stats: BackfillStats;
  done: boolean;            // Whether the account has been fully drained
  remaining: number;        // Estimated messages still needing attention
  error?: string;
}

// ── Microsoft Graph: app-only token helper ───────────────────────────────────
async function getGraphAppToken(): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID || "",
      scope: "https://graph.microsoft.com/.default",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
      grant_type: "client_credentials",
    });
    const res = await fetch(
      `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.access_token || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty body */ }

  const conversationId: string | null = body?.conversation_id || null;
  const accountIdParam: string | null = body?.account_id || null;
  const requestedLimit: number = Math.min(
    Math.max(parseInt(String(body?.limit || ""), 10) || 200, 1),
    MAX_MESSAGES_PER_CALL
  );

  const supabase = createServerClient();
  const stats: BackfillStats = {
    scanned: 0,
    alreadyBackfilled: 0,
    attachmentsUploaded: 0,
    attachmentsSkipped: 0,
    errors: [],
    messagesProcessed: 0,
  };

  // 1. Pick candidate messages. Filter to has_attachments=true. We scope to
  //    the requested account at the database level using a PostgREST inner
  //    join: `conversations!inner` makes the join mandatory, and we then
  //    apply a filter on the joined column. This pushes the work into
  //    SQL — vs. an earlier approach using a giant `.in()` clause that
  //    blew past PostgREST's URL length limit on big accounts.
  //
  //    Oldest-first so chunked progress moves through the backlog
  //    predictably: each call eats from the same end of the queue.
  let query = supabase
    .from("messages")
    .select("id, provider_message_id, conversation_id, conversations!inner(email_account_id)")
    .eq("has_attachments", true)
    .order("sent_at", { ascending: true })
    .limit(requestedLimit);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  } else if (accountIdParam) {
    // Filter via the inner-joined conversations row. The dotted path here is
    // how PostgREST applies WHERE conditions to embedded relations.
    query = query.eq("conversations.email_account_id", accountIdParam);
  }

  const { data: candidateMessages, error: msgErr } = await query;
  if (msgErr) {
    return NextResponse.json<BackfillResponse>({
      ok: false,
      stats,
      done: true,
      remaining: 0,
      error: `Failed to load messages: ${msgErr.message}`,
    }, { status: 500 });
  }

  if (!candidateMessages || candidateMessages.length === 0) {
    return NextResponse.json<BackfillResponse>({
      ok: true,
      stats,
      done: true,
      remaining: 0,
    });
  }

  // The query is already scoped at the DB layer; no client-side re-filter needed.
  const filtered = candidateMessages;

  stats.scanned = filtered.length;

  // Diagnostic: log the shape of the first row in this batch so we can see
  // why per-message logic might be failing in production without DB access.
  if (filtered.length > 0) {
    const sample = filtered[0] as any;
    console.log("[backfill] first row shape:", {
      id: sample.id,
      provider_message_id: sample.provider_message_id,
      conversation_id: sample.conversation_id,
      conversations: sample.conversations,
      conversations_type: Array.isArray(sample.conversations) ? "array" : typeof sample.conversations,
    });
  }

  // 3. Bulk-fetch which messages already have attachment rows so we can skip.
  const messageIds = filtered.map((m: any) => m.id);
  const { data: existingRows } = await supabase
    .schema("inbox")
    .from("attachments")
    .select("message_id")
    .in("message_id", messageIds);

  const alreadyHave = new Set<string>((existingRows || []).map((r: any) => r.message_id));
  stats.alreadyBackfilled = alreadyHave.size;
  const toProcess = filtered.filter((m: any) => !alreadyHave.has(m.id));

  // 4. Caches (one fetch per account regardless of how many messages we walk).
  const accountCache: Record<string, any> = {};
  const gmailTokenCache: Record<string, string> = {};
  let graphAppToken: string | null | undefined = undefined; // undefined = not yet attempted

  const getAccount = async (accountId: string) => {
    if (accountCache[accountId]) return accountCache[accountId];
    const { data } = await supabase
      .from("email_accounts")
      .select("id, email, provider, oauth_refresh_token, imap_host, imap_port, imap_user, imap_password, imap_tls")
      .eq("id", accountId)
      .single();
    accountCache[accountId] = data;
    return data;
  };

  const getGmailToken = async (accountId: string): Promise<string | null> => {
    if (gmailTokenCache[accountId]) return gmailTokenCache[accountId];
    try {
      const t = await refreshGoogleToken(accountId, true);
      gmailTokenCache[accountId] = t;
      return t;
    } catch {
      return null;
    }
  };

  // ── Gmail attachment fetch ──
  // Handles BOTH delivery shapes Gmail uses:
  //   • body.attachmentId present → must fetch via attachments.get (typical for >5MB)
  //   • body.data present         → bytes are inline (small files, often unnamed
  //                                  images from Yahoo etc.)
  // Also accepts parts without `filename` when they have image/* or
  // application/* mimeType — those are still real attachments, just lacking
  // a filename header.
  const backfillGmail = async (
    msgRowId: string,
    accountId: string,
    gmailMsgId: string,
    token: string,
  ) => {
    const msgRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMsgId}?format=full`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!msgRes.ok) {
      stats.errors.push({ message_id: msgRowId, reason: `Gmail fetch failed: ${msgRes.statusText}` });
      return;
    }
    const msgData = await msgRes.json();

    const collectParts = (payload: any, out: any[] = []) => {
      if (!payload) return out;
      const body = payload.body || {};
      const hasBytes = !!body.attachmentId || !!body.data;
      const mime = String(payload.mimeType || "");
      // text/plain and text/html are the message body, not attachments.
      const isBodyText = mime === "text/plain" || mime === "text/html";
      if (!isBodyText && hasBytes && (payload.filename || mime.startsWith("image/") || mime.startsWith("application/"))) {
        out.push(payload);
      }
      if (Array.isArray(payload.parts)) for (const p of payload.parts) collectParts(p, out);
      return out;
    };
    const parts = collectParts(msgData.payload || {});

    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      let buf: Buffer | null = null;

      if (p.body?.attachmentId) {
        const attRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMsgId}/attachments/${p.body.attachmentId}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!attRes.ok) {
          stats.errors.push({ message_id: msgRowId, reason: `Gmail attach fetch ${p.filename || "(unnamed)"} failed` });
          continue;
        }
        const attJson = await attRes.json();
        buf = Buffer.from(attJson.data || "", "base64url");
      } else if (p.body?.data) {
        buf = Buffer.from(p.body.data, "base64url");
      }

      if (!buf || buf.length === 0) {
        stats.errors.push({ message_id: msgRowId, reason: `Gmail attach ${p.filename || "(unnamed)"}: empty body` });
        continue;
      }

      const headersList: { name: string; value: string }[] = p.headers || [];
      const findHeader = (n: string) =>
        headersList.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value || "";
      const disposition = findHeader("Content-Disposition").toLowerCase();
      const contentIdRaw = findHeader("Content-ID");
      const contentId = contentIdRaw ? contentIdRaw.replace(/^<|>$/g, "") : null;

      // Derive a filename for parts that don't carry one.
      const fallbackName = (() => {
        const mt = String(p.mimeType || "").toLowerCase();
        const ext = mt.startsWith("image/") ? mt.split("/")[1] : "bin";
        return contentId ? `${contentId}.${ext}` : `attachment-${i + 1}.${ext}`;
      })();

      const up = await uploadAttachmentToStorage(supabase, {
        accountId,
        messageId: msgRowId,
        attachment: {
          filename: p.filename || fallbackName,
          contentType: p.mimeType || "application/octet-stream",
          size: typeof p.body?.size === "number" ? p.body.size : buf.length,
          isInline: disposition.startsWith("inline") || !!contentId,
          contentId,
          checksum: null,
          content: buf,
        },
        indexInMessage: i,
      });
      if (up.ok && !up.skipped) stats.attachmentsUploaded++;
      else if (up.skipped) stats.attachmentsSkipped++;
      else stats.errors.push({ message_id: msgRowId, reason: up.error || "upload failed" });
    }
  };

  // ── Microsoft Graph attachment fetch ──
  // The runtime API hits Graph on-demand for live downloads. Backfill mirrors
  // that but uploads the bytes into our Storage bucket so the on-demand path
  // becomes a fast Storage read instead of a slow Graph round-trip.
  const backfillMicrosoft = async (
    msgRowId: string,
    accountId: string,
    accountEmail: string,
    providerMsgId: string,
    token: string,
  ) => {
    // Strip our "ms:" prefix if present, then resolve internetMessageId → Graph id.
    const stripped = providerMsgId.replace(/^ms:/, "");
    let graphMsgId = stripped;
    if (stripped.includes("@") || stripped.includes("<")) {
      const searchRes = await fetch(
        `${GRAPH_BASE}/users/${accountEmail}/messages?$filter=internetMessageId eq '${encodeURIComponent(stripped)}'&$select=id`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (searchRes.ok) {
        const sd = await searchRes.json();
        if (sd.value?.[0]?.id) graphMsgId = sd.value[0].id;
      }
    }

    // List attachments first — small payload, gives us names/types.
    const listRes = await fetch(
      `${GRAPH_BASE}/users/${accountEmail}/messages/${graphMsgId}/attachments`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!listRes.ok) {
      stats.errors.push({ message_id: msgRowId, reason: `Graph list failed: ${listRes.statusText}` });
      return;
    }
    const listData = await listRes.json();
    const items: any[] = listData.value || [];

    for (let i = 0; i < items.length; i++) {
      const meta = items[i];
      // Per-attachment fetch returns contentBytes; the list endpoint can omit it.
      const detailRes = await fetch(
        `${GRAPH_BASE}/users/${accountEmail}/messages/${graphMsgId}/attachments/${meta.id}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!detailRes.ok) {
        stats.errors.push({ message_id: msgRowId, reason: `Graph fetch ${meta.name} failed` });
        continue;
      }
      const detail = await detailRes.json();
      if (!detail.contentBytes) {
        stats.errors.push({ message_id: msgRowId, reason: `Graph ${meta.name}: no contentBytes` });
        continue;
      }
      const buf = Buffer.from(detail.contentBytes, "base64");

      const up = await uploadAttachmentToStorage(supabase, {
        accountId,
        messageId: msgRowId,
        attachment: {
          filename: meta.name || "attachment",
          contentType: meta.contentType || "application/octet-stream",
          size: typeof meta.size === "number" ? meta.size : buf.length,
          isInline: !!meta.isInline,
          // Graph exposes contentId on item attachments; not always present.
          contentId: meta.contentId || null,
          checksum: null,
          content: buf,
        },
        indexInMessage: i,
      });
      if (up.ok && !up.skipped) stats.attachmentsUploaded++;
      else if (up.skipped) stats.attachmentsSkipped++;
      else stats.errors.push({ message_id: msgRowId, reason: up.error || "upload failed" });
    }
  };

  // 5. Pre-pass: separate IMAP-style messages from Gmail/Microsoft ones.
  //    IMAP messages get batched per-account so we open ONE IMAP connection
  //    per account per chunk rather than reconnecting per message. The other
  //    providers are HTTP-based so per-message processing is fine.
  //
  //    Detection: provider_message_id format is either
  //      • "gmail:{msgId}"     → Gmail API path
  //      • "ms:<rfc822-id>"    → Microsoft Graph path
  //      • "{accountId-uuid}:{uid}" → legacy IMAP path (UUID followed by colon and integer)
  //
  //    The UUID-prefixed format is what `imap-sync.ts` writes when it goes
  //    through the IMAP code path (used by Operations and other Gmail-OAuth
  //    accounts that were originally synced via App Password).
  const isImapStyle = (pmid: string): boolean => {
    if (!pmid) return false;
    if (pmid.startsWith("gmail:") || pmid.startsWith("ms:")) return false;
    // {uuid}:{integer-uid}
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\d+$/i.test(pmid);
  };

  type ImapBucketMsg = {
    msgRow: any;       // The original message row from DB
    uid: number;
  };
  const imapBuckets: Record<string, ImapBucketMsg[]> = {}; // keyed by accountId

  // Time-bounded loop guard reused across phases.
  let bailedOnTime = false;
  const timeIsUp = () => Date.now() - startedAt > SOFT_TIME_BUDGET_MS;

  // First pass: route each message either into the IMAP bucket or into the
  // synchronous per-message handler. We do the Gmail/Microsoft work inline
  // (since each call is fast HTTP), then circle back for IMAP at the end.
  for (const msg of toProcess) {
    if (timeIsUp()) { bailedOnTime = true; break; }

    stats.messagesProcessed++;
    // PostgREST's embedded relation can come back as either an object or a
    // single-element array. Defensively normalize.
    const convoRow: any = Array.isArray((msg as any).conversations)
      ? (msg as any).conversations[0]
      : (msg as any).conversations;
    const accountId = convoRow?.email_account_id;
    if (!accountId) {
      stats.errors.push({ message_id: msg.id, reason: "No email_account_id on conversation" });
      continue;
    }

    const account = await getAccount(accountId);
    if (!account) {
      stats.errors.push({ message_id: msg.id, reason: "Account not found" });
      continue;
    }

    const providerMsgId: string = msg.provider_message_id || "";

    // Track whether the provider walk produced ANY attachment rows for this
    // message AND ran cleanly. If we successfully scanned and found zero
    // rows, the `has_attachments=true` flag was a false positive.
    let scannedSuccessfully = false;
    const attachmentsBefore = stats.attachmentsUploaded + stats.attachmentsSkipped;
    const errorsBefore = stats.errors.length;

    // ── IMAP-style (legacy Gmail / generic IMAP) ──
    // Defer to the batched IMAP pass after this loop.
    if (isImapStyle(providerMsgId)) {
      const uidStr = providerMsgId.split(":")[1];
      const uid = parseInt(uidStr, 10);
      if (Number.isNaN(uid)) {
        stats.errors.push({ message_id: msg.id, reason: "IMAP UID parse failed" });
        continue;
      }
      if (!imapBuckets[accountId]) imapBuckets[accountId] = [];
      imapBuckets[accountId].push({ msgRow: msg, uid });
      // No false-positive flip here — it happens after the batched IMAP call.
      continue;
    }

    // ── Gmail OAuth (modern API path: "gmail:{msgId}") ──
    if (account.provider === "google_oauth" && providerMsgId.startsWith("gmail:")) {
      const token = await getGmailToken(accountId);
      if (!token) {
        stats.errors.push({ message_id: msg.id, reason: "Failed to refresh Gmail token" });
        continue;
      }
      const gmailMsgId = providerMsgId.replace(/^gmail:/, "");
      try {
        await backfillGmail(msg.id, accountId, gmailMsgId, token);
        scannedSuccessfully = true;
      } catch (e: any) {
        stats.errors.push({ message_id: msg.id, reason: `Gmail exception: ${e?.message || "unknown"}` });
      }
    }
    // ── Microsoft Graph ──
    else if (MICROSOFT_PROVIDERS.includes(account.provider)) {
      if (graphAppToken === undefined) {
        graphAppToken = await getGraphAppToken();
      }
      if (!graphAppToken) {
        stats.errors.push({ message_id: msg.id, reason: "Failed to obtain Microsoft Graph app token" });
        continue;
      }
      try {
        await backfillMicrosoft(msg.id, accountId, account.email, providerMsgId, graphAppToken);
        scannedSuccessfully = true;
      } catch (e: any) {
        stats.errors.push({ message_id: msg.id, reason: `Graph exception: ${e?.message || "unknown"}` });
      }
    }
    // ── Genuinely unsupported (e.g. unknown providerMsgId shape) ──
    else {
      stats.errors.push({
        message_id: msg.id,
        reason: `Unrecognized provider="${account.provider}" pmid_prefix="${providerMsgId.split(":")[0] || "(empty)"}"`,
      });
      continue;
    }

    // False-positive cleanup for Gmail/Microsoft. Only flip the flag when:
    //   1. The scan ran without throwing
    //   2. The walk uploaded nothing
    //   3. The walk pushed no errors
    if (scannedSuccessfully) {
      const attachmentsAfter = stats.attachmentsUploaded + stats.attachmentsSkipped;
      const errorsAfter = stats.errors.length;
      if (attachmentsAfter === attachmentsBefore && errorsAfter === errorsBefore) {
        await supabase
          .from("messages")
          .update({ has_attachments: false })
          .eq("id", msg.id);
      }
    }
  }

  // 6. Second pass: process IMAP buckets, one connection per account.
  //    Each bucket gets a single IMAP session that fetches ALL of that
  //    account's UIDs in one round-trip — much cheaper than reconnecting
  //    per message.
  for (const accountId of Object.keys(imapBuckets)) {
    if (timeIsUp()) { bailedOnTime = true; break; }
    const bucket = imapBuckets[accountId];
    if (bucket.length === 0) continue;
    const account = await getAccount(accountId);
    if (!account) {
      for (const item of bucket) {
        stats.errors.push({ message_id: item.msgRow.id, reason: "Account not found (IMAP batch)" });
      }
      continue;
    }

    const before = {
      uploads: stats.attachmentsUploaded,
      skips: stats.attachmentsSkipped,
      errors: stats.errors.length,
    };

    // Build the XOAUTH2 SASL string for Gmail OAuth accounts. App Passwords
    // get invalidated when an account is reconnected via OAuth, so when both
    // credentials exist we prefer OAuth — and for accounts that only have
    // OAuth (no App Password), it's the only option.
    //
    // node-imap docs (https://www.npmjs.com/package/node-imap):
    //   "xoauth2 - string - Base64-encoded OAuth2 token for The SASL XOAUTH2
    //    Mechanism"
    // i.e. the library expects the PRE-BUILT, base64-encoded SASL string —
    //   base64("user=" + email + "\x01auth=Bearer " + accessToken + "\x01\x01")
    // NOT the raw access token. buildXOAuth2Token() does this encoding.
    let xoauth2Token: string | null = null;
    if (account.provider === "google_oauth" && account.oauth_refresh_token) {
      try {
        const accessToken = await refreshGoogleToken(accountId, false);
        xoauth2Token = buildXOAuth2Token(account.email, accessToken);
      } catch (refreshErr: any) {
        // Fall back to App Password if refresh fails. If both fail, the
        // helper itself surfaces the credentials error.
        console.warn("[imap-backfill] OAuth refresh failed; falling back to password", {
          account: account.email,
          err: refreshErr?.message,
        });
      }
    }

    try {
      const r = await backfillAttachmentsViaImap(
        supabase,
        {
          id: account.id,
          email: account.email,
          imap_host: account.imap_host,
          imap_port: account.imap_port,
          imap_user: account.imap_user,
          imap_password: account.imap_password,
          imap_tls: account.imap_tls,
          xoauth2Token,
        },
        {
          accountId,
          messages: bucket.map((b) => ({ messageRowId: b.msgRow.id, uid: b.uid })),
        }
      );
      stats.attachmentsUploaded += r.uploadedCount;
      stats.attachmentsSkipped += r.skippedCount;

      // Per-message status → flag-clean and error tracking
      for (const item of bucket) {
        const st = r.status[item.msgRow.id];
        if (st === "ok") {
          // Clear false-positive flag only when this specific message added
          // no new uploads/skips AND no errors got pushed for it.
          const reason = r.errorReasons[item.msgRow.id];
          if (!reason) {
            // Check: did THIS message contribute uploads? We can't tell
            // per-message from aggregate counters, so a simpler rule:
            // if the overall bucket added 0 new uploads/skips AND 0 errors,
            // every message in the bucket is a false positive. Otherwise
            // we leave the flag alone (a bit conservative but safe).
          }
        } else if (st === "not_found") {
          // UID no longer on the server — message was deleted from the
          // mailbox after we synced it. Flag is no longer meaningful.
          await supabase
            .from("messages")
            .update({ has_attachments: false })
            .eq("id", item.msgRow.id);
        } else if (st === "error") {
          stats.errors.push({
            message_id: item.msgRow.id,
            reason: `IMAP backfill: ${r.errorReasons[item.msgRow.id] || "unknown"}`,
          });
        }
      }

      // Bucket-wide false-positive cleanup: if NOTHING was uploaded or
      // errored for the whole batch, every message was a clean negative
      // and we can flip their flags off in one batch update.
      const after = {
        uploads: stats.attachmentsUploaded,
        skips: stats.attachmentsSkipped,
        errors: stats.errors.length,
      };
      if (
        after.uploads === before.uploads &&
        after.skips === before.skips &&
        after.errors === before.errors
      ) {
        const okIds = bucket
          .filter((b) => r.status[b.msgRow.id] === "ok")
          .map((b) => b.msgRow.id);
        if (okIds.length > 0) {
          await supabase
            .from("messages")
            .update({ has_attachments: false })
            .in("id", okIds);
        }
      }
    } catch (e: any) {
      // Connection-level catastrophe.
      for (const item of bucket) {
        stats.errors.push({
          message_id: item.msgRow.id,
          reason: `IMAP batch failed: ${e?.message || "unknown"}`,
        });
      }
    }
  }

  // 7. Tell the caller whether they should call again.
  //
  // Semantics: `done: true` means "the ACCOUNT is fully drained, stop calling".
  // `done: false` means "there might be more work — call us again".
  //
  // Earlier this returned `done: true` whenever we happened to finish a
  // chunk's `toProcess` list, but that's the wrong unit of work. Each
  // chunk only LOOKS AT 500 rows from the query — there can be thousands
  // more rows in the table that we haven't even queried yet. The auto-resume
  // UI loop needs to keep calling until the QUERY itself returns nothing.
  //
  // Rule:
  //   • If we got 0 candidate messages from the query → genuinely nothing
  //     left to do for this account → done.
  //   • If we bailed on the soft time budget → not done; resume.
  //   • Otherwise we processed real work this chunk; the next call should
  //     re-query and either find more work or come back empty → not done.
  const accountFullyDrained = stats.scanned === 0;
  const done = !bailedOnTime && accountFullyDrained;
  const remaining = bailedOnTime
    ? Math.max(0, toProcess.length - stats.messagesProcessed)
    : (accountFullyDrained ? 0 : -1); // -1 signals "unknown but more likely"

  // Aggregate error reasons so the UI / Vercel log can show WHAT failed,
  // not just how many. Group by the first 120 chars so the IMAP/Graph
  // exception detail is preserved — previously we truncated at the first
  // colon which threw away exactly the useful part.
  const errorCounts: Record<string, number> = {};
  for (const e of stats.errors) {
    const reason = e.reason.slice(0, 120);
    errorCounts[reason] = (errorCounts[reason] || 0) + 1;
  }
  const topErrorReasons = Object.entries(errorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => `${count}× ${reason}`);

  // Also dump the first 3 raw errors so we can see exactly what's failing
  // when a single category dominates.
  console.log("[backfill] result:", {
    accountIdParam,
    conversationId,
    scanned: stats.scanned,
    messagesProcessed: stats.messagesProcessed,
    uploaded: stats.attachmentsUploaded,
    skipped: stats.attachmentsSkipped,
    errorCount: stats.errors.length,
    topErrorReasons,
    firstThreeErrors: stats.errors.slice(0, 3),
    bailedOnTime,
    done,
  });

  return NextResponse.json<BackfillResponse & { topErrors?: string[] }>({
    ok: true,
    stats,
    done,
    remaining,
    topErrors: topErrorReasons,
  });
}