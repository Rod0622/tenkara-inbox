"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  Check,
  CheckCircle,
  ChevronDown,
  Circle,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  Forward,
  GitBranch,
  Mail,
  MessageSquare,
  Plus,
  Reply,
  Send,
  Star,
  Tag,
  Trash2,
  User,
  X,
} from "lucide-react";
import {
  useConversationDetail,
  useFolders,
  useLabels,
  useRelatedThreads,
  useThreadSummary,
} from "@/lib/hooks";
import type { ConversationDetailProps, TeamMember } from "@/types";

function normalizeSuggestedTaskText(value: string) {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function Avatar({
  initials,
  color,
  size = 28,
}: {
  initials: string;
  color: string;
  size?: number;
}) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold text-[#0B0E11] flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38, background: color }}
    >
      {initials}
    </div>
  );
}

function AssignDropdown({
  currentAssignee,
  currentUser,
  teamMembers,
  onAssign,
  conversationId,
}: {
  currentAssignee: TeamMember | null | undefined;
  currentUser: TeamMember | null;
  teamMembers: TeamMember[];
  onAssign: (
    conversationId: string,
    assigneeId: string | null,
    updatedConversation?: any
  ) => Promise<void>;
  conversationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const handleAssign = async (memberId: string | null) => {
    setAssigning(true);
    try {
      const res = await fetch("/api/conversations/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          assignee_id: memberId,
          actor_id: currentUser?.id,
        }),
      });
      const result = await res.json().catch(() => ({}));
      await onAssign(conversationId, memberId, result.conversation);
    } catch (error) {
      console.error("Assign failed:", error);
    } finally {
      setAssigning(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      {currentAssignee ? (
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={assigning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[12px] font-medium hover:bg-[#181D24] transition-all"
        >
          <Avatar initials={currentAssignee.initials} color={currentAssignee.color} size={18} />
          <span style={{ color: currentAssignee.color }}>{currentAssignee.name}</span>
          <ChevronDown size={12} className="text-[#484F58]" />
        </button>
      ) : (
        <div className="flex">
          <button
            onClick={() => currentUser && handleAssign(currentUser.id)}
            disabled={assigning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg border border-[#1E242C] border-r-0 bg-[#12161B] text-[12px] font-medium hover:bg-[#181D24] transition-all"
          >
            <User size={14} className="text-[#4ADE80]" />
            <span className="text-[#E6EDF3]">{assigning ? "Assigning..." : "Assign to me"}</span>
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            className="px-2 py-1.5 rounded-r-lg border border-[#1E242C] bg-[#12161B] hover:bg-[#181D24] transition-all"
          >
            <ChevronDown size={12} className="text-[#484F58]" />
          </button>
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1">
          <div className="px-3 py-2 border-b border-[#1E242C]">
            <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
              Assign to team member
            </div>
          </div>

          {currentAssignee && (
            <button
              onClick={() => handleAssign(null)}
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[#F85149] hover:bg-[#1E242C]"
            >
              <X size={14} />
              Unassign
            </button>
          )}

          {teamMembers
            .filter((m) => m.is_active !== false)
            .map((member) => {
              const active = currentAssignee?.id === member.id;
              return (
                <button
                  key={member.id}
                  onClick={() => handleAssign(member.id)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] hover:bg-[#1E242C] ${
                    active ? "text-[#4ADE80]" : "text-[#E6EDF3]"
                  }`}
                >
                  <Avatar initials={member.initials} color={member.color} size={20} />
                  <div className="flex-1 text-left">
                    <div className="font-medium">
                      {member.name}
                      {member.id === currentUser?.id && (
                        <span className="text-[10px] text-[#484F58] ml-1">(me)</span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#484F58]">{member.department}</div>
                  </div>
                  {active && <Check size={14} className="text-[#4ADE80]" />}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

function LabelPicker({
  conversationId,
  currentLabels,
  onToggle,
}: {
  conversationId: string;
  currentLabels: { label_id: string; label?: any }[];
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const allLabels = useLabels();
  const ref = useRef<HTMLDivElement>(null);
  const [localLabelIds, setLocalLabelIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLocalLabelIds(new Set(currentLabels.map((cl) => cl.label_id)));
  }, [currentLabels]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggleLabel = async (labelId: string) => {
    const add = !localLabelIds.has(labelId);

    setLocalLabelIds((prev) => {
      const next = new Set(prev);
      if (add) next.add(labelId);
      else next.delete(labelId);
      return next;
    });

    try {
      await fetch("/api/conversations/labels", {
        method: add ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, labelId }),
      });
      onToggle();
    } catch (error) {
      console.error("Label toggle failed:", error);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md border border-[#1E242C] bg-[#12161B] text-[11px] font-medium text-[#7D8590] hover:bg-[#181D24]"
      >
        <Tag size={12} />
        <span>Labels</span>
        <ChevronDown size={10} className="text-[#484F58]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1">
          <div className="px-3 py-2 border-b border-[#1E242C]">
            <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
              Toggle labels
            </div>
          </div>

          {allLabels.map((label) => {
            const active = localLabelIds.has(label.id);
            return (
              <button
                key={label.id}
                onClick={() => toggleLabel(label.id)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] hover:bg-[#1E242C]"
              >
                <div
                  className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center ${
                    active ? "border-transparent" : "border-[#484F58]"
                  }`}
                  style={active ? { background: label.color } : {}}
                >
                  {active && <Check size={10} className="text-[#0B0E11]" />}
                </div>
                <span className="w-2 h-2 rounded-full" style={{ background: label.color }} />
                <span className={active ? "text-[#E6EDF3] font-medium" : "text-[#7D8590]"}>
                  {label.name}
                </span>
              </button>
            );
          })}

          {allLabels.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-[#484F58] text-center">
              No labels yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MoveToFolderDropdown({
  conversationId,
  currentFolderId,
  onMove,
}: {
  conversationId: string;
  currentFolderId: string | null;
  onMove: (conversationIds: string[], folderId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const allFolders = useFolders();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const move = async (folderId: string) => {
    await onMove([conversationId], folderId);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md border border-[#1E242C] bg-[#12161B] text-[11px] font-medium text-[#7D8590] hover:bg-[#181D24]"
      >
        <FolderOpen size={12} />
        <span>Move to</span>
        <ChevronDown size={10} className="text-[#484F58]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1 max-h-[320px] overflow-y-auto">
          <div className="px-3 py-2 border-b border-[#1E242C]">
            <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
              Move to folder
            </div>
          </div>

          {allFolders.map((folder) => {
            const active = folder.id === currentFolderId;
            return (
              <button
                key={folder.id}
                onClick={() => !active && move(folder.id)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-[12px] ${
                  active
                    ? "text-[#4ADE80] bg-[rgba(74,222,128,0.06)]"
                    : "text-[#7D8590] hover:bg-[#1E242C]"
                }`}
              >
                <span className="text-[13px]">{folder.icon || "📁"}</span>
                <span className="flex-1 text-left truncate">{folder.name}</span>
                {active && <Check size={12} className="text-[#4ADE80]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamChat({
  conversationId,
  currentUser,
  teamMembers,
}: {
  conversationId: string;
  currentUser: TeamMember | null;
  teamMembers: TeamMember[];
}) {
  const [comments, setComments] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/comments?conversation_id=${conversationId}`);
      if (!res.ok) return;
      const data = await res.json();
      setComments(data.comments || []);
    } catch (error) {
      console.error("Failed to fetch comments:", error);
    }
  };

  useEffect(() => {
    if (!conversationId) return;
    fetchComments();
    const id = setInterval(fetchComments, 5000);
    return () => clearInterval(id);
  }, [conversationId]);

  const sendComment = async () => {
    if (!input.trim() || !currentUser) return;
    setSending(true);
    try {
      await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          author_id: currentUser.id,
          body: input.trim(),
          mentions: [],
        }),
      });
      setInput("");
      fetchComments();
    } catch (error) {
      console.error("Failed to send comment:", error);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border-t border-[#161B22]">
      <div className="px-4 py-3 border-b border-[#161B22] flex items-center gap-2 text-[11px] text-[#7D8590] uppercase tracking-wider">
        <MessageSquare size={12} />
        <span>Team Chat</span>
        <span className="text-[#484F58] normal-case">(internal — not visible to sender)</span>
      </div>

      <div className="h-[110px] overflow-y-auto px-4 py-3">
        {comments.length === 0 ? (
          <div className="text-center text-[12px] text-[#484F58] pt-6">
            No team discussion yet. Start a conversation about this thread.
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => {
              const author =
                comment.author ||
                teamMembers.find((member) => member.id === comment.author_id) ||
                null;

              return (
                <div key={comment.id} className="flex items-start gap-2">
                  {author ? (
                    <Avatar initials={author.initials} color={author.color} size={20} />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-[#30363D]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[11px] font-semibold"
                        style={{ color: author?.color || "#E6EDF3" }}
                      >
                        {author?.name || "Unknown"}
                      </span>
                      <span className="text-[10px] text-[#484F58]">
                        {comment.created_at
                          ? new Date(comment.created_at).toLocaleString()
                          : ""}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#E6EDF3] whitespace-pre-wrap">
                      {comment.body}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-[#161B22]">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendComment();
              }
            }}
            placeholder="@ Chat with your team..."
            className="flex-1 h-10 rounded-lg bg-[#0B0E11] border border-[#1E242C] px-3 text-[13px] text-[#E6EDF3] placeholder:text-[#484F58] outline-none focus:border-[#30363D]"
          />
          <button
            onClick={sendComment}
            disabled={sending || !input.trim()}
            className="w-10 h-10 rounded-lg bg-[#12161B] border border-[#1E242C] text-[#7D8590] hover:bg-[#181D24] disabled:opacity-50 flex items-center justify-center"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

function ActivityItem({
  activity,
  teamMembers,
}: {
  activity: any;
  teamMembers: TeamMember[];
}) {
  const actor =
    activity.actor ||
    teamMembers.find((member) => member.id === activity.actor_id) ||
    null;

  const actionMap: Record<string, { label: string; color: string; icon: any }> = {
    viewed: { label: "Viewed", color: "#58A6FF", icon: Eye },
    assigned: { label: "Assigned", color: "#4ADE80", icon: User },
    unassigned: { label: "Unassigned", color: "#F0883E", icon: User },
    note_created: { label: "Note added", color: "#A371F7", icon: MessageSquare },
    task_created: { label: "Task created", color: "#58A6FF", icon: Plus },
    task_completed: { label: "Task completed", color: "#4ADE80", icon: CheckCircle },
    task_reopened: { label: "Task reopened", color: "#F5D547", icon: Circle },
    task_deleted: { label: "Task deleted", color: "#F85149", icon: Trash2 },
    reply_sent: { label: "Reply sent", color: "#4ADE80", icon: Send },
  };

  const config = actionMap[activity.action] || {
    label: activity.action || "Activity",
    color: "#7D8590",
    icon: MessageSquare,
  };
  const Icon = config.icon;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-[#161B22] last:border-b-0">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `${config.color}20`, color: config.color }}
      >
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold" style={{ color: config.color }}>
          {config.label}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-[#484F58]">
          {actor && (
            <>
              <Avatar initials={actor.initials} color={actor.color} size={16} />
              <span style={{ color: actor.color }}>{actor.name}</span>
            </>
          )}
          <span>
            {activity.created_at ? new Date(activity.created_at).toLocaleString() : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ConversationDetail({
  conversation: convo,
  currentUser,
  teamMembers,
  onAddNote,
  onToggleTask,
  onAddTask,
  onUpdateTask,
  onAssign,
  onSendReply,
  onMoveToFolder,
}: ConversationDetailProps) {
  const [replyText, setReplyText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [showTaskInput, setShowTaskInput] = useState(false);
  const [activeTab, setActiveTab] = useState("messages");
  const [sending, setSending] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskAssigneeIds, setNewTaskAssigneeIds] = useState<string[]>([]);
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [creatingSuggestedTasks, setCreatingSuggestedTasks] = useState<string[]>([]);
  const [creatingAllSuggestedTasks, setCreatingAllSuggestedTasks] = useState(false);

  const {
    notes,
    tasks,
    messages,
    activities,
    refetch: refetchDetail,
  } = useConversationDetail(convo?.id || null);

  const {
    threads: relatedThreads,
    externalEmail,
    summary,
    loading: relatedThreadsLoading,
  } = useRelatedThreads(convo?.id || null);

  const {
    summary: threadSummary,
    loading: threadSummaryLoading,
    generating: threadSummaryGenerating,
    generateSummary,
  } = useThreadSummary(convo?.id || null);

  useEffect(() => {
    setActiveTab("messages");
    setShowNoteInput(false);
    setShowTaskInput(false);
    setReplyText("");
    setNoteText("");
    setNewTaskText("");
    setNewTaskAssigneeIds([]);
    setNewTaskDueDate("");
  }, [convo?.id]);

  useEffect(() => {
    if (!convo?.id) return;

    if (currentUser?.id) {
      fetch("/api/conversations/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          actor_id: currentUser.id,
          action: "viewed",
          details: {},
        }),
      }).catch(() => {});
    }

    if (convo.is_unread) {
      fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          is_unread: false,
          actor_id: currentUser?.id,
        }),
      }).catch(() => {});
    }
  }, [convo?.id, convo?.is_unread, currentUser?.id]);

  const assignee = useMemo(
    () => convo?.assignee || teamMembers.find((member) => member.id === convo?.assignee_id),
    [convo, teamMembers]
  );

  const tabs = [
    { id: "messages", label: "Messages", count: messages.length },
    { id: "notes", label: "Notes", count: notes.length },
    { id: "tasks", label: "Tasks", count: tasks.length },
    { id: "activity", label: "Activity", count: activities.length },
    { id: "related", label: "Related Threads", count: relatedThreads.length },
    { id: "summary", label: "Summary", count: 0 },
  ];

  const isReviewTab = activeTab !== "messages";

  const getTaskAssignees = (task: any) =>
    task.assignees?.length ? task.assignees : task.assignee ? [task.assignee] : [];

  const handleAddNoteInternal = async () => {
    if (!convo || !noteText.trim()) return;
    await onAddNote(convo.id, noteText.trim());
    setNoteText("");
    setShowNoteInput(false);
    await refetchDetail();
  };

  const handleAddTaskInternal = async () => {
    if (!convo || !newTaskText.trim()) return;

    await onAddTask(
      convo.id,
      newTaskText.trim(),
      newTaskAssigneeIds.length > 0
        ? newTaskAssigneeIds
        : currentUser?.id
          ? [currentUser.id]
          : [],
      newTaskDueDate || undefined
    );

    await refetchDetail();
    setActiveTab("tasks");
    setNewTaskText("");
    setNewTaskAssigneeIds([]);
    setNewTaskDueDate("");
    setShowTaskInput(false);
  };

  const handleSendReplyInternal = async () => {
    if (!convo || !replyText.trim()) return;
    setSending(true);
    try {
      await onSendReply(convo.id, replyText.trim());
      setReplyText("");
      await refetchDetail();
    } finally {
      setSending(false);
    }
  };

  const handleToggleRead = async () => {
    if (!convo) return;
    try {
      await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          is_unread: !convo.is_unread,
        }),
      });
    } catch (error) {
      console.error("Toggle read failed:", error);
    }
  };

  const handleToggleStar = async () => {
    if (!convo) return;
    try {
      await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          is_starred: !convo.is_starred,
        }),
      });
    } catch (error) {
      console.error("Toggle star failed:", error);
    }
  };

  const existingTaskTextSet = useMemo(() => {
    return new Set(
      tasks
        .map((task) => normalizeSuggestedTaskText(task?.text || ""))
        .filter(Boolean)
    );
  }, [tasks]);

  const suggestedTaskItems = useMemo(() => {
    return (threadSummary?.summary?.suggested_tasks || [])
      .filter((item: string) => typeof item === "string" && item.trim())
      .map((item: string, index: number) => {
        const normalizedText = normalizeSuggestedTaskText(item);
        return {
          id: `${normalizedText || item}-${index}`,
          text: item.trim(),
          normalizedText,
          alreadyCreated: existingTaskTextSet.has(normalizedText),
        };
      });
  }, [threadSummary?.summary?.suggested_tasks, existingTaskTextSet]);

  type SuggestedTaskItem = {
  id: string;
  text: string;
  normalizedText: string;
  alreadyCreated: boolean;
};

const suggestedTaskItems = useMemo<SuggestedTaskItem[]>(() => {
  return (threadSummary?.summary?.suggested_tasks || [])
    .filter((item: string) => typeof item === "string" && item.trim())
    .map((item: string, index: number) => {
      const normalizedText = normalizeSuggestedTaskText(item);
      return {
        id: `${normalizedText || item}-${index}`,
        text: item.trim(),
        normalizedText,
        alreadyCreated: existingTaskTextSet.has(normalizedText),
      };
    });
}, [threadSummary?.summary?.suggested_tasks, existingTaskTextSet]);

const pendingSuggestedTaskItems = useMemo<SuggestedTaskItem[]>(
  () => suggestedTaskItems.filter((item) => !item.alreadyCreated),
  [suggestedTaskItems]
);

  const createSuggestedTask = async (taskText: string) => {
    if (!convo || !taskText.trim()) return;

    try {
      setCreatingSuggestedTasks((prev) => [...prev, taskText]);

      await onAddTask(
        convo.id,
        taskText.trim(),
        currentUser?.id ? [currentUser.id] : [],
        undefined
      );

      await refetchDetail();
    } finally {
      setCreatingSuggestedTasks((prev) => prev.filter((item) => item !== taskText));
    }
  };

  const createAllSuggestedTasks = async () => {
    if (!convo) return;

    const tasksToCreate = pendingSuggestedTaskItems.map((item) => item.text);

    if (tasksToCreate.length === 0) return;

    try {
      setCreatingAllSuggestedTasks(true);
      for (const taskText of tasksToCreate) {
        await onAddTask(
          convo.id,
          taskText.trim(),
          currentUser?.id ? [currentUser.id] : [],
          undefined
        );
      }
      await refetchDetail();
    } finally {
      setCreatingAllSuggestedTasks(false);
    }
  };

  if (!convo) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-[#484F58] bg-[#0B0E11]">
        <div className="w-16 h-16 rounded-2xl bg-[#12161B] flex items-center justify-center">
          <Mail size={24} />
        </div>
        <div className="text-[15px] font-medium">Select a conversation</div>
        <div className="text-xs">Choose from the list to view details</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#0B0E11] overflow-hidden">
      <div className="px-5 py-3 border-b border-[#1E242C] flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-[#E6EDF3] truncate tracking-tight mb-1">
            {convo.subject}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-[#7D8590]">{convo.from_name}</span>
            <span className="text-[#484F58]">&lt;{convo.from_email}&gt;</span>
          </div>

          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {(convo.labels || []).map(
              (cl) =>
                cl.label && (
                  <span
                    key={cl.label_id || cl.label?.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold"
                    style={{ background: cl.label.bg_color, color: cl.label.color }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: cl.label.color }}
                    />
                    {cl.label.name}
                  </span>
                )
            )}

            <LabelPicker
              conversationId={convo.id}
              currentLabels={convo.labels || []}
              onToggle={() => {}}
            />

            {onMoveToFolder && (
              <MoveToFolderDropdown
                conversationId={convo.id}
                currentFolderId={convo.folder_id}
                onMove={onMoveToFolder}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <AssignDropdown
            currentAssignee={assignee}
            currentUser={currentUser}
            teamMembers={teamMembers}
            onAssign={onAssign}
            conversationId={convo.id}
          />

          <div className="flex gap-1">
            <button
              onClick={handleToggleStar}
              title={convo.is_starred ? "Unstar" : "Star"}
              className={`w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] flex items-center justify-center hover:bg-[#181D24] ${
                convo.is_starred ? "text-[#F5D547]" : "text-[#7D8590]"
              }`}
            >
              <Star size={16} fill={convo.is_starred ? "#F5D547" : "none"} />
            </button>

            <button
              onClick={handleToggleRead}
              title={convo.is_unread ? "Mark as read" : "Mark as unread"}
              className="w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] flex items-center justify-center hover:bg-[#181D24]"
            >
              {convo.is_unread ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>

            {[Reply, Forward, Archive].map((Icon, idx) => (
              <button
                key={idx}
                className="w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] flex items-center justify-center hover:bg-[#181D24]"
              >
                <Icon size={16} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex border-b border-[#161B22] px-5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2.5 text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === tab.id
                ? "text-[#4ADE80] border-b-2 border-[#4ADE80]"
                : "text-[#484F58] border-b-2 border-transparent"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0 rounded font-bold ${
                  activeTab === tab.id
                    ? "bg-[rgba(74,222,128,0.12)] text-[#4ADE80]"
                    : "bg-[#1E242C] text-[#484F58]"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        className={`${
          isReviewTab ? "flex-1 overflow-hidden px-5 py-4" : "flex-1 overflow-y-auto px-5 py-4"
        }`}
      >
        {activeTab === "messages" && (
          <>
            {messages.map((msg: any) => (
              <div
                key={msg.id}
                className={`mb-4 p-4 rounded-xl border ${
                  msg.is_outbound
                    ? "bg-[rgba(74,222,128,0.04)] border-[rgba(74,222,128,0.1)]"
                    : "bg-[#12161B] border-[#161B22]"
                }`}
              >
                <div className="flex items-center gap-2 mb-2.5">
                  <Avatar
                    initials={(msg.from_name || "?").slice(0, 2).toUpperCase()}
                    color={msg.is_outbound ? "#4ADE80" : "#58A6FF"}
                  />
                  <div className="flex-1">
                    <span className="text-[13px] font-semibold text-[#E6EDF3]">
                      {msg.from_name}
                      {msg.is_outbound && (
                        <span className="text-[10px] text-[#4ADE80] ml-2">Sent</span>
                      )}
                    </span>
                    <span className="text-[11px] text-[#484F58] ml-2">{msg.from_email}</span>
                  </div>
                  <span className="text-[11px] text-[#484F58]">
                    {msg.sent_at ? new Date(msg.sent_at).toLocaleString() : ""}
                  </span>
                </div>
                <div className="text-[13px] leading-relaxed text-[#7D8590] whitespace-pre-wrap">
                  {msg.body_text || msg.snippet || "(No text content)"}
                </div>
              </div>
            ))}

            {messages.length === 0 && (
              <div className="text-center py-10 text-[#484F58] text-sm">
                No messages yet. Click the sync button in the sidebar to fetch emails.
              </div>
            )}
          </>
        )}

        {activeTab === "notes" && (
          <div className="h-full overflow-y-auto pr-2 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[#E6EDF3]">Internal Notes</div>
              <button
                onClick={() => setShowNoteInput((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[12px] font-semibold text-[#58A6FF] hover:bg-[#181D24]"
              >
                <Plus size={13} />
                New note
              </button>
            </div>

            {showNoteInput && (
              <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Write an internal note..."
                  rows={4}
                  className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none"
                />
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => {
                      setShowNoteInput(false);
                      setNoteText("");
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-[#7D8590] text-sm hover:bg-[#181D24]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddNoteInternal}
                    className="px-3 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-sm font-semibold hover:bg-[#3FCF73]"
                  >
                    Save note
                  </button>
                </div>
              </div>
            )}

            {notes.length === 0 && (
              <div className="text-center py-10 text-[#484F58] text-sm">No notes yet</div>
            )}

            {notes.map((note: any) => {
              const author =
                note.author || teamMembers.find((member) => member.id === note.author_id) || null;
              return (
                <div key={note.id} className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                  <div className="flex items-center gap-2 mb-2">
                    {author ? (
                      <Avatar initials={author.initials} color={author.color} size={20} />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-[#30363D]" />
                    )}
                    <div className="text-[12px]">
                      <span
                        className="font-semibold"
                        style={{ color: author?.color || "#E6EDF3" }}
                      >
                        {author?.name || "Unknown"}
                      </span>
                      <span className="text-[#484F58] ml-2">
                        {note.created_at ? new Date(note.created_at).toLocaleString() : ""}
                      </span>
                    </div>
                  </div>
                  <div className="text-[13px] text-[#E6EDF3] whitespace-pre-wrap">{note.text}</div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="h-full overflow-y-auto pr-2 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[#E6EDF3]">Thread Tasks</div>
              <button
                onClick={() => setShowTaskInput((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[12px] font-semibold text-[#58A6FF] hover:bg-[#181D24]"
              >
                <Plus size={13} />
                New task
              </button>
            </div>

            {showTaskInput && (
              <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4 space-y-3">
                <textarea
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  placeholder="What needs to be done?"
                  rows={3}
                  className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none"
                />

                <input
                  type="date"
                  value={newTaskDueDate}
                  onChange={(e) => setNewTaskDueDate(e.target.value)}
                  className="h-10 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 text-sm text-[#E6EDF3] outline-none"
                />

                <div className="rounded-lg border border-[#1E242C] bg-[#0B0E11] p-3 space-y-2 max-h-36 overflow-y-auto">
                  {teamMembers
                    .filter((member) => member.is_active !== false)
                    .map((member) => {
                      const checked = newTaskAssigneeIds.includes(member.id);
                      return (
                        <label key={member.id} className="flex items-center gap-2 text-sm text-[#E6EDF3]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              setNewTaskAssigneeIds((prev) =>
                                e.target.checked
                                  ? [...prev, member.id]
                                  : prev.filter((id) => id !== member.id)
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

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowTaskInput(false);
                      setNewTaskText("");
                      setNewTaskAssigneeIds([]);
                      setNewTaskDueDate("");
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-[#7D8590] text-sm hover:bg-[#181D24]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddTaskInternal}
                    className="px-3 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-sm font-semibold hover:bg-[#3FCF73]"
                  >
                    Create task
                  </button>
                </div>
              </div>
            )}

            {tasks.length === 0 && (
              <div className="text-center py-10 text-[#484F58] text-sm">
                No tasks for this conversation
              </div>
            )}

            {tasks.map((task: any) => {
              const assignees = getTaskAssignees(task);

              return (
                <div key={task.id} className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => onToggleTask(task.id, !(task.status === "completed" || task.is_done))}
                      className="mt-0.5"
                    >
                      {task.status === "completed" || task.is_done ? (
                        <CheckCircle size={18} className="text-[#4ADE80]" />
                      ) : (
                        <Circle size={18} className="text-[#7D8590]" />
                      )}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium ${
                          task.status === "completed" || task.is_done
                            ? "text-[#7D8590] line-through"
                            : "text-[#E6EDF3]"
                        }`}
                      >
                        {task.text}
                      </div>

                      <div className="flex flex-wrap gap-2 mt-2">
                        <select
                          value={task.status || (task.is_done ? "completed" : "todo")}
                          onChange={(e) =>
                            onUpdateTask(task.id, { status: e.target.value as any })
                          }
                          className="h-8 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-2 text-[12px] text-[#E6EDF3] outline-none"
                        >
                          <option value="todo">To do</option>
                          <option value="in_progress">In progress</option>
                          <option value="completed">Completed</option>
                        </select>

                        {task.due_date && (
                          <span className="inline-flex items-center rounded-full px-2 py-1 text-[11px] bg-[rgba(245,213,71,0.12)] text-[#F5D547]">
                            Due: {task.due_date}
                          </span>
                        )}

                        {assignees.map((member: TeamMember) => (
                          <span
                            key={member.id}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px]"
                            style={{
                              background: `${member.color}20`,
                              color: member.color,
                            }}
                          >
                            <Avatar initials={member.initials} color={member.color} size={16} />
                            {member.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "activity" && (
          <div className="h-full overflow-y-auto pr-2 space-y-0.5">
            {activities.length === 0 && (
              <div className="text-center py-10 text-[#484F58] text-sm">
                No activity recorded yet
              </div>
            )}
            {activities.map((activity: any) => (
              <ActivityItem key={activity.id} activity={activity} teamMembers={teamMembers} />
            ))}
          </div>
        )}

        {activeTab === "related" && (
          <div className="h-full overflow-y-auto pr-2">
            {summary && (
              <div className="mb-4 rounded-xl border border-[#1E242C] bg-[#0F1318] p-4">
                <div className="text-sm font-semibold text-[#E6EDF3] mb-2">Supplier Contact</div>
                <div className="text-xs text-[#7D8590] mb-3">{externalEmail}</div>

                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="px-2 py-1 rounded bg-[#12161B] border border-[#1E242C]">
                    Threads: {summary.total_threads}
                  </span>
                  <span className="px-2 py-1 rounded bg-[#12161B] border border-[#1E242C] text-[#4ADE80]">
                    Open: {summary.open_threads}
                  </span>
                  <span className="px-2 py-1 rounded bg-[#12161B] border border-[#1E242C] text-[#F87171]">
                    Closed: {summary.closed_threads}
                  </span>
                  {summary.last_activity && (
                    <span className="px-2 py-1 rounded bg-[#12161B] border border-[#1E242C]">
                      Last activity:{" "}
                      {new Date(summary.last_activity).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mb-3 rounded-xl border border-[#1E242C] bg-[#12161B] px-4 py-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-[#E6EDF3]">
                <GitBranch size={14} className="text-[#58A6FF]" />
                Related threads in this shared account
              </div>
              <div className="mt-1 text-[11px] text-[#7D8590]">
                {externalEmail
                  ? `Showing threads where the outside contact is ${externalEmail}`
                  : "We could not determine the outside contact for this thread."}
              </div>
            </div>

            {relatedThreadsLoading && (
              <div className="text-center py-10 text-[#484F58] text-sm">
                Loading related threads...
              </div>
            )}

            {!relatedThreadsLoading && relatedThreads.length === 0 && (
              <div className="text-center py-10 text-[#484F58] text-sm">
                No related threads found for this contact in this shared account
              </div>
            )}

            {!relatedThreadsLoading &&
              relatedThreads.map((thread: any) => {
                const sameSubject =
                  String(thread.subject || "").trim().toLowerCase() ===
                  String(convo.subject || "").trim().toLowerCase();

                const href = `/#conversation=${thread.id}&mailbox=${thread.email_account_id || ""}&folder=${thread.folder_id || ""}`;

                return (
                  <div
                    key={thread.id}
                    className="rounded-xl border border-[#1E242C] bg-[#12161B] p-3 mb-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {thread.is_unread && (
                            <span className="w-2 h-2 rounded-full bg-[#4ADE80]" />
                          )}
                          <div className="text-[13px] font-semibold text-[#E6EDF3] truncate">
                            {thread.subject || "(No subject)"}
                          </div>
                          {sameSubject && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[rgba(245,213,71,0.12)] text-[#F5D547]">
                              Possible duplicate
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-[#7D8590] mb-2 truncate">
                          {thread.preview || "No preview available"}
                        </div>

                        <div className="flex flex-wrap gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#0B0E11] px-2 py-1 text-[#7D8590] border border-[#1E242C]">
                            Status: {thread.status || "open"}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#0B0E11] px-2 py-1 text-[#7D8590] border border-[#1E242C]">
                            Folder: {thread.folder?.name || "Inbox"}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[#0B0E11] px-2 py-1 text-[#7D8590] border border-[#1E242C]">
                            Last activity:{" "}
                            {thread.last_message_at
                              ? new Date(thread.last_message_at).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })
                              : "Unknown"}
                          </span>
                        </div>

                        {(thread.labels || []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {thread.labels.map((cl: any) =>
                              cl.label ? (
                                <span
                                  key={`${thread.id}-${cl.label_id || cl.label?.id}`}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold"
                                  style={{
                                    background: cl.label.bg_color,
                                    color: cl.label.color,
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full"
                                    style={{ background: cl.label.color }}
                                  />
                                  {cl.label.name}
                                </span>
                              ) : null
                            )}
                          </div>
                        )}
                      </div>

                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#0B0E11] text-[11px] font-semibold text-[#58A6FF] hover:bg-[#181D24] shrink-0"
                      >
                        <ExternalLink size={13} />
                        Open
                      </a>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {activeTab === "summary" && (
          <div className="h-full overflow-y-auto pr-2 pb-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[#E6EDF3]">Thread Summary</div>
                <div className="text-xs text-[#7D8590]">
                  AI-generated review of this conversation
                </div>
              </div>

              <button
                type="button"
                onClick={() => generateSummary(true)}
                disabled={threadSummaryGenerating}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[12px] font-semibold text-[#58A6FF] hover:bg-[#181D24] disabled:opacity-60"
              >
                {threadSummaryGenerating ? "Refreshing..." : "Refresh Summary"}
              </button>
            </div>

            {threadSummaryLoading && (
              <div className="text-center py-10 text-[#484F58] text-sm">Loading summary...</div>
            )}

            {!threadSummaryLoading && !threadSummary && (
              <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                <div className="text-sm text-[#E6EDF3] mb-2">No summary yet for this thread</div>
                <div className="text-xs text-[#7D8590] mb-4">
                  Generate a cached AI summary with status, intent, action items, completed items,
                  and next step.
                </div>
                <button
                  type="button"
                  onClick={() => generateSummary(false)}
                  disabled={threadSummaryGenerating}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-[12px] font-semibold hover:bg-[#3FCF73] disabled:opacity-60"
                >
                  {threadSummaryGenerating ? "Generating..." : "Generate Summary"}
                </button>
              </div>
            )}

            {!threadSummaryLoading && threadSummary?.summary && (
              <div className="space-y-3">
                <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-2">
                    Overview
                  </div>
                  <div className="text-sm text-[#E6EDF3] leading-6">
                    {threadSummary.summary.overview || "No overview available"}
                  </div>
                </div>

                <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-2">
                    Current Status
                  </div>
                  <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-[rgba(88,166,255,0.12)] text-[#58A6FF]">
                    {threadSummary.summary.status || "Unknown"}
                  </div>
                </div>

                <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-2">
                    Supplier Intent
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-[rgba(245,213,71,0.12)] text-[#F5D547]">
                      {threadSummary.summary.intent
                        ? threadSummary.summary.intent.replace(/_/g, " ")
                        : "general inquiry"}
                    </span>

                    <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-[rgba(88,166,255,0.12)] text-[#58A6FF]">
                      Confidence: {threadSummary.summary.confidence || "medium"}
                    </span>
                  </div>

                  {threadSummary.summary.secondary_intents?.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[#7D8590] mb-2">
                        Secondary intents
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {threadSummary.summary.secondary_intents.map(
                          (intent: string, index: number) => (
                            <span
                              key={index}
                              className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[#0B0E11] border border-[#1E242C] text-[#E6EDF3]"
                            >
                              {intent.replace(/_/g, " ")}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-2">
                    Open Action Items
                  </div>
                  {threadSummary.summary.open_action_items?.length > 0 ? (
                    <ul className="space-y-2">
                      {threadSummary.summary.open_action_items.map(
                        (item: string, index: number) => (
                          <li
                            key={index}
                            className="text-sm text-[#E6EDF3] flex items-start gap-2"
                          >
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#F5D547]" />
                            <span>{item}</span>
                          </li>
                        )
                      )}
                    </ul>
                  ) : (
                    <div className="text-sm text-[#7D8590]">No open action items detected</div>
                  )}
                </div>

                <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[#7D8590]">
                      Suggested Tasks
                    </div>

                    {pendingSuggestedTaskItems.length > 1 && (
                      <button
                        type="button"
                        onClick={createAllSuggestedTasks}
                        disabled={creatingAllSuggestedTasks}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#0B0E11] text-[11px] font-semibold text-[#4ADE80] hover:bg-[#181D24] disabled:opacity-60"
                      >
                        {creatingAllSuggestedTasks ? "Creating..." : "Create All"}
                      </button>
                    )}
                  </div>

                  {suggestedTaskItems.length > 0 ? (
                    <div className="space-y-2">
                      {suggestedTaskItems.map((item) => {
                        const isCreating = creatingSuggestedTasks.includes(item.text);

                        return (
                          <div
                            key={item.id}
                            className="flex items-start justify-between gap-3 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-[#E6EDF3]">{item.text}</div>
                              {item.alreadyCreated && (
                                <div className="mt-1 text-[11px] font-medium text-[#4ADE80]">
                                  Already created in thread tasks
                                </div>
                              )}
                            </div>

                            {item.alreadyCreated ? (
                              <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[11px] font-semibold text-[#4ADE80] shrink-0">
                                Created
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => createSuggestedTask(item.text)}
                                disabled={isCreating || creatingAllSuggestedTasks}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-[11px] font-semibold hover:bg-[#3FCF73] disabled:opacity-60 shrink-0"
                              >
                                {isCreating ? "Creating..." : "Create"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-sm text-[#7D8590]">No suggested tasks generated</div>
                  )}
                </div>

                <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-2">
                    Completed Items
                  </div>
                  {threadSummary.summary.completed_items?.length > 0 ? (
                    <ul className="space-y-2">
                      {threadSummary.summary.completed_items.map(
                        (item: string, index: number) => (
                          <li
                            key={index}
                            className="text-sm text-[#E6EDF3] flex items-start gap-2"
                          >
                            <span className="mt-1 text-[#4ADE80]">✓</span>
                            <span>{item}</span>
                          </li>
                        )
                      )}
                    </ul>
                  ) : (
                    <div className="text-sm text-[#7D8590]">No completed items detected</div>
                  )}
                </div>

                <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[#7D8590] mb-2">
                    Next Step
                  </div>
                  <div className="text-sm text-[#E6EDF3]">
                    {threadSummary.summary.next_step || "No next step identified"}
                  </div>
                </div>

                <div className="text-[11px] text-[#484F58] px-1">
                  Last generated:{" "}
                  {threadSummary.generated_at
                    ? new Date(threadSummary.generated_at).toLocaleString()
                    : "Unknown"}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!isReviewTab && (
        <div className="px-5 py-3 border-t border-[#161B22]">
          <div className="flex items-center gap-2">
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder="Write a reply..."
              rows={2}
              className="flex-1 rounded-xl border border-[#1E242C] bg-[#0B0E11] px-4 py-3 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none resize-none"
            />
            <button
              onClick={handleSendReplyInternal}
              disabled={sending || !replyText.trim()}
              className="w-12 h-12 rounded-xl bg-[#12161B] border border-[#1E242C] text-[#7D8590] hover:bg-[#181D24] disabled:opacity-50 flex items-center justify-center"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      )}

      {!isReviewTab && (
        <TeamChat
          conversationId={convo.id}
          currentUser={currentUser}
          teamMembers={teamMembers}
        />
      )}
    </div>
  );
}