"use client";

import { useState, useEffect, useMemo } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Users, CheckCircle2, Clock3, AlertTriangle,
  ListTodo, Mail, TrendingUp, BarChart3, CalendarClock
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";

const supabase = createBrowserClient();

interface UserStats {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  role: string;
  department: string;
  tasks: {
    total: number;
    todo: number;
    in_progress: number;
    completed: number;
    overdue: number;
    dueSoon: number; // due within 48 hours
  };
  conversations: {
    assigned: number;
    unread: number;
  };
}

interface TaskDetail {
  id: string;
  text: string;
  due_date: string | null;
  due_time: string | null;
  status: string;
  conversation_subject: string;
  conversation_id: string;
  assignees: { name: string; initials: string; color: string; is_done: boolean; status: string }[];
  category_name: string | null;
  category_color: string | null;
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(true);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [criticalTasks, setCriticalTasks] = useState<TaskDetail[]>([]);
  const [allTasks, setAllTasks] = useState<TaskDetail[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"overview" | "critical" | "all-tasks">("overview");

  useEffect(() => {
    loadDashboardData();
  }, []);

  async function loadDashboardData() {
    setLoading(true);

    // Fetch team members
    const { data: members } = await supabase
      .from("team_members")
      .select("id, name, email, initials, color, role, department")
      .eq("is_active", true)
      .order("name");

    // Fetch all tasks with assignees
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, text, due_date, due_time, status, is_done, conversation_id, category_id, conversation:conversations(id, subject), task_assignees(team_member_id, is_done, status, team_member:team_members(name, initials, color)), category:task_categories(name, color)")
      .order("due_date", { ascending: true });

    // Fetch conversations with assignments
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, assignee_id, is_unread, status")
      .neq("status", "trash");

    const now = new Date();
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    // Build user stats
    const stats: UserStats[] = (members || []).map((member) => {
      // Get tasks where this user is an assignee
      const memberTasks = (tasks || []).filter((t: any) =>
        (t.task_assignees || []).some((a: any) => a.team_member_id === member.id)
      );

      const getPersonalStatus = (task: any) => {
        const assignee = (task.task_assignees || []).find((a: any) => a.team_member_id === member.id);
        return assignee?.status || (assignee?.is_done ? "completed" : "todo");
      };

      const todo = memberTasks.filter((t: any) => getPersonalStatus(t) === "todo").length;
      const inProgress = memberTasks.filter((t: any) => getPersonalStatus(t) === "in_progress").length;
      const completed = memberTasks.filter((t: any) => getPersonalStatus(t) === "completed").length;

      const overdue = memberTasks.filter((t: any) => {
        if (getPersonalStatus(t) === "completed") return false;
        if (!t.due_date) return false;
        return new Date(t.due_date) < now;
      }).length;

      const dueSoon = memberTasks.filter((t: any) => {
        if (getPersonalStatus(t) === "completed") return false;
        if (!t.due_date) return false;
        const dueDate = new Date(t.due_date);
        return dueDate >= now && dueDate <= in48Hours;
      }).length;

      const assignedConvos = (conversations || []).filter((c: any) => c.assignee_id === member.id);
      const unreadConvos = assignedConvos.filter((c: any) => c.is_unread);

      return {
        id: member.id,
        name: member.name,
        email: member.email,
        initials: member.initials || member.name?.slice(0, 2).toUpperCase(),
        color: member.color || "#4ADE80",
        role: member.role,
        department: member.department || "Uncategorized",
        tasks: {
          total: memberTasks.length,
          todo,
          in_progress: inProgress,
          completed,
          overdue,
          dueSoon,
        },
        conversations: {
          assigned: assignedConvos.length,
          unread: unreadConvos.length,
        },
      };
    });

    // Build critical tasks (overdue + due within 48 hours)
    const critical: TaskDetail[] = (tasks || [])
      .filter((t: any) => {
        if (t.is_done || t.status === "completed") return false;
        // Check if ALL assignees are done
        const allDone = (t.task_assignees || []).every((a: any) => a.is_done);
        if (allDone) return false;
        if (!t.due_date) return false;
        return new Date(t.due_date) <= in48Hours;
      })
      .map((t: any) => ({
        id: t.id,
        text: t.text,
        due_date: t.due_date,
        due_time: t.due_time,
        status: t.status || "todo",
        conversation_subject: t.conversation?.subject || "Unknown",
        conversation_id: t.conversation?.id || t.conversation_id,
        assignees: (t.task_assignees || []).map((a: any) => ({
          name: a.team_member?.name || "Unknown",
          initials: a.team_member?.initials || "?",
          color: a.team_member?.color || "#7D8590",
          is_done: a.is_done,
          status: a.status || (a.is_done ? "completed" : "todo"),
        })),
        category_name: t.category?.name || null,
        category_color: t.category?.color || null,
      }))
      .sort((a: TaskDetail, b: TaskDetail) => {
        const aDate = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const bDate = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return aDate - bDate;
      });

    // All tasks (non-completed)
    const all: TaskDetail[] = (tasks || [])
      .filter((t: any) => {
        const allDone = (t.task_assignees || []).every((a: any) => a.is_done);
        return !allDone && t.status !== "completed" && !t.is_done;
      })
      .map((t: any) => ({
        id: t.id,
        text: t.text,
        due_date: t.due_date,
        due_time: t.due_time,
        status: t.status || "todo",
        conversation_subject: t.conversation?.subject || "Unknown",
        conversation_id: t.conversation?.id || t.conversation_id,
        assignees: (t.task_assignees || []).map((a: any) => ({
          name: a.team_member?.name || "Unknown",
          initials: a.team_member?.initials || "?",
          color: a.team_member?.color || "#7D8590",
          is_done: a.is_done,
          status: a.status || (a.is_done ? "completed" : "todo"),
        })),
        category_name: t.category?.name || null,
        category_color: t.category?.color || null,
      }))
      .sort((a: TaskDetail, b: TaskDetail) => {
        const aDate = a.due_date ? new Date(a.due_date).getTime() : Infinity;
        const bDate = b.due_date ? new Date(b.due_date).getTime() : Infinity;
        return aDate - bDate;
      });

    setUserStats(stats);
    setCriticalTasks(critical);
    setAllTasks(all);
    setLoading(false);
  }

  const totals = useMemo(() => {
    return userStats.reduce(
      (acc, u) => ({
        totalTasks: acc.totalTasks + u.tasks.total,
        todo: acc.todo + u.tasks.todo,
        inProgress: acc.inProgress + u.tasks.in_progress,
        completed: acc.completed + u.tasks.completed,
        overdue: acc.overdue + u.tasks.overdue,
        dueSoon: acc.dueSoon + u.tasks.dueSoon,
        totalConvos: acc.totalConvos + u.conversations.assigned,
        unreadConvos: acc.unreadConvos + u.conversations.unread,
      }),
      { totalTasks: 0, todo: 0, inProgress: 0, completed: 0, overdue: 0, dueSoon: 0, totalConvos: 0, unreadConvos: 0 }
    );
  }, [userStats]);

  const filteredTasks = selectedUser
    ? allTasks.filter((t) => t.assignees.some((a) => a.name === userStats.find((u) => u.id === selectedUser)?.name))
    : allTasks;

  if (status === "loading" || loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
        <Loader2 className="w-8 h-8 animate-spin text-[#4ADE80]" />
      </div>
    );
  }

