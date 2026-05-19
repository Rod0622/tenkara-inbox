/**
 * POST /api/admin/backfill-gmail-spam
 *
 * One-shot backfill: for each ACTIVE Gmail OAuth account, query Gmail's API
 * for messages in the Spam label received in the last 30 days, and insert
 * them into Tenkara's `messages` / `conversations` tables with `status="spam"`
 * so they show up in the Spam folder for review.
 *
 * Why: the default Gmail sync query excluded Spam-labeled messages entirely,
 * so legitimate supplier emails that Gmail mis-classified (e.g., token-style
 * auto-responders from tenderapp.com) were never imported. This catches the
 * last 30 days. Going forward, the sync query was changed to include Spam.
 *
 * Admin-only (passes actor_id; verified against team_members.role).
 *
 * Request:
 *   POST /api/admin/backfill-gmail-spam
 *   { actor_id: string, days?: number }    // days defaults to 30, capped at 90
 *
 * Response 200:
 *   {
 *     ok: true,
 *     accounts: [
 *       { email, account_id, spam_listed, already_present, newly_inserted, errors }
 *     ]
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { refreshGoogleToken } from "@/lib/google-oauth";
import { decodeEmailText, decodeEmailTextPreserveNewlines } from "@/lib/decode-email-text";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => ({}));
    const actorId: string | undefined = body.actor_id || body.actorId;
    const days = Math.min(parseInt(body.days || "30", 10) || 30, 90);

    if (!actorId) {
      return NextResponse.json({ error: "actor_id is required" }, { status: 400 });
    }

    // Admin gate
    const { data: actor } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", actorId)
      .maybeSingle();
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // Fetch Gmail OAuth accounts
    const { data: accounts, error: aErr } = await supabase
      .from("email_accounts")
      .select("id, email, name, provider, oauth_refresh_token")
      .eq("is_active", true)
      .eq("provider", "google_oauth");
    if (aErr) {
      return NextResponse.json({ error: aErr.message }, { status: 500 });
    }

    const sinceEpoch = Math.floor(Date.now() / 1000 - days * 24 * 60 * 60);
    const summary: any[] = [];

    for (const account of accounts || []) {
      const acctSummary: any = {
        email: account.email,
        account_id: account.id,
        spam_listed: 0,
        already_present: 0,
        newly_inserted: 0,
        errors: 0,
      };

      try {
        // Refresh the OAuth token. refreshGoogleToken returns the access token string.
        const accessToken = await refreshGoogleToken(account.id).catch(() => null);
        if (!accessToken) {
          acctSummary.errors++;
          acctSummary.error_msg = "Failed to refresh token";
          summary.push(acctSummary);
          continue;
        }

        // Paginate Gmail API list with `in:spam after:<epoch>`. Hard cap
        // at 500 messages per account to keep this bounded.
        const HARD_CAP = 500;
        let pageToken: string | undefined;
        const allIds: string[] = [];
        while (allIds.length < HARD_CAP) {
          const q = encodeURIComponent(`in:spam after:${sinceEpoch}`);
          const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${q}&maxResults=100${pageToken ? `&pageToken=${pageToken}` : ""}`;
          const listRes = await fetch(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!listRes.ok) {
            acctSummary.errors++;
            break;
          }
          const listData = await listRes.json();
          const ids = (listData.messages || []).map((m: any) => m.id);
          allIds.push(...ids);
          pageToken = listData.nextPageToken;
          if (!pageToken || ids.length === 0) break;
        }
        acctSummary.spam_listed = allIds.length;

        if (allIds.length === 0) {
          summary.push(acctSummary);
          continue;
        }

        // Existence check — skip messages we already have (e.g., from prior
        // partial runs of this backfill).
        const providerIds = allIds.map((id) => `gmail:${id}`);
        const existingIds = new Set<string>();
        for (let i = 0; i < providerIds.length; i += 200) {
          const slice = providerIds.slice(i, i + 200);
          const { data: existing } = await supabase
            .from("messages")
            .select("provider_message_id")
            .in("provider_message_id", slice);
          for (const r of existing || []) existingIds.add(r.provider_message_id);
        }
        acctSummary.already_present = existingIds.size;

        const newIds = allIds.filter((id) => !existingIds.has(`gmail:${id}`));

        // Fetch each new message + insert. Same shape as the sync code path,
        // but always with status="spam".
        for (const msgId of newIds) {
          try {
            const msgRes = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!msgRes.ok) {
              acctSummary.errors++;
              continue;
            }
            const msgData = await msgRes.json();

            const headers: Record<string, string> = {};
            for (const h of msgData.payload?.headers || []) {
              headers[h.name.toLowerCase()] = h.value;
            }

            const fromMatch = (headers.from || "").match(/^(.+?)\s*<(.+?)>$/);
            const fromName = fromMatch ? fromMatch[1].trim() : headers.from || "Unknown";
            const fromEmail = fromMatch
              ? fromMatch[2].trim().toLowerCase()
              : (headers.from || "").toLowerCase();
            const isOutbound = fromEmail === account.email.toLowerCase();
            const subject = headers.subject || "(No Subject)";
            const snippet = decodeEmailText(msgData.snippet || "");
            const sentAt = headers.date
              ? new Date(headers.date).toISOString()
              : new Date(parseInt(msgData.internalDate)).toISOString();

            // Extract HTML body (same nested-MIME walker as sync uses).
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

            // Thread into conversation by subject (same heuristic as sync).
            const cleanSubject = subject.replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, "").trim();
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
                  status: "spam",  // ALL backfilled rows are spam
                  last_message_at: sentAt,
                })
                .select("id")
                .single();
              if (ce || !nc) {
                acctSummary.errors++;
                continue;
              }
              conversationId = nc.id;
            }

            // Insert the message
            await supabase.from("messages").insert({
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
            acctSummary.newly_inserted++;
          } catch (e) {
            console.error("[backfill-spam] message error:", e);
            acctSummary.errors++;
          }
        }
      } catch (e: any) {
        console.error(`[backfill-spam] account ${account.email} failed:`, e);
        acctSummary.errors++;
        acctSummary.error_msg = e?.message || String(e);
      }

      summary.push(acctSummary);
    }

    return NextResponse.json({ ok: true, days, accounts: summary });
  } catch (err: any) {
    console.error("POST /api/admin/backfill-gmail-spam failed:", err);
    return NextResponse.json(
      { error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}
