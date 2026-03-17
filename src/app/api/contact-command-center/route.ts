import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function normalizeEmail(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

function parseAddressList(value?: string | null) {
  if (!value) return [];
  return value
    .split(/[;,]/)
    .map((part) => normalizeEmail(part))
    .filter(Boolean);
}

function conversationTouchesExternalEmail(
  conversation: any,
  messages: Array<{ from_email?: string | null; to_addresses?: string | null }>,
  sharedEmail: string,
  externalEmail: string
) {
  const shared = normalizeEmail(sharedEmail);
  const external = normalizeEmail(externalEmail);
  const candidates = new Set<string>();

  const convoFrom = normalizeEmail(conversation?.from_email);
  if (convoFrom && convoFrom !== shared) candidates.add(convoFrom);

  for (const msg of messages || []) {
    const from = normalizeEmail(msg.from_email);
    if (from && from !== shared) candidates.add(from);
    for (const to of parseAddressList(msg.to_addresses)) {
      if (to && to !== shared) candidates.add(to);
    }
  }

  return candidates.has(external);
}

function normalizeText(value?: string | null) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildRiskSignals(params: {
  threads: any[];
  tasks: any[];
  summaries: any[];
}) {
  const haystack = normalizeText(
    [
      ...params.threads.map((thread) => `${thread.subject || ""} ${thread.preview || ""}`),
      ...params.tasks.map((task) => task.text || ""),
      ...params.summaries.map((summary) => JSON.stringify(summary?.summary || {})),
    ].join(" \n ")
  );

  const signals: string[] = [];
  if (/(delay|late|pushed|hold|held|slip|slipped|behind schedule)/.test(haystack)) {
    signals.push("Timeline / shipment delay risk");
  }
  if (/(price increase|cost increase|moq|minimum order|higher price|requote|new quote)/.test(haystack)) {
    signals.push("Commercial negotiation risk");
  }
  if (/(sample|approval|confirm|awaiting|waiting|pending|review)/.test(haystack)) {
    signals.push("Awaiting confirmation or approval");
  }
  if (params.tasks.filter((task) => task.status !== "completed" && !task.is_done).length >= 5) {
    signals.push("High operational follow-up load");
  }

  return signals.slice(0, 4);
}

function pickTopSummary(params: { summaries: any[]; threads: any[]; tasks: any[] }) {
  const summaries = params.summaries.filter((item) => item?.summary);

  const openItems = Array.from(
    new Set(
      summaries.flatMap((item) =>
        Array.isArray(item.summary?.open_action_items) ? item.summary.open_action_items : []
      )
    )
  ).slice(0, 5);

  const completedItems = Array.from(
    new Set(
      summaries.flatMap((item) =>
        Array.isArray(item.summary?.completed_items) ? item.summary.completed_items : []
      )
    )
  ).slice(0, 5);

  const intents = Array.from(
    new Set(
      summaries
        .map((item) => item.summary?.intent)
        .filter((value) => typeof value === "string" && value.trim())
    )
  );

  const statuses = Array.from(
    new Set(
      summaries
        .map((item) => item.summary?.status)
        .filter((value) => typeof value === "string" && value.trim())
    )
  );

  const overviews = summaries
    .map((item) => item.summary?.overview)
    .filter((value) => typeof value === "string" && value.trim());

  const primaryOverview =
    overviews[0] ||
    `This contact has ${params.threads.length} related thread${params.threads.length === 1 ? "" : "s"} and ${params.tasks.length} task${params.tasks.length === 1 ? "" : "s"} across the shared inbox.`;

  return {
    overview: primaryOverview,
    intents: intents.slice(0, 4),
    statuses: statuses.slice(0, 4),
    open_action_items: openItems,
    completed_items: completedItems,
  };
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const externalEmail = normalizeEmail(req.nextUrl.searchParams.get("external_email"));
    const accountId = req.nextUrl.searchParams.get("email_account_id");

    if (!externalEmail || !accountId) {
      return NextResponse.json(
        { error: "external_email and email_account_id are required" },
        { status: 400 }
      );
    }

    const { data: account, error: accountError } = await supabase
      .from("email_accounts")
      .select("id, email, name")
      .eq("id", accountId)
      .single();

    if (accountError || !account) {
      return NextResponse.json(
        { error: accountError?.message || "Shared account not found" },
        { status: 404 }
      );
    }

    const sharedEmail = normalizeEmail(account.email);

    const { data: candidateConversations, error: conversationsError } = await supabase
      .from("conversations")
      .select(`
        id,
        email_account_id,
        folder_id,
        thread_id,
        subject,
        from_name,
        from_email,
        preview,
        is_unread,
        is_starred,
        assignee_id,
        status,
        last_message_at,
        created_at,
        updated_at,
        labels:conversation_labels(
          label_id,
          label:labels(*)
        ),
        assignee:team_members!conversations_assignee_id_fkey(*)
      `)
      .eq("email_account_id", accountId)
      .order("last_message_at", { ascending: false })
      .limit(300);

    if (conversationsError) {
      return NextResponse.json({ error: conversationsError.message }, { status: 500 });
    }

    const conversationIds = (candidateConversations || []).map((item: any) => item.id);

    const messagesByConversation = new Map<string, any[]>();
    if (conversationIds.length > 0) {
      const { data: messages, error: messagesError } = await supabase
        .from("messages")
        .select("conversation_id, from_email, to_addresses, sent_at")
        .in("conversation_id", conversationIds)
        .order("sent_at", { ascending: true });

      if (messagesError) {
        return NextResponse.json({ error: messagesError.message }, { status: 500 });
      }

      for (const message of messages || []) {
        const list = messagesByConversation.get(message.conversation_id) || [];
        list.push(message);
        messagesByConversation.set(message.conversation_id, list);
      }
    }

    const relatedThreads = (candidateConversations || []).filter((conversation: any) =>
      conversationTouchesExternalEmail(
        conversation,
        messagesByConversation.get(conversation.id) || [],
        sharedEmail,
        externalEmail
      )
    );

    const relatedIds = relatedThreads.map((thread: any) => thread.id);
    const folderIds = Array.from(new Set(relatedThreads.map((thread: any) => thread.folder_id).filter(Boolean)));

    const [folderResult, notesResult, tasksResult, summaryResult, activityResult] = await Promise.all([
      folderIds.length > 0
        ? supabase.from("folders").select("id, name, icon, color, is_system").in("id", folderIds)
        : Promise.resolve({ data: [], error: null } as any),
      relatedIds.length > 0
        ? supabase
            .from("notes")
            .select("*, author:team_members(*)")
            .in("conversation_id", relatedIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as any),
      relatedIds.length > 0
        ? supabase
            .from("tasks")
            .select(
              "*, assignee:team_members!tasks_assignee_id_fkey(*), conversation:conversations(id, subject, from_name, from_email), task_assignees(team_member_id, team_member:team_members!task_assignees(*))"
            )
            .in("conversation_id", relatedIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as any),
      relatedIds.length > 0
        ? supabase
            .from("thread_summaries")
            .select("*")
            .in("conversation_id", relatedIds)
        : Promise.resolve({ data: [], error: null } as any),
      relatedIds.length > 0
        ? supabase
            .from("activity_log")
            .select("*, actor:team_members(id, name, initials, color)")
            .in("conversation_id", relatedIds)
            .order("created_at", { ascending: false })
            .limit(50)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

    if (folderResult.error || notesResult.error || tasksResult.error || summaryResult.error || activityResult.error) {
      return NextResponse.json(
        {
          error:
            folderResult.error?.message ||
            notesResult.error?.message ||
            tasksResult.error?.message ||
            summaryResult.error?.message ||
            activityResult.error?.message ||
            "Failed to fetch command center data",
        },
        { status: 500 }
      );
    }

    const folderMap = new Map<string, any>((folderResult.data || []).map((folder: any) => [folder.id, folder]));

    const threads = relatedThreads.map((thread: any) => ({
      ...thread,
      folder: thread.folder_id ? folderMap.get(thread.folder_id) || null : null,
    }));

    const tasks = (tasksResult.data || []).map((task: any) => ({
      ...task,
      status: task?.status || (task?.is_done ? "completed" : "todo"),
      assignees:
        task?.task_assignees?.map((entry: any) => entry.team_member).filter(Boolean) ||
        (task?.assignee ? [task.assignee] : []),
    }));

    const notes = notesResult.data || [];
    const summaries = summaryResult.data || [];
    const activities = activityResult.data || [];

    const sortedThreads = [...threads].sort((a: any, b: any) => {
      const aTime = new Date(a.last_message_at || 0).getTime();
      const bTime = new Date(b.last_message_at || 0).getTime();
      return bTime - aTime;
    });

    const openTasks = tasks.filter((task: any) => task.status !== "completed" && !task.is_done);
    const completedTasks = tasks.filter((task: any) => task.status === "completed" || task.is_done);
    const unreadThreads = threads.filter((thread: any) => thread.is_unread).length;

    const summary = pickTopSummary({ summaries, threads, tasks });
    const riskSignals = buildRiskSignals({ threads, tasks, summaries });

    return NextResponse.json({
      contact: {
        external_email: externalEmail,
        shared_email: sharedEmail,
        shared_account_name: account.name || account.email,
        email_account_id: account.id,
      },
      stats: {
        total_threads: threads.length,
        open_threads: threads.filter((thread: any) => thread.status !== "closed").length,
        closed_threads: threads.filter((thread: any) => thread.status === "closed").length,
        unread_threads: unreadThreads,
        total_tasks: tasks.length,
        open_tasks: openTasks.length,
        completed_tasks: completedTasks.length,
        total_notes: notes.length,
        last_contact_at: sortedThreads[0]?.last_message_at || null,
      },
      summary,
      risk_signals: riskSignals,
      threads: sortedThreads,
      tasks: tasks,
      notes: notes,
      activities: activities,
    });
  } catch (error: any) {
    console.error("GET /api/contact-command-center failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch contact command center" },
      { status: 500 }
    );
  }
}
