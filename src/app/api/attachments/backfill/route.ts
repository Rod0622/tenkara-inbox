export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { refreshGoogleToken } from "@/lib/google-oauth";
import { uploadAttachmentToStorage } from "@/lib/attachments-storage";

// ─── Attachment backfill ────────────────────────────────────────────────────
//
// POST /api/attachments/backfill
// Body: { account_id?: string, conversation_id?: string, limit?: number }
//
// Walks already-synced messages that have `has_attachments = true` and
// re-fetches their attachments from the upstream provider, storing them in
// Supabase Storage + inbox.attachments.
//
// Scope (in order of precedence, pick one):
//   • conversation_id → backfill only this thread's messages
//   • account_id      → backfill every flagged message in this account
//   • (neither)       → backfill every flagged message in every active account
//                       (capped to `limit`, default 200, to avoid timeouts)
//
// Skips messages that already have rows in inbox.attachments (idempotent —
// safe to re-run as many times as you want).
//
// Provider support:
//   • google_oauth (Gmail OAuth) — re-fetches via Gmail API
//   • everything else — returns "not implemented" entry per message
//     (TODO: IMAP re-fetch and Microsoft Graph backfill in future passes)
// ────────────────────────────────────────────────────────────────────────────

const MAX_MESSAGES_PER_RUN = 500;

interface BackfillStats {
  scanned: number;
  alreadyBackfilled: number;
  attachmentsUploaded: number;
  attachmentsSkipped: number;
  errors: { message_id: string; reason: string }[];
  messagesProcessed: number;
}

export async function POST(req: NextRequest) {
  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty body */ }

  const conversationId: string | null = body?.conversation_id || null;
  const accountIdParam: string | null = body?.account_id || null;
  const requestedLimit: number = Math.min(
    Math.max(parseInt(String(body?.limit || ""), 10) || 200, 1),
    MAX_MESSAGES_PER_RUN
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

  // 1. Pick the messages to process. We always filter to has_attachments=true
  //    since those are the only candidates with anything to fetch.
  //    Pull conversation join so we know the email_account_id without a
  //    second roundtrip.
  let query = supabase
    .from("messages")
    .select("id, provider_message_id, conversation_id, conversations:conversation_id(email_account_id)")
    .eq("has_attachments", true)
    .order("sent_at", { ascending: false })
    .limit(requestedLimit);

  if (conversationId) {
    query = query.eq("conversation_id", conversationId);
  }

  const { data: candidateMessages, error: msgErr } = await query;
  if (msgErr) {
    return NextResponse.json({ error: `Failed to load messages: ${msgErr.message}` }, { status: 500 });
  }

  if (!candidateMessages || candidateMessages.length === 0) {
    return NextResponse.json({ ok: true, stats, message: "No messages with attachments found" });
  }

  // 2. Filter to the requested account if specified.
  const filtered = accountIdParam
    ? candidateMessages.filter((m: any) => m.conversations?.email_account_id === accountIdParam)
    : candidateMessages;

  stats.scanned = filtered.length;

  // 3. Find messages that already have attachment rows so we can skip them.
  //    Single batch query is much faster than per-message checks.
  const messageIds = filtered.map((m: any) => m.id);
  const { data: existingRows } = await supabase
    .schema("inbox")
    .from("attachments")
    .select("message_id")
    .in("message_id", messageIds);

  const alreadyHave = new Set<string>((existingRows || []).map((r: any) => r.message_id));
  stats.alreadyBackfilled = alreadyHave.size;

  const toProcess = filtered.filter((m: any) => !alreadyHave.has(m.id));

  // 4. Cache account info (provider, token) so we don't re-query per message.
  const accountCache: Record<string, any> = {};
  const tokenCache: Record<string, string> = {};

  const getAccount = async (accountId: string) => {
    if (accountCache[accountId]) return accountCache[accountId];
    const { data } = await supabase
      .from("email_accounts")
      .select("id, email, provider, oauth_refresh_token")
      .eq("id", accountId)
      .single();
    accountCache[accountId] = data;
    return data;
  };

  const getGmailToken = async (accountId: string): Promise<string | null> => {
    if (tokenCache[accountId]) return tokenCache[accountId];
    try {
      const t = await refreshGoogleToken(accountId, true);
      tokenCache[accountId] = t;
      return t;
    } catch {
      return null;
    }
  };

  // 5. Process each message. Tight per-message error handling so one bad
  //    message doesn't kill the whole batch.
  for (const msg of toProcess) {
    stats.messagesProcessed++;
    const accountId = (msg as any).conversations?.email_account_id;
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

    // ── Gmail OAuth ──
    if (account.provider === "google_oauth" && providerMsgId.startsWith("gmail:")) {
      const token = await getGmailToken(accountId);
      if (!token) {
        stats.errors.push({ message_id: msg.id, reason: "Failed to refresh Gmail token" });
        continue;
      }
      const gmailMsgId = providerMsgId.replace(/^gmail:/, "");
      try {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMsgId}?format=full`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!msgRes.ok) {
          stats.errors.push({ message_id: msg.id, reason: `Gmail fetch failed: ${msgRes.statusText}` });
          continue;
        }
        const msgData = await msgRes.json();

        // Walk the MIME tree to find attachment parts.
        const collectParts = (payload: any, out: any[] = []) => {
          if (!payload) return out;
          if (payload.filename && payload.body?.attachmentId) out.push(payload);
          if (Array.isArray(payload.parts)) for (const p of payload.parts) collectParts(p, out);
          return out;
        };
        const parts = collectParts(msgData.payload || {});

        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          const attRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMsgId}/attachments/${p.body.attachmentId}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!attRes.ok) {
            stats.errors.push({ message_id: msg.id, reason: `Gmail attach fetch ${p.filename} failed` });
            continue;
          }
          const attJson = await attRes.json();
          const buf = Buffer.from(attJson.data || "", "base64url");

          const headersList: { name: string; value: string }[] = p.headers || [];
          const findHeader = (n: string) =>
            headersList.find((h) => h.name?.toLowerCase() === n.toLowerCase())?.value || "";
          const disposition = findHeader("Content-Disposition").toLowerCase();
          const contentIdRaw = findHeader("Content-ID");
          const contentId = contentIdRaw ? contentIdRaw.replace(/^<|>$/g, "") : null;

          const up = await uploadAttachmentToStorage(supabase, {
            accountId,
            messageId: msg.id,
            attachment: {
              filename: p.filename || "attachment",
              contentType: p.mimeType || "application/octet-stream",
              size: typeof p.body.size === "number" ? p.body.size : buf.length,
              isInline: disposition.startsWith("inline") || !!contentId,
              contentId,
              checksum: null,
              content: buf,
            },
            indexInMessage: i,
          });
          if (up.ok && !up.skipped) stats.attachmentsUploaded++;
          else if (up.skipped) stats.attachmentsSkipped++;
          else stats.errors.push({ message_id: msg.id, reason: up.error || "upload failed" });
        }
      } catch (e: any) {
        stats.errors.push({ message_id: msg.id, reason: `Gmail exception: ${e?.message || "unknown"}` });
      }
      continue;
    }

    // ── Other providers ──
    // IMAP backfill is harder because we'd have to re-establish an IMAP
    // session and find the message by UID. Microsoft Graph backfill is also
    // doable but the runtime API endpoint already fetches Graph attachments
    // on-demand, so backfill is less urgent there. Both can be added later.
    stats.errors.push({
      message_id: msg.id,
      reason: `Backfill not yet implemented for provider="${account.provider}"`,
    });
  }

  return NextResponse.json({ ok: true, stats });
}
