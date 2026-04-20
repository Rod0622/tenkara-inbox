import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const THREAD_SUMMARIES_TABLE = "thread_summaries";

function safeLower(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function formatIso(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function detectRiskSignals(params: {
  threads: any[];
  tasks: any[];
  summaries: any[];
}) {
  const joinedText = [
    ...params.threads.map((t) => `${t.subject || ""} ${t.preview || ""}`),
    ...params.tasks.map((t) => `${t.text || ""}`),
    ...params.summaries.map((s) => JSON.stringify(s.summary || {})),
  ]
    .join(" \n ")
    .toLowerCase();

  const risks: string[] = [];

  if (
    joinedText.includes("delay") ||
    joinedText.includes("delayed") ||
    joinedText.includes("late shipment") ||
    joinedText.includes("shipment delay")
  ) {
    risks.push("Shipment delay risk");
  }

  if (
    joinedText.includes("price increase") ||
    joinedText.includes("increase price") ||
    joinedText.includes("cost increase") ||
    joinedText.includes("higher price")
  ) {
    risks.push("Price increase risk");
  }

  if (
    joinedText.includes("waiting for approval") ||
    joinedText.includes("internal decision") ||
    joinedText.includes("awaiting confirmation")
  ) {
    risks.push("Pending internal decision");
  }

  if (
    joinedText.includes("mold") ||
    joinedText.includes("tooling") ||
    joinedText.includes("drawing revision")
  ) {
    risks.push("Engineering / spec change");
  }

  return risks;
}

function buildRollupSummary(params: {
  contactEmail: string;
  threads: any[];
  openTasks: any[];
  summaries: any[];
  riskSignals: string[];
}) {
  const latestSummaryTexts = params.summaries
    .map((s) => s?.summary?.overview)
    .filter(Boolean)
    .slice(0, 3);

  const latestNextSteps = params.summaries
    .map((s) => s?.summary?.next_step)
    .filter(Boolean)
    .slice(0, 3);

  const lines: string[] = [];

  lines.push(
    `${params.contactEmail} has ${params.threads.length} related thread${
      params.threads.length === 1 ? "" : "s"
    } and ${params.openTasks.length} open task${
      params.openTasks.length === 1 ? "" : "s"
    }.`
  );

  if (latestSummaryTexts.length > 0) {
    lines.push(latestSummaryTexts[0]);
  }

  if (params.riskSignals.length > 0) {
    lines.push(`Key risks: ${params.riskSignals.join(", ")}.`);
  }

  if (latestNextSteps.length > 0) {
    lines.push(`Likely next step: ${latestNextSteps[0]}.`);
  }

  return lines.join(" ");
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();

    const email = safeLower(req.nextUrl.searchParams.get("email"));
    const accountId = req.nextUrl.searchParams.get("account");

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 });
    }

    // ── Fetch supplier contact info (business hours) ──
    const { data: supplierContact } = await supabase
      .from("supplier_contacts")
      .select("id, name, email, company, timezone, work_start, work_end, work_days")
      .eq("email", email)
      .maybeSingle();

    // ── Fetch threads from current account ──
    let convoQuery = supabase
      .from("conversations")
      .select(`
        id, subject, status, from_name, from_email, preview, is_unread, is_starred,
        last_message_at, email_account_id, folder_id, supplier_contact_id,
        folders ( id, name ),
        email_accounts:email_accounts!conversations_email_account_id_fkey ( id, name, email ),
        conversation_labels ( label_id, labels ( id, name, color, bg_color ) )
      `)
      .order("last_message_at", { ascending: false });

    if (accountId) {
      convoQuery = convoQuery.eq("email_account_id", accountId);
    }

    const { data: allConversations, error: convoError } = await convoQuery;

    if (convoError) {
      return NextResponse.json({ error: convoError.message }, { status: 500 });
    }

    // Find conversation IDs where this email appears in messages (from, to, or cc)
    const searchTerm = "%" + email + "%";
    const { data: msgMatches } = await supabase
      .from("messages")
      .select("conversation_id")
      .or(`from_email.ilike.${searchTerm},to_addresses.ilike.${searchTerm},cc_addresses.ilike.${searchTerm}`)
      .limit(1000);
    const msgConvoIds = new Set((msgMatches || []).map((m: any) => m.conversation_id).filter(Boolean));

    const relatedThreads = (allConversations || []).filter((convo: any) => {
      if (safeLower(convo.from_email) === email) return true;
      return msgConvoIds.has(convo.id);
    });

    // ── Fetch cross-account threads (ALL accounts for this supplier) ──
    let crossAccountThreads: any[] = [];
    if (accountId) {
      const { data: crossConvos } = await supabase
        .from("conversations")
        .select(`
          id, subject, status, from_name, from_email, preview, is_unread, is_starred,
          last_message_at, email_account_id, folder_id,
          folders ( id, name ),
          email_accounts:email_accounts!conversations_email_account_id_fkey ( id, name, email ),
          conversation_labels ( label_id, labels ( id, name, color, bg_color ) )
        `)
        .neq("email_account_id", accountId)
        .order("last_message_at", { ascending: false });

      crossAccountThreads = (crossConvos || []).filter((convo: any) => {
        if (safeLower(convo.from_email) === email) return true;
        return msgConvoIds.has(convo.id);
      });
    }

    const allRelatedIds = [
      ...relatedThreads.map((t: any) => t.id),
      ...crossAccountThreads.map((t: any) => t.id),
    ];
    const conversationIds = relatedThreads.map((t: any) => t.id);

    // ── Fetch domain-related threads (same domain, different contacts) ──
    const domain = email.split("@")[1]?.toLowerCase();
    let domainThreads: any[] = [];
    let domainContacts: string[] = [];
    if (domain && !["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "mail.com", "protonmail.com"].includes(domain)) {
      const domainSearch = "%@" + domain;
      // Find messages from the same domain but different email
      const { data: domainMsgMatches } = await supabase
        .from("messages")
        .select("conversation_id, from_email")
        .ilike("from_email", domainSearch)
        .neq("from_email", email)
        .eq("is_outbound", false)
        .limit(500);

      const domainConvoIds = new Set<string>();
      const domainEmailSet = new Set<string>();
      for (const m of (domainMsgMatches || [])) {
        if (m.conversation_id && !allRelatedIds.includes(m.conversation_id)) {
          domainConvoIds.add(m.conversation_id);
        }
        if (m.from_email) domainEmailSet.add(m.from_email.toLowerCase());
      }
      domainContacts = Array.from(domainEmailSet).sort();

      if (domainConvoIds.size > 0) {
        const domainIdArray = Array.from(domainConvoIds);
        for (let i = 0; i < domainIdArray.length; i += 50) {
          const batch = domainIdArray.slice(i, i + 50);
          const { data: domainConvos } = await supabase
            .from("conversations")
            .select(`
              id, subject, status, from_name, from_email, preview, is_unread, is_starred,
              last_message_at, email_account_id, folder_id,
              folders ( id, name ),
              email_accounts:email_accounts!conversations_email_account_id_fkey ( id, name, email ),
              conversation_labels ( label_id, labels ( id, name, color, bg_color ) )
            `)
            .in("id", batch)
            .neq("status", "trash")
            .order("last_message_at", { ascending: false });
          if (domainConvos) domainThreads.push(...domainConvos);
        }
      }
    }

    if (allRelatedIds.length === 0 && domainThreads.length === 0) {
      return NextResponse.json({
        contact: { email, name: supplierContact?.name || supplierContact?.company || email.split("@")[1]?.split(".")[0] || email, company: supplierContact?.company || null },
        supplier_hours: supplierContact ? {
          id: supplierContact.id,
          timezone: supplierContact.timezone,
          work_start: supplierContact.work_start,
          work_end: supplierContact.work_end,
          work_days: supplierContact.work_days,
        } : null,
        summary: {
          total_threads: 0, open_threads: 0, closed_threads: 0,
          open_tasks: 0, completed_tasks: 0, notes_count: 0,
          activity_count: 0, last_activity: null, risk_signals: [], rollup: `${email} has no related threads.`,
        },
        threads: [], cross_account_threads: [], domain_threads: [], domain_contacts: [], tasks: [], notes: [],
        activities: [], thread_summaries: [],
      });
    }

    // ── Tasks across ALL related conversations (both accounts) ──
    // Also find tasks linked via supplier_contact_id
    let tasksRaw: any[] = [];
    if (allRelatedIds.length > 0) {
      const { data, error: tasksError } = await supabase
        .from("tasks")
        .select("*, category:task_categories(name, color)")
        .in("conversation_id", allRelatedIds)
        .order("created_at", { ascending: false });
      if (tasksError) return NextResponse.json({ error: tasksError.message }, { status: 500 });
      tasksRaw = data || [];
    }

    // Also find tasks from conversations linked to this supplier_contact
    if (supplierContact?.id) {
      const { data: scConvos } = await supabase
        .from("conversations")
        .select("id")
        .eq("supplier_contact_id", supplierContact.id);
      const scIds = (scConvos || []).map((c: any) => c.id).filter((id: string) => !allRelatedIds.includes(id));
      if (scIds.length > 0) {
        const { data: extraTasks } = await supabase
          .from("tasks")
          .select("*, category:task_categories(name, color)")
          .in("conversation_id", scIds)
          .order("created_at", { ascending: false });
        if (extraTasks) {
          const existingIds = new Set(tasksRaw.map((t: any) => t.id));
          for (const t of extraTasks) {
            if (!existingIds.has(t.id)) tasksRaw.push(t);
          }
        }
      }
    }

    const tasks = tasksRaw || [];
    const taskIds = tasks.map((t: any) => t.id);

    const { data: taskAssigneeLinks, error: linkError } =
      taskIds.length > 0
        ? await supabase
            .from("task_assignees")
            .select("task_id, team_member_id")
            .in("task_id", taskIds)
        : { data: [], error: null as any };

    if (linkError) {
      return NextResponse.json({ error: linkError.message }, { status: 500 });
    }

    const teamMemberIds = Array.from(
      new Set((taskAssigneeLinks || []).map((row: any) => row.team_member_id).filter(Boolean))
    );

    const { data: teamMembers, error: membersError } =
      teamMemberIds.length > 0
        ? await supabase
            .from("team_members")
            .select("id, name, email, initials, color, avatar_url")
            .in("id", teamMemberIds)
        : { data: [], error: null as any };

    if (membersError) {
      return NextResponse.json({ error: membersError.message }, { status: 500 });
    }

    const memberMap = new Map((teamMembers || []).map((m: any) => [m.id, m]));
    const assigneeMap = new Map<string, any[]>();

    for (const link of taskAssigneeLinks || []) {
      const existing = assigneeMap.get(link.task_id) || [];
      const member = memberMap.get(link.team_member_id);
      if (member) existing.push(member);
      assigneeMap.set(link.task_id, existing);
    }

    const hydratedTasks = tasks.map((task: any) => ({
      ...task,
      assignees: assigneeMap.get(task.id) || [],
    }));

    const { data: notes, error: notesError } = await supabase
      .from("notes")
      .select("*")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false });

    if (notesError) {
      return NextResponse.json({ error: notesError.message }, { status: 500 });
    }

    // conversation_activity is optional in your project.
    // If the table does not exist, do not fail the whole page.
    let activities: any[] = [];
    const activityResult = await supabase
      .from("conversation_activity")
      .select("*")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(100);

    if (!activityResult.error) {
      activities = activityResult.data || [];
    }

    const summariesResult = await supabase
      .from(THREAD_SUMMARIES_TABLE)
      .select("*")
      .in("conversation_id", conversationIds);

    const threadSummaries =
      summariesResult.error && summariesResult.error.message?.toLowerCase().includes("does not exist")
        ? []
        : (summariesResult.data || []);

    if (
      summariesResult.error &&
      !summariesResult.error.message?.toLowerCase().includes("does not exist")
    ) {
      return NextResponse.json({ error: summariesResult.error.message }, { status: 500 });
    }

    const openThreads = relatedThreads.filter(
      (thread: any) => !["closed", "done", "resolved"].includes(safeLower(thread.status))
    ).length;

    const closedThreads = relatedThreads.length - openThreads;

    const openTasks = hydratedTasks.filter(
      (task: any) => !["completed", "done"].includes(safeLower(task.status)) && !task.is_done
    );

    const completedTasks = hydratedTasks.filter(
      (task: any) => ["completed", "done"].includes(safeLower(task.status)) || task.is_done
    );

    const lastActivityCandidates = [
      ...relatedThreads.map((t: any) => t.last_message_at).filter(Boolean),
      ...(notes || []).map((n: any) => n.created_at).filter(Boolean),
      ...hydratedTasks.map((t: any) => t.updated_at || t.created_at).filter(Boolean),
      ...activities.map((a: any) => a.created_at).filter(Boolean),
    ].sort((a, b) => +new Date(b) - +new Date(a));

    const riskSignals = detectRiskSignals({
      threads: relatedThreads,
      tasks: hydratedTasks,
      summaries: threadSummaries,
    });

    // Determine display name: supplier_contacts name > company > domain name
    const domainName = email.split("@")[1]?.split(".")[0] || email;
    const contactName = supplierContact?.name || supplierContact?.company || domainName.charAt(0).toUpperCase() + domainName.slice(1);
    const contactCompany = supplierContact?.company || null;

    const rollup = buildRollupSummary({
      contactEmail: email,
      threads: relatedThreads,
      openTasks,
      summaries: threadSummaries,
      riskSignals,
    });

    // ── Fetch responsiveness data for this supplier ──
    let responsiveness = null;
    try {
      const { data: supplierRts } = await supabase
        .from("response_times")
        .select("direction, response_minutes, response_sent_at, team_member_id")
        .eq("supplier_email", email)
        .order("response_sent_at", { ascending: false })
        .limit(100);

      if (supplierRts && supplierRts.length > 0) {
        const supplierReplies = supplierRts.filter((r: any) => r.direction === "supplier_reply");
        const teamReplies = supplierRts.filter((r: any) => r.direction === "team_reply");

        const calcStats = (items: any[]) => {
          if (items.length === 0) return null;
          const mins = items.map((r: any) => r.response_minutes).sort((a: number, b: number) => a - b);
          const sum = mins.reduce((a: number, b: number) => a + b, 0);
          return {
            avg_minutes: Math.round(sum / mins.length),
            median_minutes: Math.round(mins[Math.floor(mins.length / 2)]),
            fastest_minutes: Math.round(mins[0]),
            slowest_minutes: Math.round(mins[mins.length - 1]),
            total: mins.length,
            last_at: items[0]?.response_sent_at || null,
          };
        };

        responsiveness = {
          supplier: calcStats(supplierReplies),
          team: calcStats(teamReplies),
        };
      }
    } catch (_rtErr) { /* non-critical */ }

    return NextResponse.json({
      contact: {
        email,
        name: contactName,
        company: contactCompany,
      },
      supplier_hours: supplierContact ? {
        id: supplierContact.id,
        timezone: supplierContact.timezone,
        work_start: supplierContact.work_start,
        work_end: supplierContact.work_end,
        work_days: supplierContact.work_days,
      } : null,
      responsiveness,
      summary: {
        total_threads: relatedThreads.length + crossAccountThreads.length,
        open_threads: openThreads,
        closed_threads: closedThreads,
        open_tasks: openTasks.length,
        completed_tasks: completedTasks.length,
        notes_count: (notes || []).length,
        activity_count: activities.length,
        last_activity: formatIso(lastActivityCandidates[0] || null),
        risk_signals: riskSignals,
        rollup,
      },
      threads: relatedThreads.map((thread: any) => ({
        ...thread,
        folder: thread.folders || null,
        account_name: thread.email_accounts?.name || null,
        account_email: thread.email_accounts?.email || null,
        labels: (thread.conversation_labels || []).map((item: any) => ({
          label_id: item.label_id,
          label: item.labels,
        })),
      })),
      cross_account_threads: crossAccountThreads.map((thread: any) => ({
        ...thread,
        folder: thread.folders || null,
        account_name: thread.email_accounts?.name || null,
        account_email: thread.email_accounts?.email || null,
        labels: (thread.conversation_labels || []).map((item: any) => ({
          label_id: item.label_id,
          label: item.labels,
        })),
      })),
      domain_threads: domainThreads.map((thread: any) => ({
        ...thread,
        folder: thread.folders || null,
        account_name: thread.email_accounts?.name || null,
        account_email: thread.email_accounts?.email || null,
        labels: (thread.conversation_labels || []).map((item: any) => ({
          label_id: item.label_id,
          label: item.labels,
        })),
      })),
      domain_contacts: domainContacts,
      tasks: hydratedTasks,
      notes: notes || [],
      activities,
      thread_summaries: threadSummaries,
    });
  } catch (error: any) {
    console.error("GET /api/contact-command-center failed:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load command center" },
      { status: 500 }
    );
  }
}
// PATCH — Update supplier business hours
export async function PATCH(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json();
    const { supplier_contact_id, email, timezone, work_start, work_end, work_days } = body;

    if (!supplier_contact_id && !email) {
      return NextResponse.json({ error: "supplier_contact_id or email required" }, { status: 400 });
    }

    const update: any = {};
    if (timezone !== undefined) update.timezone = timezone || null;
    if (work_start !== undefined) update.work_start = work_start || null;
    if (work_end !== undefined) update.work_end = work_end || null;
    if (work_days !== undefined) update.work_days = work_days || null;

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    let result;
    if (supplier_contact_id) {
      result = await supabase.from("supplier_contacts").update(update).eq("id", supplier_contact_id).select("*").single();
    } else {
      result = await supabase.from("supplier_contacts").update(update).eq("email", email).select("*").single();
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, supplier_contact: result.data });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to update" }, { status: 500 });
  }
}