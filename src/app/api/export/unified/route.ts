import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const dateFrom = req.nextUrl.searchParams.get("date_from") || null;
    const dateTo = req.nextUrl.searchParams.get("date_to") || null;

    let convQ = supabase
      .from("conversations")
      .select("id, subject, from_name, from_email, preview, status, is_unread, is_starred, assignee_id, email_account_id, folder_id, last_message_at, created_at")
      .neq("status", "trash")
      .order("last_message_at", { ascending: false })
      .limit(1000);
    if (dateFrom) convQ = convQ.gte("created_at", dateFrom);
    if (dateTo) convQ = convQ.lte("created_at", dateTo + "T23:59:59.999Z");
    const { data: conversations, error: convErr } = await convQ;
    if (convErr) return NextResponse.json({ error: convErr.message, rows: [] }, { status: 500 });

    const { data: members } = await supabase.from("team_members").select("id, name, email, role, department");
    const memberMap: Record<string, any> = {};
    for (const m of (members || [])) memberMap[m.id] = m;

    const { data: accounts } = await supabase.from("email_accounts").select("id, name, email");
    const accountMap: Record<string, any> = {};
    for (const a of (accounts || [])) accountMap[a.id] = a;

    const { data: folders } = await supabase.from("folders").select("id, name");
    const folderMap: Record<string, any> = {};
    for (const f of (folders || [])) folderMap[f.id] = f;

    const { data: rawTasks } = await supabase
      .from("tasks")
      .select("id, text, status, is_done, due_date, due_time, created_at, conversation_id, task_assignees(team_member_id, is_done, status), category:task_categories(name)");

    const tasksByConvo: Record<string, any[]> = {};
    for (const t of (rawTasks || [])) {
      if (!t.conversation_id) continue;
      if (!tasksByConvo[t.conversation_id]) tasksByConvo[t.conversation_id] = [];
      tasksByConvo[t.conversation_id].push(t);
    }

    const { data: rawMessages } = await supabase
      .from("messages")
      .select("conversation_id, is_outbound, sent_at, sent_by_user_id, from_name, from_email, to_addresses, snippet, has_attachments")
      .order("sent_at", { ascending: true })
      .limit(5000);

    const msgsByConvo: Record<string, any[]> = {};
    for (const m of (rawMessages || [])) {
      if (!msgsByConvo[m.conversation_id]) msgsByConvo[m.conversation_id] = [];
      msgsByConvo[m.conversation_id].push(m);
    }

    const now = new Date();
    const rows: any[] = [];

    for (const _c of (conversations || [])) {
      const convo = _c as any;
      const assignee = memberMap[convo.assignee_id] || {};
      const account = accountMap[convo.email_account_id] || {};
      const folder = folderMap[convo.folder_id] || {};
      const msgs = msgsByConvo[convo.id] || [];
      const tasks = tasksByConvo[convo.id] || [];

      const inbound = msgs.filter((m: any) => !m.is_outbound).length;
      const outbound = msgs.filter((m: any) => m.is_outbound).length;
      const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const waitingHours = lastMsg ? Math.round((now.getTime() - new Date(lastMsg.sent_at).getTime()) / (1000 * 60 * 60) * 10) / 10 : 0;
      const replyStatus = !lastMsg ? "No messages" : lastMsg.is_outbound ? "Awaiting supplier reply" : "Awaiting our reply";

      // First response time
      let firstResponseHours = "";
      let firstResponseBy = "";
      for (let i = 0; i < msgs.length; i++) {
        if (!msgs[i].is_outbound) {
          for (let j = i + 1; j < msgs.length; j++) {
            if (msgs[j].is_outbound) {
              firstResponseHours = String(Math.round((new Date(msgs[j].sent_at).getTime() - new Date(msgs[i].sent_at).getTime()) / (1000 * 60 * 60) * 10) / 10);
              firstResponseBy = memberMap[msgs[j].sent_by_user_id]?.name || "";
              break;
            }
          }
          break;
        }
      }

      // Latest inbound/outbound
      const latestIn = [...msgs].reverse().find((m: any) => !m.is_outbound);
      const latestOut = [...msgs].reverse().find((m: any) => m.is_outbound);

      const base: any = {
        conversation_id: convo.id,
        conversation_subject: convo.subject || "",
        conversation_status: convo.status || "",
        conversation_from_name: convo.from_name || "",
        conversation_from_email: convo.from_email || "",
        conversation_is_unread: convo.is_unread ? "Yes" : "No",
        conversation_is_starred: convo.is_starred ? "Yes" : "No",
        conversation_created_at: convo.created_at || "",
        conversation_last_message_at: convo.last_message_at || "",
        account_name: account.name || "",
        account_email: account.email || "",
        folder_name: folder.name || "",
        conversation_assignee_name: assignee.name || "",
        conversation_assignee_email: assignee.email || "",
        conversation_assignee_department: assignee.department || "",
        conversation_assignee_role: assignee.role || "",
        total_messages: msgs.length,
        inbound_messages: inbound,
        outbound_messages: outbound,
        reply_status: replyStatus,
        waiting_hours: waitingHours,
        first_response_hours: firstResponseHours,
        first_response_by: firstResponseBy,
        latest_inbound_from: latestIn?.from_name || "",
        latest_inbound_email: latestIn?.from_email || "",
        latest_inbound_date: latestIn?.sent_at || "",
        latest_inbound_snippet: latestIn?.snippet || "",
        latest_outbound_to: latestOut?.to_addresses || "",
        latest_outbound_date: latestOut?.sent_at || "",
        latest_outbound_by: memberMap[latestOut?.sent_by_user_id]?.name || "",
        latest_outbound_snippet: latestOut?.snippet || "",
        has_attachments: msgs.some((m: any) => m.has_attachments) ? "Yes" : "No",
      };

      const emptyTask = {
        task_id: "", task_text: "", task_status: "", task_category: "",
        task_due_date: "", task_due_time: "", task_created_at: "",
        task_assignee_name: "", task_assignee_email: "", task_assignee_department: "",
        task_assignee_status: "", task_assignee_done: "",
        task_total_assignees: "", task_completed_count: "",
      };

      if (tasks.length === 0) {
        rows.push({ ...base, ...emptyTask });
      } else {
        for (const _task of tasks) {
          const task = _task as any;
          const assignees = (task.task_assignees || []).map((a: any) => ({
            ...(memberMap[a.team_member_id] || {}),
            is_done: a.is_done,
            status: a.status || (a.is_done ? "completed" : "todo"),
          }));
          const cat = (task.category as any)?.name || "";
          const totalA = assignees.length;
          const doneA = assignees.filter((a: any) => a.is_done).length;

          if (assignees.length === 0) {
            rows.push({ ...base, task_id: task.id, task_text: task.text || "", task_status: task.status || "todo", task_category: cat, task_due_date: task.due_date || "", task_due_time: task.due_time || "", task_created_at: task.created_at || "", task_assignee_name: "", task_assignee_email: "", task_assignee_department: "", task_assignee_status: "", task_assignee_done: "", task_total_assignees: 0, task_completed_count: "" });
          } else {
            for (const ta of assignees) {
              rows.push({ ...base, task_id: task.id, task_text: task.text || "", task_status: task.status || "todo", task_category: cat, task_due_date: task.due_date || "", task_due_time: task.due_time || "", task_created_at: task.created_at || "", task_assignee_name: ta.name || "", task_assignee_email: ta.email || "", task_assignee_department: ta.department || "", task_assignee_status: ta.status || "", task_assignee_done: ta.is_done ? "Yes" : "No", task_total_assignees: totalA, task_completed_count: doneA + "/" + totalA });
            }
          }
        }
      }
    }

    return NextResponse.json({ rows, total: rows.length });
  } catch (error: any) {
    console.error("Unified export error:", error);
    return NextResponse.json({ error: error?.message || "Unknown error", rows: [] }, { status: 500 });
  }
}