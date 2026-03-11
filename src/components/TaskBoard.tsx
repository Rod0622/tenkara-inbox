"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [text, setText] = useState("");
  const [dueDate, setDueDate] = useState("");
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

  const grouped = useMemo(
    () => ({
      todo: tasks.filter((task) => task.status === "todo"),
      in_progress: tasks.filter((task) => task.status === "in_progress"),
      completed: tasks.filter((task) => task.status === "completed"),
    }),
    [tasks]
  );

  const createTask = async () => {
    if (!text.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: text.trim(),
          assignee_ids: assigneeIds,
          due_date: dueDate || null,
          status: "todo",
        }),
      });

      if (res.ok) {
        setText("");
        setDueDate("");
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
            <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4 mt-4">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7D8590] mb-2">
                  Assignees
                </div>
                <div className="rounded-xl border border-[#1E242C] bg-[#0B0E11] p-3 space-y-2 max-h-40 overflow-y-auto">
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

              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7D8590] mb-2">
                  Due date
                </div>
                <button
                  type="button"
                  onClick={openDatePicker}
                  className="w-full flex items-center gap-3 rounded-xl border border-[#1E242C] bg-[#0B0E11] px-4 py-3 text-left text-sm text-[#E6EDF3] hover:border-[#4ADE80] transition-colors"
                >
                  <CalendarDays size={16} className="text-[#F5D547]" />
                  <span className={dueDate ? "text-[#E6EDF3]" : "text-[#484F58]"}>
                    {dueDate || "Pick a due date"}
                  </span>
                </button>
                <input
                  ref={dateInputRef}
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="sr-only"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => {
                  setShowComposer(false);
                  setText("");
                  setDueDate("");
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
                        selected={selectedTaskIds.includes(task.id)}
                        onSelectedChange={(checked) => toggleTaskSelection(task.id, checked)}
                        onStatusChange={updateTaskStatus}
                        onDelete={() => deleteTasks([task.id])}
                        onOpenConversation={onOpenConversation}
                        deleting={deleting}
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
  selected,
  onSelectedChange,
  onStatusChange,
  onDelete,
  onOpenConversation,
  deleting,
}: {
  task: Task;
  selected: boolean;
  onSelectedChange: (checked: boolean) => void;
  onStatusChange: (taskId: string, status: TaskStatus) => Promise<void>;
  onDelete: () => void;
  onOpenConversation?: (conversationId: string) => void;
  deleting: boolean;
}) {
  return (
    <div className="rounded-xl border border-[#1E242C] bg-[#0B0E11] p-3">
      <div className="flex items-start gap-2 mb-2">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onSelectedChange(e.target.checked)}
          className="mt-1 accent-[#4ADE80]"
        />

        {task.status === "completed" ? (
          <CheckCircle2 size={16} className="text-[#4ADE80] mt-0.5" />
        ) : (
          <Circle size={16} className="text-[#484F58] mt-0.5" />
        )}

        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${task.status === "completed" ? "text-[#7D8590] line-through" : "text-[#E6EDF3]"}`}>
            {task.text}
          </div>

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
        {task.assignees?.map((member) => (
          <span
            key={member.id}
            className="inline-flex items-center gap-1 rounded-full bg-[rgba(88,166,255,0.12)] px-2 py-1 text-[11px]"
            style={{ color: member.color }}
          >
            <User2 size={11} />
            {member.name}
          </span>
        ))}

        {task.due_date && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(245,213,71,0.12)] px-2 py-1 text-[11px] text-[#F5D547]">
            <CalendarDays size={12} />
            {task.due_date}
          </span>
        )}

        {!task.conversation_id && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(74,222,128,0.12)] px-2 py-1 text-[11px] text-[#4ADE80]">
            Standalone
          </span>
        )}
      </div>

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
    </div>
  );
}