/**
 * POST /api/admin/backfill-account
 *
 * Deep backfill for a single Gmail OAuth account. Unlike the normal sync
 * (which is bounded to recent messages and never paginates), this endpoint
 * walks every Gmail page in the requested time window and inserts missing
 * messages — designed to recover historical email for an account that was
 * added long after the messages arrived.
 *
 * Why this exists:
 *   The normal sync (src/lib/imap-sync.ts) on first-run grabs at most ~100
 *   messages from the last 30 days. For a newly-added group inbox with
 *   high volume (e.g. purchasing@nutripro received hundreds of supplier
 *   replies before being added to Tenkara), most of those messages never
 *   get imported. This endpoint backfills them.
 *
 *   It is also useful when changing Gmail filters or restoring an account
 *   after disconnect/reconnect, where there's a gap between the last
 *   incremental sync and "now" that the existing sync logic can't catch up
 *   on because of its narrow query window.
 *
 * Key design decisions:
 *   • Does NOT touch `email_accounts.last_sync_at`. The normal incremental
 *     sync keeps doing its thing concurrently; this endpoint just fills
 *     in messages that fall before `last_sync_at`.
 *   • Page-by-page resumable. Each invocation processes one Gmail API
 *     page (up to 500 messages) and returns a `next_page_token` if more
 *     pages remain. Callers loop until `done: true`.
 *   • Uses `provider_message_id` existence check to skip already-synced
 *     messages, so re-runs are cheap and idempotent.
 *   • Mirrors the message-insert shape used by both the normal sync and
 *     the spam backfill endpoint — same conversation threading by subject,
 *     same body extraction, same field set.
 *
 * Admin-only (passes actor_id; verified against team_members.role).
 *
 * Request:
 *   POST /api/admin/backfill-account
 *   {
 *     actor_id:    string,            // admin team_member id
 *     account_id:  string,            // email_accounts.id to backfill
 *     since_date?: string,            // ISO date, e.g. "2024-01-01"
 *                                     // OMIT for all-time (no `after:` filter)
 *     page_token?: string,            // pass back next_page_token to resume
 *     query?:      string,            // default: "in:anywhere -in:trash"
 *     max_per_page?: number           // default: 500, cap: 500
 *   }
 *
 * Response 200:
 *   {
 *     ok: true,
 *     listed: number,                 // IDs returned by Gmail this run
 *     already_present: number,        // skipped (existed in messages table)
 *     newly_inserted: number,
 *     errors: number,
 *     next_page_token: string | null,
 *     done: boolean,                  // true when no more pages
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { refreshGoogleToken } from "@/lib/google-oauth";
import { decodeEmailText, decodeEmailTextPreserveNewlines } from "@/lib/decode-email-text";
import { cleanSubject as cleanSubjectFn } from "@/lib/email";
import { onNewConversationFromSync } from "@/lib/folder-labels";

const HARD_CAP_PER_INVOCATION = 500;

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => ({}));

    const actorId:    string | undefined = body.actor_id   || body.actorId;
    const accountId:  string | undefined = body.account_id || body.accountId;
    const sinceDate:  string | undefined = body.since_date || body.sinceDate;
    const pageToken:  string | undefined = body.page_token || body.pageToken;
    const userQuery:  string | undefined = body.query;
    const maxPerPage = Math.min(
      parseInt(String(body.max_per_page || HARD_CAP_PER_INVOCATION), 10) || HARD_CAP_PER_INVOCATION,
      HARD_CAP_PER_INVOCATION
    );

    if (!actorId)   return NextResponse.json({ error: "actor_id is required"   }, { status: 400 });
    if (!accountId) return NextResponse.json({ error: "account_id is required" }, { status: 400 });

    // ── Admin gate ─────────────────────────────────────────────────
    const { data: actor } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", actorId)
      .maybeSingle();
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // ── Fetch the target account ──────────────────────────────────
    const { data: account, error: aErr } = await supabase
      .from("email_accounts")
      .select("id, email, name, provider, oauth_refresh_token, is_active")
      .eq("id", accountId)
      .maybeSingle();
    if (aErr || !account) {
      return NextResponse.json({ error: aErr?.message || "Account not found" }, { status: 404 });
    }
    if (account.provider !== "google_oauth") {
      return NextResponse.json({ error: "Only Gmail OAuth accounts supported for now" }, { status: 400 });
    }

    // ── Refresh OAuth token ───────────────────────────────────────
    const accessToken = await refreshGoogleToken(account.id).catch(() => null);
    if (!accessToken) {
      return NextResponse.json({ error: "Failed to refresh Gmail OAuth token" }, { status: 500 });
    }

    // ── Build the Gmail query ─────────────────────────────────────
    // Default to the same filter the normal sync uses; user can override.
    // When `since_date` is omitted, NO `after:` clause is added → all-time.
    const baseQuery = userQuery || "in:anywhere -in:trash";
    let query = baseQuery;
    if (sinceDate) {
      const epoch = Math.floor(new Date(sinceDate).getTime() / 1000);
      if (!isNaN(epoch)) {
        query = `after:${epoch} ${baseQuery}`;
      }
    }

    // ── List messages (one page per invocation) ───────────────────
    const listUrl =
      `https://gmail.googleapis.com/gmail/v1/users/me/messages` +
      `?q=${encodeURIComponent(query)}` +
      `&maxResults=${maxPerPage}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const listRes = await fetch(listUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) {
      const err = await listRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: `Gmail list error: ${err.error?.message || listRes.statusText}` },
        { status: 502 }
      );
    }
    const listData = await listRes.json();
    const ids: string[] = (listData.messages || []).map((m: any) => m.id);
    const nextPageToken: string | null = listData.nextPageToken || null;

    if (ids.length === 0) {
      return NextResponse.json({
        ok: true,
        listed: 0,
        already_present: 0,
        newly_inserted: 0,
        errors: 0,
        next_page_token: nextPageToken,
        done: !nextPageToken,
      });
    }

    // ── Existence check ───────────────────────────────────────────
    // The unique index on messages.provider_message_id keeps duplicates
    // out at the DB level, but checking up front lets us skip the
    // expensive per-message Gmail fetch entirely for ones we already have.
    const providerIds = ids.map((id) => `gmail:${id}`);
    const existing = new Set<string>();
    for (let i = 0; i < providerIds.length; i += 200) {
      const slice = providerIds.slice(i, i + 200);
      const { data } = await supabase
        .from("messages")
        .select("provider_message_id")
        .in("provider_message_id", slice);
      for (const r of data || []) existing.add(r.provider_message_id);
    }
    const alreadyPresent = existing.size;
    const newIds = ids.filter((id) => !existing.has(`gmail:${id}`));

    // ── Fetch + insert each new message ───────────────────────────
    // Concurrency-limited to 5: 500 IDs at ~250ms per Gmail fetch =
    // ~25s with concurrency 5. Well within Vercel's function timeout.
    let newlyInserted = 0;
    let errors = 0;
    const concurrency = 5;

    const processOne = async (msgId: string) => {
      try {
        const msgRes = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!msgRes.ok) {
          errors++;
          return;
        }
        const msgData = await msgRes.json();

        // ── Parse headers ────────────────────────────────────────
        const headers: Record<string, string> = {};
        for (const h of msgData.payload?.headers || []) {
          headers[String(h.name).toLowerCase()] = h.value;
        }

        const fromMatch = (headers.from || "").match(/^(.+?)\s*<(.+?)>$/);
        const fromName  = fromMatch ? fromMatch[1].trim() : headers.from || "Unknown";
        const fromEmail = fromMatch
          ? fromMatch[2].trim().toLowerCase()
          : (headers.from || "").toLowerCase();
        const isOutbound = fromEmail === (account.email || "").toLowerCase();
        const subject    = headers.subject || "(No Subject)";
        const snippet    = decodeEmailText(msgData.snippet || "");
        const sentAt     = headers.date
          ? new Date(headers.date).toISOString()
          : new Date(parseInt(msgData.internalDate, 10)).toISOString();

        // ── Extract body (same MIME walker as the sync + spam backfill) ──
        const extract = (payload: any): { html: string; text: string } => {
          let html = "";
          let text = "";
          const walk = (part: any) => {
            if (!part) return;
            if (part.mimeType === "text/html" && part.body?.data) {
              html = Buffer.from(part.body.data, "base64").toString("utf-8");
            } else if (part.mimeType === "text/plain" && part.body?.data && !text) {
              text = Buffer.from(part.body.data, "base64").toString("utf-8");
            }
            if (part.parts) part.parts.forEach(walk);
          };
          walk(payload);
          return { html, text };
        };
        const extracted = extract(msgData.payload);
        const bodyHtml = extracted.html;
        const htmlStrippedText = bodyHtml
          ? bodyHtml
              .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
              .replace(/<[^>]*>/g, " ")
          : "";
        const bodyText = decodeEmailTextPreserveNewlines(
          extracted.text || htmlStrippedText || snippet
        );

        // ── Thread into a conversation by cleaned subject ───────
        const cleanSubject = cleanSubjectFn(subject);
        let conversationId: string | null = null;
        if (cleanSubject) {
          const { data: c } = await supabase
            .from("conversations")
            .select("id")
            .eq("email_account_id", account.id)
            .eq("subject", cleanSubject)
            .order("last_message_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (c) conversationId = c.id;
        }
        if (!conversationId) {
          const { data: nc, error: ce } = await supabase
            .from("conversations")
            .insert({
              email_account_id: account.id,
              thread_id: `gmail:${msgData.threadId || msgId}`,
              subject: cleanSubject || "(No Subject)",
              from_name: fromName,
              from_email: fromEmail,
              preview: snippet.slice(0, 200),
              is_unread: !isOutbound,
              last_message_at: sentAt,
            })
            .select("id")
            .single();
          if (ce || !nc) {
            errors++;
            return;
          }
          conversationId = nc.id;

          // Apply [account, Inbox] auto-labels + set folder_id, same
          // call the regular sync makes. Without this, the new convo
          // is invisible to the inbox list view despite existing in
          // the DB. Idempotent — safe to call again later. Use nc.id
          // directly so TS narrows it as non-null (conversationId is
          // typed string|null from earlier in the function).
          await onNewConversationFromSync(nc.id, account.id, isOutbound)
            .catch((e: any) =>
              console.error("[backfill-account] label apply failed:", e?.message || e)
            );
        }

        // ── Insert the message ──────────────────────────────────
        const { error: mErr } = await supabase.from("messages").insert({
          conversation_id: conversationId,
          provider_message_id: `gmail:${msgId}`,
          from_name: fromName,
          from_email: fromEmail,
          to_addresses: headers.to ? [headers.to] : [],
          cc_addresses: headers.cc ? [headers.cc] : [],
          subject: subject,
          body_html: bodyHtml || null,
          body_text: bodyText.slice(0, 5000) || null,
          snippet: snippet.slice(0, 200),
          sent_at: sentAt,
          is_outbound: isOutbound,
          has_attachments: false,
        });
        if (mErr) {
          // Unique-violation (23505) is fine — means a parallel run beat us.
          const code = (mErr as any).code;
          if (code !== "23505") {
            console.error("[backfill-account] insert error:", mErr.message);
            errors++;
            return;
          }
        }
        newlyInserted++;
      } catch (e: any) {
        console.error("[backfill-account] message error:", e?.message || e);
        errors++;
      }
    };

    // Process newIds with bounded concurrency.
    for (let i = 0; i < newIds.length; i += concurrency) {
      const batch = newIds.slice(i, i + concurrency);
      await Promise.all(batch.map(processOne));
    }

    return NextResponse.json({
      ok: true,
      listed: ids.length,
      already_present: alreadyPresent,
      newly_inserted: newlyInserted,
      errors,
      next_page_token: nextPageToken,
      done: !nextPageToken,
    });
  } catch (err: any) {
    console.error("POST /api/admin/backfill-account failed:", err);
    return NextResponse.json(
      { error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}