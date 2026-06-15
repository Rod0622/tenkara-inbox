import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * /api/outreach-tracker/conversations
 *
 * Powers the Outreach Tracker page — one row per conversation, with all the
 * joined data the table renders.
 *
 * GET   — list conversations with filters + joined data
 * PATCH — update outreach_status_id / material_inquiry / follow_up_log
 *         on a single conversation
 *
 * Auth: relies on createServerClient's RLS-aware client. Anyone with read
 * access to a conversation can see it in the tracker.
 *
 * Sort order (handled at SQL layer):
 *   has_outreach_status DESC  — statused convs first
 *   has_any_label       DESC  — within each tier, labeled before unlabeled
 *   last_message_at     DESC  — within each tier, newest first
 *
 * The PostgREST max-rows cap (default 1000) clamps result size, but with
 * this ordering the top-1000 returned are always the most actionable —
 * statused/labeled work surfaces above noise (OTPs, security alerts,
 * promotional emails) that would otherwise dominate a recency-only sort.
 */

// Hard ceiling; the PostgREST server cap (max-rows) may clamp this lower.
const MAX_ROWS = 5000;

// Kong / PostgREST cap URL length around 8KB. With 36-char UUIDs plus
// commas plus URL encoding, a single .in() clause exceeds that around
// 200 ids. 150 keeps us well under the limit even with extra params.
// Chunks are dispatched in parallel via Promise.all, so latency cost
// is ~one round trip regardless of chunk count.
const ID_CHUNK = 150;

