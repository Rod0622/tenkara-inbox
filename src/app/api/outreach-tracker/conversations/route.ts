import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * /api/outreach-tracker/conversations
 *
 * Powers the Outreach Tracker page — one row per conversation, with all the
 * joined data the table renders. Replaces the old per-(supplier × account)
 * view that lived under /api/team-coverage.
 *
 * GET   — list conversations with filters + joined data
 * PATCH — update outreach_status_id / material_inquiry / follow_up_log
 *         on a single conversation
 *
 * Auth: relies on createServerClient's RLS-aware client. Anyone with read
 * access to a conversation can see it in the tracker.
 */

// Up to this many conversations are returned in one GET. Far above any
// realistic active workload; the page also has client-side filters that
// narrow the list before render. If you ever cross this ceiling, add
// cursor pagination — keys would be (last_message_at DESC, id DESC).
const MAX_ROWS = 5000;

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const { searchParams } = new URL(req.url);

  // ── Parse filters from query string ─────────────────────────────
  // All filters are optional. Multi-value filters use comma-separated
  // ids (matches MultiSelectDropdown's URL serialization elsewhere).
  const accountIds   = (searchParams.get("account_ids")  || "").split(",").filter(Boolean);
  const statusIds    = (searchParams.get("status_ids")   || "").split(",").filter(Boolean);
  const assigneeIds  = (searchParams.get("assignee_ids") || "").split(",").filter(Boolean);
  const labelIds     = (searchParams.get("label_ids")    || "").split(",").filter(Boolean);
  const sublabelIds  = (searchParams.get("sublabel_ids") || "").split(",").filter(Boolean);
  const search       = (searchParams.get("q") || "").trim();
  const createdFrom  = searchParams.get("created_from"); // ISO date
  const createdTo    = searchParams.get("created_to");

  // ── Pre-filter by labels (server-side) ──────────────────────────
  // If the user picked label_ids and/or sublabel_ids, narrow the
  // conversation set BEFORE the main fetch. Semantics:
  //   • OR within a single filter (any of the picked labels matches)
  //   • AND across the two filters (must match both label AND sublabel)
  // This mirrors how account / status / assignee filters compose.
  // Performance: each pre-query reads conversation_labels rows for
  // the picked label ids only — usually a small set, fast.
  let labelFilteredIds: string[] | null = null;

  if (labelIds.length > 0) {
    const { data, error } = await supabase
      .from("conversation_labels")
      .select("conversation_id")
      .in("label_id", labelIds);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    labelFilteredIds = Array.from(new Set((data || []).map((r: any) => r.conversation_id)));
  }

  if (sublabelIds.length > 0) {
    const { data, error } = await supabase
      .from("conversation_labels")
      .select("conversation_id")
      .in("label_id", sublabelIds);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const sublabelSet = new Set((data || []).map((r: any) => r.conversation_id));
    if (labelFilteredIds === null) {
      labelFilteredIds = Array.from(sublabelSet);
    } else {
      // Intersect: must match BOTH a chosen label AND a chosen sublabel
      labelFilteredIds = labelFilteredIds.filter((id) => sublabelSet.has(id));
    }
  }

  // Short-circuit: label filters that resolve to zero matches don't
  // need the main fetch.
  if (labelFilteredIds !== null && labelFilteredIds.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  // ── Base query against conversations ────────────────────────────
  // We fetch the convo row with primary contact, assignee, account,
  // outreach status, all joined in. Labels and the call task come via
  // secondary queries so the row count stays predictable.
  let q = supabase
    .from("conversations")
    .select(
      `
      id,
      subject,
      created_at,
      last_message_at,
      from_email,
      from_name,
      primary_contact_email,
      assignee_id,
      email_account_id,
      outreach_status_id,
      material_inquiry,
      follow_up_log,
      status,
      email_account:email_accounts!conversations_email_account_id_fkey ( id, name, email ),
      assignee:team_members!conversations_assignee_id_fkey ( id, name, initials, color, avatar_url ),
      outreach_status:outreach_statuses!conversations_outreach_status_id_fkey ( id, name, sort_order, color )
      `
    )
    // Hide trash/spam from the tracker — outreach is a positive-direction
    // workflow, those don't belong on the board.
    .not("status", "in", "(trash,spam)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(MAX_ROWS);

  if (accountIds.length)             q = q.in("email_account_id", accountIds);
  if (statusIds.length)              q = q.in("outreach_status_id", statusIds);
  if (assigneeIds.length)            q = q.in("assignee_id", assigneeIds);
  if (labelFilteredIds !== null)     q = q.in("id", labelFilteredIds);
  if (createdFrom)                   q = q.gte("created_at", createdFrom);
  if (createdTo)                     q = q.lte("created_at", createdTo);
  if (search) {
    // ilike on subject + from_email + primary_contact_email gives a
    // friendly "search by what you see" feel. Tightly bounded with %.
    const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
    q = q.or(
      `subject.ilike.${pattern},from_email.ilike.${pattern},primary_contact_email.ilike.${pattern},from_name.ilike.${pattern}`
    );
  }

  const { data: convos, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const conversationIds = (convos || []).map((c: any) => c.id);
  if (conversationIds.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  // ── Labels (parents and children separately for the two columns) ──
  // The page wants two columns: Label (top-level) and Sublabel (children).
  // We resolve label.parent_label_id NULL = top-level.
  const { data: convLabels } = await supabase
    .from("conversation_labels")
    .select(
      `
      conversation_id,
      label:labels ( id, name, parent_label_id, color )
      `
    )
    .in("conversation_id", conversationIds);

  const labelsByConvo: Map<string, { parents: string[]; children: string[] }> = new Map();
  for (const cl of (convLabels || []) as any[]) {
    const cid = cl.conversation_id;
    const label = cl.label;
    if (!label) continue;
    let entry = labelsByConvo.get(cid);
    if (!entry) {
      entry = { parents: [], children: [] };
      labelsByConvo.set(cid, entry);
    }
    if (label.parent_label_id) {
      entry.children.push(label.name);
    } else {
      entry.parents.push(label.name);
    }
  }

  // ── Caller (derived from tasks where category = 'call') ─────────
  // One row per (conversation, caller). Conversations with no call
  // task have no caller. The latest-by-created_at call task wins if
  // a conversation somehow has multiple.
  const { data: callTasks } = await supabase
    .from("tasks")
    .select(
      `
      conversation_id,
      created_at,
      assignee:team_members!tasks_assignee_id_fkey ( id, name, initials, color, avatar_url )
      `
    )
    .in("conversation_id", conversationIds)
    .eq("category", "call")
    .order("created_at", { ascending: false });

  const callerByConvo = new Map<string, any>();
  for (const t of (callTasks || []) as any[]) {
    // First-write-wins (we ordered DESC, so this is the latest task)
    if (!callerByConvo.has(t.conversation_id) && t.assignee) {
      callerByConvo.set(t.conversation_id, t.assignee);
    }
  }

  // ── Assemble final rows ─────────────────────────────────────────
  const rows = (convos || []).map((c: any) => {
    const labelEntry = labelsByConvo.get(c.id) || { parents: [], children: [] };
    return {
      id:                    c.id,
      subject:               c.subject,
      created_at:            c.created_at,
      last_message_at:       c.last_message_at,
      labels:                labelEntry.parents,
      sublabels:             labelEntry.children,
      supplier: {
        // The "supplier involved" cell — primary_contact_email wins over
        // raw from_email when present (it's the curated contact). Falls
        // back to from_email which is the raw header sender.
        email: c.primary_contact_email || c.from_email || null,
        name:  c.from_name || null,
      },
      assignee:        c.assignee || null,
      caller:          callerByConvo.get(c.id) || null,
      account:         c.email_account || null,
      outreach_status: c.outreach_status || null,
      material_inquiry: c.material_inquiry || "",
      follow_up_log:    c.follow_up_log    || "",
    };
  });

  return NextResponse.json({ rows });
}

/**
 * PATCH — update outreach_status_id / material_inquiry / follow_up_log
 * on a single conversation. Subject editing has its own endpoint
 * (/api/conversations/subject) — don't duplicate it here so the cascade
 * + activity-log behavior stays consistent.
 *
 * Body: { conversation_id, actor_id?, fields: { ... } }
 *   fields may include any subset of:
 *     outreach_status_id (uuid | null)
 *     material_inquiry   (string)
 *     follow_up_log      (string)
 */
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const conversationId = body.conversation_id || body.conversationId;
  const actorId        = body.actor_id || null;
  const fields         = body.fields || {};

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  // Whitelist updatable fields. Anything not in this set is silently
  // dropped — prevents accidental writes to e.g. assignee_id from a
  // mis-targeted PATCH.
  const allowed: Record<string, true> = {
    outreach_status_id: true,
    material_inquiry:   true,
    follow_up_log:      true,
  };
  const update: Record<string, any> = {};
  for (const key of Object.keys(fields)) {
    if (allowed[key]) update[key] = fields[key];
  }
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "no updatable fields provided" }, { status: 400 });
  }

  // Length caps on the free-text columns. The textareas in the UI also
  // soft-cap; this is the backend guard.
  if (typeof update.material_inquiry === "string" && update.material_inquiry.length > 5000) {
    return NextResponse.json({ error: "material_inquiry too long (max 5000)" }, { status: 400 });
  }
  if (typeof update.follow_up_log === "string" && update.follow_up_log.length > 10000) {
    return NextResponse.json({ error: "follow_up_log too long (max 10000)" }, { status: 400 });
  }

  // Fetch prior values for the activity log diff. One row, cheap.
  const { data: pre } = await supabase
    .from("conversations")
    .select("outreach_status_id, material_inquiry, follow_up_log")
    .eq("id", conversationId)
    .single();

  const { data, error } = await supabase
    .from("conversations")
    .update(update)
    .eq("id", conversationId)
    .select(
      `
      id, outreach_status_id, material_inquiry, follow_up_log,
      outreach_status:outreach_statuses!conversations_outreach_status_id_fkey ( id, name, sort_order, color )
      `
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Activity log — only audit status changes (material/follow-up notes
  // get edited constantly; logging every keystroke is noise). Resolve
  // the status name on both sides for human-readable history.
  if ("outreach_status_id" in update && pre?.outreach_status_id !== update.outreach_status_id) {
    const ids = [pre?.outreach_status_id, update.outreach_status_id].filter(Boolean) as string[];
    let nameMap = new Map<string, string>();
    if (ids.length) {
      const { data: statuses } = await supabase
        .from("outreach_statuses")
        .select("id, name")
        .in("id", ids);
      for (const s of (statuses || []) as any[]) nameMap.set(s.id, s.name);
    }
    await supabase.from("activity_log").insert({
      conversation_id: conversationId,
      actor_id: actorId,
      action: "outreach_status_changed",
      details: {
        old_status_id: pre?.outreach_status_id || null,
        new_status_id: update.outreach_status_id || null,
        old_status_name: pre?.outreach_status_id ? nameMap.get(pre.outreach_status_id) || null : null,
        new_status_name: update.outreach_status_id ? nameMap.get(update.outreach_status_id) || null : null,
      },
    });
  }

  return NextResponse.json({ conversation: data });
}