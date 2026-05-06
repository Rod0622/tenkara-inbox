"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ArrowLeft, CheckCircle2, ExternalLink, Inbox, ListTodo, Loader2,
  Mail, Send, AlertTriangle, Eye, Clock,
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";
import TaskCountdown from "@/components/TaskCountdown";

interface TaskDetail {
  id: string; text: string; due_date: string | null; due_time: string | null;
  status: string; dismiss_reason: string | null; created_at: string;
  conversation_subject: string; conversation_id: string | null;
  assignees: { name: string; initials: string; color: string; is_done: boolean; status: string }[];
  category_name: string | null; category_color: string | null;
}

interface ConvoDetail {
  id: string; subject: string; from_name: string; from_email: string;
  preview: string; status: string; is_unread: boolean; last_message_at: string;
  email_account_name: string; folder_name: string | null;
  reply_status: "awaiting_our_reply" | "awaiting_supplier_reply" | "internal" | "unknown";
  waiting_hours: number;
}

interface SentEmail {
  id: string; subject: string; to_addresses: string; sent_at: string;
  conversation_id: string; from_email: string;
}

function fmtTime(mins: number): string {
  if (mins < 60) return mins + "m";
  if (mins < 1440) return Math.round(mins / 60 * 10) / 10 + "h";
  return Math.round(mins / 1440 * 10) / 10 + "d";
}