  if (!session) redirect("/login");

  const isAdmin = (session as any)?.teamMember?.role === "admin";
  if (!isAdmin) redirect("/");

  function formatDueDate(date: string | null) {
    if (!date) return "";
    const d = new Date(date);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays < 0) return `${Math.abs(diffDays)}d overdue`;
    if (diffDays === 0) return "Due today";
    if (diffDays === 1) return "Due tomorrow";
    return `Due in ${diffDays}d`;
  }

  function getDueColor(date: string | null) {
    if (!date) return "#484F58";
    const d = new Date(date);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    if (diffHours < 0) return "#F85149";
    if (diffHours < 48) return "#F0883E";
    return "#58A6FF";
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0B0E11] text-[#E6EDF3]">
      {/* Header */}
      <div className="border-b border-[#1E242C] px-6 py-4 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[#484F58] hover:text-[#E6EDF3] transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-lg font-bold tracking-tight">Team Dashboard</h1>
            <p className="text-xs text-[#484F58]">Performance overview &amp; task monitoring</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {(["overview", "critical", "all-tasks"] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                viewMode === mode ? "bg-[#1E242C] text-[#E6EDF3]" : "text-[#484F58] hover:text-[#7D8590]"
              }`}
            >
              {mode === "overview" ? "Team Overview" : mode === "critical" ? `Critical Tasks (${criticalTasks.length})` : `All Tasks (${allTasks.length})`}
            </button>
          ))}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="px-6 py-4 grid grid-cols-4 gap-3 flex-shrink-0">
        <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] p-4">
          <div className="flex items-center gap-2 text-[#484F58] text-xs mb-2"><Users size={14} /> Team Members</div>
          <div className="text-2xl font-bold">{userStats.length}</div>
        </div>
        <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] p-4">
          <div className="flex items-center gap-2 text-[#484F58] text-xs mb-2"><ListTodo size={14} /> Open Tasks</div>
          <div className="text-2xl font-bold">{totals.todo + totals.inProgress}</div>
          <div className="text-[10px] text-[#484F58] mt-1">{totals.completed} completed</div>
        </div>
        <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] p-4">
          <div className="flex items-center gap-2 text-[#F85149] text-xs mb-2"><AlertTriangle size={14} /> Overdue</div>
          <div className="text-2xl font-bold text-[#F85149]">{totals.overdue}</div>
          <div className="text-[10px] text-[#484F58] mt-1">{totals.dueSoon} due within 48h</div>
        </div>
        <div className="rounded-xl border border-[#1E242C] bg-[#0F1318] p-4">
          <div className="flex items-center gap-2 text-[#484F58] text-xs mb-2"><Mail size={14} /> Assigned Emails</div>
          <div className="text-2xl font-bold">{totals.totalConvos}</div>
          <div className="text-[10px] text-[#484F58] mt-1">{totals.unreadConvos} unread</div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {viewMode === "overview" && (
          <div className="space-y-2">
            {/* Column Headers */}
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 text-[10px] text-[#484F58] uppercase tracking-wider font-semibold">
              <span>Team Member</span>
              <span className="text-center">To Do</span>
              <span className="text-center">In Progress</span>
              <span className="text-center">Completed</span>
              <span className="text-center">Overdue</span>
              <span className="text-center">Due Soon</span>
              <span className="text-center">Emails</span>
            </div>

            {userStats.map((user) => (
              <button
                key={user.id}
                onClick={() => { setSelectedUser(user.id); setViewMode("all-tasks"); }}
                className="w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 rounded-xl border border-[#1E242C] bg-[#0F1318] hover:border-[#4ADE80]/30 transition-all items-center text-left"
              >
                {/* User info */}
                <div className="flex items-center gap-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-[#0B0E11] flex-shrink-0"
                    style={{ background: user.color }}
                  >
                    {user.initials}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold text-[#E6EDF3]">{user.name}</div>
                    <div className="text-[10px] text-[#484F58]">{user.department}</div>
                  </div>
                </div>

                {/* To Do */}
                <div className="text-center">
                  <span className="text-sm font-semibold text-[#58A6FF]">{user.tasks.todo}</span>
                </div>

                {/* In Progress */}
                <div className="text-center">
                  <span className="text-sm font-semibold text-[#F5D547]">{user.tasks.in_progress}</span>
                </div>

                {/* Completed */}
                <div className="text-center">
                  <span className="text-sm font-semibold text-[#4ADE80]">{user.tasks.completed}</span>
                </div>

                {/* Overdue */}
                <div className="text-center">
                  <span className={`text-sm font-semibold ${user.tasks.overdue > 0 ? "text-[#F85149]" : "text-[#484F58]"}`}>
                    {user.tasks.overdue}
                  </span>
                </div>

                {/* Due Soon */}
                <div className="text-center">
                  <span className={`text-sm font-semibold ${user.tasks.dueSoon > 0 ? "text-[#F0883E]" : "text-[#484F58]"}`}>
                    {user.tasks.dueSoon}
                  </span>
                </div>

                {/* Emails */}
                <div className="text-center">
                  <span className="text-sm font-semibold text-[#E6EDF3]">{user.conversations.assigned}</span>
                  {user.conversations.unread > 0 && (
                    <span className="ml-1 text-[10px] text-[#F0883E]">({user.conversations.unread} new)</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {viewMode === "critical" && (
          <div className="space-y-2">
            <div className="text-sm text-[#F85149] font-semibold mb-3 flex items-center gap-2">
              <AlertTriangle size={16} /> Tasks that are overdue or due within 48 hours
            </div>
            {criticalTasks.length === 0 ? (
              <div className="text-center py-16 text-[#484F58] text-sm">No critical tasks right now</div>
            ) : (
              criticalTasks.map((task) => (
                <TaskRow key={task.id} task={task} formatDueDate={formatDueDate} getDueColor={getDueColor} />
              ))
            )}
          </div>
        )}

        {viewMode === "all-tasks" && (
          <div className="space-y-2">
            {/* User filter */}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-[#484F58]">Filter by:</span>
              <button
                onClick={() => setSelectedUser(null)}
                className={`px-2.5 py-1 rounded-lg text-xs transition-colors ${
                  !selectedUser ? "bg-[#4ADE80] text-[#0B0E11] font-semibold" : "bg-[#1E242C] text-[#7D8590] hover:text-[#E6EDF3]"
                }`}
              >
                All ({allTasks.length})
              </button>
              {userStats.map((user) => (
                <button
                  key={user.id}
                  onClick={() => setSelectedUser(user.id === selectedUser ? null : user.id)}
                  className={`px-2.5 py-1 rounded-lg text-xs transition-colors flex items-center gap-1.5 ${
                    selectedUser === user.id ? "bg-[#4ADE80] text-[#0B0E11] font-semibold" : "bg-[#1E242C] text-[#7D8590] hover:text-[#E6EDF3]"
                  }`}
                >
                  <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-[#0B0E11]" style={{ background: user.color }}>
                    {user.initials}
                  </div>
                  {user.name.split(" ")[0]}
                </button>
              ))}
            </div>

            {filteredTasks.length === 0 ? (
              <div className="text-center py-16 text-[#484F58] text-sm">No open tasks</div>
            ) : (
              filteredTasks.map((task) => (
                <TaskRow key={task.id} task={task} formatDueDate={formatDueDate} getDueColor={getDueColor} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskRow({ task, formatDueDate, getDueColor }: { task: TaskDetail; formatDueDate: (d: string | null) => string; getDueColor: (d: string | null) => string }) {
  const completedCount = task.assignees.filter((a) => a.is_done).length;
  const totalCount = task.assignees.length;
  const isOverdue = task.due_date && new Date(task.due_date) < new Date();

  return (
    <div className={`rounded-xl border bg-[#0F1318] p-4 ${isOverdue ? "border-[#F85149]/30" : "border-[#1E242C]"}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-[#E6EDF3] mb-1">{task.text}</div>
          <div className="flex items-center gap-3 text-[11px] text-[#484F58]">
            <Link href={`/?conversation=${task.conversation_id}`} className="hover:text-[#58A6FF] transition-colors truncate max-w-[300px]">
              {task.conversation_subject}
            </Link>
            {task.category_name && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: (task.category_color || "#1E242C") + "20", color: task.category_color || "#7D8590" }}>
                {task.category_name}
              </span>
            )}
          </div>
        </div>

        {/* Due date */}
        <div className="flex-shrink-0 text-right">
          {task.due_date && (
            <div className="flex items-center gap-1 text-[11px] font-medium" style={{ color: getDueColor(task.due_date) }}>
              <CalendarClock size={12} />
              {formatDueDate(task.due_date)}
              {task.due_time && <span className="text-[#484F58]">at {task.due_time}</span>}
            </div>
          )}
        </div>
      </div>

      {/* Assignees */}
      <div className="flex items-center gap-2 mt-3">
        <div className="flex items-center gap-1">
          {task.assignees.map((a, i) => (
            <div
              key={i}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-[#0B0E11] relative ${a.is_done ? "opacity-50" : ""}`}
              style={{ background: a.color }}
              title={a.name + (a.is_done ? " (done)" : "")}
            >
              {a.initials}
              {a.is_done && (
                <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[#4ADE80] rounded-full flex items-center justify-center">
                  <CheckCircle2 size={8} className="text-[#0B0E11]" />
                </div>
              )}
            </div>
          ))}
        </div>
        <span className="text-[10px] text-[#484F58]">
          {completedCount}/{totalCount} done
        </span>
        {/* Progress bar */}
        <div className="w-16 h-1.5 rounded-full bg-[#1E242C] overflow-hidden">
          <div
            className="h-full rounded-full bg-[#4ADE80] transition-all"
            style={{ width: totalCount > 0 ? (completedCount / totalCount * 100) + "%" : "0%" }}
          />
        </div>
      </div>
    </div>
  );
}
