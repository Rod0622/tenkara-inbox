import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { authenticateBearer, hasScope } from "@/lib/api-token-auth";

// GET /api/drafts — list drafts.
// Filters (all optional, combinable):
//   conversation_id   — drafts for a specific conversation
//   conversation_id=null with standalone=true — standalone (compose) drafts
//   author_id         — drafts authored by a specific user (used for personal Drafts view)
//   email_account_id  — drafts on a specific email account (used for the per-account
//                       "Drafts" folder in the sidebar, which shows the TEAM's drafts
//                       on that account regardless of author)
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");
  const authorId = req.nextUrl.searchParams.get("author_id");
  const emailAccountId = req.nextUrl.searchParams.get("email_account_id");
  const standaloneOnly = req.nextUrl.searchParams.get("standalone") === "true";

  let query = supabase
    .from("email_drafts")
    .select(`
      *,
      conversation:conversations(id, subject, from_name, from_email, email_account_id),
      account:email_accounts(id, name, email),
      author:team_members!email_drafts_author_id_fkey(id, name, initials, color)
    `)
    .order("updated_at", { ascending: false });

  if (conversationId) query = query.eq("conversation_id", conversationId);
  if (authorId) query = query.eq("author_id", authorId);
  if (emailAccountId) query = query.eq("email_account_id", emailAccountId);
  if (standaloneOnly) query = query.is("conversation_id", null);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ drafts: data || [] });
}

// POST /api/drafts — create or update a draft
//   - conversation_id present: reply draft (existing behavior, unique per conversation+author)
//   - conversation_id absent/null: standalone compose draft (unique per author)
//
// Authentication: two modes are supported.
//   1. NextAuth session (existing flow): operators use this through the web app
//   2. Bearer token (Phase 1, external integrations): partner agents like
//      Sammy's drafting bot. Token must carry "drafts:write" scope. For
//      token-authed POSTs:
//        - author_id can be null (the agent isn't a team_member)
//        - email_account_id can be null (operator picks sender at review time)
//        - created_by_agent is set to the token's name (e.g. "Sammy Agent v1")
//        - requires_sender_selection is true when email_account_id is null,
//          which the UI uses to block Send until an operator picks an account
//      Uniqueness for agent drafts is keyed on (conversation_id, created_by_agent)
//      so each agent gets one draft slot per conversation.
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const {
    conversation_id,
    email_account_id,
    author_id,
    to_addresses,
    cc_addresses,
    bcc_addresses,
    subject,
    body_html,
    body_text,
    is_reply,
    source,
  } = body;

  // Try to authenticate as a bearer-token request. If null, this is a normal
  // session-authed call (which we don't gate further at this layer — operator
  // requests come through with their own author_id).
  const agentToken = await authenticateBearer(req);
  const isAgentRequest = agentToken !== null;

  if (isAgentRequest) {
    // Bearer-token requests must carry drafts:write
    if (!hasScope(agentToken, "drafts:write")) {
      return NextResponse.json(
        { error: "Token missing required scope: drafts:write" },
        { status: 403 }
      );
    }
    // Agents must target an existing conversation. Standalone agent drafts
    // (no conversation) don't have a natural review surface yet — easier to
    // require conversation_id for Phase 1.
    if (!conversation_id) {
      return NextResponse.json(
        { error: "conversation_id is required for agent-created drafts" },
        { status: 400 }
      );
    }
  } else {
    // Session-authed flow: keep the original constraint. Standalone drafts
    // require an author_id to enforce the partial unique index (one
    // standalone draft per author).
    if (!conversation_id && !author_id) {
      return NextResponse.json({ error: "author_id is required for standalone drafts" }, { status: 400 });
    }
  }

  const computedBodyText =
    body_text ?? (body_html || "").replace(/<[^>]*>/g, "").slice(0, 5000);

  // Find an existing draft to update.
  //   - Agent flow:    match (conversation_id, created_by_agent = token.name)
  //   - Session flow:  match (conversation_id, author_id) or (NULL, author_id) for standalone
  let existingQuery = supabase
    .from("email_drafts")
    .select("id");

  if (isAgentRequest) {
    existingQuery = existingQuery
      .eq("conversation_id", conversation_id)
      .eq("created_by_agent", agentToken!.name);
  } else {
    existingQuery = existingQuery.eq("author_id", author_id || "");
    if (conversation_id) {
      existingQuery = existingQuery.eq("conversation_id", conversation_id);
    } else {
      existingQuery = existingQuery.is("conversation_id", null);
    }
  }

  const { data: existing } = await existingQuery.maybeSingle();

  // requires_sender_selection: only meaningful for agent drafts where no
  // account was specified. The operator must pick an account before Send.
  // Once they pick (in the UI), email_account_id is set and this flag
  // should be cleared — handled by the existing flow that updates the
  // draft body / metadata.
  const requiresSenderSelection = isAgentRequest && !email_account_id;

  if (existing) {
    // Build the update payload. For agent drafts, also propagate created_by_agent
    // and requires_sender_selection so toggling between agent and session
    // updates stays consistent (an operator manually editing an agent draft
    // can clear requires_sender_selection by selecting an account).
    const updatePayload: any = {
      to_addresses,
      cc_addresses,
      bcc_addresses,
      subject,
      body_html,
      body_text: computedBodyText,
      email_account_id: email_account_id || null,
      is_reply: is_reply ?? !!conversation_id,
      source: source || (isAgentRequest ? "agent" : "manual"),
      updated_at: new Date().toISOString(),
    };
    if (isAgentRequest) {
      updatePayload.created_by_agent = agentToken!.name;
      updatePayload.requires_sender_selection = requiresSenderSelection;
    } else if (email_account_id) {
      // Operator manually selected an account on a draft that previously
      // had requires_sender_selection — clear the flag so Send unlocks.
      updatePayload.requires_sender_selection = false;
    }

    const { data, error } = await supabase
      .from("email_drafts")
      .update(updatePayload)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ draft: data });
  }

  // Create new draft
  const insertPayload: any = {
    conversation_id: conversation_id || null,
    email_account_id: email_account_id || null,
    author_id: isAgentRequest ? null : (author_id || null),
    to_addresses,
    cc_addresses,
    bcc_addresses,
    subject,
    body_html,
    body_text: computedBodyText,
    is_reply: is_reply ?? !!conversation_id,
    source: source || (isAgentRequest ? "agent" : "manual"),
  };
  if (isAgentRequest) {
    insertPayload.created_by_agent = agentToken!.name;
    insertPayload.requires_sender_selection = requiresSenderSelection;
  }

  const { data, error } = await supabase
    .from("email_drafts")
    .insert(insertPayload)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ draft: data });
}

// DELETE /api/drafts?id=xxx or ?conversation_id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  if (id) {
    const { error } = await supabase.from("email_drafts").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (conversationId) {
    const { error } = await supabase.from("email_drafts").delete().eq("conversation_id", conversationId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "id or conversation_id required" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}