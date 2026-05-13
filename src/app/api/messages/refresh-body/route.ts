export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { simpleParser } from "mailparser";
import { createServerClient } from "@/lib/supabase";
import { refreshGoogleToken } from "@/lib/google-oauth";
import { decodeEmailTextPreserveNewlines } from "@/lib/decode-email-text";

// ─── Body refresh endpoint ──────────────────────────────────────────────────
//
// POST /api/messages/refresh-body
// Body: { account_id?: string, limit?: number, message_id?: string }
//
// Re-fetches messages from Gmail using format=raw and re-parses with
// mailparser to populate body_text and body_html. Targets messages where
// body_text appears truncated (≈ snippet length) AND body_html is NULL —
// the signature of "Gmail's hand-rolled MIME walker came back empty and
// we stored the snippet as body."
//
// Like the attachment backfill, this is chunked with a soft time budget
// and an auto-resume loop. The caller (settings UI or an admin script)
// should poll until { done: true }.
//
// Safe to re-run: messages that no longer match the "truncated" predicate
// drop out of the candidate set automatically.
// ────────────────────────────────────────────────────────────────────────────

const SOFT_TIME_BUDGET_MS = 240_000;
const MAX_MESSAGES_PER_CALL = 200;
const PER_FETCH_TIMEOUT_MS = 20_000;

async function fetchWithTimeout(url: string, init: RequestInit, ms = PER_FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e: any) {
    if (e?.name === "AbortError") throw new Error(`Upstream timed out after ${ms}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

interface RefreshResult {
  ok: boolean;
  scanned: number;
  refreshed: number;
  unchanged: number;
  errors: { message_id: string; reason: string }[];
  done: boolean;
  error?: string;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const accountIdParam: string | null = body?.account_id || null;
  const singleMessageId: string | null = body?.message_id || null;
  const limit = Math.min(
    Math.max(parseInt(String(body?.limit || "100"), 10) || 100, 1),
    MAX_MESSAGES_PER_CALL
  );

  const supabase = createServerClient();
  const result: RefreshResult = {
    ok: true,
    scanned: 0,
    refreshed: 0,
    unchanged: 0,
    errors: [],
    done: false,
  };

  try {
    // 1. Find candidate messages: body_html IS NULL AND body_text is short
    //    AND provider is Gmail OAuth (only path we can re-fetch from).
    //    Also restrict to single-message override or account scope.
    let query = supabase
      .from("messages")
      .select("id, provider_message_id, body_text, conversation_id, conversations!inner(email_account_id, email_accounts!inner(provider))")
      .like("provider_message_id", "gmail:%")
      .is("body_html", null)
      .order("sent_at", { ascending: false })
      .limit(limit);

    if (singleMessageId) {
      query = query.eq("id", singleMessageId);
    } else if (accountIdParam) {
      query = query.eq("conversations.email_account_id", accountIdParam);
    }

    const { data: candidates, error: candidateErr } = await query;
    if (candidateErr) {
      return NextResponse.json<RefreshResult>({
        ...result, ok: false, done: true,
        error: `Failed to load candidates: ${candidateErr.message}`,
      }, { status: 500 });
    }

    // Client-side filter: only short body_text. We can't easily express
    // "body_text length < 250" in PostgREST.
    const toProcess = (candidates || []).filter(
      (m: any) => (m.body_text || "").length < 250
    );
    result.scanned = toProcess.length;

    if (toProcess.length === 0) {
      result.done = true;
      return NextResponse.json(result);
    }

    // 2. Group by account so we share OAuth tokens.
    const accountIds = Array.from(new Set(
      toProcess.map((m: any) => {
        const co = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations;
        return co?.email_account_id;
      }).filter(Boolean)
    ));

    // Fetch tokens per account
    const tokenCache: Record<string, string> = {};
    for (const aid of accountIds) {
      try {
        tokenCache[aid] = await refreshGoogleToken(aid, false);
      } catch (e: any) {
        // We'll error per message below.
      }
    }

    // 3. Process each message: fetch raw, parse, update.
    for (const m of toProcess) {
      if (Date.now() - startedAt > SOFT_TIME_BUDGET_MS) {
        result.done = false;
        return NextResponse.json(result);
      }

      const co = Array.isArray(m.conversations) ? m.conversations[0] : m.conversations;
      const accountId = co?.email_account_id;
      const token = accountId ? tokenCache[accountId] : null;
      if (!token) {
        result.errors.push({ message_id: m.id, reason: "No Gmail token" });
        continue;
      }

      const gmailMsgId = m.provider_message_id.replace(/^gmail:/, "");

      try {
        const rawRes = await fetchWithTimeout(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailMsgId}?format=raw`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!rawRes.ok) {
          result.errors.push({ message_id: m.id, reason: `Gmail HTTP ${rawRes.status}` });
          continue;
        }
        const rawData = await rawRes.json();
        if (!rawData.raw) {
          result.errors.push({ message_id: m.id, reason: "Gmail returned no raw field" });
          continue;
        }

        const rawBuf = Buffer.from(rawData.raw, "base64url");
        const parsed = await simpleParser(rawBuf);

        const newBodyText = decodeEmailTextPreserveNewlines(parsed.text || "");
        const newBodyHtml = typeof parsed.html === "string" ? parsed.html : null;

        // Only update if we got something better than what we had.
        if (newBodyText.length <= (m.body_text || "").length && !newBodyHtml) {
          result.unchanged++;
          continue;
        }

        const update: any = {};
        if (newBodyText.length > (m.body_text || "").length) {
          update.body_text = newBodyText.slice(0, 50000);
        }
        if (newBodyHtml) {
          update.body_html = newBodyHtml;
        }

        if (Object.keys(update).length > 0) {
          const { error: updErr } = await supabase
            .from("messages")
            .update(update)
            .eq("id", m.id);
          if (updErr) {
            result.errors.push({ message_id: m.id, reason: `DB update: ${updErr.message}` });
          } else {
            result.refreshed++;
          }
        } else {
          result.unchanged++;
        }
      } catch (e: any) {
        result.errors.push({ message_id: m.id, reason: e?.message || "unknown" });
      }
    }

    result.done = result.scanned < limit;  // If we hit the limit, there may be more
    return NextResponse.json(result);
  } catch (fatal: any) {
    console.error("[refresh-body] fatal:", fatal);
    return NextResponse.json<RefreshResult>({
      ...result, ok: false, done: true,
      error: `Refresh crashed: ${fatal?.message || "unknown"}`,
    }, { status: 500 });
  }
}
