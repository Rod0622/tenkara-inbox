// ── Outbound webhook dispatch ───────────────────────────────────────────
//
// Looks up the token associated with an agent draft / agent-involved
// conversation, and POSTs an event payload to the partner's webhook_url.
// Body is signed with HMAC-SHA256 using the token's webhook_secret so the
// partner can verify authenticity.
//
// Events fired today:
//   - draft.sent        (operator sent an agent-drafted email)
//   - draft.discarded   (operator deleted an agent draft without sending)
//   - message.received  (new inbound message in a conv with agent involvement;
//                        unblocks the partner's reply-loop agent)
//
// Best-effort: every call is wrapped in try/catch and writes a row to
// api_webhook_deliveries for audit. A failed webhook NEVER blocks the
// user-facing or sync action. If the partner is down, the action still
// completes; the partner can poll later via the read surfaces if needed.
//
// The Signature header:
//   X-Tenkara-Signature: sha256=<hex digest>
// computed as HMAC-SHA256(webhook_secret, exact JSON body bytes).
import { createHmac } from "crypto";
import { createServerClient } from "@/lib/supabase";

export type WebhookEvent = "draft.sent" | "draft.discarded" | "message.received";

// ── Shared low-level signed POST + audit ────────────────────────────────
// All three event types use this. Kept module-private; callers go through
// the typed dispatch* functions below.
async function postSignedWebhook(
  tokenRow: { id: string; webhook_url: string; webhook_secret: string | null },
  event: WebhookEvent,
  payload: Record<string, any>
): Promise<void> {
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
    // 5-second timeout — partners with slow webhooks shouldn't slow our flow.
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
    responseBody = text.slice(0, 1000); // truncate to keep audit rows small
  } catch (e: any) {
    errorMsg = e?.message || String(e);
  }

  // Audit log row. Best-effort — don't throw if this insert fails.
  const supabase = createServerClient();
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
      if (error) console.error(`[webhook] ${event} delivery log insert failed:`, error.message);
    });
}

// ── Token lookup by agent name ──────────────────────────────────────────
// Active (non-revoked) token matching this name. If multiple share a name,
// pick the most recently created one.
async function lookupTokenByAgentName(
  agentName: string
): Promise<{ id: string; webhook_url: string; webhook_secret: string | null } | null> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("api_tokens")
    .select("id, webhook_url, webhook_secret")
    .eq("name", agentName)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.webhook_url) return null;
  return data as { id: string; webhook_url: string; webhook_secret: string | null };
}

// ── draft.sent / draft.discarded ────────────────────────────────────────
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
  event: "draft.sent" | "draft.discarded",
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

  const tokenRow = await lookupTokenByAgentName(draft.created_by_agent);
  if (!tokenRow) return;

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

  await postSignedWebhook(tokenRow, event, payload);
}

// ── message.received ────────────────────────────────────────────────────
/**
 * Fire message.received to every agent involved in the given conversation.
 *
 * Called from each sync path after inserting a new inbound message (caller
 * is responsible for skipping outbound messages — we don't double-check
 * here to keep this function cheap when there's no agent involvement).
 *
 * Agent involvement is detected via two signals:
 *   1. Any current row in email_drafts with created_by_agent != NULL —
 *      agent has an active draft they're working on
 *   2. Any past activity_log entry with action='agent_draft_sent' for this
 *      conv — agent's draft was sent and the supplier reply belongs to them
 *
 * Discarded drafts are NOT a signal — the operator explicitly opted out by
 * deleting the draft. Re-engagement happens when the agent creates a new
 * draft (which then matches signal #1 again).
 *
 * Fire-and-forget: never throws. Caller can omit await for non-blocking
 * behaviour, or await for sequential semantics — either works.
 */
export async function dispatchMessageReceivedWebhook(args: {
  conversationId: string;
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  /** ISO timestamp of when the message was sent/received (provider's sent_at). */
  receivedAt: string;
}): Promise<void> {
  const { conversationId, messageId, fromEmail, fromName, subject, bodyText, bodyHtml, receivedAt } = args;
  if (!conversationId || !messageId) return;

  const supabase = createServerClient();

  // Signal 1: current agent drafts on the conversation.
  const { data: drafts } = await supabase
    .from("email_drafts")
    .select("created_by_agent")
    .eq("conversation_id", conversationId)
    .not("created_by_agent", "is", null);

  const agentNames = new Set<string>();
  for (const d of (drafts || []) as any[]) {
    if (d.created_by_agent) agentNames.add(d.created_by_agent);
  }

  // Signal 2: history of agent_draft_sent — the agent's outgoing message
  // is what the supplier is replying to, even if no current draft exists.
  // Note: this depends on /api/send logging this action when sending an
  // agent-authored draft. If that logging is missing, we degrade gracefully
  // to firing only when a current draft exists.
  const { data: sentActions } = await supabase
    .from("activity_log")
    .select("details")
    .eq("conversation_id", conversationId)
    .eq("action", "agent_draft_sent");
  for (const a of (sentActions || []) as any[]) {
    const name = (a.details as any)?.agent_name;
    if (name) agentNames.add(name);
  }

  if (agentNames.size === 0) return;

  // Fire to each agent in parallel. Each call is independently best-effort.
  await Promise.all(
    Array.from(agentNames).map(async (agentName) => {
      const tokenRow = await lookupTokenByAgentName(agentName);
      if (!tokenRow) return;

      const payload = {
        event: "message.received" as const,
        agent_name: agentName,
        conversation_id: conversationId,
        message_id: messageId,
        from_email: fromEmail,
        from_name: fromName,
        subject,
        body_text: bodyText,
        body_html: bodyHtml,
        received_at: receivedAt,
        timestamp: new Date().toISOString(),
      };

      await postSignedWebhook(tokenRow, "message.received", payload);
    })
  );
}