"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  CalendarDays,
  CheckCircle2,
  Circle,
  Clock3,
  ExternalLink,
  ListTodo,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  User2,
  Search,
  ClipboardCheck,
} from "lucide-react";
import { useTasks } from "@/lib/hooks";
import TaskCountdown from "@/components/TaskCountdown";
import FormModal from "@/components/FormModal";
import type { Task, TaskStatus, TeamMember } from "@/types";

const STATUS_OPTIONS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "dismissed", label: "Dismissed" },
];

const SECTION_META = {
  todo: { label: "To do", icon: ListTodo, color: "var(--info)" },
  in_progress: { label: "In progress", icon: Clock3, color: "var(--highlight)" },
  completed: { label: "Completed", icon: CheckCircle2, color: "var(--accent)" },
  dismissed: { label: "Dismissed", icon: Ban, color: "var(--warning)" },
} as const;

function Avatar({ initials, color, size = 18 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold text-[var(--bg)] flex-shrink-0"
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
  const [showFormModal, setShowFormModal] = useState<{ taskId: string; conversationId: string; categoryId?: string } | null>(null);
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
                color: acc.color || "var(--info)",
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
    // Dismissed overrides everything — it's a task-level status
    if (task.status === "dismissed") return "dismissed";
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
      dismissed: filteredTasks.filter((task) => getMyStatus(task) === "dismissed"),
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
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] bg-[var(--bg)]">
        Sign in to view your tasks.
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-6xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6 gap-4">
          <div>
            <h1 className="text-3xl font-normal font-serif text-[var(--text-primary)] tracking-tight">My Tasks</h1>
            <p className="text-sm text-[var(--text-secondary)] mt-1">Tasks assigned to you across threads and standalone work.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              <input
                value={taskSearch}
                onChange={(e) => setTaskSearch(e.target.value)}
                placeholder="Search tasks..."
                className="w-56 pl-9 pr-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              />
            </div>
            {selectedTaskIds.length > 0 && currentUser?.role === "admin" && (
              <button
                onClick={() => deleteTasks(selectedTaskIds)}
                disabled={deleting}
                className="inline-flex items-center gap-2 px-3 py-2.5 rounded-lg border border-[rgba(248,81,73,0.35)] bg-[rgba(248,81,73,0.08)] text-[var(--danger)] text-sm font-semibold hover:bg-[rgba(248,81,73,0.14)] disabled:opacity-60"
              >
                <Trash2 size={15} />
                {deleting ? "Deleting..." : `Delete selected (${selectedTaskIds.length})`}
              </button>
            )}
            <button
              onClick={() => setShowComposer((value) => !value)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold hover:bg-[var(--accent-strong)] transition-colors"
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
          <div className="mb-6 p-4 rounded-2xl border border-[rgba(74,222,128,0.25)] bg-[var(--surface)]">
            <div className="text-sm font-semibold text-[var(--text-primary)] mb-3">Create Task</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="What needs to get done?"
              rows={3}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-none focus:border-[var(--accent)]"
            />

            {/* Category picker */}
            {taskCategories.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Category</div>
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setCategoryId("")}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                      !categoryId ? "bg-[var(--border)] text-[var(--text-primary)] ring-1 ring-[var(--accent)]" : "bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--text-secondary)]"}`}>
                    None
                  </button>
                  {taskCategories.map((cat: any) => (
                    <button key={cat.id} onClick={() => setCategoryId(cat.id)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                        categoryId === cat.id ? "ring-1 ring-[var(--accent)] bg-[var(--border)]" : "bg-[var(--bg)] border border-[var(--border)] hover:bg-[var(--border)]"}`}>
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
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Assignees</div>
                  <button onClick={() => {
                    const active = teamMembers.filter((m) => m.is_active !== false);
                    setAssigneeIds(assigneeIds.length === active.length ? [] : active.map((m) => m.id));
                  }} className="text-[10px] text-[var(--info)] hover:text-[#79B8FF] font-semibold">
                    {assigneeIds.length === teamMembers.filter((m) => m.is_active !== false).length ? "Deselect all" : "Select all"}
                  </button>
                </div>
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3 space-y-2 max-h-40 overflow-y-auto">
                  {/* Group quick-select */}
                  {userGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1 pb-2 mb-2 border-b border-[var(--border)]">
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
                              isSelected ? "ring-1 ring-[var(--accent)] bg-[rgba(74,222,128,0.1)]" : "bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--text-muted)]"
                            }`}>
                            <span className="text-[11px]">{g.icon}</span>
                            <span style={{ color: isSelected ? "var(--accent)" : g.color }}>{g.name}</span>
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
                        <label key={member.id} className="flex items-center gap-2 text-sm text-[var(--text-primary)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setAssigneeIds((prev) =>
                                e.target.checked ? [...prev, member.id] : prev.filter((id) => id !== member.id)
                              );
                            }}
                            className="accent-[var(--accent)]"
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
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Due date</div>
                  <button type="button" onClick={openDatePicker}
                    className="w-full flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 text-left text-sm text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors">
                    <CalendarDays size={16} className="text-[var(--highlight)]" />
                    <span className={dueDate ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"}>{dueDate || "Pick a due date"}</span>
                  </button>
                  <input ref={dateInputRef} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="sr-only" />
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Hours to complete</div>
                  <select value={dueHours} onChange={(e) => setDueHours(e.target.value)}
                    className="w-full h-10 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]">
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
                className="px-3.5 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-2)]"
              >
                Cancel
              </button>
              <button
                onClick={createTask}
                disabled={saving || !text.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold hover:bg-[var(--accent-strong)] disabled:opacity-60"
              >
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                {saving ? "Saving..." : "Create Task"}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-20 flex justify-center">
            <Loader2 size={28} className="animate-spin text-[var(--accent)]" />
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
                  className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden min-h-[420px]"
                >
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                    <div className="flex items-center gap-2">
                      <Icon size={16} style={{ color: meta.color }} />
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{meta.label}</div>
                    </div>
                    <div className="flex items-center gap-3">
                      {sectionTasks.length > 0 && (
                        <label className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={(e) => toggleSectionSelection(sectionTasks, e.target.checked)}
                            className="accent-[var(--accent)]"
                          />
                          Select all
                        </label>
                      )}
                      <span className="text-xs text-[var(--text-secondary)]">{sectionTasks.length}</span>
                    </div>
                  </div>

                  <div className="p-3 space-y-3">
                    {sectionTasks.length === 0 && (
                      <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-8 text-center text-sm text-[var(--text-muted)]">
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
                        onOpenForm={(t) => t.conversation_id && setShowFormModal({ taskId: t.id, conversationId: t.conversation_id, categoryId: (t as any).category_id || undefined })}
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

      {/* Form Modal */}
      {showFormModal && (
        <FormModal
          conversationId={showFormModal.conversationId}
          taskId={showFormModal.taskId}
          taskCategoryId={showFormModal.categoryId}
          submittedBy={currentUser?.id}
          onClose={() => setShowFormModal(null)}
          onSubmitted={() => { refetch(); }}
        />
      )}
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
  onOpenForm,
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
  onOpenForm?: (task: Task) => void;
  onRefetch?: () => Promise<void>;
  deleting: boolean;
  isHighlighted?: boolean;
  highlightRef?: React.RefObject<HTMLDivElement>;
}) {
  const assignees = task.assignees || [];
  const isMulti = assignees.length > 1;
  const doneCount = assignees.filter((a: any) => a.is_done).length;
  const [showReopenPanel, setShowReopenPanel] = useState(false);
  const [reopenDeadlineChoice, setReopenDeadlineChoice] = useState<"keep" | "reset" | "custom">("keep");
  const [reopenCustomDate, setReopenCustomDate] = useState("");
  const [reopening, setReopening] = useState(false);

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
      className={`rounded-xl border bg-[var(--bg)] p-3 transition-all duration-500 ${
        isHighlighted
          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/30 bg-[var(--accent)]/5"
          : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-start gap-2 mb-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectedChange(e.target.checked)}
          className="mt-1 accent-[var(--accent)]"
        />

        <button
          onClick={isMulti ? toggleMyCompletion : () => onStatusChange(task.id, task.status === "completed" ? "todo" : "completed")}
          title={isMulti ? "Mark my part as done" : "Toggle completion"}
          className="mt-0.5"
        >
          {(() => {
            if (task.status === "dismissed") return <Ban size={16} className="text-[var(--warning)] opacity-60" />;
            if (isMulti && currentUser) {
              const myEntry = assignees.find((a: any) => a.id === currentUser.id);
              if (doneCount === assignees.length) return <CheckCircle2 size={16} className="text-[var(--accent)]" />;
              if (myEntry?.is_done) return <CheckCircle2 size={16} className="text-[var(--info)]" />;
              return <Circle size={16} className="text-[var(--text-muted)]" />;
            }
            return task.status === "completed"
              ? <CheckCircle2 size={16} className="text-[var(--accent)]" />
              : <Circle size={16} className="text-[var(--text-muted)]" />;
          })()}
        </button>

        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${task.status === "dismissed" ? "text-[var(--warning)] italic opacity-70" : task.status === "completed" ? "text-[var(--text-secondary)] line-through" : "text-[var(--text-primary)]"}`}>
            {task.status === "dismissed" && <Ban size={12} className="inline mr-1 -mt-0.5" />}
            {task.text}
          </div>

          {/* Dismiss reason */}
          {task.status === "dismissed" && task.dismiss_reason && (
            <div className="mt-1 px-2 py-1 rounded bg-[rgba(240,136,62,0.08)] border border-[rgba(240,136,62,0.15)]">
              <span className="text-[10px] text-[var(--warning)] font-semibold">Dismissed: </span>
              <span className="text-[10px] text-[var(--text-secondary)]">{task.dismiss_reason}</span>
              {task.dismissed_at && (
                <span className="text-[10px] text-[var(--text-muted)] ml-2">
                  {new Date(task.dismissed_at).toLocaleDateString()}
                </span>
              )}
            </div>
          )}

          {/* Progress for multi-assignee */}
          {isMulti && (
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] max-w-[100px]">
                <div className="h-full rounded-full transition-all" style={{
                  width: `${(doneCount / assignees.length) * 100}%`,
                  background: doneCount === assignees.length ? "var(--accent)" : "var(--info)",
                }} />
              </div>
              <span className="text-[10px] text-[var(--text-muted)]">{doneCount}/{assignees.length}</span>
            </div>
          )}

          {task.conversation && (
            <button
              type="button"
              onClick={() => task.conversation?.id && onOpenConversation?.(task.conversation.id)}
              className="mt-1 flex items-center gap-1 text-xs text-[var(--info)] hover:text-[var(--info)] max-w-full overflow-hidden"
            >
              <ExternalLink size={12} className="shrink-0" />
              <span className="truncate">
                Open thread: {task.conversation.subject || task.conversation.from_email || "Untitled thread"}
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Fill form button */}
          <button
            type="button"
            onClick={() => onOpenForm?.(task)}
            className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            title="Fill out form"
          >
            <ClipboardCheck size={14} />
          </button>
          {task.status === "dismissed" ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowReopenPanel(!showReopenPanel)}
                className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
                title="Reopen this task"
              >
                <RotateCcw size={14} />
              </button>
              {showReopenPanel && (
                <div className="absolute right-0 top-7 z-50 w-64 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-xl">
                  <div className="text-[11px] font-semibold text-[var(--text-primary)] mb-2">Reopen Task</div>
                  <div className="space-y-1.5 mb-3">
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] text-[#C9D1D9]">
                      <input type="radio" name={`reopen-${task.id}`} checked={reopenDeadlineChoice === "keep"} onChange={() => setReopenDeadlineChoice("keep")}
                        className="accent-[var(--accent)]" />
                      Keep deadline{task.due_date ? ` (${task.due_date})` : " (none)"}
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] text-[#C9D1D9]">
                      <input type="radio" name={`reopen-${task.id}`} checked={reopenDeadlineChoice === "reset"} onChange={() => setReopenDeadlineChoice("reset")}
                        className="accent-[var(--accent)]" />
                      Reset to 24hrs from now
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-[11px] text-[#C9D1D9]">
                      <input type="radio" name={`reopen-${task.id}`} checked={reopenDeadlineChoice === "custom"} onChange={() => setReopenDeadlineChoice("custom")}
                        className="accent-[var(--accent)]" />
                      Set new date
                    </label>
                    {reopenDeadlineChoice === "custom" && (
                      <input type="date" value={reopenCustomDate} onChange={(e) => setReopenCustomDate(e.target.value)}
                        className="w-full mt-1 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] [color-scheme:dark]" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      disabled={reopening || (reopenDeadlineChoice === "custom" && !reopenCustomDate)}
                      onClick={async () => {
                        setReopening(true);
                        try {
                          const body: any = { task_id: task.id, status: "todo" };
                          if (reopenDeadlineChoice === "reset") {
                            const { addBusinessHours } = await import("@/lib/business-hours");
                            const result = addBusinessHours(new Date(), 24, null);
                            body.due_date = result.dueDate;
                          } else if (reopenDeadlineChoice === "custom" && reopenCustomDate) {
                            body.due_date = reopenCustomDate;
                          }
                          await fetch("/api/tasks", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
                          setShowReopenPanel(false);
                          onRefetch?.();
                        } catch (e) { console.error(e); }
                        setReopening(false);
                      }}
                      className="flex-1 px-2 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[10px] font-semibold disabled:opacity-50"
                    >
                      {reopening ? "Reopening..." : "Reopen"}
                    </button>
                    <button onClick={() => setShowReopenPanel(false)}
                      className="px-2 py-1.5 rounded-lg border border-[var(--border)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            task.status !== "completed" && !task.is_done && (
              <button
                type="button"
                onClick={async () => {
                  const reason = prompt("Why is this task no longer needed?\n(e.g., supplier responded via email, issue resolved, duplicate task)");
                  if (!reason || !reason.trim()) return;
                  try {
                    await fetch("/api/tasks", {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        task_id: task.id,
                        status: "dismissed",
                        dismiss_reason: reason.trim(),
                        dismissed_by: currentUser?.id || null,
                      }),
                    });
                    onRefetch?.();
                  } catch (e) { console.error(e); }
                }}
                className="text-[var(--text-secondary)] hover:text-[var(--warning)] transition-colors"
                title="Dismiss — no longer needed"
              >
                <Ban size={14} />
              </button>
            )
          )}
          {currentUser?.role === "admin" && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting}
              className="text-[var(--text-secondary)] hover:text-[var(--danger)] transition-colors disabled:opacity-50"
              title="Delete task"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
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
              color: member.is_done ? "var(--accent)" : member.color,
            }}
          >
            {member.is_done ? <CheckCircle2 size={11} className="text-[var(--accent)]" /> : <User2 size={11} />}
            {member.name}
          </button>
        ))}

        {task.due_date && (
          <>
            <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(245,213,71,0.12)] px-2 py-1 text-[11px] text-[var(--highlight)]">
              <CalendarDays size={12} />
              {task.due_date}{task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
            </span>
            <TaskCountdown
              dueDate={task.due_date}
              dueTime={task.due_time}
              isCompleted={task.status === "completed" || task.status === "dismissed" || task.is_done}
            />
          </>
        )}

        {!task.conversation_id && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(74,222,128,0.12)] px-2 py-1 text-[11px] text-[var(--accent)]">
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
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
        >
          <option value="todo">📋 To do (my part)</option>
          <option value="in_progress">🔄 In progress (my part)</option>
          <option value="completed">✅ Completed (my part)</option>
        </select>
      ) : (
        <select
          value={task.status}
          onChange={(e) => onStatusChange(task.id, e.target.value as TaskStatus)}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
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