export default function MyPerformancePage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [tasks, setTasks] = useState<TaskDetail[]>([]);
  const [conversations, setConversations] = useState<ConvoDetail[]>([]);
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [responseStats, setResponseStats] = useState<{ avg: number; fastest: number; slowest: number; total: number; suppliers: any[] } | null>(null);
  const [activeTab, setActiveTab] = useState<"tasks" | "emails" | "unread" | "sent" | "response">("tasks");

  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    if (!session?.user?.email) return;
    loadMyData();
  }, [session?.user?.email]);

  async function loadMyData() {
    setLoading(true);
    const sb = createBrowserClient();

    // Find current user
    const { data: me } = await sb.from("team_members").select("*").eq("email", session!.user!.email!).single();
    if (!me) { setLoading(false); return; }
    setUser(me);

    // Fetch tasks, conversations, sent emails, response times in parallel
    const [tasksRes, convosRes, sentRes, rtRes] = await Promise.all([
      // Tasks assigned to me
      sb.from("task_assignees")
        .select("task_id, is_done, status, task:tasks(id, text, due_date, due_time, status, is_done, dismiss_reason, created_at, conversation_id, conversation:conversations(id, subject), task_assignees(team_member_id, is_done, status, team_member:team_members(name, initials, color)), category:task_categories(name, color))")
        .eq("team_member_id", me.id),

      // My assigned conversations
      sb.from("conversations")
        .select("id, subject, from_name, from_email, preview, status, is_unread, last_message_at, assignee_id, email_account_id, folder_id, email_account:email_accounts(name), folder:folders(name)")
        .eq("assignee_id", me.id)
        .neq("status", "trash")
        .neq("status", "merged")
        .order("last_message_at", { ascending: false })
        .limit(100),

      // My sent emails
      sb.from("messages")
        .select("id, subject, to_addresses, sent_at, conversation_id, from_email, sent_by_user_id")
        .eq("is_outbound", true)
        .eq("sent_by_user_id", me.id)
        .order("sent_at", { ascending: false })
        .limit(50),

      // My response times
      sb.from("response_times")
        .select("*")
        .eq("team_member_id", me.id)
        .eq("direction", "team_reply")
        .order("response_sent_at", { ascending: false })
        .limit(500),
    ]);

    // Process tasks
    const uTasks: TaskDetail[] = (tasksRes.data || [])
      .filter((r: any) => r.task)
      .map((r: any) => {
        const t = r.task;
        const taskStatus = t.status === "dismissed" ? "dismissed" : (r.status || (r.is_done ? "completed" : "todo"));
        return {
          id: t.id, text: t.text, due_date: t.due_date, due_time: t.due_time,
          status: taskStatus, dismiss_reason: t.dismiss_reason || null, created_at: t.created_at,
          conversation_subject: t.conversation?.subject || "Unknown",
          conversation_id: t.conversation?.id || t.conversation_id,
          assignees: (t.task_assignees || []).map((a: any) => ({
            name: a.team_member?.name || "Unknown", initials: a.team_member?.initials || "?",
            color: a.team_member?.color || "var(--text-secondary)", is_done: a.is_done,
            status: a.status || (a.is_done ? "completed" : "todo"),
          })),
          category_name: t.category?.name || null, category_color: t.category?.color || null,
        };
      })
      .sort((a: TaskDetail, b: TaskDetail) => (a.due_date || "z").localeCompare(b.due_date || "z"));
    setTasks(uTasks);

    // Process conversations — get reply status
    const convoIds = (convosRes.data || []).map((c: any) => c.id);
    let lastMsgMap: Record<string, { is_outbound: boolean; sent_at: string }> = {};
    if (convoIds.length > 0) {
      for (let i = 0; i < convoIds.length; i += 50) {
        const batch = convoIds.slice(i, i + 50);
        const { data: msgs } = await sb.from("messages").select("conversation_id, is_outbound, sent_at").in("conversation_id", batch).order("sent_at", { ascending: false });
        for (const msg of (msgs || [])) {
          if (!lastMsgMap[msg.conversation_id]) lastMsgMap[msg.conversation_id] = { is_outbound: msg.is_outbound, sent_at: msg.sent_at };
        }
      }
    }

    const now = new Date();
    const uConvos: ConvoDetail[] = (convosRes.data || []).map((c: any) => {
      const lastMsg = lastMsgMap[c.id];
      let replyStatus: ConvoDetail["reply_status"] = "unknown";
      let waitingHours = 0;
      if (c.from_email === "internal") { replyStatus = "internal"; }
      else if (lastMsg) {
        const msgTime = new Date(lastMsg.sent_at);
        waitingHours = Math.round((now.getTime() - msgTime.getTime()) / (1000 * 60 * 60) * 10) / 10;
        replyStatus = lastMsg.is_outbound ? "awaiting_supplier_reply" : "awaiting_our_reply";
      }
      return {
        id: c.id, subject: c.subject, from_name: c.from_name, from_email: c.from_email,
        preview: c.preview || "", status: c.status, is_unread: c.is_unread,
        last_message_at: c.last_message_at, email_account_name: c.email_account?.name || "",
        folder_name: c.folder?.name || null, reply_status: replyStatus, waiting_hours: waitingHours,
      };
    });
    setConversations(uConvos);

    // Process sent
    setSentEmails((sentRes.data || []).map((s: any) => ({
      id: s.id, subject: s.subject, to_addresses: s.to_addresses,
      sent_at: s.sent_at, conversation_id: s.conversation_id, from_email: s.from_email,
    })));

    // Process response times
    const rts = rtRes.data || [];
    if (rts.length > 0) {
      const mins = rts.map((r: any) => r.response_minutes).sort((a: number, b: number) => a - b);
      const avg = Math.round(mins.reduce((a: number, b: number) => a + b, 0) / mins.length);

      // Per-supplier breakdown
      const bySupplier: Record<string, { mins: number[]; subjects: Set<string> }> = {};
      for (const r of rts) {
        const se = r.supplier_email || "unknown";
        if (!bySupplier[se]) bySupplier[se] = { mins: [], subjects: new Set() };
        bySupplier[se].mins.push(r.response_minutes);
      }
      const suppliers = Object.entries(bySupplier).map(([email, data]) => {
        const sorted = data.mins.slice().sort((a, b) => a - b);
        return {
          email, avg: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length),
          total: sorted.length, subjects: Array.from(data.subjects),
        };
      }).sort((a, b) => b.total - a.total);

      setResponseStats({
        avg, fastest: Math.round(mins[0]), slowest: Math.round(mins[mins.length - 1]),
        total: mins.length, suppliers,
      });
    }

    setLoading(false);
  }

  // Derived stats
  const taskStats = useMemo(() => {
    const todo = tasks.filter(t => t.status === "todo").length;
    const inProgress = tasks.filter(t => t.status === "in_progress").length;
    const completed = tasks.filter(t => t.status === "completed").length;
    const dismissed = tasks.filter(t => t.status === "dismissed").length;
    const now = new Date();
    const overdue = tasks.filter(t => t.status !== "completed" && t.status !== "dismissed" && t.due_date && new Date(t.due_date) < now).length;
    return { todo, inProgress, completed, dismissed, overdue, total: tasks.length };
  }, [tasks]);

  const unreadConvos = useMemo(() => conversations.filter(c => c.is_unread), [conversations]);
  const awaitingReply = useMemo(() => conversations.filter(c => c.reply_status === "awaiting_our_reply"), [conversations]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] flex items-center justify-center">
        <div className="text-center">
          <div className="text-lg font-semibold text-[var(--danger)] mb-2">Unable to load your profile</div>
          <Link href="/" className="text-[var(--info)] text-sm hover:underline">Back to Inbox</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-5xl px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><ArrowLeft size={20} /></Link>
          <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-[var(--bg)]" style={{ background: user.color }}>{user.initials}</div>
          <div>
            <h1 className="text-2xl font-normal font-serif tracking-tight">My Performance</h1>
            <div className="text-sm text-[var(--text-secondary)]">{user.name} · {user.department || "Team Member"}</div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-6 gap-3 mb-6">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1 flex items-center gap-1"><ListTodo size={11} /> Open Tasks</div>
            <div className="text-2xl font-bold text-[var(--info)]">{taskStats.todo + taskStats.inProgress}</div>
            <div className="text-[10px] text-[var(--text-muted)]">{taskStats.completed} completed</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1 flex items-center gap-1"><AlertTriangle size={11} /> Overdue</div>
            <div className="text-2xl font-bold" style={{ color: taskStats.overdue > 0 ? "var(--danger)" : "var(--text-muted)" }}>{taskStats.overdue}</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1 flex items-center gap-1"><Mail size={11} /> Assigned</div>
            <div className="text-2xl font-bold">{conversations.length}</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[10px] text-[var(--warning)] uppercase font-semibold mb-1 flex items-center gap-1"><Eye size={11} /> Unread</div>
            <div className="text-2xl font-bold text-[var(--warning)]">{unreadConvos.length}</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1 flex items-center gap-1"><Send size={11} /> Sent</div>
            <div className="text-2xl font-bold text-[var(--accent)]">{sentEmails.length}</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1 flex items-center gap-1"><Clock size={11} /> Avg Response</div>
            <div className="text-2xl font-bold" style={{ color: responseStats ? (responseStats.avg <= 240 ? "var(--accent)" : responseStats.avg <= 660 ? "var(--warning)" : "var(--danger)") : "var(--text-muted)" }}>
              {responseStats ? fmtTime(responseStats.avg) : "—"}
            </div>
            <div className="text-[10px] text-[var(--text-muted)]">{responseStats?.total || 0} replies</div>
          </div>
        </div>

        {/* Needs Attention */}
        {(awaitingReply.length > 0 || taskStats.overdue > 0) && (
          <div className="mb-6 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/5 p-4">
            <div className="text-sm font-semibold text-[var(--danger)] mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Needs Your Attention</div>
            <div className="flex gap-4 text-xs">
              {awaitingReply.length > 0 && <span className="text-[var(--danger)]">{awaitingReply.length} emails awaiting your reply</span>}
              {taskStats.overdue > 0 && <span className="text-[var(--warning)]">{taskStats.overdue} overdue tasks</span>}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 mb-4 border-b border-[var(--border)] pb-2">
          {([
            { id: "tasks" as const, label: `Tasks (${tasks.length})`, icon: <ListTodo size={13} /> },
            { id: "emails" as const, label: `Assigned (${conversations.length})`, icon: <Inbox size={13} /> },
            { id: "unread" as const, label: `Unread (${unreadConvos.length})`, icon: <Eye size={13} /> },
            { id: "sent" as const, label: `Sent (${sentEmails.length})`, icon: <Send size={13} /> },
            { id: "response" as const, label: `Response Times`, icon: <Clock size={13} /> },
          ]).map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                activeTab === tab.id ? "bg-[var(--border)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              }`}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* Tasks Tab */}
        {activeTab === "tasks" && (
          <div className="space-y-2">
            {tasks.length === 0 ? <div className="text-center py-10 text-[var(--text-muted)] text-sm">No tasks assigned</div> : tasks.map(t => (
              <div key={t.id} className={`rounded-xl border bg-[var(--surface)] p-3 ${t.status === "completed" || t.status === "dismissed" ? "border-[var(--border)] opacity-60" : t.due_date && new Date(t.due_date) < new Date() && t.status !== "completed" ? "border-[var(--danger)]/30" : "border-[var(--border)]"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{t.text}</div>
                    {t.conversation_subject && <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Thread: {t.conversation_subject}</div>}
                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                        t.status === "completed" ? "bg-[var(--accent)]/10 text-[var(--accent)]" :
                        t.status === "dismissed" ? "bg-[var(--warning)]/10 text-[var(--warning)]" :
                        t.status === "in_progress" ? "bg-[var(--highlight)]/10 text-[var(--highlight)]" :
                        "bg-[var(--info)]/10 text-[var(--info)]"
                      }`}>{t.status}</span>
                      {t.category_name && <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: (t.category_color || "var(--text-muted)") + "20", color: t.category_color || "var(--text-muted)" }}>{t.category_name}</span>}
                      {t.due_date && <TaskCountdown dueDate={t.due_date} dueTime={t.due_time} isCompleted={t.status === "completed" || t.status === "dismissed"} compact />}
                      {t.assignees.map((a, i) => (
                        <span key={i} className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-[var(--bg)]" style={{ background: a.color }} title={a.name}>{a.initials}</span>
                      ))}
                    </div>
                  </div>
                  {t.conversation_id && (
                    <Link href={`/#conversation=${t.conversation_id}`} className="text-[var(--info)] hover:text-[var(--info)] shrink-0"><ExternalLink size={14} /></Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Assigned Emails Tab */}
        {activeTab === "emails" && (
          <div className="space-y-1">
            {conversations.length === 0 ? <div className="text-center py-10 text-[var(--text-muted)] text-sm">No assigned conversations</div> : conversations.map(c => (
              <Link key={c.id} href={`/#conversation=${c.id}`}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-[var(--surface)] hover:border-[var(--info)]/30 transition-all ${
                  c.reply_status === "awaiting_our_reply" && c.waiting_hours > 24 ? "border-[var(--danger)]/30" : "border-[var(--border)]"
                }`}>
                <div className="flex-shrink-0 w-2.5">{c.is_unread && <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" />}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{c.subject}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">{c.from_name} &lt;{c.from_email}&gt;</div>
                </div>
                {c.reply_status === "awaiting_our_reply" && <span className="text-[9px] font-semibold text-[var(--danger)] bg-[var(--danger)]/10 px-1.5 py-0.5 rounded shrink-0">Needs reply · {c.waiting_hours < 24 ? Math.round(c.waiting_hours) + "h" : Math.round(c.waiting_hours / 24) + "d"}</span>}
                <div className="text-[10px] text-[var(--text-muted)] shrink-0">{c.email_account_name}</div>
                <div className="text-[10px] text-[var(--text-muted)] shrink-0">{new Date(c.last_message_at).toLocaleDateString()}</div>
                <ExternalLink size={12} className="text-[var(--text-muted)] shrink-0" />
              </Link>
            ))}
          </div>
        )}

        {/* Unread Tab */}
        {activeTab === "unread" && (
          <div className="space-y-1">
            {unreadConvos.length === 0 ? <div className="text-center py-10 text-[var(--text-muted)] text-sm">No unread emails</div> : unreadConvos.map(c => (
              <Link key={c.id} href={`/#conversation=${c.id}`}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--surface)] hover:border-[var(--warning)]/40 transition-all">
                <div className="w-2.5 h-2.5 rounded-full bg-[var(--warning)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold truncate">{c.subject}</div>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate">{c.from_name} &lt;{c.from_email}&gt;</div>
                  <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{c.preview}</div>
                </div>
                <div className="flex flex-col items-end shrink-0 gap-1">
                  <div className="text-[10px] text-[var(--text-muted)]">{c.email_account_name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{new Date(c.last_message_at).toLocaleDateString()} {new Date(c.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                  {c.reply_status === "awaiting_our_reply" && <span className="text-[9px] font-semibold text-[var(--danger)] bg-[var(--danger)]/10 px-1.5 py-0.5 rounded">Needs reply</span>}
                </div>
                <ExternalLink size={12} className="text-[var(--text-muted)] shrink-0" />
              </Link>
            ))}
          </div>
        )}

        {/* Sent Tab */}
        {activeTab === "sent" && (
          <div className="space-y-1">
            {sentEmails.length === 0 ? <div className="text-center py-10 text-[var(--text-muted)] text-sm">No sent emails</div> : sentEmails.map(s => (
              <Link key={s.id} href={`/#conversation=${s.conversation_id}`}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/30 transition-all">
                <Send size={14} className="text-[var(--accent)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium truncate">{s.subject}</div>
                  <div className="text-[11px] text-[var(--text-muted)] truncate">To: {s.to_addresses}</div>
                </div>
                <div className="text-[10px] text-[var(--text-muted)] shrink-0">{new Date(s.sent_at).toLocaleDateString()} {new Date(s.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                <ExternalLink size={12} className="text-[var(--text-muted)] shrink-0" />
              </Link>
            ))}
          </div>
        )}

        {/* Response Times Tab */}
        {activeTab === "response" && (
          <div>
            {!responseStats ? (
              <div className="text-center py-10 text-[var(--text-muted)] text-sm">No response time data yet</div>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1">Avg Response</div>
                    <div className="text-xl font-bold" style={{ color: responseStats.avg <= 240 ? "var(--accent)" : responseStats.avg <= 660 ? "var(--warning)" : "var(--danger)" }}>{fmtTime(responseStats.avg)}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1">Fastest</div>
                    <div className="text-xl font-bold text-[var(--accent)]">{fmtTime(responseStats.fastest)}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1">Slowest</div>
                    <div className="text-xl font-bold text-[var(--warning)]">{fmtTime(responseStats.slowest)}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-center">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1">Total Replies</div>
                    <div className="text-xl font-bold">{responseStats.total}</div>
                  </div>
                </div>

                <div className="text-sm font-semibold mb-3">Response Times by Supplier</div>
                <div className="space-y-1">
                  {responseStats.suppliers.map(sup => (
                    <Link key={sup.email} href={`/contacts/${encodeURIComponent(sup.email)}`}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--info)]/30 transition-all">
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-medium">{sup.email}</div>
                      </div>
                      <div className="text-sm font-semibold" style={{ color: sup.avg <= 240 ? "var(--accent)" : sup.avg <= 660 ? "var(--warning)" : "var(--danger)" }}>{fmtTime(sup.avg)}</div>
                      <div className="text-[11px] text-[var(--text-secondary)]">{sup.total} replies</div>
                      <ExternalLink size={12} className="text-[var(--text-muted)] shrink-0" />
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}