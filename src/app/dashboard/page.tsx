"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Users, CheckCircle2, AlertTriangle,
  ListTodo, Mail, CalendarClock, Send, ChevronDown, X,
  ExternalLink, Inbox, Eye, Download, FileSpreadsheet, FileJson, FileText
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";
import {
  getBusinessHoursRemaining as sharedGetBusinessHoursRemaining,
  getBusinessHoursElapsed as sharedGetBusinessHoursElapsed,
  formatBusinessTime as sharedFormatBusinessTime,
  type SupplierHours,
} from "@/lib/business-hours";

// Lazy-init supabase client (avoid module-level call that breaks static generation)
let _supabase: ReturnType<typeof createBrowserClient> | null = null;
function getSupabase() {
  if (!_supabase) _supabase = createBrowserClient();
  return _supabase;
}

// ── Types ─────────────────────────────────────────────

interface UserStats {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  role: string;
  department: string;
  tasks: { total: number; todo: number; in_progress: number; completed: number; dismissed: number; overdue: number; dueSoon: number };
  conversations: { assigned: number; unread: number };
  sentEmails: number;
}

interface TaskDetail {
  id: string;
  text: string;
  due_date: string | null;
  due_time: string | null;
  status: string;
  dismiss_reason?: string | null;
  created_at: string;
  conversation_subject: string;
  conversation_id: string;
  assignees: { name: string; initials: string; color: string; is_done: boolean; status: string }[];
  category_name: string | null;
  category_color: string | null;
}

interface ConversationDetail {
  id: string;
  subject: string;
  from_name: string;
  from_email: string;
  preview: string;
  status: string;
  is_unread: boolean;
  last_message_at: string;
  assignee_id: string | null;
  email_account_name: string;
  folder_name: string | null;
  reply_status: "awaiting_our_reply" | "awaiting_supplier_reply" | "internal" | "unknown";
  waiting_hours: number;
}

interface SentEmail {
  id: string;
  subject: string;
  to_addresses: string;
  sent_at: string;
  conversation_id: string;
  from_email: string;
}

type ViewMode = "overview" | "critical" | "all-tasks" | "user-detail" | "sla" | "export";

// ── Helpers ───────────────────────────────────────────

// Business hours now use shared utility from @/lib/business-hours
// These wrappers maintain the same call signatures used throughout the dashboard
function getBusinessHoursRemaining(dueDate: string): number {
  return sharedGetBusinessHoursRemaining(dueDate);
}

function getBusinessHoursElapsed(dueDate: string): number {
  return sharedGetBusinessHoursElapsed(dueDate);
}

function formatBusinessTime(hours: number): string {
  return sharedFormatBusinessTime(hours);
}

function formatDueDate(date: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  
  if (d < now) {
    const bh = getBusinessHoursElapsed(date);
    if (bh < 11) return bh + "h overdue";
    const days = Math.floor(bh / 11);
    return days + "d " + (bh % 11) + "h overdue";
  }
  
  const bh = getBusinessHoursRemaining(date);
  if (bh === 0) return "Due now";
  if (bh < 11) return "Due in " + bh + "h";
  const days = Math.floor(bh / 11);
  const remHours = bh % 11;
  if (remHours === 0) return "Due in " + days + "d";
  return "Due in " + days + "d " + remHours + "h";
}

function getDueColor(date: string | null): string {
  if (!date) return "#484F58";
  const d = new Date(date);
  if (d < new Date()) return "#F85149"; // overdue
  const bh = getBusinessHoursRemaining(date);
  if (bh <= 11) return "#F85149"; // less than 1 business day
  if (bh <= 22) return "#F0883E"; // less than 2 business days
  return "#58A6FF";
}

function getPresetDates(preset: string): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  switch (preset) {
    case "today": return { from: fmt(today), to: fmt(today) };
    case "yesterday": {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(y) };
    }
    case "this_week": {
      const start = new Date(today); start.setDate(start.getDate() - start.getDay());
      return { from: fmt(start), to: fmt(today) };
    }
    case "last_week": {
      const end = new Date(today); end.setDate(end.getDate() - end.getDay() - 1);
      const start = new Date(end); start.setDate(start.getDate() - 6);
      return { from: fmt(start), to: fmt(end) };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: fmt(start), to: fmt(today) };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fmt(start), to: fmt(end) };
    }
    default: return { from: "", to: "" };
  }
}