// Run an .in("conversation_id", chunk) query in parallel chunks and
// concatenate the results. Used for both the labels and tasks enrichment
// queries below.
async function fetchInChunks<T = any>(
  ids: string[],
  // PromiseLike (not Promise) so the supabase-js builder — which is
  // thenable but not a true Promise — passes the type check directly.
  fetchOne: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    chunks.push(ids.slice(i, i + ID_CHUNK));
  }
  const results = await Promise.all(chunks.map((c) => fetchOne(c)));
  const out: T[] = [];
  for (const r of results) {
    if (r.error) {
      // Log but don't throw — partial enrichment is better than no rows at all
      console.error("[outreach-tracker] chunk fetch error:", r.error);
      continue;
    }
    if (r.data) out.push(...r.data);
  }
  return out;
}

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
  let labelFilteredIds: string[] | null = null;

  // ── Account filter is a LABEL filter ────────────────────────────
  // Each email account has a brand label of the SAME NAME (e.g. account
  // "Vita Organica" ↔ label "Vita Organica"). Filtering by account means
  // "conversations carrying that brand's label" — NOT conversations whose
  // email_account_id matches (those diverge: a Vita-account conversation can
  // carry a Bobber Labs label or no brand label, and should be governed by
  // the label). We resolve the selected account ids → their names → the
  // labels with matching names, then restrict by those labels.
  if (accountIds.length > 0) {
    const { data: accs, error: accErr } = await supabase
      .from("email_accounts")
      .select("id, name")
      .in("id", accountIds);
    if (accErr) {
      return NextResponse.json({ error: accErr.message }, { status: 500 });
    }
    const accountNames = (accs || []).map((a: any) => a.name).filter(Boolean);

    let brandLabelConvIds = new Set<string>();
    if (accountNames.length > 0) {
      const { data: brandLabels, error: blErr } = await supabase
        .from("labels")
        .select("id")
        .in("name", accountNames);
      if (blErr) {
        return NextResponse.json({ error: blErr.message }, { status: 500 });
      }
      const brandLabelIds = (brandLabels || []).map((l: any) => l.id);
      if (brandLabelIds.length > 0) {
        const { data: cl, error: clErr } = await supabase
          .from("conversation_labels")
          .select("conversation_id")
          .in("label_id", brandLabelIds);
        if (clErr) {
          return NextResponse.json({ error: clErr.message }, { status: 500 });
        }
        brandLabelConvIds = new Set((cl || []).map((r: any) => r.conversation_id));
      }
    }
    // Account filter is authoritative: intersect into labelFilteredIds.
    labelFilteredIds = Array.from(brandLabelConvIds);
  }

  if (labelIds.length > 0) {
    const { data, error } = await supabase
      .from("conversation_labels")
      .select("conversation_id")
      .in("label_id", labelIds);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const labelSet = new Set<string>((data || []).map((r: any) => r.conversation_id as string));
    if (labelFilteredIds === null) {
      labelFilteredIds = Array.from(labelSet);
    } else {
      // Intersect with the account-derived set (AND).
      labelFilteredIds = labelFilteredIds.filter((id) => labelSet.has(id));
    }
  }

  if (sublabelIds.length > 0) {
    const { data, error } = await supabase
      .from("conversation_labels")
      .select("conversation_id")
      .in("label_id", sublabelIds);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const sublabelSet = new Set<string>((data || []).map((r: any) => r.conversation_id as string));
    if (labelFilteredIds === null) {
      labelFilteredIds = Array.from(sublabelSet);
    } else {
      labelFilteredIds = labelFilteredIds.filter((id) => sublabelSet.has(id));
    }
  }

  if (labelFilteredIds !== null && labelFilteredIds.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  // ── Base query against conversations ────────────────────────────
  // PostgREST clamps each request to its max-rows ceiling (default 1000
  // on Supabase). To reach MAX_ROWS we issue sequential .range() calls
  // and concatenate. Same ORDER BY on each chunk so Postgres returns
  // rows in a deterministic, stable order across calls.
  const CONV_CHUNK = 1000;

  // Apply every filter to a builder. Called per chunk because each
  // chunk needs its own builder instance (.range() finalizes the slice).
  const applyConvFilters = (builder: any) => {
    // NOTE: account filtering is handled via brand labels (see labelFilteredIds
    // above), NOT via email_account_id — the brand label governs membership.
    if (statusIds.length)          builder = builder.in("outreach_status_id", statusIds);
    if (assigneeIds.length)        builder = builder.in("assignee_id", assigneeIds);
    if (labelFilteredIds !== null) builder = builder.in("id", labelFilteredIds);
    if (createdFrom)               builder = builder.gte("created_at", createdFrom);
    if (createdTo)                 builder = builder.lte("created_at", createdTo);
    if (search) {
      const pattern = `%${search.replace(/[%_]/g, "\\$&")}%`;
      builder = builder.or(
        `subject.ilike.${pattern},from_email.ilike.${pattern},primary_contact_email.ilike.${pattern},from_name.ilike.${pattern}`
      );
    }
    return builder;
  };

  const convos: any[] = [];
  for (let from = 0; from < MAX_ROWS; from += CONV_CHUNK) {
    const to = Math.min(from + CONV_CHUNK - 1, MAX_ROWS - 1);

    let chunkQ = supabase
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
      .not("status", "in", "(trash,spam)")
      // Tiered ordering: statused → labeled → recency. Must match across
      // chunks for concatenation to produce a coherent ordered list.
      .order("has_outreach_status", { ascending: false })
      .order("has_any_label",       { ascending: false })
      .order("last_message_at",     { ascending: false, nullsFirst: false })
      .range(from, to);

    chunkQ = applyConvFilters(chunkQ);

    const { data, error } = await chunkQ;
    if (error) {
      // PostgREST returns 416 / PGRST103 when the requested range is
      // past the end of the result set — treat as "no more rows" rather
      // than failing the request.
      const code = (error as any).code;
      const msg  = (error.message || "").toLowerCase();
      if (code === "PGRST103" || msg.includes("range") || msg.includes("not satisfiable")) {
        break;
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data || data.length === 0) break;
    convos.push(...data);
    // Short chunk means we've reached the end of the result set.
    if (data.length < CONV_CHUNK) break;
  }

  const conversationIds = convos.map((c: any) => c.id);
  if (conversationIds.length === 0) {
    return NextResponse.json({ rows: [] });
  }

  // ── Labels (chunked .in() to stay under URL length limit) ───────
  // Kong caps URL length around 8KB. A 1000-id .in() clause is ~37KB
  // and was previously failing silently — labels arrays came back
  // empty even when conversations DID have labels in the DB.
  // We chunk into batches of ID_CHUNK and run in parallel.
  const convLabels = await fetchInChunks<any>(
    conversationIds,
    (chunk) =>
      supabase
        .from("conversation_labels")
        .select(
          `
          conversation_id,
          label:labels ( id, name, parent_label_id, color )
          `
        )
        .in("conversation_id", chunk)
  );

  const labelsByConvo: Map<string, { parents: string[]; children: string[] }> = new Map();
  for (const cl of convLabels as any[]) {
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

  // ── Caller (chunked same way) ───────────────────────────────────
  // Tasks have the same URL-length risk as labels. The query orders
  // each chunk's results DESC so the per-chunk "first" is the latest
  // call task; we then dedupe by conversation_id at merge time.
  const callTasks = await fetchInChunks<any>(
    conversationIds,
    (chunk) =>
      supabase
        .from("tasks")
        .select(
          `
          conversation_id,
          created_at,
          assignee:team_members!tasks_assignee_id_fkey ( id, name, initials, color, avatar_url )
          `
        )
        .in("conversation_id", chunk)
        .eq("category", "call")
        .order("created_at", { ascending: false })
  );

  const callerByConvo = new Map<string, any>();
  // Sort the combined chunks DESC again — within each chunk it was DESC
  // but the chunks themselves may interleave. One global pass is cheap.
  (callTasks as any[]).sort((a, b) => {
    const aT = a.created_at || "";
    const bT = b.created_at || "";
    return bT.localeCompare(aT);
  });
  for (const t of callTasks as any[]) {
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

  if (typeof update.material_inquiry === "string" && update.material_inquiry.length > 5000) {
    return NextResponse.json({ error: "material_inquiry too long (max 5000)" }, { status: 400 });
  }
  if (typeof update.follow_up_log === "string" && update.follow_up_log.length > 10000) {
    return NextResponse.json({ error: "follow_up_log too long (max 10000)" }, { status: 400 });
  }

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