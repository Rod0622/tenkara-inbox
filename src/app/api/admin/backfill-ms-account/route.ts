/**
 * POST /api/admin/backfill-ms-account
 *
 * Microsoft twin of /api/admin/backfill-account: deep backfill for a single
 * microsoft_oauth account. Walks Graph /me/messages over the requested time
 * window page by page and inserts messages missing from the database —
 * designed to recover mail the incremental sync stepped over.
 *
 * Mirrors the Gmail backfill's contract and design decisions:
 *   • Does NOT touch `email_accounts.last_sync_at`/`last_sync_uid` — the
 *     normal incremental sync keeps doing its thing concurrently.
 *   • Page-by-page resumable. Each invocation processes ONE Graph page and
 *     returns `next_page_token` (Microsoft's @odata.nextLink, passed back
 *     verbatim per Microsoft's guidance) until `done: true`.
 *   • `provider_message_id` existence check makes re-runs cheap+idempotent.
 *   • Message shape mirrors the regular Microsoft sync
 *     (src/lib/microsoft-oauth-sync.ts): key `ms:<internetMessageId||id>`,
 *     thread by `ms:<conversationId>` first then cleaned subject, same
 *     body/contentType handling. Like the Gmail backfill, attachment BYTES
 *     are not fetched (has_attachments is stored so the flag is truthful).
 *
 * Admin-only (actor_id verified against team_members.role).
 *
 * Request:
 *   { actor_id: string, account_id: string, since_date?: string,
 *     page_token?: string, max_per_page?: number }   // cap 250
 * Response 200:
 *   { ok, listed, already_present, newly_inserted, errors,
 *     next_page_token: string|null, done: boolean }
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { refreshMicrosoftToken } from "@/lib/microsoft-oauth";
import { cleanSubject as cleanSubjectFn, sanitizeBodyHtml } from "@/lib/email";
import { onNewConversationFromSync } from "@/lib/folder-labels";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const HARD_CAP_PER_INVOCATION = 250;

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => ({}));

    const actorId:   string | undefined = body.actor_id   || body.actorId;
    const accountId: string | undefined = body.account_id || body.accountId;
    const sinceDate: string | undefined = body.since_date || body.sinceDate;
    const pageToken: string | undefined = body.page_token || body.pageToken;
    const maxPerPage = Math.min(
      parseInt(String(body.max_per_page || HARD_CAP_PER_INVOCATION), 10) || HARD_CAP_PER_INVOCATION,
      HARD_CAP_PER_INVOCATION
    );

    if (!actorId)   return NextResponse.json({ error: "actor_id is required"   }, { status: 400 });
    if (!accountId) return NextResponse.json({ error: "account_id is required" }, { status: 400 });

    // ── Admin gate (same as the Gmail backfill) ────────────────────
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
      .select("id, email, provider, is_active")
      .eq("id", accountId)
      .maybeSingle();
    if (aErr || !account) {
      return NextResponse.json({ error: aErr?.message || "Account not found" }, { status: 404 });
    }
    if (account.provider !== "microsoft_oauth") {
      return NextResponse.json({ error: "Only microsoft_oauth accounts supported by this endpoint" }, { status: 400 });
    }

    // ── Refresh OAuth token (in-app, so rotated tokens are persisted) ──
    const accessToken = await refreshMicrosoftToken(account.id, true).catch(() => null);
    if (!accessToken) {
      return NextResponse.json({ error: "Failed to refresh Microsoft OAuth token" }, { status: 500 });
    }

    // ── Build the Graph URL (or resume from the verbatim nextLink) ─
    let listUrl: string;
    if (pageToken) {
      listUrl = pageToken;
    } else {
      const fields = "id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,conversationId,internetMessageId";
      let filter = "";
      if (sinceDate) {
        const d = new Date(sinceDate);
        if (!isNaN(d.getTime())) {
          const iso = d.toISOString().replace(/\.\d{3}Z$/, "Z");
          filter = `&$filter=${encodeURIComponent(`receivedDateTime ge ${iso}`)}`;
        }
      }
      listUrl =
        `https://graph.microsoft.com/v1.0/me/messages?$top=${maxPerPage}` +
        `&$orderby=${encodeURIComponent("receivedDateTime desc")}` +
        `&$select=${fields}${filter}`;
    }

    const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!listRes.ok) {
      const err = await listRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: `Graph list error: ${err.error?.message || listRes.statusText}` },
        { status: 502 }
      );
    }
    const listData = await listRes.json();
    const messages: any[] = listData.value || [];
    const nextPageToken: string | null = listData["@odata.nextLink"] || null;

    if (messages.length === 0) {
      return NextResponse.json({
        ok: true, listed: 0, already_present: 0, newly_inserted: 0, errors: 0,
        next_page_token: nextPageToken, done: !nextPageToken,
      });
    }

    // ── Existence check (same key scheme as the regular MS sync) ──
    const keyOf = (email: any) => "ms:" + (email.internetMessageId || email.id);
    const providerIds = messages.map(keyOf);
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
    const newMessages = messages.filter((m) => !existing.has(keyOf(m)));

    // ── Insert each new message (bodies already came in the list) ─
    let newlyInserted = 0;
    let errors = 0;

    for (const email of newMessages) {
      try {
        const providerId = keyOf(email);
        const fromEmail = (email.from?.emailAddress?.address || "").toLowerCase();
        const fromName = email.from?.emailAddress?.name || fromEmail || "Unknown";
        const isOutbound = fromEmail === (account.email || "").toLowerCase();
        const subject = email.subject || "(No Subject)";
        const sentAt = email.receivedDateTime || email.sentDateTime || new Date().toISOString();

        // Thread by Graph conversationId first (same as the sync), then by
        // cleaned subject, then create a new conversation.
        let conversationId: string | null = null;
        if (email.conversationId) {
          const { data: c } = await supabase.from("conversations").select("id")
            .eq("thread_id", "ms:" + email.conversationId)
            .eq("email_account_id", account.id)
            .maybeSingle();
          if (c) conversationId = c.id;
        }
        const cleanSubject = cleanSubjectFn(subject);
        if (!conversationId && cleanSubject) {
          const { data: c } = await supabase.from("conversations").select("id")
            .eq("email_account_id", account.id).eq("subject", cleanSubject)
            .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
          if (c) conversationId = c.id;
        }
        if (!conversationId) {
          const { data: nc, error: ce } = await supabase.from("conversations").insert({
            email_account_id: account.id,
            thread_id: email.conversationId ? "ms:" + email.conversationId : "ms:" + email.id,
            subject: cleanSubject || "(No Subject)",
            from_name: fromName,
            from_email: fromEmail,
            preview: (email.bodyPreview || "").slice(0, 200),
            is_unread: !isOutbound,
            status: "open",
            last_message_at: sentAt,
          }).select("id").single();
          if (ce || !nc) { errors++; continue; }
          conversationId = nc.id;
          await onNewConversationFromSync(nc.id, account.id, isOutbound)
            .catch((e: any) => console.error("[backfill-ms-account] label apply failed:", e?.message || e));
        }

        // Body handling — same html/text contentType logic as the MS sync.
        const rawBodyContent: string = email.body?.content || "";
        const bodyContentType = (email.body?.contentType || "").toLowerCase();
        const escapeHtml = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        let bodyHtml: string | null = null;
        let bodyText: string;
        if (bodyContentType === "html" && rawBodyContent) {
          bodyHtml = rawBodyContent;
          bodyText = rawBodyContent
            .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 5000);
        } else if (bodyContentType === "text" && rawBodyContent) {
          bodyText = rawBodyContent.slice(0, 5000);
          bodyHtml = "<div style=\"white-space: pre-wrap;\">" + escapeHtml(rawBodyContent) + "</div>";
        } else {
          bodyText = email.bodyPreview || "";
          bodyHtml = null;
        }
        bodyHtml = sanitizeBodyHtml(bodyHtml);
        const toAddr = (email.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", ");
        const ccAddr = (email.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", ");

        const { error: mErr } = await supabase.from("messages").insert({
          conversation_id: conversationId,
          provider_message_id: providerId,
          from_name: fromName,
          from_email: fromEmail,
          to_addresses: toAddr,
          cc_addresses: ccAddr,
          subject,
          body_text: bodyText.slice(0, 5000),
          body_html: bodyHtml,
          snippet: (email.bodyPreview || bodyText).slice(0, 200),
          sent_at: sentAt,
          is_outbound: isOutbound,
          has_attachments: !!email.hasAttachments,
        });
        if (mErr) {
          // Unique-violation (23505) is fine — a parallel run beat us.
          if ((mErr as any).code !== "23505") {
            console.error("[backfill-ms-account] insert error:", mErr.message);
            errors++;
            continue;
          }
        }
        newlyInserted++;
      } catch (e: any) {
        console.error("[backfill-ms-account] message error:", e?.message || e);
        errors++;
      }
    }

    return NextResponse.json({
      ok: true,
      listed: messages.length,
      already_present: alreadyPresent,
      newly_inserted: newlyInserted,
      errors,
      next_page_token: nextPageToken,
      done: !nextPageToken,
    });
  } catch (e: any) {
    console.error("[backfill-ms-account] fatal:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Internal error" }, { status: 500 });
  }
}
