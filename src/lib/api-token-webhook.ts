// ── Outbound webhook dispatch ───────────────────────────────────────────
//
// Looks up the token associated with an agent draft (by name) and POSTs an
// event payload to the partner's webhook_url. Body is signed with HMAC-SHA256
// using the token's webhook_secret so the partner can verify authenticity.
//
// Events fired by Phase 2:
//   - draft.sent       (an operator sent an agent-drafted email)
//   - draft.discarded  (an operator deleted an agent draft without sending)
//
// Best-effort: every call is wrapped in try/catch and writes a row to
// api_webhook_deliveries for audit. A failed webhook NEVER blocks the user-
// facing action (Send / Discard). If the partner is down, the action still
// completes; the partner can poll later via the GET /api/external/drafts
// surface if they need to reconcile.
//
// The Signature header:
//   X-Tenkara-Signature: sha256=<hex digest>
// computed as HMAC-SHA256(webhook_secret, exact JSON body bytes).
import { createHmac } from "crypto";
import { createServerClient } from "@/lib/supabase";

export type WebhookEvent = "draft.sent" | "draft.discarded";

/**
 * Fire a webhook for an agent draft event. Idempotent for callers — if the
 * draft has no created_by_agent (operator draft), this is a no-op. If the
 * token has no webhook_url configured, this is a no-op.
 *
 * @param event       Event name ("draft.sent" or "draft.discarded")
 * @param draft       The draft row (must have created_by_agent set for webhook to fire)
 * @param extra       Optional extra fields merged into the payload (e.g. sent_at,
 *                    message_id, discarded_by_user_id)
 */
export async function dispatchDraftWebhook(
  event: WebhookEvent,
  draft: {
    id: string;
    conversation_id: string | null;
    created_by_agent: string | null;
    email_account_id: string | null;
    subject: string | null;
    to_addresses: string | null;
  } | null | undefined,
  extra: Record<string, any> = {}
): Promise<void> {
  if (!draft || !draft.created_by_agent) return;

  const supabase = createServerClient();

  // Look up the token by name. We match the active (non-revoked) token
  // with this name — Phase 1's token-creation flow disallows reusing names
  // implicitly via the partner workflow, but if multiple tokens share a
  // name we pick the most recently created one.
  const { data: tokenRow } = await supabase
    .from("api_tokens")
    .select("id, webhook_url, webhook_secret")
    .eq("name", draft.created_by_agent)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow?.webhook_url) {
    // No webhook configured — silently no-op. Partner can poll if needed.
    return;
  }

  const payload = {
    event,
    draft_id: draft.id,
    conversation_id: draft.conversation_id,
    agent_name: draft.created_by_agent,
    email_account_id: draft.email_account_id,
    subject: draft.subject,
    to: draft.to_addresses,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  const body = JSON.stringify(payload);

  // HMAC-SHA256 of the EXACT body bytes — partner can recompute and compare.
  // Empty secret means we still send the header but with an empty digest;
  // partners SHOULD configure a secret.
  const signature = tokenRow.webhook_secret
    ? "sha256=" + createHmac("sha256", tokenRow.webhook_secret).update(body).digest("hex")
    : "sha256=";

  let statusCode: number | null = null;
  let responseBody: string | null = null;
  let errorMsg: string | null = null;

  try {
    // 5-second timeout — partners with slow webhooks shouldn't slow our Send.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(tokenRow.webhook_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Tenkara-Inbox-Webhook/1.0",
        "X-Tenkara-Signature": signature,
        "X-Tenkara-Event": event,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    statusCode = res.status;
    const text = await res.text().catch(() => "");
    responseBody = text.slice(0, 1000); // truncate to keep the audit row small
  } catch (e: any) {
    errorMsg = e?.message || String(e);
  }

  // Audit log row. Best-effort — don't throw if this insert fails.
  supabase
    .from("api_webhook_deliveries")
    .insert({
      token_id: tokenRow.id,
      event_type: event,
      payload,
      url: tokenRow.webhook_url,
      status_code: statusCode,
      response_body: responseBody,
      error: errorMsg,
    })
    .then(({ error }) => {
      if (error) console.error("[webhook] delivery log insert failed:", error.message);
    });
}