// ── Main Component ────────────────────────────────────

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(true);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [criticalTasks, setCriticalTasks] = useState<TaskDetail[]>([]);
  const [allTasks, setAllTasks] = useState<TaskDetail[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");

  // User detail drill-down
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userTasks, setUserTasks] = useState<TaskDetail[]>([]);
  const [userConversations, setUserConversations] = useState<ConversationDetail[]>([]);
  const [userSentEmails, setUserSentEmails] = useState<SentEmail[]>([]);
  const [userDetailTab, setUserDetailTab] = useState<"tasks" | "emails" | "sent">("tasks");
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  // Date filter
  const [datePreset, setDatePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Selected user filter for all-tasks view
  const [taskFilterUser, setTaskFilterUser] = useState<string | null>(null);
  const [dashTaskSearch, setDashTaskSearch] = useState("");

  // SLA/KPI metrics
  const [slaData, setSlaData] = useState<any>(null);
  const [slaLoading, setSlaLoading] = useState(false);
  const [slaSubTab, setSlaSubTab] = useState<"response-times" | "awaiting-ours" | "awaiting-supplier">("response-times");

  useEffect(() => { loadDashboardData(); }, [dateFrom, dateTo]);

  // Load SLA data when switching to SLA tab or when dates change
  useEffect(() => {
    if (viewMode === "sla") loadSlaData();
  }, [viewMode, dateFrom, dateTo]);

  async function loadSlaData() {
    setSlaLoading(true);
    try {
      let url = "/api/metrics?";
      if (effectiveDateFrom) url += "date_from=" + effectiveDateFrom + "&";
      if (effectiveDateTo) url += "date_to=" + effectiveDateTo + "&";
      const res = await fetch(url);
      const data = await res.json();
      setSlaData(data);
    } catch (_e) {
      console.error("Failed to load SLA metrics");
    } finally {
      setSlaLoading(false);
    }
  }

  // Reload user detail when dates change
  useEffect(() => {
    if (selectedUserId && viewMode === "user-detail") {
      loadUserDetail(selectedUserId);
    }
  }, [dateFrom, dateTo]);

  const effectiveDateFrom = dateFrom || null;
  const effectiveDateTo = dateTo ? dateTo + "T23:59:59.999Z" : null;

  async function loadDashboardData() {
    setLoading(true);

    const { data: members } = await getSupabase()
      .from("team_members")
      .select("id, name, email, initials, color, role, department")
      .eq("is_active", true)
      .order("name");

    // Tasks query with optional date filter
    let tasksQuery = getSupabase()
      .from("tasks")
      .select("id, text, due_date, due_time, status, is_done, dismiss_reason, created_at, conversation_id, category_id, conversation:conversations(id, subject), task_assignees(team_member_id, is_done, status, team_member:team_members(name, initials, color)), category:task_categories(name, color)")
      .order("due_date", { ascending: true });

    if (effectiveDateFrom) tasksQuery = tasksQuery.gte("created_at", effectiveDateFrom);
    if (effectiveDateTo) tasksQuery = tasksQuery.lte("created_at", effectiveDateTo);

    const { data: tasks } = await tasksQuery;

    // Conversations
    let convosQuery = getSupabase().from("conversations").select("id, assignee_id, is_unread, status, email_account_id").neq("status", "trash");
    if (effectiveDateFrom) convosQuery = convosQuery.gte("last_message_at", effectiveDateFrom);
    if (effectiveDateTo) convosQuery = convosQuery.lte("last_message_at", effectiveDateTo);
    const { data: conversations } = await convosQuery;

    // Sent emails — count by sent_by_user_id (most accurate), fallback to account_access
    let outboundQuery = getSupabase()
      .from("messages")
      .select("id, conversation_id, sent_at, sent_by_user_id")
      .eq("is_outbound", true);
    if (effectiveDateFrom) outboundQuery = outboundQuery.gte("sent_at", effectiveDateFrom);
    if (effectiveDateTo) outboundQuery = outboundQuery.lte("sent_at", effectiveDateTo);
    const { data: outboundMessages } = await outboundQuery;

    // Map conversation_id -> email_account_id for fallback attribution
    const convoToAccount: Record<string, string> = {};
    for (const c of (conversations || [])) {
      if ((c as any).email_account_id) convoToAccount[c.id] = (c as any).email_account_id;
    }

    // Get account_access for fallback
    const { data: accessData } = await getSupabase().from("account_access").select("team_member_id, email_account_id");
    const accountToUsers: Record<string, string[]> = {};
    for (const row of (accessData || [])) {
      if (!accountToUsers[row.email_account_id]) accountToUsers[row.email_account_id] = [];
      accountToUsers[row.email_account_id].push(row.team_member_id);
    }

    // Count sent per user
    const sentByUser: Record<string, number> = {};
    const unattributed: Record<string, number> = {}; // per account, for messages without sent_by_user_id

    for (const msg of (outboundMessages || [])) {
      if (msg.sent_by_user_id) {
        // Attributed to a specific user
        sentByUser[msg.sent_by_user_id] = (sentByUser[msg.sent_by_user_id] || 0) + 1;
      } else {
        // Unattributed — count per account for fallback display
        const accId = convoToAccount[msg.conversation_id];
        if (accId) unattributed[accId] = (unattributed[accId] || 0) + 1;
      }
    }

    const now = new Date();
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const stats: UserStats[] = (members || []).map((member) => {
      const memberTasks = (tasks || []).filter((t: any) =>
        (t.task_assignees || []).some((a: any) => a.team_member_id === member.id)
      );
      const getStatus = (task: any) => {
        // Dismissed is a task-level status that overrides per-assignee status
        if (task.status === "dismissed") return "dismissed";
        const a = (task.task_assignees || []).find((a: any) => a.team_member_id === member.id);
        return a?.status || (a?.is_done ? "completed" : "todo");
      };
      const todo = memberTasks.filter((t: any) => getStatus(t) === "todo").length;
      const inProgress = memberTasks.filter((t: any) => getStatus(t) === "in_progress").length;
      const completed = memberTasks.filter((t: any) => getStatus(t) === "completed").length;
      const dismissed = memberTasks.filter((t: any) => getStatus(t) === "dismissed").length;
      const overdue = memberTasks.filter((t: any) => getStatus(t) !== "completed" && getStatus(t) !== "dismissed" && t.due_date && new Date(t.due_date) < now).length;
      const dueSoon = memberTasks.filter((t: any) => {
        const s = getStatus(t);
        if (s === "completed" || s === "dismissed" || !t.due_date) return false;
        const d = new Date(t.due_date);
        return d >= now && d <= in48Hours;
      }).length;

      const assignedConvos = (conversations || []).filter((c: any) => c.assignee_id === member.id);

      // Sent count: attributed (sent_by_user_id) + share of unattributed from accessible accounts
      const attributedSent = sentByUser[member.id] || 0;
      const sentCount = attributedSent;

      return {
        id: member.id, name: member.name, email: member.email,
        initials: member.initials || member.name?.slice(0, 2).toUpperCase(),
        color: member.color || "#4ADE80", role: member.role,
        department: member.department || "Uncategorized",
        tasks: { total: memberTasks.length, todo, in_progress: inProgress, completed, dismissed, overdue, dueSoon },
        conversations: { assigned: assignedConvos.length, unread: assignedConvos.filter((c: any) => c.is_unread).length },
        sentEmails: sentCount,
      };
    });

    const mapTask = (t: any): TaskDetail => ({
      id: t.id, text: t.text, due_date: t.due_date, due_time: t.due_time,
      status: t.status || "todo", dismiss_reason: t.dismiss_reason || null, created_at: t.created_at,
      conversation_subject: t.conversation?.subject || "Unknown",
      conversation_id: t.conversation?.id || t.conversation_id,
      assignees: (t.task_assignees || []).map((a: any) => ({
        name: a.team_member?.name || "Unknown", initials: a.team_member?.initials || "?",
        color: a.team_member?.color || "#7D8590", is_done: a.is_done,
        status: a.status || (a.is_done ? "completed" : "todo"),
      })),
      category_name: t.category?.name || null, category_color: t.category?.color || null,
    });

    const critical = (tasks || [])
      .filter((t: any) => !t.is_done && t.status !== "completed" && t.status !== "dismissed" && !(t.task_assignees || []).every((a: any) => a.is_done) && t.due_date && new Date(t.due_date) <= in48Hours)
      .map(mapTask).sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

    const all = (tasks || [])
      .filter((t: any) => !(t.task_assignees || []).every((a: any) => a.is_done) && t.status !== "completed" && t.status !== "dismissed" && !t.is_done)
      .map(mapTask).sort((a, b) => (a.due_date || "z").localeCompare(b.due_date || "z"));

    setUserStats(stats);
    setCriticalTasks(critical);
    setAllTasks(all);
    setLoading(false);
  }

  async function loadUserDetail(userId: string) {
    setSelectedUserId(userId);
    setViewMode("user-detail");
    setUserDetailTab("tasks");
    setUserDetailLoading(true);

    const user = userStats.find((u) => u.id === userId);

    // Fetch user's tasks WITH date filter
    let tasksQuery = getSupabase()
      .from("task_assignees")
      .select("task_id, is_done, status, task:tasks(id, text, due_date, due_time, status, is_done, dismiss_reason, created_at, conversation_id, conversation:conversations(id, subject), task_assignees(team_member_id, is_done, status, team_member:team_members(name, initials, color)), category:task_categories(name, color))")
      .eq("team_member_id", userId);

    const { data: assigneeRows } = await tasksQuery;

    let uTasks: TaskDetail[] = (assigneeRows || [])
      .filter((r: any) => r.task)
      .map((r: any) => {
        const t = r.task;
        // Dismissed is task-level, overrides per-assignee status
        const taskStatus = t.status === "dismissed" ? "dismissed" : (r.status || (r.is_done ? "completed" : "todo"));
        return {
          id: t.id, text: t.text, due_date: t.due_date, due_time: t.due_time,
          status: taskStatus, dismiss_reason: t.dismiss_reason || null, created_at: t.created_at,
          conversation_subject: t.conversation?.subject || "Unknown",
          conversation_id: t.conversation?.id || t.conversation_id,
          assignees: (t.task_assignees || []).map((a: any) => ({
            name: a.team_member?.name || "Unknown", initials: a.team_member?.initials || "?",
            color: a.team_member?.color || "#7D8590", is_done: a.is_done,
            status: a.status || (a.is_done ? "completed" : "todo"),
          })),
          category_name: t.category?.name || null, category_color: t.category?.color || null,
        };
      })
      .sort((a: TaskDetail, b: TaskDetail) => (a.due_date || "z").localeCompare(b.due_date || "z"));

    // Apply date filter on tasks
    if (effectiveDateFrom) {
      uTasks = uTasks.filter((t) => t.created_at >= effectiveDateFrom!);
    }
    if (effectiveDateTo) {
      uTasks = uTasks.filter((t) => t.created_at <= effectiveDateTo!);
    }

    // Fetch user's assigned conversations WITH date filter
    let convosQuery = getSupabase()
      .from("conversations")
      .select("id, subject, from_name, from_email, preview, status, is_unread, last_message_at, assignee_id, email_account_id, folder_id, email_account:email_accounts(name), folder:folders(name)")
      .eq("assignee_id", userId)
      .neq("status", "trash")
      .order("last_message_at", { ascending: false })
      .limit(50);

    if (effectiveDateFrom) convosQuery = convosQuery.gte("last_message_at", effectiveDateFrom);
    if (effectiveDateTo) convosQuery = convosQuery.lte("last_message_at", effectiveDateTo);

    const { data: convos } = await convosQuery;

    // Fetch last message per conversation to determine reply status
    const convoIds = (convos || []).map((c: any) => c.id);
    let lastMsgMap: Record<string, { is_outbound: boolean; sent_at: string }> = {};
    if (convoIds.length > 0) {
      for (let i = 0; i < convoIds.length; i += 50) {
        const batch = convoIds.slice(i, i + 50);
        const { data: msgs } = await getSupabase()
          .from("messages")
          .select("conversation_id, is_outbound, sent_at")
          .in("conversation_id", batch)
          .order("sent_at", { ascending: false });
        // Keep only the latest message per conversation
        for (const msg of (msgs || [])) {
          if (!lastMsgMap[msg.conversation_id]) {
            lastMsgMap[msg.conversation_id] = { is_outbound: msg.is_outbound, sent_at: msg.sent_at };
          }
        }
      }
    }

    const now = new Date();
    const uConvos: ConversationDetail[] = (convos || []).map((c: any) => {
      const lastMsg = lastMsgMap[c.id];
      let replyStatus: ConversationDetail["reply_status"] = "unknown";
      let waitingHours = 0;

      if (c.from_email === "internal") {
        replyStatus = "internal";
      } else if (lastMsg) {
        const msgTime = new Date(lastMsg.sent_at);
        waitingHours = Math.round((now.getTime() - msgTime.getTime()) / (1000 * 60 * 60) * 10) / 10;
        replyStatus = lastMsg.is_outbound ? "awaiting_supplier_reply" : "awaiting_our_reply";
      }

      return {
        id: c.id, subject: c.subject, from_name: c.from_name, from_email: c.from_email,
        preview: c.preview || "", status: c.status, is_unread: c.is_unread,
        last_message_at: c.last_message_at, assignee_id: c.assignee_id,
        email_account_name: c.email_account?.name || "", folder_name: c.folder?.name || null,
        reply_status: replyStatus, waiting_hours: waitingHours,
      };
    });

    // Fetch sent emails — filter by sent_by_user_id for accurate per-user tracking
    let sentQuery = getSupabase()
      .from("messages")
      .select("id, subject, to_addresses, sent_at, conversation_id, from_email, sent_by_user_id")
      .eq("is_outbound", true)
      .eq("sent_by_user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(100);

    if (effectiveDateFrom) sentQuery = sentQuery.gte("sent_at", effectiveDateFrom);
    if (effectiveDateTo) sentQuery = sentQuery.lte("sent_at", effectiveDateTo);

    const { data: sentMsgs } = await sentQuery;

    const uSent: SentEmail[] = (sentMsgs || []).map((msg: any) => ({
      id: msg.id,
      subject: msg.subject || "Unknown",
      to_addresses: msg.to_addresses || "",
      sent_at: msg.sent_at,
      conversation_id: msg.conversation_id,
      from_email: msg.from_email || "",
    }));

    setUserTasks(uTasks);
    setUserConversations(uConvos);
    setUserSentEmails(uSent);
    setUserDetailLoading(false);
  }

  const totals = useMemo(() => {
    return userStats.reduce((acc, u) => ({
      totalTasks: acc.totalTasks + u.tasks.total,
      todo: acc.todo + u.tasks.todo,
      inProgress: acc.inProgress + u.tasks.in_progress,
      completed: acc.completed + u.tasks.completed,
      overdue: acc.overdue + u.tasks.overdue,
      dueSoon: acc.dueSoon + u.tasks.dueSoon,
      totalConvos: acc.totalConvos + u.conversations.assigned,
      unreadConvos: acc.unreadConvos + u.conversations.unread,
      totalSent: acc.totalSent + u.sentEmails,
    }), { totalTasks: 0, todo: 0, inProgress: 0, completed: 0, overdue: 0, dueSoon: 0, totalConvos: 0, unreadConvos: 0, totalSent: 0 });
  }, [userStats]);

  const filteredAllTasks = useMemo(() => {
    let filtered = allTasks;
    if (taskFilterUser) {
      filtered = filtered.filter((t) => t.assignees.some((a) => a.name === userStats.find((u) => u.id === taskFilterUser)?.name));
    }
    if (dashTaskSearch.trim()) {
      const q = dashTaskSearch.toLowerCase();
      filtered = filtered.filter((t) =>
        t.text.toLowerCase().includes(q) ||
        t.conversation_subject.toLowerCase().includes(q) ||
        t.assignees.some((a) => a.name.toLowerCase().includes(q)) ||
        (t.category_name || "").toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allTasks, taskFilterUser, dashTaskSearch, userStats]);

  const selectedUser = userStats.find((u) => u.id === selectedUserId);

  if (status === "loading" || loading) {
    return <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]"><Loader2 className="w-8 h-8 animate-spin text-[#4ADE80]" /></div>;
  }
  if (!session) redirect("/login");
  if ((session as any)?.teamMember?.role !== "admin") redirect("/");

  function handleDatePreset(preset: string) {
    setDatePreset(preset);
    if (preset === "all") { setDateFrom(""); setDateTo(""); return; }
    if (preset === "custom") return;
    const { from, to } = getPresetDates(preset);
    setDateFrom(from);
    setDateTo(to);
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B0E11] text-[#E6EDF3]">
      {/* Header */}
      <div className="border-b border-[#1E242C] px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[#484F58] hover:text-[#E6EDF3] transition-colors"><ArrowLeft size={18} /></Link>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Team Dashboard</h1>
            <p className="text-[10px] text-[#484F58]">Performance overview &amp; task monitoring</p>
          </div>
        </div>

        {/* Date Filter — Dropdown */}
        <div className="flex items-center gap-2">
          <CalendarClock size={14} className="text-[#484F58]" />
          <select
            value={datePreset}
            onChange={(e) => handleDatePreset(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] cursor-pointer"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_week">This Week</option>
            <option value="last_week">Last Week</option>
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="custom">Custom Range</option>
          </select>
          {datePreset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="px-2 py-1.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]" />
              <span className="text-[#484F58] text-[10px]">to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="px-2 py-1.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]" />
            </div>
          )}
        </div>
      </div>

      {/* View Tabs */}
      <div className="border-b border-[#1E242C] px-6 py-1.5 flex items-center gap-1 flex-shrink-0">
        {([
          { id: "overview", label: "Team Overview" },
          { id: "critical", label: "Critical Tasks (" + criticalTasks.length + ")" },
          { id: "all-tasks", label: "All Tasks (" + allTasks.length + ")" },
          { id: "sla", label: "SLA / Response Times" },
          { id: "export", label: "Export Data" },
        ] as { id: ViewMode; label: string }[]).map((tab) => (
          <button key={tab.id} onClick={() => { setViewMode(tab.id); setSelectedUserId(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              viewMode === tab.id ? "bg-[#1E242C] text-[#E6EDF3]" : "text-[#484F58] hover:text-[#7D8590]"
            }`}
          >{tab.label}</button>
        ))}
        {viewMode === "user-detail" && selectedUser && (
          <div className="flex items-center gap-2 ml-2 px-3 py-1.5 rounded-lg bg-[#1E242C]">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-[#0B0E11]" style={{ background: selectedUser.color }}>{selectedUser.initials}</div>
            <span className="text-xs font-medium">{selectedUser.name}</span>
            <button onClick={() => setViewMode("overview")} className="text-[#484F58] hover:text-[#E6EDF3]"><X size={12} /></button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="px-6 py-3 grid grid-cols-5 gap-3 flex-shrink-0">
        <SummaryCard icon={<Users size={14} />} label="Team Members" value={userStats.length} color="#484F58" />
        <SummaryCard icon={<ListTodo size={14} />} label="Open Tasks" value={totals.todo + totals.inProgress} sub={totals.completed + " completed"} color="#484F58" />
        <SummaryCard icon={<AlertTriangle size={14} />} label="Overdue" value={totals.overdue} sub={totals.dueSoon + " due within 48h"} color="#F85149" />
        <SummaryCard icon={<Mail size={14} />} label="Assigned Emails" value={totals.totalConvos} sub={totals.unreadConvos + " unread"} color="#484F58" />
        <SummaryCard icon={<Send size={14} />} label="Emails Sent" value={totals.totalSent} color="#4ADE80" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">

        {/* ── TEAM OVERVIEW ─── */}
        {viewMode === "overview" && (
          <div className="space-y-1">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 text-[10px] text-[#484F58] uppercase tracking-wider font-semibold">
              <span>Team Member</span><span className="text-center">To Do</span><span className="text-center">In Progress</span>
              <span className="text-center">Completed</span><span className="text-center">Dismissed</span><span className="text-center">Overdue</span>
              <span className="text-center">Due Soon</span><span className="text-center">Emails</span><span className="text-center">Sent</span>
            </div>
            {userStats.map((user) => (
              <button key={user.id} onClick={() => loadUserDetail(user.id)}
                className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 rounded-xl border border-[#1E242C] bg-[#0F1318] hover:border-[#4ADE80]/30 transition-all items-center text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-[#0B0E11] flex-shrink-0" style={{ background: user.color }}>{user.initials}</div>
                  <div><div className="text-[13px] font-semibold">{user.name}</div><div className="text-[10px] text-[#484F58]">{user.department}</div></div>
                </div>
                <div className="text-center text-sm font-semibold text-[#58A6FF]">{user.tasks.todo}</div>
                <div className="text-center text-sm font-semibold text-[#F5D547]">{user.tasks.in_progress}</div>
                <div className="text-center text-sm font-semibold text-[#4ADE80]">{user.tasks.completed}</div>
                <div className="text-center text-sm font-semibold text-[#F0883E]">{user.tasks.dismissed}</div>
                <div className="text-center text-sm font-semibold" style={{ color: user.tasks.overdue > 0 ? "#F85149" : "#484F58" }}>{user.tasks.overdue}</div>
                <div className="text-center text-sm font-semibold" style={{ color: user.tasks.dueSoon > 0 ? "#F0883E" : "#484F58" }}>{user.tasks.dueSoon}</div>
                <div className="text-center"><span className="text-sm font-semibold">{user.conversations.assigned}</span>{user.conversations.unread > 0 && <span className="ml-1 text-[10px] text-[#F0883E]">({user.conversations.unread})</span>}</div>
                <div className="text-center text-sm font-semibold text-[#4ADE80]">{user.sentEmails}</div>
              </button>
            ))}
          </div>
        )}

        {/* ── CRITICAL TASKS ─── */}
        {viewMode === "critical" && (
          <div className="space-y-2">
            <div className="text-sm text-[#F85149] font-semibold mb-3 flex items-center gap-2"><AlertTriangle size={16} /> Overdue or due within 48 hours</div>
            {criticalTasks.length === 0 ? <Empty text="No critical tasks" /> : criticalTasks.map((t) => <TaskRow key={t.id} task={t} />)}
          </div>
        )}

        {/* ── ALL TASKS ─── */}
        {viewMode === "all-tasks" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs text-[#484F58]">Filter:</span>
              <FilterPill active={!taskFilterUser} onClick={() => setTaskFilterUser(null)} label={"All (" + allTasks.length + ")"} />
              {userStats.map((u) => (
                <FilterPill key={u.id} active={taskFilterUser === u.id} onClick={() => setTaskFilterUser(taskFilterUser === u.id ? null : u.id)}
                  label={u.name.split(" ")[0]} avatar={{ initials: u.initials, color: u.color }} />
              ))}
              <div className="ml-auto relative">
                <input
                  value={dashTaskSearch}
                  onChange={(e) => setDashTaskSearch(e.target.value)}
                  placeholder="Search tasks..."
                  className="w-56 pl-3 pr-3 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                />
              </div>
            </div>
            {filteredAllTasks.length === 0 ? <Empty text="No open tasks" /> : filteredAllTasks.map((t) => <TaskRow key={t.id} task={t} />)}
          </div>
        )}

        {/* ── USER DETAIL ─── */}
        {viewMode === "user-detail" && selectedUser && (
          <div>
            {/* User header */}
            <div className="flex items-center gap-4 mb-4 p-4 rounded-xl border border-[#1E242C] bg-[#0F1318]">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-[#0B0E11]" style={{ background: selectedUser.color }}>{selectedUser.initials}</div>
              <div className="flex-1">
                <div className="text-lg font-bold">{selectedUser.name}</div>
                <div className="text-xs text-[#484F58]">{selectedUser.email} · {selectedUser.department} · {selectedUser.role}</div>
              </div>
              <div className="grid grid-cols-7 gap-4 text-center">
                <div><div className="text-xl font-bold text-[#58A6FF]">{selectedUser.tasks.todo + selectedUser.tasks.in_progress}</div><div className="text-[10px] text-[#484F58]">Open Tasks</div></div>
                <div><div className="text-xl font-bold text-[#4ADE80]">{selectedUser.tasks.completed}</div><div className="text-[10px] text-[#484F58]">Completed</div></div>
                <div><div className="text-xl font-bold text-[#F0883E]">{selectedUser.tasks.dismissed}</div><div className="text-[10px] text-[#484F58]">Dismissed</div></div>
                <div><div className="text-xl font-bold" style={{ color: selectedUser.tasks.overdue > 0 ? "#F85149" : "#484F58" }}>{selectedUser.tasks.overdue}</div><div className="text-[10px] text-[#484F58]">Overdue</div></div>
                <div><div className="text-xl font-bold text-[#4ADE80]">{selectedUser.sentEmails}</div><div className="text-[10px] text-[#484F58]">Sent</div></div>
                <div><div className="text-xl font-bold text-[#F85149]">{userConversations.filter((c) => c.reply_status === "awaiting_our_reply").length}</div><div className="text-[10px] text-[#484F58]">Need Reply</div></div>
                <div><div className="text-xl font-bold text-[#F0883E]">{userConversations.filter((c) => c.reply_status === "awaiting_supplier_reply").length}</div><div className="text-[10px] text-[#484F58]">Waiting Supplier</div></div>
              </div>
            </div>

            {/* Completed tasks by category breakdown */}
            {(() => {
              const completedTasks = userTasks.filter((t) => t.status === "completed");
              if (completedTasks.length === 0) return null;
              const byCategory: Record<string, { count: number; color: string }> = {};
              for (const t of completedTasks) {
                const cat = t.category_name || "Uncategorized";
                if (!byCategory[cat]) byCategory[cat] = { count: 0, color: t.category_color || "#7D8590" };
                byCategory[cat].count++;
              }
              const sorted = Object.entries(byCategory).sort((a, b) => b[1].count - a[1].count);
              return (
                <div className="mb-4 p-4 rounded-xl border border-[#1E242C] bg-[#0F1318]">
                  <div className="text-xs font-semibold text-[#7D8590] mb-3 flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-[#4ADE80]" />
                    Completed Tasks by Category ({completedTasks.length} total)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sorted.map(([cat, data]) => (
                      <div key={cat} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[#1E242C] bg-[#0B0E11]">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: data.color }} />
                        <span className="text-xs text-[#E6EDF3] font-medium">{cat}</span>
                        <span className="text-sm font-bold" style={{ color: data.color }}>{data.count}</span>
                      </div>
                    ))}
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 flex h-2 rounded-full overflow-hidden bg-[#1E242C]">
                    {sorted.map(([cat, data]) => (
                      <div key={cat} title={`${cat}: ${data.count}`} style={{ width: `${(data.count / completedTasks.length) * 100}%`, background: data.color }} />
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Sub-tabs */}
            <div className="flex items-center gap-1 mb-3">
              {([
                { id: "tasks" as const, label: "Tasks (" + userTasks.length + ")", icon: <ListTodo size={13} /> },
                { id: "emails" as const, label: "Assigned Emails (" + userConversations.length + ")", icon: <Inbox size={13} /> },
                { id: "sent" as const, label: "Sent (" + userSentEmails.length + ")", icon: <Send size={13} /> },
              ]).map((tab) => (
                <button key={tab.id} onClick={() => setUserDetailTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    userDetailTab === tab.id ? "bg-[#1E242C] text-[#E6EDF3]" : "text-[#484F58] hover:text-[#7D8590]"
                  }`}
                >{tab.icon} {tab.label}</button>
              ))}
            </div>

            {userDetailLoading ? (
              <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
            ) : (
              <>
                {userDetailTab === "tasks" && (
                  <div className="space-y-2">
                    {userTasks.length === 0 ? <Empty text="No tasks assigned" /> : userTasks.map((t) => <TaskRow key={t.id} task={t} />)}
                  </div>
                )}

                {userDetailTab === "emails" && (
                  <div className="space-y-1">
                    {userConversations.length === 0 ? <Empty text="No assigned conversations" /> : userConversations.map((c) => (
                      <Link key={c.id} href={"/#conversation=" + c.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-[#0F1318] hover:border-[#58A6FF]/30 transition-all ${
                          c.reply_status === "awaiting_our_reply" && c.waiting_hours > 24 ? "border-[#F85149]/30" : "border-[#1E242C]"
                        }`}
                      >
                        {/* Status indicator */}
                        <div className="flex-shrink-0 w-2.5">
                          {c.is_unread ? (
                            <div className="w-2 h-2 rounded-full bg-[#58A6FF]" />
                          ) : c.reply_status === "awaiting_our_reply" ? (
                            <div className="w-2 h-2 rounded-full bg-[#F85149]" title="Awaiting our reply" />
                          ) : c.reply_status === "awaiting_supplier_reply" ? (
                            <div className="w-2 h-2 rounded-full bg-[#F0883E]" title="Awaiting supplier reply" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-transparent" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium truncate">{c.subject}</div>
                          <div className="text-[11px] text-[#484F58] truncate">{c.from_name} &lt;{c.from_email}&gt;</div>
                        </div>

                        {/* Reply status badge */}
                        <div className="flex-shrink-0">
                          {c.reply_status === "awaiting_our_reply" ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              c.waiting_hours > 24 ? "bg-[#F85149]/15 text-[#F85149]" : "bg-[#F85149]/10 text-[#F85149]"
                            }`}>
                              Needs reply · {formatBusinessTime(c.waiting_hours)}
                            </span>
                          ) : c.reply_status === "awaiting_supplier_reply" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F0883E]/10 text-[#F0883E]">
                              Waiting supplier · {formatBusinessTime(c.waiting_hours)}
                            </span>
                          ) : null}
                        </div>

                        <div className="text-[10px] text-[#484F58] flex-shrink-0">{c.email_account_name}</div>
                        <div className="text-[10px] text-[#484F58] flex-shrink-0">{new Date(c.last_message_at).toLocaleDateString()}</div>
                        <ExternalLink size={12} className="text-[#484F58]" />
                      </Link>
                    ))}
                  </div>
                )}

                {userDetailTab === "sent" && (
                  <div className="space-y-1">
                    {userSentEmails.length === 0 ? <Empty text="No sent emails in this period" /> : userSentEmails.map((s) => (
                      <Link key={s.id} href={"/#conversation=" + s.conversation_id}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#1E242C] bg-[#0F1318] hover:border-[#4ADE80]/30 transition-all"
                      >
                        <Send size={14} className="text-[#4ADE80] flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium truncate">{s.subject}</div>
                          <div className="text-[11px] text-[#484F58] truncate">To: {s.to_addresses}</div>
                        </div>
                        <div className="text-[10px] text-[#484F58] flex-shrink-0">{s.from_email}</div>
                        <div className="text-[10px] text-[#484F58] flex-shrink-0">{new Date(s.sent_at).toLocaleDateString()} {new Date(s.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        <ExternalLink size={12} className="text-[#484F58]" />
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── SLA / RESPONSE TIMES ─── */}
        {viewMode === "sla" && (
          <div>
            {slaLoading ? (
              <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
            ) : slaData ? (
              <>
                {/* KPI Summary Cards */}
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] p-4">
                    <div className="text-[10px] text-[#484F58] uppercase font-semibold mb-1">Avg Response Time</div>
                    <div className="text-2xl font-bold text-[#4ADE80]">{formatBusinessTime(slaData.overall.avg_response_hours)}</div>
                    <div className="text-[10px] text-[#484F58] mt-1">business hours</div>
                  </div>
                  <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] p-4">
                    <div className="text-[10px] text-[#484F58] uppercase font-semibold mb-1">Total Responses</div>
                    <div className="text-2xl font-bold text-[#E6EDF3]">{slaData.overall.total_responses}</div>
                  </div>
                  <div className="rounded-xl border border-[#F85149]/20 bg-[#F85149]/5 p-4">
                    <div className="text-[10px] text-[#F85149] uppercase font-semibold mb-1">Awaiting Our Reply</div>
                    <div className="text-2xl font-bold text-[#F85149]">{slaData.overall.awaiting_our_reply}</div>
                    <div className="text-[10px] text-[#484F58] mt-1">supplier waiting on us</div>
                  </div>
                  <div className="rounded-xl border border-[#F0883E]/20 bg-[#F0883E]/5 p-4">
                    <div className="text-[10px] text-[#F0883E] uppercase font-semibold mb-1">Awaiting Supplier Reply</div>
                    <div className="text-2xl font-bold text-[#F0883E]">{slaData.overall.awaiting_supplier_reply}</div>
                    <div className="text-[10px] text-[#484F58] mt-1">we sent last message</div>
                  </div>
                </div>

                {/* Sub tabs */}
                <div className="flex items-center gap-1 mb-3">
                  {([
                    { id: "response-times" as const, label: "Response Times by User" },
                    { id: "awaiting-ours" as const, label: "Awaiting Our Reply (" + slaData.overall.awaiting_our_reply + ")" },
                    { id: "awaiting-supplier" as const, label: "Awaiting Supplier Reply (" + slaData.overall.awaiting_supplier_reply + ")" },
                  ]).map((t) => (
                    <button key={t.id} onClick={() => setSlaSubTab(t.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        slaSubTab === t.id ? "bg-[#1E242C] text-[#E6EDF3]" : "text-[#484F58] hover:text-[#7D8590]"
                      }`}
                    >{t.label}</button>
                  ))}
                </div>

                {/* Response Times by User */}
                {slaSubTab === "response-times" && (
                  <div className="space-y-1">
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 text-[10px] text-[#484F58] uppercase tracking-wider font-semibold">
                      <span>Team Member</span><span className="text-center">Avg Response</span><span className="text-center">Fastest</span><span className="text-center">Slowest</span><span className="text-center">Responses</span>
                    </div>
                    {slaData.per_user.map((stat: any) => {
                      const user = userStats.find((u) => u.id === stat.user_id);
                      return (
                        <div key={stat.user_id} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 rounded-xl border border-[#1E242C] bg-[#0F1318] items-center">
                          <div className="flex items-center gap-3">
                            {user ? (
                              <>
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-[#0B0E11]" style={{ background: user.color }}>{user.initials}</div>
                                <div><div className="text-[13px] font-semibold">{user.name}</div><div className="text-[10px] text-[#484F58]">{user.department}</div></div>
                              </>
                            ) : (
                              <div className="text-[13px] text-[#484F58]">Unassigned</div>
                            )}
                          </div>
                          <div className="text-center text-sm font-semibold" style={{ color: stat.avg_response_hours <= 4 ? "#4ADE80" : stat.avg_response_hours <= 11 ? "#F0883E" : "#F85149" }}>
                            {formatBusinessTime(stat.avg_response_hours)}
                          </div>
                          <div className="text-center text-sm text-[#4ADE80]">{formatBusinessTime(stat.fastest_response_hours)}</div>
                          <div className="text-center text-sm text-[#F0883E]">{formatBusinessTime(stat.slowest_response_hours)}</div>
                          <div className="text-center text-sm text-[#E6EDF3]">{stat.total_responses}</div>
                        </div>
                      );
                    })}
                    {slaData.per_user.length === 0 && <Empty text="No response data yet" />}
                  </div>
                )}

                {/* Awaiting Our Reply */}
                {slaSubTab === "awaiting-ours" && (
                  <div className="space-y-1">
                    {slaData.awaiting_our_reply.length === 0 ? <Empty text="No emails awaiting our reply" /> : (
                      slaData.awaiting_our_reply.map((item: any) => {
                        const assignee = userStats.find((u) => u.id === item.assignee_id);
                        return (
                          <a key={item.conversation_id} href={"/#conversation=" + item.conversation_id}
                            className={`block rounded-xl border bg-[#0F1318] p-4 hover:border-[#F85149]/30 transition-all ${item.waiting_business_hours > 11 ? "border-[#F85149]/30" : "border-[#1E242C]"}`}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium mb-1">{item.subject}</div>
                                <div className="text-[11px] text-[#484F58]">{item.from_name} &lt;{item.from_email}&gt;</div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                {assignee && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-[#0B0E11]" style={{ background: assignee.color }}>{assignee.initials}</div>
                                    <span className="text-[10px] text-[#484F58]">{assignee.name.split(" ")[0]}</span>
                                  </div>
                                )}
                                <div className="text-right">
                                  <div className="text-xs font-semibold" style={{ color: item.waiting_business_hours > 11 ? "#F85149" : item.waiting_business_hours > 4 ? "#F0883E" : "#58A6FF" }}>
                                    {formatBusinessTime(item.waiting_business_hours)} waiting
                                  </div>
                                  <div className="text-[10px] text-[#484F58]">since {new Date(item.last_message_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                                </div>
                              </div>
                            </div>
                          </a>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Awaiting Supplier Reply */}
                {slaSubTab === "awaiting-supplier" && (
                  <div className="space-y-1">
                    {slaData.awaiting_supplier_reply.length === 0 ? <Empty text="No emails awaiting supplier reply" /> : (
                      slaData.awaiting_supplier_reply.map((item: any) => {
                        const assignee = userStats.find((u) => u.id === item.assignee_id);
                        return (
                          <a key={item.conversation_id} href={"/#conversation=" + item.conversation_id}
                            className="block rounded-xl border border-[#1E242C] bg-[#0F1318] p-4 hover:border-[#F0883E]/30 transition-all">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium mb-1">{item.subject}</div>
                                <div className="text-[11px] text-[#484F58]">{item.from_name} &lt;{item.from_email}&gt;</div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                {assignee && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-[#0B0E11]" style={{ background: assignee.color }}>{assignee.initials}</div>
                                    <span className="text-[10px] text-[#484F58]">{assignee.name.split(" ")[0]}</span>
                                  </div>
                                )}
                                <div className="text-right">
                                  <div className="text-xs font-semibold text-[#F0883E]">
                                    {formatBusinessTime(item.waiting_business_hours)} waiting
                                  </div>
                                  <div className="text-[10px] text-[#484F58]">since {new Date(item.last_message_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                                </div>
                              </div>
                            </div>
                          </a>
                        );
                      })
                    )}
                  </div>
                )}
              </>
            ) : (
              <Empty text="No SLA data available" />
            )}
          </div>
        )}

        {/* ── EXPORT DATA ─── */}
        {viewMode === "export" && (
          <ExportPanel dateFrom={effectiveDateFrom} dateTo={effectiveDateTo} />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────

function SummaryCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: number; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] p-4">
      <div className="flex items-center gap-2 text-xs mb-2" style={{ color }}>{icon} {label}</div>
      <div className="text-2xl font-bold" style={{ color: color === "#484F58" ? "#E6EDF3" : color }}>{value}</div>
      {sub && <div className="text-[10px] text-[#484F58] mt-1">{sub}</div>}
    </div>
  );
}

function FilterPill({ active, onClick, label, avatar }: { active: boolean; onClick: () => void; label: string; avatar?: { initials: string; color: string } }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs transition-colors flex items-center gap-1.5 ${
        active ? "bg-[#4ADE80] text-[#0B0E11] font-semibold" : "bg-[#1E242C] text-[#7D8590] hover:text-[#E6EDF3]"
      }`}
    >
      {avatar && <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-[#0B0E11]" style={{ background: avatar.color }}>{avatar.initials}</div>}
      {label}
    </button>
  );
}

function TaskRow({ task }: { task: TaskDetail }) {
  const completedCount = task.assignees.filter((a) => a.is_done).length;
  const totalCount = task.assignees.length;
  const isDismissed = task.status === "dismissed";
  const isCompleted = task.status === "completed" || (totalCount > 0 && completedCount === totalCount);
  const isOverdue = !isDismissed && !isCompleted && task.due_date && new Date(task.due_date) < new Date();

  return (
    <Link href={"/#conversation=" + task.conversation_id}
      className={`block rounded-xl border bg-[#0F1318] p-4 hover:border-[#58A6FF]/30 transition-all cursor-pointer ${
        isDismissed ? "border-[#F0883E]/20 opacity-70" : isCompleted ? "border-[#4ADE80]/20 opacity-80" : isOverdue ? "border-[#F85149]/30" : "border-[#1E242C]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isDismissed && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[rgba(240,136,62,0.12)] text-[#F0883E]"
                title={task.dismiss_reason ? "Reason: " + task.dismiss_reason : "No reason provided"}>
                Dismissed
              </span>
            )}
            {isCompleted && !isDismissed && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[rgba(74,222,128,0.12)] text-[#4ADE80]">
                Completed
              </span>
            )}
            <div className={`text-[13px] font-medium ${isDismissed ? "italic text-[#7D8590]" : isCompleted ? "line-through text-[#7D8590]" : ""}`}>{task.text}</div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[#484F58]">
            <span className="truncate max-w-[300px]">{task.conversation_subject}</span>
            {task.category_name && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: (task.category_color || "#1E242C") + "20", color: task.category_color || "#7D8590" }}>{task.category_name}</span>
            )}
          </div>
          {isDismissed && task.dismiss_reason && (
            <div className="mt-1 text-[11px] text-[#F0883E] italic">
              Reason: {task.dismiss_reason}
            </div>
          )}
        </div>
        {task.due_date && !isDismissed && (
          <div className="flex items-center gap-1 text-[11px] font-medium flex-shrink-0" style={{ color: isCompleted ? "#4ADE80" : getDueColor(task.due_date) }}>
            <CalendarClock size={12} /> {isCompleted ? "Done" : formatDueDate(task.due_date)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <div className="flex items-center gap-1">
          {task.assignees.map((a, i) => (
            <div key={i} className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-[#0B0E11] relative ${a.is_done ? "opacity-50" : ""}`}
              style={{ background: a.color }} title={a.name + (a.is_done ? " (done)" : "")}>
              {a.initials}
              {a.is_done && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#4ADE80] rounded-full flex items-center justify-center"><CheckCircle2 size={8} className="text-[#0B0E11]" /></div>}
            </div>
          ))}
        </div>
        {!isDismissed && (
          <>
            <span className="text-[10px] text-[#484F58]">{completedCount}/{totalCount} done</span>
            <div className="w-16 h-1.5 rounded-full bg-[#1E242C] overflow-hidden">
              <div className="h-full rounded-full bg-[#4ADE80] transition-all" style={{ width: totalCount > 0 ? (completedCount / totalCount * 100) + "%" : "0%" }} />
            </div>
          </>
        )}
      </div>
    </Link>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center py-16 text-[#484F58] text-sm">{text}</div>;
}

// ── Export Panel ──────────────────────────────────────

const DATASETS = [
  { id: "conversations", label: "Conversations", desc: "All email threads with assignee, account, status" },
  { id: "messages", label: "Messages", desc: "Individual emails with sender, recipient, timestamps" },
  { id: "tasks", label: "Tasks", desc: "All tasks with assignees, categories, due dates, completion" },
  { id: "team_members", label: "Team Members", desc: "User profiles, roles, departments" },
  { id: "sla", label: "SLA Metrics", desc: "Response times, waiting times, reply status per conversation" },
  { id: "user_performance", label: "User Performance", desc: "Per-user task breakdown, completion rates, categories, conversation SLA & response times" },
  { id: "activity", label: "Activity Log", desc: "All actions: assignments, replies, status changes" },
] as const;

function ExportPanel({ dateFrom, dateTo }: { dateFrom: string | null; dateTo: string | null }) {
  const [exportMode, setExportMode] = useState<"single" | "unified">("single");
  const [selectedDataset, setSelectedDataset] = useState<string>("conversations");
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv" | "json" | "pdf">("xlsx");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Data + columns
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [perfSubSheet, setPerfSubSheet] = useState<"task_summary" | "task_details" | "conversation_performance">("task_summary");

  // Fetch data when mode or dataset changes
  useEffect(() => {
    if (exportMode === "single") loadSingleData();
    else loadUnifiedData();
  }, [selectedDataset, exportMode, perfSubSheet]);

  async function loadSingleData() {
    setPreviewLoading(true);
    try {
      let url = "/api/export?dataset=" + selectedDataset;
      if (dateFrom) url += "&date_from=" + dateFrom;
      if (dateTo) url += "&date_to=" + dateTo;
      const res = await fetch(url);
      const data = await res.json();

      let rows: any[];
      if (selectedDataset === "user_performance") {
        // User performance has 3 sub-sheets — show the selected one
        const perfData = data.user_performance || {};
        rows = perfData[perfSubSheet] || [];
      } else {
        rows = data[selectedDataset] || [];
      }

      setPreviewData(rows);
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        setAllColumns(cols);
        setSelectedColumns(new Set(cols));
      } else { setAllColumns([]); setSelectedColumns(new Set()); }
    } catch (_e) { setPreviewData([]); setAllColumns([]); }
    finally { setPreviewLoading(false); }
  }

  async function loadUnifiedData() {
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      let url = "/api/export/unified?x=1";
      if (dateFrom) url += "&date_from=" + dateFrom;
      if (dateTo) url += "&date_to=" + dateTo;
      const res = await fetch(url);
      const text = await res.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (_e) {
        console.error("Unified API returned non-JSON:", text.slice(0, 500));
        setPreviewData([]);
        setAllColumns([]);
        setPreviewLoading(false);
        return;
      }

      if (data.error) {
        console.error("Unified export API error:", data.error);
      }

      const rows = data.rows || [];
      setPreviewData(rows);

      const UNIFIED_COLUMNS = [
        "conversation_id", "conversation_subject", "conversation_status", "conversation_from_name", "conversation_from_email",
        "conversation_is_unread", "conversation_is_starred", "conversation_created_at", "conversation_last_message_at",
        "account_name", "account_email", "folder_name",
        "conversation_assignee_name", "conversation_assignee_email", "conversation_assignee_department", "conversation_assignee_role",
        "total_messages", "inbound_messages", "outbound_messages", "reply_status", "waiting_hours",
        "first_response_hours", "first_response_by",
        "latest_inbound_from", "latest_inbound_email", "latest_inbound_date", "latest_inbound_snippet",
        "latest_outbound_to", "latest_outbound_date", "latest_outbound_by", "latest_outbound_snippet",
        "has_attachments",
        "task_id", "task_text", "task_status", "task_category", "task_due_date", "task_due_time", "task_created_at",
        "task_assignee_name", "task_assignee_email", "task_assignee_department", "task_assignee_status", "task_assignee_done",
        "task_total_assignees", "task_completed_count",
      ];

      const cols = rows.length > 0 ? Object.keys(rows[0]) : UNIFIED_COLUMNS;
      setAllColumns(cols);
      setSelectedColumns(new Set()); // Start empty so admin picks what they want
    } catch (_e) {
      console.error("Unified load failed:", _e);
      setPreviewData([]);
      setAllColumns([]);
    }
    finally { setPreviewLoading(false); }
  }

  function toggleColumn(col: string) {
    setSelectedColumns((prev) => { const n = new Set(prev); if (n.has(col)) n.delete(col); else n.add(col); return n; });
  }

  // Group columns by prefix for unified mode display
  const columnGroups = useMemo(() => {
    if (exportMode !== "unified") return {};
    const groups: Record<string, string[]> = {};
    for (const col of allColumns) {
      let group = "Other";
      if (col.startsWith("conversation_")) group = "Conversation";
      else if (col.startsWith("account_")) group = "Account";
      else if (col.startsWith("folder_")) group = "Folder";
      else if (col.startsWith("task_")) group = "Task";
      else if (col.startsWith("latest_inbound_")) group = "Latest Inbound Message";
      else if (col.startsWith("latest_outbound_")) group = "Latest Outbound Message";
      else if (["total_messages", "inbound_messages", "outbound_messages", "reply_status", "waiting_hours", "first_response_hours", "first_response_by", "has_attachments"].includes(col)) group = "SLA Metrics";

      if (!groups[group]) groups[group] = [];
      groups[group].push(col);
    }
    return groups;
  }, [allColumns, exportMode]);

  // Filter rows based on which column groups are selected
  const filteredRows = useMemo(() => {
    if (exportMode !== "unified" || !previewData) return previewData;

    const selectedCols = Array.from(selectedColumns);
    const hasTaskCols = selectedCols.some((c) => c.startsWith("task_"));
    const hasConvoCols = selectedCols.some((c) =>
      c.startsWith("conversation_") || c.startsWith("account_") || c.startsWith("folder_") ||
      c.startsWith("assignee_") || c.startsWith("latest_") ||
      ["total_messages", "inbound_messages", "outbound_messages", "reply_status", "waiting_hours", "first_response_hours", "first_response_by", "has_attachments"].includes(c)
    );

    return previewData.filter((row) => {
      // If task columns are selected, only include rows that have task data
      if (hasTaskCols && !hasConvoCols) {
        return row.task_id && row.task_id !== "";
      }
      // If only conversation columns selected, deduplicate (one row per conversation)
      // But for unified this is handled below
      return true;
    });
  }, [previewData, selectedColumns, exportMode]);

  // Deduplicate conversation-only exports (one row per conversation when no task columns)
  const exportRows = useMemo(() => {
    if (exportMode !== "unified" || !filteredRows) return filteredRows;

    const selectedCols = Array.from(selectedColumns);
    const hasTaskCols = selectedCols.some((c) => c.startsWith("task_"));

    if (!hasTaskCols) {
      // No task columns selected — deduplicate by conversation_id
      const seen = new Set<string>();
      return filteredRows.filter((row) => {
        if (seen.has(row.conversation_id)) return false;
        seen.add(row.conversation_id);
        return true;
      });
    }

    return filteredRows;
  }, [filteredRows, selectedColumns, exportMode]);

  async function handleExport() {
    const sourceRows = exportMode === "unified" ? exportRows : previewData;
    if (!sourceRows || selectedColumns.size === 0) return;
    setLoading(true);
    try {
      const cols = allColumns.filter((c) => selectedColumns.has(c));
      const filtered = sourceRows.map((row: any) => {
        const obj: any = {};
        for (const c of cols) obj[c] = row[c] ?? "";
        return obj;
      });
      const filename = exportMode === "unified"
        ? "tenkara_full_report_" + new Date().toISOString().slice(0, 10)
        : "tenkara_" + selectedDataset + "_" + new Date().toISOString().slice(0, 10);

      if (exportFormat === "json") downloadJSON(filtered, filename);
      else if (exportFormat === "csv") downloadCSV(filtered, cols, filename);
      else if (exportFormat === "xlsx") await downloadXLSX(filtered, cols, filename, exportMode === "unified" ? "Full Report" : selectedDataset);
      else if (exportFormat === "pdf") downloadPDFTable(filtered, cols, filename, exportMode === "unified" ? "Full Report" : selectedDataset);
    } catch (e) {
      console.error("Export failed:", e);
      alert("Export failed: " + (e as any)?.message);
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      {/* Mode switcher */}
      <div className="flex items-center gap-2">
        <button onClick={() => setExportMode("single")}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${exportMode === "single" ? "bg-[#4ADE80] text-[#0B0E11]" : "bg-[#12161B] text-[#7D8590] border border-[#1E242C] hover:text-[#E6EDF3]"}`}
        >Single Dataset</button>
        <button onClick={() => setExportMode("unified")}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${exportMode === "unified" ? "bg-[#4ADE80] text-[#0B0E11]" : "bg-[#12161B] text-[#7D8590] border border-[#1E242C] hover:text-[#E6EDF3]"}`}
        >Unified Report (All Data Joined)</button>
      </div>

      {/* Single dataset picker */}
      {exportMode === "single" && (
        <>
        <div className="grid grid-cols-3 gap-2">
          {DATASETS.map((ds) => (
            <button key={ds.id} onClick={() => setSelectedDataset(ds.id)}
              className={`p-3 rounded-xl border text-left transition-all ${selectedDataset === ds.id ? "border-[#4ADE80]/40 bg-[#4ADE80]/5" : "border-[#1E242C] bg-[#0F1318] hover:border-[#4ADE80]/20"}`}
            >
              <div className="text-xs font-semibold text-[#E6EDF3]">{ds.label}</div>
              <div className="text-[10px] text-[#484F58] mt-0.5">{ds.desc}</div>
            </button>
          ))}
        </div>

        {/* Sub-sheet selector for User Performance */}
        {selectedDataset === "user_performance" && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] text-[#484F58]">View:</span>
            {([
              { id: "task_summary" as const, label: "Task Summary" },
              { id: "task_details" as const, label: "Task Details" },
              { id: "conversation_performance" as const, label: "Conversation Performance" },
            ]).map((sheet) => (
              <button key={sheet.id} onClick={() => { setPerfSubSheet(sheet.id); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  perfSubSheet === sheet.id ? "bg-[#4ADE80]/10 text-[#4ADE80] border border-[#4ADE80]/30" : "text-[#7D8590] hover:text-[#E6EDF3] border border-[#1E242C]"
                }`}
              >{sheet.label}</button>
            ))}
          </div>
        )}
        </>
      )}

      {/* Unified mode description */}
      {exportMode === "unified" && !previewLoading && (
        <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] p-3">
          <div className="text-xs text-[#7D8590]">
            All data joined through conversations. {exportRows ? exportRows.length + " rows" : previewData ? previewData.length + " rows loaded." : "Loading..."} {exportRows && previewData && exportRows.length !== previewData.length ? `(filtered from ${previewData.length} total)` : ""}
          </div>
          {previewData && previewData.length === 0 && allColumns.length > 0 && (
            <div className="text-[11px] text-[#F0883E] mt-1">No data found for the selected date range. Columns are still available — try changing the date filter or select "All Time".</div>
          )}
        </div>
      )}

      {previewLoading ? (
        <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <>
          {/* Column picker */}
          <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-bold text-[#E6EDF3]">Select Columns</div>
                <div className="text-[10px] text-[#484F58]">{selectedColumns.size} of {allColumns.length} selected · {exportMode === "unified" ? (exportRows?.length || 0) : (previewData?.length || 0)} rows</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedColumns(new Set(allColumns))} className="text-[10px] text-[#58A6FF] hover:text-[#7cc0ff]">Select all</button>
                <span className="text-[#1E242C]">|</span>
                <button onClick={() => setSelectedColumns(new Set())} className="text-[10px] text-[#58A6FF] hover:text-[#7cc0ff]">Deselect all</button>
              </div>
            </div>

            {/* Grouped columns for unified mode */}
            {exportMode === "unified" ? (
              <div className="space-y-3">
                {Object.entries(columnGroups).map(([group, cols]) => (
                  <div key={group}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-[#7D8590] uppercase">{group}</span>
                      <div className="flex gap-2">
                        <button onClick={() => { const n = new Set(selectedColumns); cols.forEach((c) => n.add(c)); setSelectedColumns(n); }} className="text-[9px] text-[#58A6FF]">all</button>
                        <button onClick={() => { const n = new Set(selectedColumns); cols.forEach((c) => n.delete(c)); setSelectedColumns(n); }} className="text-[9px] text-[#58A6FF]">none</button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {cols.map((col) => (
                        <button key={col} onClick={() => toggleColumn(col)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${selectedColumns.has(col) ? "bg-[#4ADE80]/15 text-[#4ADE80] border border-[#4ADE80]/30" : "bg-[#12161B] text-[#484F58] border border-[#1E242C] hover:text-[#7D8590]"}`}
                        >{col.replace(/_/g, " ")}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allColumns.map((col) => (
                  <button key={col} onClick={() => toggleColumn(col)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${selectedColumns.has(col) ? "bg-[#4ADE80]/15 text-[#4ADE80] border border-[#4ADE80]/30" : "bg-[#12161B] text-[#484F58] border border-[#1E242C] hover:text-[#7D8590]"}`}
                  >{col.replace(/_/g, " ")}</button>
                ))}
              </div>
            )}
          </div>

          {/* Preview table */}
          {(() => {
            const previewSource = exportMode === "unified" ? exportRows : previewData;
            return previewSource && previewSource.length > 0 && selectedColumns.size > 0 && (
            <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] overflow-hidden">
              <div className="px-4 py-2 border-b border-[#1E242C] text-[10px] text-[#484F58]">Preview (first 5 rows)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead><tr className="border-b border-[#1E242C]">
                    {allColumns.filter((c) => selectedColumns.has(c)).map((col) => (
                      <th key={col} className="px-3 py-2 text-left text-[10px] text-[#484F58] font-semibold uppercase whitespace-nowrap">{col.replace(/_/g, " ")}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {previewSource.slice(0, 5).map((row: any, i: number) => (
                      <tr key={i} className="border-b border-[#1E242C]/50">
                        {allColumns.filter((c) => selectedColumns.has(c)).map((col) => (
                          <td key={col} className="px-3 py-2 text-[#7D8590] whitespace-nowrap max-w-[200px] truncate">{String(row[col] ?? "")}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
          })()}

          {/* Export format + button */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-[#1E242C] bg-[#0F1318]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#484F58]">Format:</span>
              {([
                { id: "xlsx" as const, label: "Excel (.xlsx)", icon: <FileSpreadsheet size={14} /> },
                { id: "csv" as const, label: "CSV", icon: <FileText size={14} /> },
                { id: "json" as const, label: "JSON", icon: <FileJson size={14} /> },
                { id: "pdf" as const, label: "PDF", icon: <FileText size={14} /> },
              ]).map((fmt) => (
                <button key={fmt.id} onClick={() => setExportFormat(fmt.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    exportFormat === fmt.id ? "bg-[#4ADE80]/15 text-[#4ADE80] border border-[#4ADE80]/30" : "bg-[#12161B] text-[#7D8590] border border-[#1E242C] hover:text-[#E6EDF3]"
                  }`}
                >{fmt.icon} {fmt.label}</button>
              ))}
            </div>
            <button
              onClick={handleExport}
              disabled={loading || selectedColumns.size === 0 || !(exportMode === "unified" ? exportRows?.length : previewData?.length)}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold hover:bg-[#3FCF73] disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {loading ? "Exporting..." : `Export ${exportMode === "unified" ? (exportRows?.length || 0) : (previewData?.length || 0)} rows`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Export helpers ─────────────────────────────────────

function downloadJSON(data: any[], filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  triggerDownload(blob, filename + ".json");
}

function downloadCSV(data: any[], columns: string[], filename: string) {
  const header = columns.join(",");
  const rows = data.map((row) =>
    columns.map((col) => {
      const val = String(row[col] ?? "").replace(/"/g, '""');
      return val.includes(",") || val.includes('"') || val.includes("\n") ? `"${val}"` : val;
    }).join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename + ".csv");
}

async function downloadXLSX(data: any[], columns: string[], filename: string, sheetName: string) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(data, { header: columns });
  const colWidths = columns.map((col) => {
    const maxLen = Math.max(col.length, ...data.slice(0, 100).map((r) => String(r[col] ?? "").length));
    return { wch: Math.min(maxLen + 2, 50) };
  });
  ws["!cols"] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  triggerDownload(blob, filename + ".xlsx");
}

function downloadPDFTable(data: any[], columns: string[], filename: string, title: string) {
  // Generate a simple HTML table and trigger print-to-PDF
  const headerCells = columns.map((c) => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f0f0f0;font-size:10px;white-space:nowrap">${c.replace(/_/g, " ")}</th>`).join("");
  const bodyRows = data.map((row) =>
    "<tr>" + columns.map((c) => `<td style="border:1px solid #eee;padding:3px 6px;font-size:9px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${String(row[c] ?? "")}</td>`).join("") + "</tr>"
  ).join("");

  const html = `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;margin:20px}h1{font-size:16px;margin-bottom:8px}p{font-size:11px;color:#666;margin-bottom:16px}table{border-collapse:collapse;width:100%}</style></head><body><h1>Tenkara Inbox — ${title}</h1><p>Exported ${new Date().toLocaleString()} · ${data.length} rows</p><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}