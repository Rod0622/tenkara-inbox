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

    // Enhance SLA rows with response_times data
    const convoIds = slaRows.map((r: any) => r.conversation_id);
    if (convoIds.length > 0) {
      const { data: rtData } = await supabase
        .from("response_times")
        .select("conversation_id, direction, response_minutes")
        .in("conversation_id", convoIds.slice(0, 500));

      const rtByConvo: Record<string, { supplier: number[]; team: number[] }> = {};
      for (const rt of (rtData || [])) {
        if (!rtByConvo[rt.conversation_id]) rtByConvo[rt.conversation_id] = { supplier: [], team: [] };
        if (rt.direction === "supplier_reply") rtByConvo[rt.conversation_id].supplier.push(rt.response_minutes);
        else rtByConvo[rt.conversation_id].team.push(rt.response_minutes);
      }

      const fmtM = (m: number) => m < 60 ? Math.round(m) + "m" : m < 1440 ? Math.round(m / 60 * 10) / 10 + "h" : Math.round(m / 1440 * 10) / 10 + "d";

      for (const row of slaRows) {
        const rt = rtByConvo[row.conversation_id];
        if (rt) {
          if (rt.supplier.length > 0) {
            const avg = rt.supplier.reduce((a: number, b: number) => a + b, 0) / rt.supplier.length;
            row.supplier_avg_response = fmtM(avg);
            row.supplier_response_count = rt.supplier.length;
          }
          if (rt.team.length > 0) {
            const avg = rt.team.reduce((a: number, b: number) => a + b, 0) / rt.team.length;
            row.team_avg_response = fmtM(avg);
            row.team_response_count = rt.team.length;
          }
        }
        if (!row.supplier_avg_response) { row.supplier_avg_response = ""; row.supplier_response_count = 0; }
        if (!row.team_avg_response) { row.team_avg_response = ""; row.team_response_count = 0; }
      }
    }
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
          link: task.conversation_id ? "https://tenkara-inbox-nine.vercel.app/#conversation=" + task.conversation_id : "",
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
          link: "https://tenkara-inbox-nine.vercel.app/#conversation=" + convo.id,
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

  // ── SUPPLIER RESPONSIVENESS ──
  if (dataset === "all" || dataset === "supplier_responsiveness") {
    let rtQuery = supabase
      .from("response_times")
      .select("supplier_email, supplier_domain, direction, response_minutes, response_sent_at, email_account_id, team_member_id")
      .order("response_sent_at", { ascending: false });

    if (dateFrom) rtQuery = rtQuery.gte("response_sent_at", dateFrom + "T00:00:00Z");
    if (dateTo) rtQuery = rtQuery.lte("response_sent_at", dateTo + "T23:59:59Z");

    const { data: rtData } = await rtQuery;

    // Fetch account names for mapping
    const { data: accounts } = await supabase.from("email_accounts").select("id, name, email");
    const acctMap: Record<string, any> = {};
    for (const a of (accounts || [])) acctMap[a.id] = a;

    // Fetch team member names
    const { data: tmMembers } = await supabase.from("team_members").select("id, name, email");
    const tmMap: Record<string, any> = {};
    for (const m of (tmMembers || [])) tmMap[m.id] = m;

    // Aggregate by supplier email
    const supplierAgg: Record<string, { email: string; domain: string; supplier_replies: number[]; team_replies: number[]; last_at: string; accounts: Set<string> }> = {};
    for (const rt of (rtData || [])) {
      if (!rt.supplier_email) continue;
      if (!supplierAgg[rt.supplier_email]) {
        supplierAgg[rt.supplier_email] = { email: rt.supplier_email, domain: rt.supplier_domain || "", supplier_replies: [], team_replies: [], last_at: "", accounts: new Set() };
      }
      const s = supplierAgg[rt.supplier_email];
      if (rt.direction === "supplier_reply") s.supplier_replies.push(rt.response_minutes);
      else s.team_replies.push(rt.response_minutes);
      if (!s.last_at || rt.response_sent_at > s.last_at) s.last_at = rt.response_sent_at;
      if (rt.email_account_id) s.accounts.add(acctMap[rt.email_account_id]?.name || rt.email_account_id);
    }

    const fmtMin = (m: number) => m < 60 ? Math.round(m) + "m" : m < 1440 ? Math.round(m / 60 * 10) / 10 + "h" : Math.round(m / 1440 * 10) / 10 + "d";
    const calcStats = (arr: number[]) => {
      if (arr.length === 0) return { avg: "", median: "", fastest: "", slowest: "", count: 0 };
      const sorted = arr.slice().sort((a, b) => a - b);
      const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
      return {
        avg: fmtMin(avg),
        median: fmtMin(sorted[Math.floor(sorted.length / 2)]),
        fastest: fmtMin(sorted[0]),
        slowest: fmtMin(sorted[sorted.length - 1]),
        count: sorted.length,
      };
    };

    const supplierRows: any[] = [];
    for (const [email, s] of Object.entries(supplierAgg)) {
      const sr = calcStats(s.supplier_replies);
      const tr = calcStats(s.team_replies);
      supplierRows.push({
        supplier_email: email,
        supplier_domain: s.domain,
        accounts: Array.from(s.accounts).join(", "),
        supplier_avg_response: sr.avg,
        supplier_median_response: sr.median,
        supplier_fastest: sr.fastest,
        supplier_slowest: sr.slowest,
        supplier_total_replies: sr.count,
        team_avg_response: tr.avg,
        team_median_response: tr.median,
        team_fastest: tr.fastest,
        team_slowest: tr.slowest,
        team_total_replies: tr.count,
        last_activity: s.last_at,
      });
    }

    // Sort by total interactions desc
    supplierRows.sort((a, b) => (b.supplier_total_replies + b.team_total_replies) - (a.supplier_total_replies + a.team_total_replies));

    result.supplier_responsiveness = supplierRows;

    // Also generate per-user response time summary
    const userAgg: Record<string, number[]> = {};
    for (const rt of (rtData || [])) {
      if (rt.direction !== "team_reply" || !rt.team_member_id) continue;
      if (!userAgg[rt.team_member_id]) userAgg[rt.team_member_id] = [];
      userAgg[rt.team_member_id].push(rt.response_minutes);
    }

    const userRtRows: any[] = [];
    for (const [userId, mins] of Object.entries(userAgg)) {
      const stats = calcStats(mins);
      const member = tmMap[userId];
      userRtRows.push({
        user_name: member?.name || "Unknown",
        user_email: member?.email || "",
        avg_response: stats.avg,
        median_response: stats.median,
        fastest: stats.fastest,
        slowest: stats.slowest,
        total_replies: stats.count,
      });
    }

    result.user_response_times = userRtRows;
  }

  return NextResponse.json(result);
}