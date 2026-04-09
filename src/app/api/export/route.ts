export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/export — Fetch all exportable data
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const dateFrom = req.nextUrl.searchParams.get("date_from") || null;
  const dateTo = req.nextUrl.searchParams.get("date_to") || null;
  const dataset = req.nextUrl.searchParams.get("dataset") || "all";

  const result: any = {};

  // ── CONVERSATIONS ──
  if (dataset === "all" || dataset === "conversations") {
    let q = supabase
      .from("conversations")
      .select("id, subject, from_name, from_email, to_addresses, preview, status, is_unread, is_starred, assignee_id, email_account_id, folder_id, last_message_at, created_at, email_account:email_accounts(name, email), assignee:team_members!conversations_assignee_id_fkey(name, email, department), folder:folders(name)")
      .neq("status", "trash")
      .order("last_message_at", { ascending: false });

    if (dateFrom) q = q.gte("created_at", dateFrom);
    if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59.999Z");

    const { data } = await q;

    result.conversations = (data || []).map((c: any) => ({
      conversation_id: c.id,
      subject: c.subject,
      from_name: c.from_name,
      from_email: c.from_email,
      to_addresses: c.to_addresses || "",
      preview: c.preview || "",
      status: c.status,
      is_unread: c.is_unread,
      is_starred: c.is_starred,
      assignee_name: c.assignee?.name || "",
      assignee_email: c.assignee?.email || "",
      assignee_department: c.assignee?.department || "",
      account_name: c.email_account?.name || "",
      account_email: c.email_account?.email || "",
      folder_name: c.folder?.name || "",
      last_message_at: c.last_message_at,
      created_at: c.created_at,
    }));
  }

  // ── MESSAGES ──
  if (dataset === "all" || dataset === "messages") {
    let q = supabase
      .from("messages")
      .select("id, conversation_id, subject, from_name, from_email, to_addresses, cc_addresses, body_text, snippet, is_outbound, has_attachments, sent_at, sent_by_user_id, conversation:conversations(subject, assignee_id)")
      .order("sent_at", { ascending: false })
      .limit(5000);

    if (dateFrom) q = q.gte("sent_at", dateFrom);
    if (dateTo) q = q.lte("sent_at", dateTo + "T23:59:59.999Z");

    const { data } = await q;

    // Get user names for sent_by_user_id
    const { data: members } = await supabase.from("team_members").select("id, name, email");
    const memberMap: Record<string, any> = {};
    for (const m of (members || [])) memberMap[m.id] = m;

    result.messages = (data || []).map((m: any) => ({
      message_id: m.id,
      conversation_id: m.conversation_id,
      conversation_subject: m.conversation?.subject || "",
      subject: m.subject || "",
      from_name: m.from_name || "",
      from_email: m.from_email || "",
      to_addresses: m.to_addresses || "",
      cc_addresses: m.cc_addresses || "",
      snippet: m.snippet || "",
      is_outbound: m.is_outbound ? "Yes" : "No",
      has_attachments: m.has_attachments ? "Yes" : "No",
      sent_at: m.sent_at,
      sent_by_user: memberMap[m.sent_by_user_id]?.name || "",
      sent_by_email: memberMap[m.sent_by_user_id]?.email || "",
    }));
  }

  // ── TASKS ──
  if (dataset === "all" || dataset === "tasks") {
    let q = supabase
      .from("tasks")
      .select("id, text, status, is_done, due_date, due_time, dismiss_reason, created_at, conversation_id, conversation:conversations(subject), assignee:team_members!tasks_assignee_id_fkey(name, email), task_assignees(team_member_id, is_done, status, team_member:team_members!task_assignees_team_member_id_fkey(name, email)), category:task_categories(name)")
      .order("created_at", { ascending: false });

    if (dateFrom) q = q.gte("created_at", dateFrom);
    if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59.999Z");

    const { data } = await q;

    result.tasks = [];
    for (const _t of (data || [])) {
      const t = _t as any;
      const assignees = (t.task_assignees || []).map((a: any) => ({
        name: a.team_member?.name || "",
        email: a.team_member?.email || "",
        is_done: a.is_done,
        status: a.status || (a.is_done ? "completed" : "todo"),
      }));

      const totalAssignees = assignees.length;
      const completedCount = assignees.filter((a: any) => a.is_done).length;

      // One row per assignee (or one row if no assignees)
      const rows = assignees.length > 0 ? assignees : [{ name: "", email: "", is_done: false, status: "todo" }];

      for (const assignee of rows) {
        result.tasks.push({
          task_id: t.id,
          task_text: t.text,
          task_status: t.status || "todo",
          dismiss_reason: t.dismiss_reason || "",
          category: t.category?.name || "",
          due_date: t.due_date || "",
          due_time: t.due_time || "",
          conversation_id: t.conversation_id || "",
          conversation_subject: t.conversation?.subject || "",
          assignee_name: assignee.name,
          assignee_email: assignee.email,
          assignee_status: assignee.status,
          assignee_done: assignee.is_done ? "Yes" : "No",
          total_assignees: totalAssignees,
          completed_count: completedCount + "/" + totalAssignees,
          created_at: t.created_at,
        });
      }
    }
  }

  // ── TEAM MEMBERS ──
  if (dataset === "all" || dataset === "team_members") {
    const { data } = await supabase
      .from("team_members")
      .select("id, name, email, role, department, is_active, has_call_skillset, created_at")
      .order("name");

    result.team_members = (data || []).map((m: any) => ({
      user_id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      department: m.department || "",
      is_active: m.is_active ? "Yes" : "No",
      has_call_skillset: m.has_call_skillset ? "Yes" : "No",
      created_at: m.created_at,
    }));
  }

  // ── SLA METRICS ──
  if (dataset === "all" || dataset === "sla") {
    // Fetch conversations and messages for SLA computation
    let convQ = supabase
      .from("conversations")
      .select("id, subject, from_name, from_email, assignee_id, last_message_at, created_at")
      .neq("status", "trash")
      .neq("from_email", "internal");

    const { data: convos } = await convQ;

    let msgQ = supabase
      .from("messages")
      .select("id, conversation_id, is_outbound, sent_at, sent_by_user_id")
      .order("sent_at", { ascending: true });

    const { data: msgs } = await msgQ;

    const { data: members } = await supabase.from("team_members").select("id, name, email");
    const memberMap: Record<string, any> = {};
    for (const m of (members || [])) memberMap[m.id] = m;

    // Group messages by conversation
    const msgsByConvo: Record<string, any[]> = {};
    for (const m of (msgs || [])) {
      if (!msgsByConvo[m.conversation_id]) msgsByConvo[m.conversation_id] = [];
      msgsByConvo[m.conversation_id].push(m);
    }

    const now = new Date();
    const slaRows: any[] = [];

    for (const convo of (convos || [])) {
      const cMsgs = msgsByConvo[convo.id] || [];
      if (cMsgs.length === 0) continue;

      if (dateFrom && convo.last_message_at < dateFrom) continue;
      if (dateTo && convo.created_at > dateTo + "T23:59:59.999Z") continue;

      const lastMsg = cMsgs[cMsgs.length - 1];
      const lastMsgTime = new Date(lastMsg.sent_at);
      const waitingHours = Math.round((now.getTime() - lastMsgTime.getTime()) / (1000 * 60 * 60) * 10) / 10;

      // Calculate first response time
      let firstResponseHours = "";
      let firstResponseBy = "";
      for (let i = 0; i < cMsgs.length; i++) {
        if (!cMsgs[i].is_outbound) {
          for (let j = i + 1; j < cMsgs.length; j++) {
            if (cMsgs[j].is_outbound) {
              const diff = (new Date(cMsgs[j].sent_at).getTime() - new Date(cMsgs[i].sent_at).getTime()) / (1000 * 60 * 60);
              firstResponseHours = (Math.round(diff * 10) / 10).toString();
              firstResponseBy = memberMap[cMsgs[j].sent_by_user_id]?.name || "";
              break;
            }
          }
          break; // Only first inbound→outbound pair
        }
      }

      const totalInbound = cMsgs.filter((m: any) => !m.is_outbound).length;
      const totalOutbound = cMsgs.filter((m: any) => m.is_outbound).length;

      slaRows.push({
        conversation_id: convo.id,
        subject: convo.subject,
        from_name: convo.from_name,
        from_email: convo.from_email,
        assignee: memberMap[convo.assignee_id]?.name || "Unassigned",
        assignee_email: memberMap[convo.assignee_id]?.email || "",
        total_messages: cMsgs.length,
        inbound_count: totalInbound,
        outbound_count: totalOutbound,
        last_message_direction: lastMsg.is_outbound ? "Outbound (us)" : "Inbound (supplier)",
        reply_status: lastMsg.is_outbound ? "Awaiting supplier reply" : "Awaiting our reply",
        waiting_hours: waitingHours,
        first_response_hours: firstResponseHours,
        first_response_by: firstResponseBy,
        conversation_created_at: convo.created_at,
        last_message_at: lastMsg.sent_at,
      });
    }

    result.sla = slaRows;
  }

  // ── USER PERFORMANCE ──
  if (dataset === "all" || dataset === "user_performance") {
    const { data: members } = await supabase.from("team_members").select("id, name, email, role, department").eq("is_active", true).order("name");
    const { data: allTasks } = await supabase
      .from("tasks")
      .select("id, text, status, is_done, due_date, due_time, dismiss_reason, dismissed_at, created_at, conversation_id, conversation:conversations(subject), task_assignees(team_member_id, is_done, status, team_member:team_members!task_assignees_team_member_id_fkey(name)), category:task_categories(name)");
    const { data: allConvos } = await supabase
      .from("conversations")
      .select("id, subject, from_name, from_email, status, is_unread, assignee_id, last_message_at, created_at, supplier_contact_id, supplier_contact:supplier_contacts(timezone, work_start, work_end)")
      .neq("status", "trash");
    const { data: allMsgs } = await supabase
      .from("messages")
      .select("id, conversation_id, is_outbound, sent_at, sent_by_user_id")
      .order("sent_at", { ascending: true });

    // Group messages by conversation
    const msgsByConvo: Record<string, any[]> = {};
    for (const m of (allMsgs || [])) {
      if (!msgsByConvo[m.conversation_id]) msgsByConvo[m.conversation_id] = [];
      msgsByConvo[m.conversation_id].push(m);
    }

    const now = new Date();

    // ─ Sheet 1: User Task Summary ─
    const userTaskRows: any[] = [];
    for (const member of (members || [])) {
      const myTasks = (allTasks || []).filter((t: any) =>
        (t.task_assignees || []).some((a: any) => a.team_member_id === member.id)
      );
      const byStatus = { todo: 0, in_progress: 0, completed: 0, dismissed: 0 };
      const byCategory: Record<string, { total: number; completed: number; dismissed: number }> = {};
      let overdueCount = 0;

      for (const t of myTasks) {
        const s = (t as any).status === "dismissed" ? "dismissed" : (() => {
          const a = ((t as any).task_assignees || []).find((a: any) => a.team_member_id === member.id);
          return a?.status || (a?.is_done ? "completed" : "todo");
        })();
        if (s in byStatus) (byStatus as any)[s]++;
        if (s !== "completed" && s !== "dismissed" && (t as any).due_date && new Date((t as any).due_date) < now) overdueCount++;
        const cat = (t as any).category?.name || "Uncategorized";
        if (!byCategory[cat]) byCategory[cat] = { total: 0, completed: 0, dismissed: 0 };
        byCategory[cat].total++;
        if (s === "completed") byCategory[cat].completed++;
        if (s === "dismissed") byCategory[cat].dismissed++;
      }

      userTaskRows.push({
        user_name: member.name,
        user_email: member.email,
        department: member.department || "",
        role: member.role || "",
        total_tasks: myTasks.length,
        todo: byStatus.todo,
        in_progress: byStatus.in_progress,
        completed: byStatus.completed,
        dismissed: byStatus.dismissed,
        overdue: overdueCount,
        completion_rate: myTasks.length > 0 ? Math.round((byStatus.completed / myTasks.length) * 100) + "%" : "0%",
        categories_breakdown: Object.entries(byCategory).map(([cat, d]) => `${cat}: ${d.completed}/${d.total}`).join("; "),
      });
    }

    // ─ Sheet 2: User Task Details ─
    const userTaskDetailRows: any[] = [];
    for (const member of (members || [])) {
      const myTasks = (allTasks || []).filter((t: any) =>
        (t.task_assignees || []).some((a: any) => a.team_member_id === member.id)
      );
      for (const t of myTasks) {
        const task = t as any;
        const s = task.status === "dismissed" ? "dismissed" : (() => {
          const a = (task.task_assignees || []).find((a: any) => a.team_member_id === member.id);
          return a?.status || (a?.is_done ? "completed" : "todo");
        })();
        const isOverdue = s !== "completed" && s !== "dismissed" && task.due_date && new Date(task.due_date) < now;
        userTaskDetailRows.push({
          user_name: member.name,
          user_email: member.email,
          task_text: task.text,
          task_status: s,
          category: task.category?.name || "Uncategorized",
          due_date: task.due_date || "",
          due_time: task.due_time || "",
          is_overdue: isOverdue ? "Yes" : "No",
          dismiss_reason: task.dismiss_reason || "",
          dismissed_at: task.dismissed_at || "",
          conversation_subject: task.conversation?.subject || "",
          conversation_id: task.conversation_id || "",
          created_at: task.created_at,
        });
      }
    }

    // ─ Sheet 3: User Conversation Performance ─
    const userConvoRows: any[] = [];
    for (const member of (members || [])) {
      const myConvos = (allConvos || []).filter((c: any) => c.assignee_id === member.id);
      for (const c of myConvos) {
        const convo = c as any;
        const cMsgs = msgsByConvo[convo.id] || [];
        const lastMsg = cMsgs[cMsgs.length - 1];
        const replyStatus = lastMsg ? (lastMsg.is_outbound ? "Awaiting supplier reply" : "Awaiting our reply") : "No messages";
        const waitingHours = lastMsg ? Math.round((now.getTime() - new Date(lastMsg.sent_at).getTime()) / (1000 * 60 * 60) * 10) / 10 : 0;
        const totalInbound = cMsgs.filter((m: any) => !m.is_outbound).length;
        const totalOutbound = cMsgs.filter((m: any) => m.is_outbound).length;
        const userReplies = cMsgs.filter((m: any) => m.is_outbound && m.sent_by_user_id === member.id).length;

        // First response time for this user
        let firstResponseHours = "";
        for (let i = 0; i < cMsgs.length; i++) {
          if (!cMsgs[i].is_outbound) {
            for (let j = i + 1; j < cMsgs.length; j++) {
              if (cMsgs[j].is_outbound && cMsgs[j].sent_by_user_id === member.id) {
                firstResponseHours = (Math.round((new Date(cMsgs[j].sent_at).getTime() - new Date(cMsgs[i].sent_at).getTime()) / (1000 * 60 * 60) * 10) / 10).toString();
                break;
              }
            }
            if (firstResponseHours) break;
          }
        }

        // Average response time for this user across all reply pairs
        const responseTimes: number[] = [];
        for (let i = 0; i < cMsgs.length; i++) {
          if (!cMsgs[i].is_outbound) {
            for (let j = i + 1; j < cMsgs.length; j++) {
              if (cMsgs[j].is_outbound && cMsgs[j].sent_by_user_id === member.id) {
                responseTimes.push((new Date(cMsgs[j].sent_at).getTime() - new Date(cMsgs[i].sent_at).getTime()) / (1000 * 60 * 60));
                break;
              }
            }
          }
        }
        const avgResponseHours = responseTimes.length > 0 ? (Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length * 10) / 10).toString() : "";

        userConvoRows.push({
          user_name: member.name,
          user_email: member.email,
          conversation_subject: convo.subject,
          conversation_id: convo.id,
          from_name: convo.from_name || "",
          from_email: convo.from_email || "",
          conversation_status: convo.status,
          is_unread: convo.is_unread ? "Yes" : "No",
          reply_status: replyStatus,
          waiting_hours: waitingHours,
          total_messages: cMsgs.length,
          inbound_count: totalInbound,
          outbound_count: totalOutbound,
          user_replies: userReplies,
          first_response_hours: firstResponseHours,
          avg_response_hours: avgResponseHours,
          last_message_at: lastMsg?.sent_at || "",
          conversation_created_at: convo.created_at,
        });
      }
    }

    result.user_performance = {
      task_summary: userTaskRows,
      task_details: userTaskDetailRows,
      conversation_performance: userConvoRows,
    };
  }

  // ── ACTIVITY LOG ──
  if (dataset === "all" || dataset === "activity") {
    let q = supabase
      .from("activity_log")
      .select("id, conversation_id, actor_id, action, details, created_at, conversation:conversations(subject), actor:team_members!activity_log_actor_id_fkey(name, email)")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (dateFrom) q = q.gte("created_at", dateFrom);
    if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59.999Z");

    const { data } = await q;

    result.activity = (data || []).map((a: any) => ({
      activity_id: a.id,
      conversation_id: a.conversation_id || "",
      conversation_subject: a.conversation?.subject || "",
      actor_name: a.actor?.name || "",
      actor_email: a.actor?.email || "",
      action: a.action,
      details: JSON.stringify(a.details || {}),
      created_at: a.created_at,
    }));
  }

  return NextResponse.json(result);
}