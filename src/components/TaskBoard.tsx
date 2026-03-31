"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  ListTodo,
  Loader2,
  Plus,
  Trash2,
  User2,
  Search,
} from "lucide-react";
import { useTasks } from "@/lib/hooks";
import type { Task, TaskStatus, TeamMember } from "@/types";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
];

const SECTION_META = {
  todo: { label: "To do", icon: ListTodo, color: "#58A6FF" },
  in_progress: { label: "In progress", icon: Clock3, color: "#F5D547" },
  completed: { label: "Completed", icon: CheckCircle2, color: "#4ADE80" },
} as const;

function Avatar({ initials, color, size = 18 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold text-[#0B0E11] flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4, background: color }}
    >
      {initials}
    </div>
  );
}

export default function TaskBoard({
  currentUser,
  teamMembers,
  onTasksChanged,
  autoOpenComposer = false,
  onOpenConversation,
}: {
  currentUser: TeamMember | null;
  teamMembers: TeamMember[];
  onTasksChanged?: () => Promise<any> | void;
  autoOpenComposer?: boolean;
  onOpenConversation?: (conversationId: string) => void;
}) {
  const { tasks, loading, refetch } = useTasks(currentUser?.id || null, "mine");
  const [showComposer, setShowComposer] = useState(false);
  const [taskSearch, setTaskSearch] = useState("");
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const highlightRef = useRef<HTMLDivElement>(null);

  // Check URL hash for highlight_task param
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const taskId = params.get("highlight_task");
    if (taskId) {
      setHighlightedTaskId(taskId);
      // Clear highlight after 5 seconds
      const timer = setTimeout(() => {
        setHighlightedTaskId(null);
        window.location.hash = "";
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Scroll highlighted task into view
  useEffect(() => {
    if (highlightedTaskId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedTaskId]);
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [dueHours, setDueHours] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [taskCategories, setTaskCategories] = useState<any[]>([]);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [assigneeIds, setAssigneeIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const dateInputRef = useRef<HTMLInputElement>(null);

  const openDatePicker = () => {
    const input = dateInputRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
    input?.showPicker?.();
    input?.focus();
  };

  useEffect(() => {
    if (showComposer) {
      setAssigneeIds(currentUser?.id ? [currentUser.id] : []);
    }
  }, [showComposer, currentUser?.id]);

  useEffect(() => {
    if (autoOpenComposer) setShowComposer(true);
  }, [autoOpenComposer]);

  useEffect(() => {
    setSelectedTaskIds((prev) => prev.filter((id) => tasks.some((task) => task.id === id)));
  }, [tasks]);

  // Load task categories and user groups
  useEffect(() => {
    import("@/lib/supabase").then(({ createBrowserClient }) => {
      const sb = createBrowserClient();
      sb.from("task_categories").select("*").eq("is_active", true).order("sort_order")
        .then(({ data }) => setTaskCategories(data || []));

      // Load manual user groups + account-based groups
      sb.from("user_groups").select("*, user_group_members(team_member_id)").eq("is_active", true).order("created_at")
        .then(async ({ data: manualGroups }) => {
          const groups = [...(manualGroups || [])];
          const [accRes, accessRes] = await Promise.all([
            sb.from("email_accounts").select("id, name, icon, color").eq("is_active", true),
            sb.from("account_access").select("email_account_id, team_member_id"),
          ]);
          const accountMembers: Record<string, string[]> = {};
          for (const row of (accessRes.data || [])) {
            if (!accountMembers[row.email_account_id]) accountMembers[row.email_account_id] = [];
            accountMembers[row.email_account_id].push(row.team_member_id);
          }
          for (const acc of (accRes.data || [])) {
            const memberIds = accountMembers[acc.id];
            if (memberIds && memberIds.length > 0) {
              groups.push({
                id: `account:${acc.id}`,
                name: acc.name,
                icon: acc.icon || "📬",
                color: acc.color || "#58A6FF",
                is_active: true,
                _isAccountGroup: true,
                user_group_members: memberIds.map((id: string) => ({ team_member_id: id })),
              });
            }
          }
          setUserGroups(groups);
        });
    });
  }, []);

  // For multi-assignee tasks, use the current user's personal completion status
  // For single-assignee tasks, use the task-level status
  const getMyStatus = useCallback((task: Task): TaskStatus => {
    const assignees = task.assignees || [];
    if (assignees.length > 1 && currentUser) {
      const myEntry = assignees.find((a: any) => a.id === currentUser.id);
      if (myEntry) {
        return (myEntry as any).personal_status || (myEntry.is_done ? "completed" : "todo");
      }
    }
    return task.status as TaskStatus;
  }, [currentUser]);

  // Filter by search and sort by nearest deadline
  const filteredTasks = useMemo(() => {
    let filtered = tasks;
    if (taskSearch.trim()) {
      const q = taskSearch.toLowerCase();
      filtered = filtered.filter((t) =>
        t.text?.toLowerCase().includes(q) ||
        (t as any).conversation?.subject?.toLowerCase().includes(q) ||
        t.assignees?.some((a: any) => a.name?.toLowerCase().includes(q))
      );
    }
    return [...filtered].sort((a, b) => {
      const aDate = a.due_date ? new Date(a.due_date).getTime() : Infinity;
      const bDate = b.due_date ? new Date(b.due_date).getTime() : Infinity;
      return aDate - bDate;
    });
  }, [tasks, taskSearch]);

  const grouped = useMemo(
    () => ({
      todo: filteredTasks.filter((task) => getMyStatus(task) === "todo"),
      in_progress: filteredTasks.filter((task) => getMyStatus(task) === "in_progress"),
      completed: filteredTasks.filter((task) => getMyStatus(task) === "completed"),
    }),
    [filteredTasks, getMyStatus]
  );

  const createTask = async () => {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);

    // Calculate due_time from hours
    let computedDueDate = dueDate || null;
    let computedDueTime: string | null = null;
    if (dueHours) {
      const hours = parseInt(dueHours);
      if (hours > 0) {
        const deadline = new Date(Date.now() + hours * 60 * 60 * 1000);
        computedDueDate = computedDueDate || deadline.toISOString().split("T")[0];
        computedDueTime = deadline.toTimeString().slice(0, 5);
      }
    }

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          assignee_ids: assigneeIds,
          due_date: computedDueDate,
          due_time: computedDueTime,
          category_id: categoryId || null,
          status: "todo",
        }),
      });

      if (res.ok) {
        setText("");
        setDueDate("");
        setDueHours("");
        setCategoryId("");
        setShowComposer(false);
        await refetch();
        await onTasksChanged?.();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Failed to create task");
      }
    } finally {
      setSaving(false);
    }
  };

  const updateTaskStatus = async (taskId: string, status: TaskStatus) => {
    setError(null);
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, status }),
    });

    if (res.ok) {
      await refetch();
      await onTasksChanged?.();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data?.error || "Failed to update task");
    }
  };

  const deleteTasks = async (taskIds: string[]) => {
    if (taskIds.length === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_ids: taskIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error || "Failed to delete task");
        return;
      }
      setSelectedTaskIds((prev) => prev.filter((id) => !taskIds.includes(id)));
      await refetch();
      await onTasksChanged?.();
    } finally {
      setDeleting(false);
    }
  };

  const toggleTaskSelection = (taskId: string, checked: boolean) => {
    setSelectedTaskIds((prev) => {
      if (checked) return [...prev, taskId];
      return prev.filter((id) => id !== taskId);
    });
  };

  const toggleSectionSelection = (sectionTasks: Task[], checked: boolean) => {
    const sectionIds = sectionTasks.map((task) => task.id);
    setSelectedTaskIds((prev) => {
      const set = new Set(prev);
      if (checked) sectionIds.forEach((id) => set.add(id));
      else sectionIds.forEach((id) => set.delete(id));
      return Array.from(set);
    });
  };

  if (!currentUser) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#484F58] bg-[#0B0E11]">
        Sign in to view your tasks.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0B0E11]">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight">My Tasks</h1>
            <p className="text-sm text-[#7D8590] mt-1">Tasks assigned to you across threads and standalone work.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#484F58]" />
              <input
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
                placeholder="Search tasks..."
                className="w-56 pl-9 pr-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
              />
            </div>
            {selectedTaskIds.length > 0 && (
              <button
                onClick={() => deleteTasks(selectedTaskIds)}
                disabled={deleting}
                className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[rgba(248,81,73,0.35)] bg-[rgba(248,81,73,0.08)] text-[#F85149] text-sm font-semibold hover:bg-[rgba(248,81,73,0.14)] disabled:opacity-60"
              >
                <Trash2 size={15} />
                {deleting ? "Deleting..." : `Delete selected (${selectedTaskIds.length})`}
              </button>
            )}
            <button
              onClick={() => setShowComposer((value) => !value)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-sm font-semibold hover:bg-[#3BC96E] transition-colors"
            >
              <Plus size={16} />
              {showComposer ? "Close" : "New Task"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-[rgba(248,81,73,0.3)] bg-[rgba(248,81,73,0.08)] px-4 py-3 text-sm text-[#FFB4AE]">
            {error}
          </div>
        )}

        {showComposer && (
          <div className="mb-6 p-4 rounded-2xl border border-[rgba(74,222,128,0.25)] bg-[#12161B]">
            <div className="text-sm font-semibold text-[#E6EDF3] mb-3">Create Task</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What needs to get done?"
              rows={3}
              className="w-full rounded-xl border border-[#1E242C] bg-[#0B0E11] px-4 py-3 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none resize-none focus:border-[#4ADE80]"
            />

            {/* Category picker */}
            {taskCategories.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7D8590] mb-2">Category</div>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setCategoryId("")}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      !categoryId ? "bg-[#1E242C] text-[#E6EDF3] ring-1 ring-[#4ADE80]" : "bg-[#0B0E11] text-[#484F58] border border-[#1E242C] hover:text-[#7D8590]"}`}>
                    None
                  </button>
                  {taskCategories.map((cat: any) => (
                    <button key={cat.id} onClick={() => setCategoryId(cat.id)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                        categoryId === cat.id ? "ring-1 ring-[#4ADE80] bg-[#1E242C]" : "bg-[#0B0E11] border border-[#1E242C] hover:bg-[#1E242C]"}`}>
                      <span className="text-[13px]">{cat.icon}</span>
                      <span style={{ color: cat.color }}>{cat.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 mt-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7D8590]">Assignees</div>
                  <button onClick={() => {
                    const active = teamMembers.filter((m) => m.is_active !== false);
                    setAssigneeIds(assigneeIds.length === active.length ? [] : active.map((m) => m.id));
                  }} className="text-[10px] text-[#58A6FF] hover:text-[#79B8FF] font-semibold">
                    {assigneeIds.length === teamMembers.filter((m) => m.is_active !== false).length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="rounded-xl border border-[#1E242C] bg-[#0B0E11] p-3 space-y-2 max-h-40 overflow-y-auto">
                  {/* Group quick-select */}
                  {userGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1 pb-2 mb-2 border-b border-[#1E242C]">
                      {userGroups.map((g: any) => {
                        const memberIds = (g.user_group_members || []).map((m: any) => m.team_member_id);
                        const isSelected = memberIds.length > 0 && memberIds.every((id: string) => assigneeIds.includes(id));
                        return (
                          <button key={g.id} onClick={() => {
                            if (isSelected) {
                              setAssigneeIds((prev) => prev.filter((id) => !memberIds.includes(id)));
                            } else {
                              setAssigneeIds((prev) => Array.from(new Set([...prev, ...memberIds])));
                            }
                          }}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                              isSelected ? "ring-1 ring-[#4ADE80] bg-[rgba(74,222,128,0.1)]" : "bg-[#12161B] border border-[#1E242C] hover:border-[#484F58]"
                            }`}>
                            <span className="text-[11px]">{g.icon}</span>
                            <span style={{ color: isSelected ? "#4ADE80" : g.color }}>{g.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {teamMembers
                    .filter((member) => member.is_active !== false)
                    .map((member) => {
                      const checked = assigneeIds.includes(member.id);
                      return (
                        <label key={member.id} className="flex items-center gap-2 text-sm text-[#E6EDF3] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setAssigneeIds((prev) =>
                                e.target.checked ? [...prev, member.id] : prev.filter((id) => id !== member.id)
                              );
                            }}
                            className="accent-[#4ADE80]"
                          />
                          <Avatar initials={member.initials} color={member.color} size={18} />
                          <span>{member.name}</span>
                        </label>
                      );
                    })}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7D8590] mb-2">Due date</div>
                  <button type="button" onClick={openDatePicker}
                    className="w-full flex items-center gap-3 rounded-xl border border-[#1E242C] bg-[#0B0E11] px-4 py-3 text-left text-sm text-[#E6EDF3] hover:border-[#4ADE80] transition-colors">
                    <CalendarDays size={16} className="text-[#F5D547]" />
                    <span className={dueDate ? "text-[#E6EDF3]" : "text-[#484F58]"}>{dueDate || "Pick a due date"}</span>
                  </button>
                  <input ref={dateInputRef} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="sr-only" />
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7D8590] mb-2">Hours to complete</div>
                  <select value={dueHours} onChange={(e) => setDueHours(e.target.value)}
                    className="w-full h-10 rounded-xl border border-[#1E242C] bg-[#0B0E11] px-3 text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                    <option value="">No limit</option>
                    <option value="1">1 hour</option>
                    <option value="2">2 hours</option>
                    <option value="3">3 hours</option>
                    <option value="4">4 hours</option>
                    <option value="6">6 hours</option>
                    <option value="8">8 hours (1 day)</option>
                    <option value="12">12 hours</option>
                    <option value="24">24 hours</option>
                    <option value="48">48 hours (2 days)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  setShowComposer(false);
                  setText("");
                  setDueDate("");
                  setDueHours("");
                  setCategoryId("");
                  setAssigneeIds([]);
                  setError(null);
                }}
                className="px-3.5 py-2 rounded-lg border border-[#1E242C] text-[#7D8590] text-sm hover:bg-[#181D24]"
              >
                Cancel
              </button>
              <button
                onClick={createTask}
                disabled={saving || !text.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-sm font-semibold hover:bg-[#3BC96E] disabled:opacity-60"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {saving ? "Saving..." : "Create Task"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-20 flex justify-center">
            <Loader2 size={28} className="animate-spin text-[#4ADE80]" />
          </div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
            {(Object.keys(SECTION_META) as TaskStatus[]).map((status) => {
              const meta = SECTION_META[status];
              const sectionTasks = grouped[status];
              const Icon = meta.icon;
              const allSelected =
                sectionTasks.length > 0 && sectionTasks.every((task) => selectedTaskIds.includes(task.id));

              return (
                <div
                  key={status}
                  className="rounded-2xl border border-[#1E242C] bg-[#12161B] overflow-hidden min-h-[420px]"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E242C]">
                    <div className="flex items-center gap-2">
                      <Icon size={16} style={{ color: meta.color }} />
                      <div className="text-sm font-semibold text-[#E6EDF3]">{meta.label}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {sectionTasks.length > 0 && (
                        <label className="flex items-center gap-1 text-[11px] text-[#7D8590] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={(e) => toggleSectionSelection(sectionTasks, e.target.checked)}
                            className="accent-[#4ADE80]"
                          />
                          Select all
                        </label>
                      )}
                      <span className="text-xs text-[#7D8590]">{sectionTasks.length}</span>
                    </div>
                  </div>

                  <div className="p-3 space-y-3">
                    {sectionTasks.length === 0 && (
                      <div className="rounded-xl border border-dashed border-[#1E242C] px-4 py-8 text-center text-sm text-[#484F58]">
                        No {meta.label.toLowerCase()} tasks
                      </div>
                    )}

                    {sectionTasks.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        currentUser={currentUser}
                        selected={selectedTaskIds.includes(task.id)}
                        onSelectedChange={(checked) => toggleTaskSelection(task.id, checked)}
                        onStatusChange={updateTaskStatus}
                        onDelete={() => deleteTasks([task.id])}
                        onOpenConversation={onOpenConversation}
                        onRefetch={refetch}
                        deleting={deleting}
                        isHighlighted={task.id === highlightedTaskId}
                        highlightRef={task.id === highlightedTaskId ? highlightRef : undefined}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({
  task,
  currentUser,
  selected,
  onSelectedChange,
  onStatusChange,
  onDelete,
  onOpenConversation,
  onRefetch,
  deleting,
  isHighlighted,
  highlightRef,
}: {
  task: Task;
  currentUser: TeamMember | null;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => Promise<void>;
  onDelete: () => void;
  onOpenConversation?: (conversationId: string) => void;
  onRefetch?: () => Promise<void>;
  deleting: boolean;
  isHighlighted?: boolean;
  highlightRef?: React.RefObject<HTMLDivElement>;
}) {
  const assignees = task.assignees || [];
  const isMulti = assignees.length > 1;
  const doneCount = assignees.filter((a: any) => a.is_done).length;

  const toggleMyCompletion = async () => {
    if (!currentUser) return;
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: task.id, toggle_assignee_id: currentUser.id }),
      });
      await onRefetch?.();
    } catch (e) { console.error(e); }
  };

  const toggleAssignee = async (memberId: string) => {
    try {
      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: task.id, toggle_assignee_id: memberId }),
      });
      await onRefetch?.();
    } catch (e) { console.error(e); }
  };

  return (
    <div
      ref={highlightRef as any}
      className={`rounded-xl border bg-[#0B0E11] p-3 transition-all duration-500 ${
        isHighlighted
          ? "border-[#4ADE80] ring-2 ring-[#4ADE80]/30 bg-[#4ADE80]/5"
          : "border-[#1E242C]"
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectedChange(e.target.checked)}
          className="mt-1 accent-[#4ADE80]"
        />

        <button
          onClick={isMulti ? toggleMyCompletion : () => onStatusChange(task.id, task.status === "completed" ? "todo" : "completed")}
          title={isMulti ? "Mark my part as done" : "Toggle completion"}
          className="mt-0.5"
        >
          {(() => {
            if (isMulti && currentUser) {
              const myEntry = assignees.find((a: any) => a.id === currentUser.id);
              if (doneCount === assignees.length) return <CheckCircle2 size={16} className="text-[#4ADE80]" />;
              if (myEntry?.is_done) return <CheckCircle2 size={16} className="text-[#58A6FF]" />;
              return <Circle size={16} className="text-[#484F58]" />;
            }
            return task.status === "completed"
              ? <CheckCircle2 size={16} className="text-[#4ADE80]" />
              : <Circle size={16} className="text-[#484F58]" />;
          })()}
        </button>

        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${task.status === "completed" ? "text-[#7D8590] line-through" : "text-[#E6EDF3]"}`}>
            {task.text}
          </div>

          {/* Progress for multi-assignee */}
          {isMulti && (
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 rounded-full bg-[#1E242C] max-w-[100px]">
                <div className="h-full rounded-full transition-all" style={{
                  width: `${(doneCount / assignees.length) * 100}%`,
                  background: doneCount === assignees.length ? "#4ADE80" : "#58A6FF",
                }} />
              </div>
              <span className="text-[10px] text-[#484F58]">{doneCount}/{assignees.length}</span>
            </div>
          )}

          {task.conversation && (
            <button
              type="button"
              onClick={() => task.conversation?.id && onOpenConversation?.(task.conversation.id)}
              className="mt-1 inline-flex items-center gap-1 text-xs text-[#58A6FF] hover:text-[#7cc0ff] truncate"
            >
              <ExternalLink size={12} />
              <span className="truncate">
                Open thread: {task.conversation.subject || task.conversation.from_email || "Untitled thread"}
              </span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={onDelete}
          disabled={deleting}
          className="text-[#7D8590] hover:text-[#F85149] transition-colors disabled:opacity-50"
          title="Delete task"
        >
          <Trash2 size={15} />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {task.category_id && task.category && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
            style={{ background: `${task.category.color}18`, color: task.category.color }}>
            <span className="text-[12px]">{task.category.icon}</span> {task.category.name}
          </span>
        )}

        {assignees.map((member: any) => (
          <button
            key={member.id}
            onClick={() => toggleAssignee(member.id)}
            title={member.is_done ? `${member.name} — done. Click to undo` : `${member.name} — click to mark done`}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-all ${
              member.is_done ? "line-through opacity-60" : ""
            }`}
            style={{
              background: member.is_done ? "rgba(74,222,128,0.15)" : "rgba(88,166,255,0.12)",
              color: member.is_done ? "#4ADE80" : member.color,
            }}
          >
            {member.is_done ? <CheckCircle2 size={11} className="text-[#4ADE80]" /> : <User2 size={11} />}
            {member.name}
          </button>
        ))}

        {task.due_date && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(245,213,71,0.12)] px-2 py-1 text-[11px] text-[#F5D547]">
            <CalendarDays size={12} />
            {task.due_date}{task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
          </span>
        )}

        {!task.conversation_id && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(74,222,128,0.12)] px-2 py-1 text-[11px] text-[#4ADE80]">
            Standalone
          </span>
        )}
      </div>

      {isMulti ? (
        <select
          value={(() => {
            if (!currentUser) return "todo";
            const myEntry = assignees.find((a: any) => a.id === currentUser.id);
            return myEntry?.personal_status || (myEntry?.is_done ? "completed" : "todo");
          })()}
          onChange={async (e) => {
            if (!currentUser) return;
            try {
              await fetch("/api/tasks", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  task_id: task.id,
                  toggle_assignee_id: currentUser.id,
                  assignee_status: e.target.value,
                }),
              });
              await onRefetch?.();
            } catch (err) { console.error(err); }
          }}
          className="w-full rounded-lg border border-[#1E242C] bg-[#12161B] px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
        >
          <option value="todo">📋 To do (my part)</option>
          <option value="in_progress">🔄 In progress (my part)</option>
          <option value="completed">✅ Completed (my part)</option>
        </select>
      ) : (
        <select
          value={task.status}
          onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
          className="w-full rounded-lg border border-[#1E242C] bg-[#12161B] px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}