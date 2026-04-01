import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/export/unified — Flat denormalized export joining all data through conversations
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const dateFrom = req.nextUrl.searchParams.get("date_from") || null;
  const dateTo = req.nextUrl.searchParams.get("date_to") || null;

  // ── Fetch all data ──

  // Conversations
  let convQ = supabase
    .from("conversations")
    .select("id, subject, from_name, from_email, to_addresses, preview, status, is_unread, is_starred, assignee_id, email_account_id, folder_id, last_message_at, created_at")
    .neq("status", "trash")
    .order("last_message_at", { ascending: false });
  if (dateFrom) convQ = convQ.gte("created_at", dateFrom);
  if (dateTo) convQ = convQ.lte("created_at", dateTo + "T23:59:59.999Z");
  const { data: conversations } = await convQ;

  // Team members
  const { data: members } = await supabase.from("team_members").select("id, name, email, role, department").order("name");
  const memberMap: Record<string, any> = {};
  for (const m of (members || [])) memberMap[m.id] = m;

  // Email accounts
  const { data: accounts } = await supabase.from("email_accounts").select("id, name, email");
  const accountMap: Record<string, any> = {};
  for (const a of (accounts || [])) accountMap[a.id] = a;

  // Folders
  const { data: folders } = await supabase.from("folders").select("id, name");
  const folderMap: Record<string, any> = {};
  for (const f of (folders || [])) folderMap[f.id] = f;

  // Tasks with assignees and categories
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, text, status, is_done, due_date, due_time, created_at, conversation_id, category_id, task_assignees(team_member_id, is_done, status), category:task_categories(name)")
    .order("created_at", { ascending: false });

  // Group tasks by conversation
  const tasksByConvo: Record<string, any[]> = {};
  for (const t of (tasks || [])) {
    if (!t.conversation_id) continue;
    if (!tasksByConvo[t.conversation_id]) tasksByConvo[t.conversation_id] = [];
    tasksByConvo[t.conversation_id].push(t);
  }

  // Messages — get last message per conversation + counts
  const { data: messages } = await supabase
    .from("messages")
    .select("conversation_id, is_outbound, sent_at, sent_by_user_id")
    .order("sent_at", { ascending: true });

  const msgStats: Record<string, { total: number; inbound: number; outbound: number; lastIsOutbound: boolean; lastSentAt: string; firstResponseHours: number | null; firstResponseBy: string }> = {};
  const msgsByConvo: Record<string, any[]> = {};
  for (const m of (messages || [])) {
    if (!msgsByConvo[m.conversation_id]) msgsByConvo[m.conversation_id] = [];
    msgsByConvo[m.conversation_id].push(m);
  }

  const now = new Date();
  for (const [convoId, msgs] of Object.entries(msgsByConvo)) {
    const inbound = msgs.filter((m: any) => !m.is_outbound).length;
    const outbound = msgs.filter((m: any) => m.is_outbound).length;
    const last = msgs[msgs.length - 1];

    // First response time
    let firstResponseHours: number | null = null;
    let firstResponseBy = "";
    for (let i = 0; i < msgs.length; i++) {
      if (!msgs[i].is_outbound) {
        for (let j = i + 1; j < msgs.length; j++) {
          if (msgs[j].is_outbound) {
            firstResponseHours = Math.round((new Date(msgs[j].sent_at).getTime() - new Date(msgs[i].sent_at).getTime()) / (1000 * 60 * 60) * 10) / 10;
            firstResponseBy = memberMap[msgs[j].sent_by_user_id]?.name || "";
            break;
          }
        }
        break;
      }
    }

    msgStats[convoId] = {
      total: msgs.length,
      inbound,
      outbound,
      lastIsOutbound: last?.is_outbound || false,
      lastSentAt: last?.sent_at || "",
      firstResponseHours,
      firstResponseBy,
    };
  }

  // ── Build flat rows ──
  const rows: any[] = [];

  for (const convo of (conversations || [])) {
    const convoAssignee = memberMap[convo.assignee_id] || null;
    const account = accountMap[convo.email_account_id] || null;
    const folder = folderMap[convo.folder_id] || null;
    const stats = msgStats[convo.id] || { total: 0, inbound: 0, outbound: 0, lastIsOutbound: false, lastSentAt: "", firstResponseHours: null, firstResponseBy: "" };
    const convoTasks = tasksByConvo[convo.id] || [];

    const waitingHours = stats.lastSentAt ? Math.round((now.getTime() - new Date(stats.lastSentAt).getTime()) / (1000 * 60 * 60) * 10) / 10 : 0;
    const replyStatus = stats.total === 0 ? "No messages" : stats.lastIsOutbound ? "Awaiting supplier reply" : "Awaiting our reply";

    // Base conversation fields
    const convoBase = {
      conversation_id: convo.id,
      conversation_subject: convo.subject,
      conversation_status: convo.status,
      conversation_from_name: convo.from_name,
      conversation_from_email: convo.from_email,
      conversation_is_unread: convo.is_unread ? "Yes" : "No",
      conversation_is_starred: convo.is_starred ? "Yes" : "No",
      conversation_created_at: convo.created_at,
      conversation_last_message_at: convo.last_message_at,
      account_name: account?.name || "",
      account_email: account?.email || "",
      folder_name: folder?.name || "",
      assignee_name: convoAssignee?.name || "",
      assignee_email: convoAssignee?.email || "",
      assignee_department: convoAssignee?.department || "",
      assignee_role: convoAssignee?.role || "",
      total_messages: stats.total,
      inbound_messages: stats.inbound,
      outbound_messages: stats.outbound,
      reply_status: replyStatus,
      waiting_hours: waitingHours,
      first_response_hours: stats.firstResponseHours ?? "",
      first_response_by: stats.firstResponseBy,
    };

    if (convoTasks.length === 0) {
      // No tasks — still output the conversation row
      rows.push({
        ...convoBase,
        task_id: "",
        task_text: "",
        task_status: "",
        task_category: "",
        task_due_date: "",
        task_due_time: "",
        task_created_at: "",
        task_assignee_name: "",
        task_assignee_email: "",
        task_assignee_department: "",
        task_assignee_status: "",
        task_assignee_done: "",
        task_total_assignees: 0,
        task_completed_count: "",
      });
    } else {
      // One row per task-assignee
      for (const task of convoTasks) {
        const assignees = (task.task_assignees || []).map((a: any) => ({
          ...memberMap[a.team_member_id],
          is_done: a.is_done,
          status: a.status || (a.is_done ? "completed" : "todo"),
        }));
        const totalAssignees = assignees.length;
        const completedCount = assignees.filter((a: any) => a.is_done).length;
        const category = (task.category as any)?.name || "";

        const taskAssigneeRows = assignees.length > 0 ? assignees : [{ name: "", email: "", department: "", is_done: false, status: "todo" }];

        for (const ta of taskAssigneeRows) {
          rows.push({
            ...convoBase,
            task_id: task.id,
            task_text: task.text,
            task_status: task.status || "todo",
            task_category: category,
            task_due_date: task.due_date || "",
            task_due_time: task.due_time || "",
            task_created_at: task.created_at,
            task_assignee_name: ta.name || "",
            task_assignee_email: ta.email || "",
            task_assignee_department: ta.department || "",
            task_assignee_status: ta.status,
            task_assignee_done: ta.is_done ? "Yes" : "No",
            task_total_assignees: totalAssignees,
            task_completed_count: completedCount + "/" + totalAssignees,
          });
        }
      }
    }
  }

  return NextResponse.json({ rows, total: rows.length });
}
