import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/data — Public data API for external dashboard integration
// Query params:
//   dataset: conversations | messages | tasks | team_members | sla | activity | all (default: all)
//   limit: number (default: 500)
//   offset: number (default: 0)
//   since: ISO date — only return records updated/created after this date
//   conversation_id: filter by specific conversation
//   assignee_id: filter by assignee
//   status: filter conversations/tasks by status

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const params = req.nextUrl.searchParams;
  const dataset = params.get("dataset") || "all";
  const limit = Math.min(parseInt(params.get("limit") || "500"), 1000);
  const offset = parseInt(params.get("offset") || "0");
  const since = params.get("since") || null;
  const conversationId = params.get("conversation_id") || null;
  const assigneeId = params.get("assignee_id") || null;
  const status = params.get("status") || null;

  const result: Record<string, any> = {};
  const meta: Record<string, any> = { timestamp: new Date().toISOString(), limit, offset };

  try {
    // ── CONVERSATIONS ──
    if (dataset === "all" || dataset === "conversations") {
      let q = supabase
        .from("conversations")
        .select("id, email_account_id, folder_id, subject, from_name, from_email, preview, is_unread, is_starred, assignee_id, status, has_attachments, attachment_count, last_message_at, created_at, updated_at, assignee:team_members!conversations_assignee_id_fkey(id, name, email, department, role), labels:conversation_labels(label_id, label:labels(id, name, color, bg_color)), email_account:email_accounts(id, name, email)", { count: "exact" })
        .neq("status", "trash")
        .order("last_message_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (since) q = q.gte("updated_at", since);
      if (assigneeId) q = q.eq("assignee_id", assigneeId);
      if (status) q = q.eq("status", status);
      if (conversationId) q = q.eq("id", conversationId);

      const { data, count, error } = await q;
      if (error) return NextResponse.json({ error: "conversations: " + error.message }, { status: 500 });
      result.conversations = data || [];
      meta.conversations_total = count;
    }

    // ── MESSAGES ──
    if (dataset === "all" || dataset === "messages") {
      let q = supabase
        .from("messages")
        .select("id, conversation_id, subject, from_name, from_email, to_addresses, cc_addresses, body_text, snippet, is_outbound, has_attachments, sent_at, sent_by_user_id, created_at", { count: "exact" })
        .order("sent_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (since) q = q.gte("created_at", since);
      if (conversationId) q = q.eq("conversation_id", conversationId);

      const { data, count, error } = await q;
      if (error) return NextResponse.json({ error: "messages: " + error.message }, { status: 500 });
      result.messages = data || [];
      meta.messages_total = count;
    }

    // ── TASKS ──
    if (dataset === "all" || dataset === "tasks") {
      let q = supabase
        .from("tasks")
        .select("id, text, status, is_done, due_date, due_time, created_at, updated_at, conversation_id, category:task_categories(id, name), task_assignees(team_member_id, is_done, status, team_member:team_members!task_assignees_team_member_id_fkey(id, name, email, department))", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (since) q = q.gte("updated_at", since);
      if (conversationId) q = q.eq("conversation_id", conversationId);
      if (status) q = q.eq("status", status);

      const { data, count, error } = await q;
      if (error) return NextResponse.json({ error: "tasks: " + error.message }, { status: 500 });
      result.tasks = data || [];
      meta.tasks_total = count;
    }

    // ── TEAM MEMBERS ──
    if (dataset === "all" || dataset === "team_members") {
      const { data, count, error } = await supabase
        .from("team_members")
        .select("id, name, email, role, department, is_active, has_call_skillset, created_at", { count: "exact" })
        .order("name")
        .range(offset, offset + limit - 1);

      if (error) return NextResponse.json({ error: "team_members: " + error.message }, { status: 500 });
      result.team_members = data || [];
      meta.team_members_total = count;
    }

    // ── LABELS ──
    if (dataset === "all" || dataset === "labels") {
      const { data, error } = await supabase
        .from("labels")
        .select("id, name, color, bg_color, created_at")
        .order("name");

      if (error) return NextResponse.json({ error: "labels: " + error.message }, { status: 500 });
      result.labels = data || [];
    }

    // ── EMAIL ACCOUNTS ──
    if (dataset === "all" || dataset === "accounts") {
      const { data, error } = await supabase
        .from("email_accounts")
        .select("id, name, email, is_active, created_at")
        .order("name");

      if (error) return NextResponse.json({ error: "accounts: " + error.message }, { status: 500 });
      result.accounts = data || [];
    }

    // ── FOLDERS ──
    if (dataset === "all" || dataset === "folders") {
      const { data, error } = await supabase
        .from("folders")
        .select("id, name, email_account_id, is_system, position, created_at")
        .order("position");

      if (error) return NextResponse.json({ error: "folders: " + error.message }, { status: 500 });
      result.folders = data || [];
    }

    // ── ACTIVITY LOG ──
    if (dataset === "all" || dataset === "activity") {
      let q = supabase
        .from("activity_log")
        .select("id, conversation_id, actor_id, action, details, created_at, actor:team_members!activity_log_actor_id_fkey(id, name, email)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (since) q = q.gte("created_at", since);
      if (conversationId) q = q.eq("conversation_id", conversationId);

      const { data, count, error } = await q;
      if (error) return NextResponse.json({ error: "activity: " + error.message }, { status: 500 });
      result.activity = data || [];
      meta.activity_total = count;
    }

    // ── NOTES ──
    if (dataset === "all" || dataset === "notes") {
      let q = supabase
        .from("notes")
        .select("id, conversation_id, text, title, author_id, created_at, author:team_members!notes_author_id_fkey(id, name, email)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(offset, offset + limit - 1);

      if (since) q = q.gte("created_at", since);
      if (conversationId) q = q.eq("conversation_id", conversationId);

      const { data, count, error } = await q;
      if (error) return NextResponse.json({ error: "notes: " + error.message }, { status: 500 });
      result.notes = data || [];
      meta.notes_total = count;
    }

    // ── SLA / RESPONSE METRICS ──
    if (dataset === "sla") {
      const { data: convos } = await supabase
        .from("conversations")
        .select("id, subject, from_name, from_email, assignee_id, last_message_at, created_at")
        .neq("status", "trash");

      const { data: msgs } = await supabase
        .from("messages")
        .select("conversation_id, is_outbound, sent_at, sent_by_user_id")
        .order("sent_at", { ascending: true })
        .limit(5000);

      const { data: members } = await supabase.from("team_members").select("id, name, email");
      const memberMap: Record<string, any> = {};
      for (const m of (members || [])) memberMap[m.id] = m;

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

        if (since && convo.last_message_at < since) continue;

        const lastMsg = cMsgs[cMsgs.length - 1];
        const waitingHours = Math.round((now.getTime() - new Date(lastMsg.sent_at).getTime()) / (1000 * 60 * 60) * 10) / 10;

        let firstResponseHours: number | null = null;
        let firstResponseBy = "";
        for (let i = 0; i < cMsgs.length; i++) {
          if (!cMsgs[i].is_outbound) {
            for (let j = i + 1; j < cMsgs.length; j++) {
              if (cMsgs[j].is_outbound) {
                firstResponseHours = Math.round((new Date(cMsgs[j].sent_at).getTime() - new Date(cMsgs[i].sent_at).getTime()) / (1000 * 60 * 60) * 10) / 10;
                firstResponseBy = memberMap[cMsgs[j].sent_by_user_id]?.name || "";
                break;
              }
            }
            break;
          }
        }

        slaRows.push({
          conversation_id: convo.id,
          subject: convo.subject,
          from_name: convo.from_name,
          from_email: convo.from_email,
          assignee: memberMap[convo.assignee_id]?.name || "Unassigned",
          assignee_id: convo.assignee_id,
          total_messages: cMsgs.length,
          inbound: cMsgs.filter((m: any) => !m.is_outbound).length,
          outbound: cMsgs.filter((m: any) => m.is_outbound).length,
          last_direction: lastMsg.is_outbound ? "outbound" : "inbound",
          reply_status: lastMsg.is_outbound ? "awaiting_supplier" : "awaiting_our_reply",
          waiting_hours: waitingHours,
          first_response_hours: firstResponseHours,
          first_response_by: firstResponseBy,
          created_at: convo.created_at,
          last_message_at: convo.last_message_at,
        });
      }

      result.sla = slaRows;
      meta.sla_total = slaRows.length;
    }

    return NextResponse.json({ data: result, meta }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "s-maxage=30, stale-while-revalidate=60",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Unknown error" }, { status: 500 });
  }
}

// Handle CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}