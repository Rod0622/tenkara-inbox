export const dynamic = "force-dynamic";
// Vercel: set a generous function timeout so the UI has time to do real work
// before we self-bail. The actual stop signal is the internal time budget
// below — Vercel's hard ceiling is 300s on the Pro plan.
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { refreshGoogleToken } from "@/lib/google-oauth";
import { uploadAttachmentToStorage } from "@/lib/attachments-storage";

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

const MICROSOFT_PROVIDERS = ["microsoft", "godaddy", "outlook_com"];
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

  // 1. Pick candidate messages. Filter to has_attachments=true (the only
  //    ones worth examining), oldest-first this time. Oldest-first gives
  //    consistent progress when chunking — each call eats from the same end
  //    and the unbacked-up tail shrinks predictably.
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

  // 2. Account scope filter
  const filtered = accountIdParam
    ? candidateMessages.filter((m: any) => m.conversations?.email_account_id === accountIdParam)
    : candidateMessages;

  stats.scanned = filtered.length;

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
      .select("id, email, provider, oauth_refresh_token")
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
        stats.errors.push({ message_id: msgRowId, reason: `Gmail attach fetch ${p.filename} failed` });
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
        messageId: msgRowId,
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

  // 5. Main loop with soft time budget.
  let bailedOnTime = false;
  for (const msg of toProcess) {
    // Soft cutoff: stop accepting new work once we've burned 240s. The UI
    // will call back to resume; the dedup query at the top of the next call
    // makes this naturally idempotent.
    if (Date.now() - startedAt > SOFT_TIME_BUDGET_MS) {
      bailedOnTime = true;
      break;
    }

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
        await backfillGmail(msg.id, accountId, gmailMsgId, token);
      } catch (e: any) {
        stats.errors.push({ message_id: msg.id, reason: `Gmail exception: ${e?.message || "unknown"}` });
      }
      continue;
    }

    // ── Microsoft Graph ──
    if (MICROSOFT_PROVIDERS.includes(account.provider)) {
      if (graphAppToken === undefined) {
        graphAppToken = await getGraphAppToken();
      }
      if (!graphAppToken) {
        stats.errors.push({ message_id: msg.id, reason: "Failed to obtain Microsoft Graph app token" });
        continue;
      }
      try {
        await backfillMicrosoft(msg.id, accountId, account.email, providerMsgId, graphAppToken);
      } catch (e: any) {
        stats.errors.push({ message_id: msg.id, reason: `Graph exception: ${e?.message || "unknown"}` });
      }
      continue;
    }

    // ── Unsupported provider (e.g. raw IMAP) ──
    stats.errors.push({
      message_id: msg.id,
      reason: `Backfill not yet implemented for provider="${account.provider}"`,
    });
  }

  // 6. Tell the caller whether they should call again.
  // `done` is true when we processed everything we considered AND we didn't
  // bail on time. If we bailed on time, more might be left even at this scan
  // window — the next call will re-query and find them.
  const remaining = Math.max(0, toProcess.length - stats.messagesProcessed);
  const done = !bailedOnTime && remaining === 0;

  return NextResponse.json<BackfillResponse>({
    ok: true,
    stats,
    done,
    remaining,
  });
}