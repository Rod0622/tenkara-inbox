import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { authenticateBearer, hasScope } from "@/lib/api-token-auth";
import { checkAndRecordRateLimit, rateLimitedResponse } from "@/lib/api-token-rate-limit";
import { dispatchDraftWebhook } from "@/lib/api-token-webhook";

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
  const draftId = req.nextUrl.searchParams.get("id");
  // Personal Drafts queue mode — see the block below.
  const personalQueueUserId = req.nextUrl.searchParams.get("personal_queue");

  // Single-draft fetch by id. Used to pull the FULL body on demand (e.g. at
  // send time) so list views (like Pending Outreach) can poll a lightweight
  // preview instead of shipping full bodies on every refresh. Returns one draft.
  if (draftId) {
    const { data: one, error: oneErr } = await supabase
      .from("email_drafts")
      .select(`
        *,
        conversation:conversations(id, subject, from_name, from_email, email_account_id),
        account:email_accounts(id, name, email),
        author:team_members!email_drafts_author_id_fkey(id, name, initials, color)
      `)
      .eq("id", draftId)
      .maybeSingle();
    if (oneErr) return NextResponse.json({ error: oneErr.message }, { status: 500 });
    if (!one) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    return NextResponse.json({ draft: one });
  }

  // ── Personal Drafts queue ────────────────────────────────────────
  // Every unsent draft the given user needs to act on, across EVERY folder
  // and stage:
  //   • agent drafts on conversations assigned to them (incl. mid-pipeline
  //     threads, e.g. an agent reply on a thread already in 2 - Quotes)
  //   • drafts they authored themselves, even on threads assigned elsewhere
  //   • their own standalone compose drafts (conversation_id null)
  //
  // EXCLUDED: drafts on UNASSIGNED conversations sitting in a Pending Outreach
  // folder. Those are unclaimed team outreach — they belong to the shared
  // Pending Outreach folder until someone sends one and thereby claims it.
  //
  // Note there is no "sent" flag to filter on: drafts are deleted on send
  // (see /api/send Phase 2), so every row here is by definition unsent.
  //
  // Membership is an OR across a join, which PostgREST can't express in a
  // single request, so it's two queries merged and deduped by draft id.
  if (personalQueueUserId) {
    // ── Personal Drafts queue ──────────────────────────────────────────
    // Membership (Rod's decision 2026-07-29, "option B"):
    //   1. any draft on a conversation ASSIGNED TO the user
    //   2. drafts the user AUTHORED on an UNASSIGNED conversation
    //   3. the user's own standalone drafts (no conversation)
    //
    // DELIBERATELY EXCLUDED: drafts the user authored on a conversation
    // assigned to SOMEONE ELSE. Those used to appear here (the earlier rule
    // included all authored drafts regardless of assignment), which surfaced
    // 24 of Rod's drafts sitting on Mildred's / Sharmaine's / Carvey's
    // threads. The conversation list shows the THREAD's assignee, so they
    // read as other people's work. They remain reachable by opening the
    // thread — they are not deleted, just not in this queue.
    //
    // ALSO EXCLUDED: drafts on unassigned conversations in a Pending Outreach
    // folder — unclaimed team outreach belongs to the shared folder until
    // someone sends one and thereby claims it.
    //
    // No PostgREST embedded-resource filters here. The previous version used
    // .eq("conversation.assignee_id", …) against a !inner join; that class of
    // filter fails silently if the path isn't resolved, and silent-wrong is
    // the worst failure mode for an access rule. Everything below filters on
    // plain top-level columns and then re-checks in JS.
    //
    // Bodies are NOT selected. This endpoint feeds a LIST; body_html /
    // body_text are large and were a material part of the ~3s open latency.
    // The editor fetches the body per-draft via ?id= when a draft is opened.
    const DRAFT_LIST_FIELDS =
      "id, conversation_id, email_account_id, author_id, created_by_agent, " +
      "created_by_token_id, subject, to_addresses, cc_addresses, " +
      "requires_sender_selection, source, is_reply, created_at, updated_at";

    // 1. Conversations assigned to this user.
    const { data: myConvos, error: mcErr } = await supabase
      .from("conversations")
      .select("id")
      .eq("assignee_id", personalQueueUserId);
    if (mcErr) return NextResponse.json({ error: mcErr.message }, { status: 500 });
    const myConvoIds = (myConvos || []).map((r: any) => r.id);

    // 2. Drafts on those conversations. Chunked: a long .in() list builds a
    //    very long querystring (same class of failure as the bulk-discard 414).
    const CHUNK = 100;
    const draftsOnMyConvos: any[] = [];
    for (let i = 0; i < myConvoIds.length; i += CHUNK) {
      const slice = myConvoIds.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("email_drafts")
        .select(DRAFT_LIST_FIELDS)
        .in("conversation_id", slice);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      draftsOnMyConvos.push(...(data || []));
    }

    // 3. Drafts this user authored (any thread, plus standalone).
    const { data: authored, error: aErr } = await supabase
      .from("email_drafts")
      .select(DRAFT_LIST_FIELDS)
      .eq("author_id", personalQueueUserId);
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 });

    // 4. Assignment + folder for every conversation referenced above, so the
    //    rule can be applied without trusting an embedded filter.
    const byId = new Map<string, any>();
    for (const d of [...draftsOnMyConvos, ...(authored || [])]) {
      if (d?.id && !byId.has(d.id)) byId.set(d.id, d);
    }
    const allDrafts = Array.from(byId.values());
    const convoIds = Array.from(
      new Set(allDrafts.map((d: any) => d.conversation_id).filter(Boolean))
    );

    const convoMeta = new Map<string, { assignee_id: string | null; folder: string }>();
    for (let i = 0; i < convoIds.length; i += CHUNK) {
      const slice = convoIds.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from("conversations")
        .select("id, assignee_id, folder:folders(name)")
        .in("id", slice);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const c of (data || []) as any[]) {
        convoMeta.set(c.id, {
          assignee_id: c.assignee_id || null,
          folder: (c.folder?.name || "").trim().toLowerCase(),
        });
      }
    }

    // 5. Apply the rule.
    const merged = allDrafts.filter((d: any) => {
      // Standalone: mine if I authored it.
      if (!d.conversation_id) return d.author_id === personalQueueUserId;

      const meta = convoMeta.get(d.conversation_id);
      if (!meta) return false; // conversation missing/merged away

      // Unclaimed team outreach stays in the shared folder.
      if (!meta.assignee_id && meta.folder === "pending outreach") return false;

      // (1) assigned to me — any draft on it, including an agent's.
      if (meta.assignee_id === personalQueueUserId) return true;

      // (2) mine, on a thread nobody has claimed.
      if (!meta.assignee_id && d.author_id === personalQueueUserId) return true;

      // Authored by me but assigned to someone else → excluded.
      return false;
    });

    // Newest draft activity first. The client may reverse this for its
    // oldest-first sort; ordering here is the canonical queue order.
    merged.sort((a: any, b: any) =>
      String(b.updated_at || "").localeCompare(String(a.updated_at || ""))
    );

    return NextResponse.json({
      drafts: merged,
      // Conversation ids for the client to hydrate full conversation rows using
      // its own CONVERSATION_SELECT_FIELDS — one definition of the conversation
      // shape, and independent of the recent-conversations window.
      conversation_ids: Array.from(
        new Set(merged.map((d: any) => d.conversation_id).filter(Boolean))
      ),
      standalone_count: merged.filter((d: any) => !d.conversation_id).length,
    });
  }

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
//        - created_by_agent is set to the token's NAME (e.g. "Sammy agent v1")
//        - created_by_token_id is set to the token's stable UUID
//
//      Partners should match on created_by_token_id, NOT created_by_agent.
//      The name is mutable: renaming a token would silently break any
//      name-based filter with no error (the filter just matches nothing).
//      Note the value is lowercase "agent" — this comment previously said
//      "Sammy Agent v1", and a well-meaning "correction" to the token name
//      to match it is exactly the failure mode described above.
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
    // Phase 2: rate limit. After auth + scope check but before any DB writes
    // so a blocked client doesn't burn write budget.
    const rl = await checkAndRecordRateLimit(agentToken!.id, "/api/drafts");
    if (!rl.allowed) return rateLimitedResponse(rl);
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
      updatePayload.created_by_token_id = agentToken!.id;
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

    // Phase 2: audit log entry for agent-driven updates. Operator updates
    // are already implicit via the draft's updated_at — no need to log them.
    if (isAgentRequest && data?.conversation_id) {
      supabase.from("activity_log").insert({
        conversation_id: data.conversation_id,
        actor_id: null,
        action: "agent_draft_updated",
        details: {
          agent_name: agentToken!.name,
          draft_id: data.id,
          token_id: agentToken!.id,
        },
      }).then(({ error: logErr }) => {
        if (logErr) console.error("[drafts/POST] audit log failed:", logErr.message);
      });
    }

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
    insertPayload.created_by_token_id = agentToken!.id;
    insertPayload.requires_sender_selection = requiresSenderSelection;
  }

  const { data, error } = await supabase
    .from("email_drafts")
    .insert(insertPayload)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Phase 2: audit log entry for agent-driven creates so the conversation
  // history pane shows "Sammy Agent v1 created a draft".
  if (isAgentRequest && data?.conversation_id) {
    supabase.from("activity_log").insert({
      conversation_id: data.conversation_id,
      actor_id: null,
      action: "agent_draft_created",
      details: {
        agent_name: agentToken!.name,
        draft_id: data.id,
        token_id: agentToken!.id,
        requires_sender_selection: data.requires_sender_selection,
      },
    }).then(({ error: logErr }) => {
      if (logErr) console.error("[drafts/POST] audit log failed:", logErr.message);
    });
  }

  return NextResponse.json({ draft: data });
}

