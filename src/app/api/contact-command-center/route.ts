import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// If your thread summary table has a different name, change this:
const THREAD_SUMMARIES_TABLE = "thread_summaries";

function safeLower(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function formatRelativeDate(value?: string | null) {
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

    let convoQuery = supabase
      .from("conversations")
      .select(
        `
        id,
        subject,
        status,
        from_name,
        from_email,
        preview,
        is_unread,
        is_starred,
        last_message_at,
        email_account_id,
        folder_id,
        folders (
          id,
          name
        ),
        conversation_labels (
          label_id,
          labels (
            id,
            name,
            color,
            bg_color
          )
        )
      `
      )
      .order("last_message_at", { ascending: false });

    if (accountId) {
      convoQuery = convoQuery.eq("email_account_id", accountId);
    }

    const { data: allConversations, error: convoError } = await convoQuery;

    if (convoError) {
      return NextResponse.json({ error: convoError.message }, { status: 500 });
    }

    const relatedThreads = (allConversations || []).filter((convo: any) => {
      const fromEmail = safeLower(convo.from_email);
      return fromEmail === email;
    });

    const conversationIds = relatedThreads.map((t: any) => t.id);

    if (conversationIds.length === 0) {
      return NextResponse.json({
        contact: {
          email,
          name: null,
        },
        summary: {
          total_threads: 0,
          open_threads: 0,
          closed_threads: 0,
          open_tasks: 0,
          completed_tasks: 0,
          notes_count: 0,
          activity_count: 0,
          last_activity: null,
          risk_signals: [],
          rollup: `${email} has no related threads in this shared account.`,
        },
        threads: [],
        tasks: [],
        notes: [],
        activities: [],
        thread_summaries: [],
      });
    }

    const { data: tasksRaw, error: tasksError } = await supabase
      .from("tasks")
      .select("*")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false });

    if (tasksError) {
      return NextResponse.json({ error: tasksError.message }, { status: 500 });
    }

    const tasks = tasksRaw || [];
    const taskIds = tasks.map((t: any) => t.id);

    // IMPORTANT:
    // Fetch task assignees separately instead of nested relationship joins.
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

    const { data: activities, error: activitiesError } = await supabase
      .from("conversation_activity")
      .select("*")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(100);

    if (activitiesError) {
      return NextResponse.json({ error: activitiesError.message }, { status: 500 });
    }

    const { data: threadSummaries, error: summariesError } = await supabase
      .from(THREAD_SUMMARIES_TABLE)
      .select("*")
      .in("conversation_id", conversationIds);

    if (summariesError) {
      return NextResponse.json({ error: summariesError.message }, { status: 500 });
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
      ...(activities || []).map((a: any) => a.created_at).filter(Boolean),
    ].sort((a, b) => +new Date(b) - +new Date(a));

    const riskSignals = detectRiskSignals({
      threads: relatedThreads,
      tasks: hydratedTasks,
      summaries: threadSummaries || [],
    });

    const contactName =
      relatedThreads.find((t: any) => t.from_name)?.from_name ||
      relatedThreads.find((t: any) => t.from_email)?.from_email ||
      email;

    const rollup = buildRollupSummary({
      contactEmail: email,
      threads: relatedThreads,
      openTasks,
      summaries: threadSummaries || [],
      riskSignals,
    });

    return NextResponse.json({
      contact: {
        email,
        name: contactName,
      },
      summary: {
        total_threads: relatedThreads.length,
        open_threads: openThreads,
        closed_threads: closedThreads,
        open_tasks: openTasks.length,
        completed_tasks: completedTasks.length,
        notes_count: (notes || []).length,
        activity_count: (activities || []).length,
        last_activity: formatRelativeDate(lastActivityCandidates[0] || null),
        risk_signals: riskSignals,
        rollup,
      },
      threads: relatedThreads.map((thread: any) => ({
        ...thread,
        folder: thread.folders || null,
        labels: (thread.conversation_labels || []).map((item: any) => ({
          label_id: item.label_id,
          label: item.labels,
        })),
      })),
      tasks: hydratedTasks,
      notes: notes || [],
      activities: activities || [],
      thread_summaries: threadSummaries || [],
    });
  } catch (error: any) {
    console.error("GET /api/contact-command-center failed:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load command center" },
      { status: 500 }
    );
  }
}