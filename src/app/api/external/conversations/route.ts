import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { authenticateBearer, hasScope } from "@/lib/api-token-auth";
import { checkAndRecordRateLimit, rateLimitedResponse } from "@/lib/api-token-rate-limit";
import { dispatchConversationCreatedWebhook } from "@/lib/api-token-webhook";

// ── POST /api/external/conversations ─────────────────────────────────────
//
// Creates a new conversation + an attached draft in one round trip, for
// external agents performing cold outbound (e.g. Sam's agent 02 Quote
// Revalidation and agent 04 Outreach). The created conversation has no
// email_account_id by default — the operator picks the sender at review
// time, and the draft's requires_sender_selection flag enforces that gate
// in the Send UI.
//
// Idempotent: requests carrying an external_id we've seen before from the
// same token return the original IDs without creating duplicates. The
// uniqueness is enforced by a partial unique index on email_drafts
// (external_token_id, external_id), which also catches concurrent
// duplicate requests via a 23505 unique_violation on the second insert.
//
// See docs/external-api-spec--standalone-outbound.md for the full contract.

const EXTERNAL_ID_MAX_LENGTH = 200;

// Same regex used by every Tenkara endpoint that accepts an email.
// Intentionally lenient — we accept anything with a local-part + @ + domain
// with a TLD. Bounce / reputation checks happen elsewhere.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  // ── 1. Authenticate ──
  const token = await authenticateBearer(req);
  if (!token) {
    return NextResponse.json(
      { error: "unauthorized", detail: "Missing or invalid Authorization bearer token" },
      { status: 401 }
    );
  }

  // ── 2. Scope check ──
  if (!hasScope(token, "conversations:write")) {
    return NextResponse.json(
      { error: "missing_scope", detail: "Token missing required scope: conversations:write" },
      { status: 403 }
    );
  }

  // ── 3. Rate limit ──
  // Same per-token sliding window the rest of the external API uses. Check
  // happens BEFORE any DB writes so a blocked client doesn't burn budget.
  const rl = await checkAndRecordRateLimit(token.id, "/api/external/conversations");
  if (!rl.allowed) return rateLimitedResponse(rl);

  // ── 4. Parse + validate body ──
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "missing_field", detail: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const externalId: unknown = body?.external_id;
  const toEmail: unknown = body?.to_email;
  const toName: string | null = body?.to_name || null;
  const subject: unknown = body?.subject;
  const bodyHtml: unknown = body?.body_html;
  const bodyText: string | null = body?.body_text || null;
  const emailAccountId: string | null = body?.email_account_id || null;
  const context: Record<string, any> | null = body?.context || null;

  if (typeof externalId !== "string" || !externalId.trim()) {
    return NextResponse.json(
      { error: "missing_field", detail: "external_id is required and must be a non-empty string" },
      { status: 400 }
    );
  }
  if (externalId.length > EXTERNAL_ID_MAX_LENGTH) {
    return NextResponse.json(
      { error: "missing_field", detail: `external_id must be ${EXTERNAL_ID_MAX_LENGTH} characters or fewer` },
      { status: 400 }
    );
  }
  if (typeof toEmail !== "string" || !toEmail.trim()) {
    return NextResponse.json(
      { error: "missing_field", detail: "to_email is required" },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(toEmail)) {
    return NextResponse.json(
      { error: "invalid_email", detail: "to_email is not a valid email address" },
      { status: 400 }
    );
  }
  if (typeof subject !== "string" || !subject.trim()) {
    return NextResponse.json(
      { error: "missing_field", detail: "subject is required" },
      { status: 400 }
    );
  }
  if (typeof bodyHtml !== "string" || !bodyHtml.trim()) {
    return NextResponse.json(
      { error: "missing_field", detail: "body_html is required" },
      { status: 400 }
    );
  }

  // ── 5. Validate email_account_id if provided ──
  if (emailAccountId) {
    const { data: acc } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("id", emailAccountId)
      .maybeSingle();
    if (!acc) {
      return NextResponse.json(
        { error: "invalid_account", detail: "email_account_id does not match a known account" },
        { status: 400 }
      );
    }
  }

  // ── 6. Idempotency lookup ──
  // If we already have a draft for this (token, external_id), return the
  // original IDs unchanged. This is the happy path for retries.
  {
    const { data: existing } = await supabase
      .from("email_drafts")
      .select("id, conversation_id, requires_sender_selection, created_at")
      .eq("external_token_id", token.id)
      .eq("external_id", externalId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          conversation_id: existing.conversation_id,
          draft_id: existing.id,
          requires_sender_selection: existing.requires_sender_selection ?? false,
          created_at: existing.created_at,
          idempotent: true,
        },
        { status: 200 }
      );
    }
  }

  // ── 7. Create the conversation ──
  // No email_account_id when the agent didn't pre-select one — operator
  // picks at review time. from_name / from_email stay null until that
  // happens, since the conv has no "sender" perspective yet.
  // primary_contact_is_manual must be true (NOT NULL constraint); the
  // agent is explicitly setting the contact via to_email.
  const computedBodyText =
    bodyText ?? (bodyHtml as string).replace(/<[^>]*>/g, "").slice(0, 5000);

  const threadId = `external:${token.name}:${externalId}`;
  const requiresSenderSelection = !emailAccountId;
  const nowIso = new Date().toISOString();

  const { data: conv, error: convErr } = await supabase
    .from("conversations")
    .insert({
      email_account_id: emailAccountId,
      thread_id: threadId,
      subject,
      from_name: null,
      from_email: null,
      preview: computedBodyText.slice(0, 200),
      is_unread: false,
      status: "open",
      last_message_at: nowIso,
      primary_contact_email: toEmail,
      primary_contact_is_manual: true,
    })
    .select("id")
    .single();

  if (convErr || !conv) {
    return NextResponse.json(
      { error: "server_error", detail: convErr?.message || "Failed to create conversation" },
      { status: 500 }
    );
  }

  // ── 8. Create the draft ──
  // Carries the external_id + external_token_id so the unique partial
  // index enforces single-create per (token, external_id), even under
  // concurrent retries.
  const toAddressFormatted = toName
    ? `"${toName.replace(/"/g, '\\"')}" <${toEmail}>`
    : toEmail;

  const { data: draft, error: draftErr } = await supabase
    .from("email_drafts")
    .insert({
      conversation_id: conv.id,
      email_account_id: emailAccountId,
      author_id: null,
      to_addresses: [toAddressFormatted],
      subject,
      body_html: bodyHtml,
      body_text: computedBodyText,
      is_reply: false,
      source: "agent",
      created_by_agent: token.name,
      requires_sender_selection: requiresSenderSelection,
      external_id: externalId,
      external_token_id: token.id,
    })
    .select("id, created_at, requires_sender_selection")
    .single();

  if (draftErr) {
    // Unique constraint violation = concurrent request with the same
    // external_id beat us to the insert. Clean up the orphan conv we
    // created in step 7, re-fetch the winner's draft, and return its IDs
    // as an idempotent replay.
    if ((draftErr as any).code === "23505") {
      await supabase.from("conversations").delete().eq("id", conv.id);

      const { data: winner } = await supabase
        .from("email_drafts")
        .select("id, conversation_id, requires_sender_selection, created_at")
        .eq("external_token_id", token.id)
        .eq("external_id", externalId)
        .maybeSingle();

      if (winner) {
        return NextResponse.json(
          {
            conversation_id: winner.conversation_id,
            draft_id: winner.id,
            requires_sender_selection: winner.requires_sender_selection ?? false,
            created_at: winner.created_at,
            idempotent: true,
          },
          { status: 200 }
        );
      }
    }

    // Other failure — clean up the orphan conv and bail.
    await supabase.from("conversations").delete().eq("id", conv.id);
    return NextResponse.json(
      { error: "server_error", detail: draftErr.message },
      { status: 500 }
    );
  }

  if (!draft) {
    // Defensive: PostgREST returned no row but no error. Clean up.
    await supabase.from("conversations").delete().eq("id", conv.id);
    return NextResponse.json(
      { error: "server_error", detail: "Draft insert returned no row" },
      { status: 500 }
    );
  }

  // ── 9. Activity log (fire-and-forget) ──
  // The conv shows "Sammy agent v1 created this conversation" in the
  // operator audit trail. Best-effort; don't block the response if it
  // fails.
  supabase
    .from("activity_log")
    .insert({
      conversation_id: conv.id,
      actor_id: null,
      action: "agent_conversation_created",
      details: {
        agent_name: token.name,
        token_id: token.id,
        external_id: externalId,
        draft_id: draft.id,
        to_email: toEmail,
        requires_sender_selection: requiresSenderSelection,
        context: context || undefined,
      },
    })
    .then(({ error: logErr }) => {
      if (logErr) console.error("[external/conversations] audit log failed:", logErr.message);
    });

  // ── 10. Confirmation webhook ──
  // Sam asked for this so his agent can confirm the create succeeded even
  // if the synchronous 201 response is lost. Awaited (rather than fire-
  // and-forget) because in Vercel serverless the function may terminate
  // before a fire-and-forget promise completes. The dispatcher's internal
  // 5s timeout bounds the worst-case latency added to the response.
  try {
    await dispatchConversationCreatedWebhook({
      conversationId: conv.id,
      draftId: draft.id,
      tokenId: token.id,
      agentName: token.name,
      externalId,
      toEmail,
      toName,
      subject,
      requiresSenderSelection,
      createdAt: draft.created_at,
      context,
    });
  } catch (e: any) {
    // Webhook failure must NOT fail the create — it's a delivery-resilience
    // signal, not part of the create transaction. Log and move on.
    console.error("[external/conversations] confirmation webhook failed:", e?.message);
  }

  // ── 11. Return 201 Created ──
  return NextResponse.json(
    {
      conversation_id: conv.id,
      draft_id: draft.id,
      requires_sender_selection: requiresSenderSelection,
      created_at: draft.created_at,
      idempotent: false,
    },
    { status: 201 }
  );
}