// DELETE /api/drafts?id=xxx or ?conversation_id=xxx
//
// Phase 2: If the draft being deleted was created by an external agent
// (created_by_agent IS NOT NULL), we fire a "draft.discarded" webhook to
// the partner so they know the operator chose not to send it. This is the
// "discard" half of the send/discard event pair — the "sent" event fires
// from /api/send when the operator hits Send.
//
// Important: we fetch the draft row BEFORE delete so we have the fields
// needed by the webhook. The delete proceeds even if the webhook dispatch
// fails (best-effort).
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();

  // OPTIONAL bearer auth. When a valid API token is present the caller is an
  // external agent, and a conversation-scoped delete is narrowed to that
  // token's OWN drafts (see the conversationId branch below).
  //
  // Why this matters: an operator can have their own hand-written draft on the
  // same thread as an agent draft. Those are distinguished at the DRAFT level
  // by email_drafts.created_by_agent — NOT by the "Super Agent" label, which
  // lives on the CONVERSATION and therefore marks both drafts alike.
  //
  // Without a token (the app UI / operator path) behaviour is unchanged.
  // Operators discarding agent drafts is the intended review workflow.
  const agentToken = await authenticateBearer(req);
  const agentScope = agentToken?.name || null;

  const id = req.nextUrl.searchParams.get("id");
  // Bulk discard: ?ids=<uuid>,<uuid>,... — used by Pending Outreach's
  // multi-select delete. Same lifecycle as single discard (per-draft
  // draft.discarded webhook + audit log below), just batched. Capped at
  // 200 ids per call to bound URL length and webhook fan-out.
  const idsParam = req.nextUrl.searchParams.get("ids");
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  const ids = idsParam
    ? idsParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 200)
    : [];

  // "discarded_by_send" param distinguishes the operator hitting Send
  // (which deletes the draft as part of the send flow) from a manual
  // discard. /api/send sets this when it deletes an agent draft after
  // a successful send so we DON'T double-fire (sent + discarded for the
  // same action). Operators discarding via the UI omit this param.
  const discardedBySend = req.nextUrl.searchParams.get("discarded_by_send") === "1";

  // Pre-fetch the draft(s) we're about to delete so we can fire webhooks +
  // audit-log entries with full context.
  type DraftRow = {
    id: string;
    conversation_id: string | null;
    created_by_agent: string | null;
    created_by_token_id: string | null;
    email_account_id: string | null;
    subject: string | null;
    to_addresses: string | null;
  };
  let draftsToDelete: DraftRow[] = [];

  if (id) {
    const { data } = await supabase
      .from("email_drafts")
      .select("id, conversation_id, created_by_agent, created_by_token_id, email_account_id, subject, to_addresses")
      .eq("id", id);
    draftsToDelete = (data || []) as DraftRow[];
  } else if (ids.length > 0) {
    const { data } = await supabase
      .from("email_drafts")
      .select("id, conversation_id, created_by_agent, created_by_token_id, email_account_id, subject, to_addresses")
      .in("id", ids);
    draftsToDelete = (data || []) as DraftRow[];
  } else if (conversationId) {
    let sel = supabase
      .from("email_drafts")
      .select("id, conversation_id, created_by_agent, created_by_token_id, email_account_id, subject, to_addresses")
      .eq("conversation_id", conversationId);
    if (agentScope) sel = sel.eq("created_by_agent", agentScope);
    const { data } = await sel;
    draftsToDelete = (data || []) as DraftRow[];
  } else {
    return NextResponse.json({ error: "id, ids, or conversation_id required" }, { status: 400 });
  }

  // Do the actual delete.
  if (id) {
    const { error } = await supabase.from("email_drafts").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (ids.length > 0) {
    const { error } = await supabase.from("email_drafts").delete().in("id", ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (conversationId) {
    let del = supabase.from("email_drafts").delete().eq("conversation_id", conversationId);
    // Agent callers may only clear their own drafts on the thread — never an
    // operator's hand-written one.
    if (agentScope) del = del.eq("created_by_agent", agentScope);
    const { error } = await del;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fire webhooks + audit log for agent drafts. Skipped when discardedBySend
  // is true — that's the send-flow path which fires draft.sent instead.
  if (!discardedBySend) {
    for (const d of draftsToDelete) {
      if (!d.created_by_agent) continue;

      // Best-effort webhook
      dispatchDraftWebhook("draft.discarded", d, {
        // No operator id available on a DELETE — partner can query who
        // discarded via conversation activity if they want.
      }).catch((e) => console.error("[drafts/DELETE] webhook error:", e?.message));

      // Audit log
      if (d.conversation_id) {
        supabase.from("activity_log").insert({
          conversation_id: d.conversation_id,
          actor_id: null,
          action: "agent_draft_discarded",
          details: {
            agent_name: d.created_by_agent,
            agent_token_id: d.created_by_token_id,
            draft_id: d.id,
          },
        }).then(({ error: logErr }) => {
          if (logErr) console.error("[drafts/DELETE] audit log failed:", logErr.message);
        });
      }
    }
  }

  return NextResponse.json({ success: true, deleted: draftsToDelete.length });
}