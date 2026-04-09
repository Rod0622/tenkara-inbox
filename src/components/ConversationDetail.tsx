"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  Archive,
  Ban,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Circle,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileText,
  FolderOpen,
  Forward,
  GitBranch,
  Image,
  Loader2,
  Mail,
  MessageSquare,
  Paperclip,
  Phone,
  Pencil,
  Plus,
  Reply,
  RotateCcw,
  Search,
  Send,
  Star,
  Tag,
  Trash2,
  User,
  Users,
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
import { createBrowserClient } from "@/lib/supabase";
import { addBusinessHours, type SupplierHours } from "@/lib/business-hours";
import TaskCountdown from "@/components/TaskCountdown";
import RichTextEditor from "@/components/RichTextEditor";

type SuggestedTaskItem = {
  id: string;
  text: string;
  normalizedText: string;
  alreadyCreated: boolean;
};

type OpenActionItemState = {
  id: string;
  text: string;
  taskMatch: any | null;
  score: number;
  state: "needs_task" | "tracked" | "completed";
};

type CompletedItemState = {
  id: string;
  text: string;
  taskMatch: any | null;
  score: number;
  state: "confirmed_completed" | "still_open" | "ai_only";
};

function normalizeSuggestedTaskText(value: string) {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}


function getNormalizedTokens(value: string) {
  return normalizeSuggestedTaskText(value)
    .split(" ")
    .filter((token) => token.length > 2);
}

function getTaskMatchMeta(itemText: string, tasks: any[]) {
  const normalizedItem = normalizeSuggestedTaskText(itemText);
  const itemTokens = getNormalizedTokens(itemText);

  let bestTask: any = null;
  let bestScore = 0;

  for (const task of tasks || []) {
    const taskText = String(task?.text || "");
    const normalizedTask = normalizeSuggestedTaskText(taskText);

    if (!normalizedTask) continue;

    if (normalizedTask === normalizedItem) {
      return {
        matchedTask: task,
        score: 1,
        isCompleted: task?.status === "completed" || task?.is_done,
      };
    }

    const taskTokens = getNormalizedTokens(taskText);
    if (itemTokens.length === 0 || taskTokens.length === 0) continue;

    const taskTokenSet = new Set(taskTokens);
    const sharedCount = itemTokens.filter((token) => taskTokenSet.has(token)).length;
    const score = sharedCount / Math.max(itemTokens.length, taskTokens.length);

    if (score > bestScore) {
      bestScore = score;
      bestTask = task;
    }
  }

  if (bestTask && bestScore >= 0.5) {
    return {
      matchedTask: bestTask,
      score: bestScore,
      isCompleted: bestTask?.status === "completed" || bestTask?.is_done,
    };
  }

  return {
    matchedTask: null,
    score: 0,
    isCompleted: false,
  };
}

// Highlight search matches in text
function HighlightedText({ text, query, matchRefs, startIndex }: {
  text: string;
  query: string;
  matchRefs: React.MutableRefObject<(HTMLElement | null)[]>;
  startIndex: number;
}) {
  if (!query.trim() || !text) return <>{text}</>;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  let matchIdx = startIndex;
  return (
    <>
      {parts.map((part, i) => {
        if (part.toLowerCase() === query.toLowerCase()) {
          const idx = matchIdx++;
          return (
            <mark
              key={i}
              ref={(el) => { matchRefs.current[idx] = el; }}
              data-match-idx={idx}
              className="bg-[#F5D547]/40 text-[#E6EDF3] rounded px-0.5"
            >
              {part}
            </mark>
          );
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function MessageHeader({ msg, convo }: { msg: any; convo: any }) {
  const [expanded, setExpanded] = useState(false);
  const toAddr = msg.to_addresses || (msg.is_outbound ? (convo.from_name ? convo.from_name + " <" + convo.from_email + ">" : convo.from_email) : "");

  return (
    <div className="flex items-start gap-2 mb-2.5">
      <Avatar
        initials={(msg.from_name || "?").slice(0, 2).toUpperCase()}
        color={msg.is_outbound ? "#4ADE80" : "#58A6FF"}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[13px] font-semibold text-[#E6EDF3]">{msg.from_name || msg.from_email}</span>
          {msg.is_outbound && <span className="text-[10px] text-[#4ADE80]">Sent</span>}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-[#484F58] truncate">
            to {toAddr ? toAddr.split(",")[0].trim() : "—"}
            {toAddr && toAddr.includes(",") ? `, +${toAddr.split(",").length - 1} more` : ""}
            {msg.cc_addresses ? `, cc: ${msg.cc_addresses.split(",")[0].trim()}` : ""}
          </span>
          <button onClick={() => setExpanded(!expanded)}
            className="text-[#484F58] hover:text-[#7D8590] flex-shrink-0 ml-0.5">
            <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
        {expanded && (
          <div className="mt-2 p-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[10px] space-y-1.5">
            <div className="flex gap-2">
              <span className="text-[#7D8590] font-semibold w-10 shrink-0">From</span>
              <span className="text-[#E6EDF3]">{msg.from_name ? `${msg.from_name} <${msg.from_email}>` : msg.from_email}</span>
            </div>
            {toAddr && (
              <div className="flex gap-2">
                <span className="text-[#7D8590] font-semibold w-10 shrink-0">To</span>
                <span className="text-[#E6EDF3] break-all">{toAddr}</span>
              </div>
            )}
            {msg.cc_addresses && (
              <div className="flex gap-2">
                <span className="text-[#7D8590] font-semibold w-10 shrink-0">Cc</span>
                <span className="text-[#E6EDF3] break-all">{msg.cc_addresses}</span>
              </div>
            )}
            {msg.bcc_addresses && (
              <div className="flex gap-2">
                <span className="text-[#7D8590] font-semibold w-10 shrink-0">Bcc</span>
                <span className="text-[#E6EDF3] break-all">{msg.bcc_addresses}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-[#7D8590] font-semibold w-10 shrink-0">Date</span>
              <span className="text-[#E6EDF3]">{msg.sent_at ? new Date(msg.sent_at).toLocaleString() : "—"}</span>
            </div>
            {msg.subject && (
              <div className="flex gap-2">
                <span className="text-[#7D8590] font-semibold w-10 shrink-0">Sub</span>
                <span className="text-[#E6EDF3]">{msg.subject}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <span className="text-[11px] text-[#484F58] flex-shrink-0">
        {msg.sent_at ? new Date(msg.sent_at).toLocaleString() : ""}
      </span>
    </div>
  );
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

// ── Call Assignment Dropdown ──────────────────────────
function CallAssignment({
  conversationId,
  tasks,
  teamMembers,
  taskCategories,
  onRefetch,
}: {
  conversationId: string;
  tasks: any[];
  teamMembers: TeamMember[];
  taskCategories: any[];
  onRefetch: () => Promise<void>;
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

  // Find callers (members with call skillset)
  const callers = teamMembers.filter((m: any) => m.has_call_skillset && m.is_active !== false);

  // Find existing call task on this thread
  const callCategory = taskCategories.find((c: any) => c.name?.toLowerCase().includes("call"));
  const existingCallTask = tasks.find((t: any) =>
    t.category_id === callCategory?.id ||
    t.text?.toLowerCase().includes("call")
  );
  const currentCaller = existingCallTask?.assignees?.[0] || 
    (existingCallTask?.assignee_id ? teamMembers.find((m) => m.id === existingCallTask.assignee_id) : null);

  const handleAssignCaller = async (member: TeamMember) => {
    setAssigning(true);
    try {
      if (existingCallTask) {
        // Update existing call task assignee
        await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: existingCallTask.id,
            assignee_ids: [member.id],
          }),
        });
        // Also update task_assignees: remove old, add new
        const { createBrowserClient } = await import("@/lib/supabase");
        const sb = createBrowserClient();
        await sb.from("task_assignees").delete().eq("task_id", existingCallTask.id);
        await sb.from("task_assignees").insert({ task_id: existingCallTask.id, team_member_id: member.id });
      } else {
        // Create new call task
        await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            text: "Call Task",
            assignee_ids: [member.id],
            status: "todo",
            category_id: callCategory?.id || undefined,
          }),
        });
      }
      await onRefetch();
    } catch (e) { console.error(e); }
    setAssigning(false);
    setOpen(false);
  };

  const handleRemoveCaller = async () => {
    if (!existingCallTask) return;
    setAssigning(true);
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_ids: [existingCallTask.id] }),
      });
      await onRefetch();
    } catch (e) { console.error(e); }
    setAssigning(false);
    setOpen(false);
  };

  if (callers.length === 0 && !currentCaller) return (
    <button
      disabled
      title="No team members have call skillset. Enable in Settings → Team Members"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[11px] font-semibold text-[#484F58] cursor-not-allowed"
    >
      <Phone size={12} />
      Call
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={assigning}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
          currentCaller
            ? "border-[rgba(88,166,255,0.3)] bg-[rgba(88,166,255,0.08)] text-[#58A6FF]"
            : "border-[#1E242C] bg-[#12161B] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#181D24]"
        }`}
      >
        <Phone size={12} />
        {assigning ? "..." : currentCaller ? (currentCaller as any).name || "Caller" : "Call"}
        <ChevronDown size={10} className="text-[#484F58]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1">
          <div className="px-3 py-2 border-b border-[#1E242C]">
            <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
              Assign caller
            </div>
          </div>

          {currentCaller && (
            <button
              onClick={handleRemoveCaller}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#F85149] hover:bg-[rgba(248,81,73,0.08)] transition-colors"
            >
              <X size={13} />
              Remove call assignment
            </button>
          )}

          {callers.map((m) => {
            const isActive = currentCaller?.id === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleAssignCaller(m)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] transition-colors ${
                  isActive ? "bg-[rgba(88,166,255,0.08)]" : "hover:bg-[#1E242C]"
                }`}
              >
                <Avatar initials={m.initials} color={m.color} size={20} />
                <span className={isActive ? "text-[#58A6FF] font-medium" : "text-[#E6EDF3]"}>{m.name}</span>
                {isActive && <Check size={13} className="text-[#58A6FF] ml-auto" />}
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

  const [isTeamChatOpen, setIsTeamChatOpen] = useState(false);

  return (
    <div className="border-t border-[#161B22] shrink-0">
      <button
        onClick={() => setIsTeamChatOpen(!isTeamChatOpen)}
        className="w-full px-4 py-2 flex items-center gap-2 text-[11px] text-[#7D8590] uppercase tracking-wider hover:bg-[#12161B] transition-colors"
      >
        <MessageSquare size={12} />
        <span>Team Chat</span>
        <span className="text-[#484F58] normal-case">(internal — not visible to sender)</span>
        {comments.length > 0 && (
          <span className="ml-auto bg-[#1E242C] text-[#7D8590] text-[10px] px-1.5 py-0.5 rounded-full font-bold">{comments.length}</span>
        )}
        <ChevronDown size={12} className={`ml-1 transition-transform ${isTeamChatOpen ? "rotate-180" : ""}`} />
      </button>

      {isTeamChatOpen && (
        <>
      <div className="h-[90px] overflow-y-auto px-4 py-2">
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
        </>
      )}
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

// ── Thread Attachment Bar (top-level summary) ───────
function ThreadAttachmentBar({ messages }: { messages: any[] }) {
  const messagesWithAttachments = messages.filter((m: any) => m.has_attachments);
  const [allAttachments, setAllAttachments] = useState<{ messageId: string; fromName: string; attachments: any[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveResult, setDriveResult] = useState<string | null>(null);
  const [downloadingAllThread, setDownloadingAllThread] = useState(false);
  const [showThreadDrivePicker, setShowThreadDrivePicker] = useState(false);
  const [threadFolders, setThreadFolders] = useState<any[]>([]);
  const [threadFolderPath, setThreadFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [threadLoadingFolders, setThreadLoadingFolders] = useState(false);
  const [threadDefaultFolderId, setThreadDefaultFolderId] = useState<string | null>(null);

  // Reset when conversation changes (messages array changes)
  const messageIds = messagesWithAttachments.map((m: any) => m.id).join(",");
  useEffect(() => {
    setAllAttachments([]);
    setLoaded(false);
    setExpanded(false);
    setDriveResult(null);
  }, [messageIds]);

  if (messagesWithAttachments.length === 0) return null;

  const loadAll = async () => {
    if (loaded) { setExpanded(!expanded); return; }
    setLoading(true);
    const results: { messageId: string; fromName: string; attachments: any[] }[] = [];
    for (const msg of messagesWithAttachments) {
      try {
        const res = await fetch(`/api/attachments?message_id=${msg.id}`);
        const data = await res.json();
        const nonInline = (data.attachments || []).filter((a: any) => !a.isInline);
        if (nonInline.length > 0) {
          results.push({ messageId: msg.id, fromName: msg.from_name || "Unknown", attachments: nonInline });
        }
      } catch (e) { /* skip */ }
    }
    setAllAttachments(results);
    setLoaded(true);
    setExpanded(true);
    setLoading(false);
  };

  const totalCount = allAttachments.reduce((sum, g) => sum + g.attachments.length, 0);

  const downloadAtt = async (messageId: string, attId: string, name: string) => {
    try {
      const res = await fetch(`/api/attachments?message_id=${messageId}&attachment_id=${attId}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
  };

  const getIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return <Image size={12} className="text-[#BC8CFF]" />;
    if (ext === "pdf") return <FileText size={12} className="text-[#F85149]" />;
    if (["doc","docx","txt","rtf"].includes(ext)) return <FileText size={12} className="text-[#58A6FF]" />;
    if (["xls","xlsx","csv"].includes(ext)) return <FileText size={12} className="text-[#4ADE80]" />;
    return <File size={12} className="text-[#7D8590]" />;
  };

  const downloadAllThread = async () => {
    setDownloadingAllThread(true);
    for (const group of allAttachments) {
      for (const att of group.attachments) {
        await downloadAtt(group.messageId, att.id, att.name);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    setDownloadingAllThread(false);
  };

  const openThreadDrivePicker = async () => {
    setShowThreadDrivePicker(true);
    setDriveResult(null);
    setThreadFolders([]);
    setThreadFolderPath([]);
    setThreadLoadingFolders(true);
    try {
      const configRes = await fetch("/api/drive?action=config");
      const config = await configRes.json();
      if (config.mode === "direct" && config.folderId) {
        setThreadDefaultFolderId(config.folderId);
        setThreadFolderPath([{ id: config.folderId, name: "Training Files" }]);
        const res = await fetch(`/api/drive?action=folders&folder_id=${config.folderId}`);
        const data = await res.json();
        setThreadFolders(data.folders || []);
      }
    } catch (e) { console.error(e); }
    setThreadLoadingFolders(false);
  };

  const openThreadFolder = async (folder: any) => {
    setThreadFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setThreadLoadingFolders(true);
    try {
      const res = await fetch(`/api/drive?action=folders&folder_id=${folder.id}`);
      const data = await res.json();
      setThreadFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setThreadLoadingFolders(false);
  };

  const navigateThreadPath = async (index: number) => {
    const newPath = index < 0 ? [{ id: threadDefaultFolderId!, name: "Training Files" }] : threadFolderPath.slice(0, index + 1);
    setThreadFolderPath(newPath);
    setThreadLoadingFolders(true);
    try {
      const fId = newPath[newPath.length - 1].id;
      const res = await fetch(`/api/drive?action=folders&folder_id=${fId}`);
      const data = await res.json();
      setThreadFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setThreadLoadingFolders(false);
  };

  const saveAllToDrive = async () => {
    const folderId = threadFolderPath.length > 0 ? threadFolderPath[threadFolderPath.length - 1].id : threadDefaultFolderId;
    if (!folderId) return;
    setSavingToDrive(true);
    setDriveResult(null);
    try {
      let saved = 0;
      for (const group of allAttachments) {
        for (const att of group.attachments) {
          const res = await fetch("/api/drive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "upload_attachment",
              messageId: group.messageId,
              attachmentId: att.id,
              fileName: att.name,
              folderId,
            }),
          });
          const data = await res.json();
          if (data.success) saved++;
        }
      }
      const label = saved === 1 ? "1 file" : `${saved} files`;
      setDriveResult(`Saved ${label} to Drive!`);
      setTimeout(() => { setDriveResult(null); setShowThreadDrivePicker(false); }, 2000);
    } catch (e: any) {
      setDriveResult(`Error: ${e.message}`);
    }
    setSavingToDrive(false);
  };

  return (
    <div className="mb-3 rounded-xl border border-[#1E242C] bg-[#12161B] overflow-hidden">
      <button
        onClick={loadAll}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[#161B22] transition-colors"
      >
        <Paperclip size={14} className="text-[#58A6FF]" />
        <span className="text-[12px] font-semibold text-[#E6EDF3]">
          {loaded ? `${totalCount} attachment${totalCount !== 1 ? "s" : ""}` : `${messagesWithAttachments.length} message${messagesWithAttachments.length !== 1 ? "s" : ""} with attachments`}
        </span>
        {loading && <span className="text-[10px] text-[#484F58]">Loading...</span>}
        {driveResult && (
          <span className={`text-[10px] ml-1 ${driveResult.startsWith("Error") ? "text-[#F85149]" : "text-[#4ADE80]"}`}>
            {driveResult}
          </span>
        )}
        <ChevronDown size={12} className={`ml-auto text-[#484F58] transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && loaded && (
        <div className="px-4 pb-3 border-t border-[#1E242C]">
          {/* Action buttons */}
          {totalCount > 0 && (
            <div className="flex items-center gap-3 py-2 border-b border-[#1E242C] mb-2">
              <button
                onClick={downloadAllThread}
                disabled={downloadingAllThread}
                className="flex items-center gap-1 text-[10px] text-[#4ADE80] hover:text-[#3BC96E] font-semibold transition-colors"
              >
                <Download size={10} />
                {downloadingAllThread ? "Downloading..." : "Download All"}
              </button>
              <button
                onClick={openThreadDrivePicker}
                disabled={savingToDrive}
                className="flex items-center gap-1 text-[10px] text-[#58A6FF] hover:text-[#79B8FF] font-semibold transition-colors"
              >
                <ExternalLink size={10} />
                {savingToDrive ? "Uploading..." : "Save All to Drive"}
              </button>
            </div>
          )}

          {/* Attachment list grouped by sender */}
          <div className="space-y-2">
          {allAttachments.map((group) => (
            <div key={group.messageId}>
              <div className="text-[10px] text-[#484F58] mt-2 mb-1">From {group.fromName}:</div>
              <div className="flex flex-wrap gap-1.5">
                {group.attachments.map((att: any) => (
                  <button
                    key={att.id}
                    onClick={() => downloadAtt(group.messageId, att.id, att.name)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#0B0E11] border border-[#1E242C] hover:border-[#4ADE80]/30 transition-all text-left"
                  >
                    {getIcon(att.name)}
                    <span className="text-[10px] text-[#E6EDF3] max-w-[140px] truncate">{att.name}</span>
                    <Download size={9} className="text-[#484F58]" />
                  </button>
                ))}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* Thread Drive Picker Modal */}
      {showThreadDrivePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowThreadDrivePicker(false)}>
          <div className="w-full max-w-md bg-[#12161B] border border-[#1E242C] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[#1E242C] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[#E6EDF3]">Save All Attachments to Drive</div>
                <div className="text-[10px] text-[#484F58]">{totalCount} file{totalCount !== 1 ? "s" : ""} — choose a folder</div>
              </div>
              <button onClick={() => setShowThreadDrivePicker(false)} className="w-7 h-7 rounded-md text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C] flex items-center justify-center">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 max-h-[350px] overflow-y-auto">
              {threadFolderPath.length > 0 && (
                <div className="flex items-center gap-1 mb-3 text-[11px] flex-wrap">
                  {threadFolderPath.map((fp, i) => (
                    <span key={fp.id} className="flex items-center gap-1">
                      {i > 0 && <span className="text-[#484F58]">/</span>}
                      <button onClick={() => navigateThreadPath(i)} className="text-[#58A6FF] hover:underline">{fp.name}</button>
                    </span>
                  ))}
                </div>
              )}
              {threadLoadingFolders ? (
                <div className="text-center py-4 text-[#484F58] text-[12px]">Loading...</div>
              ) : (
                <div className="space-y-0.5">
                  {threadFolders.map((f) => (
                    <button key={f.id} onClick={() => openThreadFolder(f)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#1E242C] text-left transition-colors">
                      <FolderOpen size={14} className="text-[#F0883E]" />
                      <span className="text-[12px] text-[#E6EDF3]">{f.name}</span>
                    </button>
                  ))}
                  <button onClick={async () => {
                    const name = prompt("New folder name:");
                    if (!name?.trim()) return;
                    const parentId = threadFolderPath.length > 0 ? threadFolderPath[threadFolderPath.length - 1].id : null;
                    if (!parentId) return;
                    try {
                      const res = await fetch("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "create_folder", folderName: name.trim(), parentFolderId: parentId }) });
                      const data = await res.json();
                      if (data.success) setThreadFolders((prev) => [...prev, { id: data.folder.id, name: data.folder.name }]);
                    } catch (e) { console.error(e); }
                  }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#1E242C] border border-dashed border-[#1E242C] mt-1">
                    <Plus size={14} className="text-[#4ADE80]" />
                    <span className="text-[12px] text-[#4ADE80] font-medium">New Folder</span>
                  </button>
                </div>
              )}
            </div>
            {driveResult && (
              <div className={`mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] ${driveResult.startsWith("Error") ? "bg-[rgba(248,81,73,0.1)] text-[#F85149]" : "bg-[rgba(74,222,128,0.1)] text-[#4ADE80]"}`}>{driveResult}</div>
            )}
            <div className="px-4 py-3 border-t border-[#1E242C] flex justify-between items-center">
              <div className="text-[10px] text-[#484F58]">Saving to: {threadFolderPath.map((p) => p.name).join(" / ") || "..."}</div>
              <button onClick={saveAllToDrive} disabled={savingToDrive}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-[11px] font-bold disabled:opacity-50">
                <ExternalLink size={12} /> {savingToDrive ? "Uploading..." : "Save Here"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Message Attachments ─────────────────────────────
function MessageAttachments({ messageId }: { messageId: string }) {
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  // Drive state
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [driveAction, setDriveAction] = useState<{ type: "single" | "all"; attId?: string; attName?: string } | null>(null);
  const [drives, setDrives] = useState<any[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<any>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);

  // Reset when switching messages
  useEffect(() => {
    setAttachments([]);
    setLoaded(false);
    setShowDrivePicker(false);
    setUploadResult(null);
  }, [messageId]);

  const loadAttachments = async () => {
    if (loaded) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/attachments?message_id=${messageId}`);
      const data = await res.json();
      setAttachments(data.attachments || []);
    } catch (err) {
      console.error("Failed to load attachments:", err);
    }
    setLoading(false);
    setLoaded(true);
  };

  const downloadAttachment = async (attId: string, filename: string) => {
    setDownloading(attId);
    try {
      const res = await fetch(`/api/attachments?message_id=${messageId}&attachment_id=${attId}`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
    setDownloading(null);
  };

  const downloadAllAttachments = async () => {
    setDownloadingAll(true);
    try {
      const res = await fetch(`/api/attachments?message_id=${messageId}&download_all=true`);
      const data = await res.json();
      if (data.attachments && data.format === "base64") {
        // Download each file individually
        for (const att of data.attachments) {
          const bytes = Uint8Array.from(atob(att.data), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: att.contentType || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = att.name;
          a.click();
          URL.revokeObjectURL(url);
          // Small delay between downloads
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } catch (err) {
      console.error("Download all failed:", err);
    }
    setDownloadingAll(false);
  };

  const getFileIcon = (name: string, contentType: string) => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext) || contentType.startsWith("image/"))
      return <Image size={14} className="text-[#BC8CFF]" />;
    if (["pdf"].includes(ext)) return <FileText size={14} className="text-[#F85149]" />;
    if (["doc", "docx", "txt", "rtf"].includes(ext)) return <FileText size={14} className="text-[#58A6FF]" />;
    if (["xls", "xlsx", "csv"].includes(ext)) return <FileText size={14} className="text-[#4ADE80]" />;
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return <Archive size={14} className="text-[#F0883E]" />;
    return <File size={14} className="text-[#7D8590]" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Drive functions
  const openDrivePicker = async (type: "single" | "all", attId?: string, attName?: string) => {
    setDriveAction({ type, attId, attName });
    setUploadResult(null);
    setShowDrivePicker(true);
    setFolders([]);
    setFolderPath([]);
    setSelectedDrive(null);
    setLoadingFolders(true);

    try {
      // Check if there's a default folder configured
      const configRes = await fetch("/api/drive?action=config");
      const config = await configRes.json();

      if (config.mode === "direct" && config.folderId) {
        // Start inside the configured folder
        setSelectedDrive({ id: "configured", name: "Shared Drive" });
        setFolderPath([{ id: config.folderId, name: "Training Files" }]);
        const res = await fetch(`/api/drive?action=folders&folder_id=${config.folderId}`);
        const data = await res.json();
        setFolders(data.folders || []);
      } else {
        // Load drives
        setLoadingDrives(true);
        const res = await fetch("/api/drive?action=drives");
        const data = await res.json();
        setDrives(data.drives || []);
        setLoadingDrives(false);
      }
    } catch (e) {
      console.error("Failed to load drive:", e);
    }
    setLoadingFolders(false);
  };

  const selectDrive = async (drive: any) => {
    setSelectedDrive(drive);
    setFolderPath([]);
    setLoadingFolders(true);
    try {
      const res = await fetch(`/api/drive?action=folders&drive_id=${drive.id}`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setLoadingFolders(false);
  };

  const openFolder = async (folder: any) => {
    setFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setLoadingFolders(true);
    try {
      const res = await fetch(`/api/drive?action=folders&drive_id=${selectedDrive?.id}&folder_id=${folder.id}`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setLoadingFolders(false);
  };

  const navigateToPathIndex = async (index: number) => {
    if (index < 0) {
      // Back to drive root
      setFolderPath([]);
      await selectDrive(selectedDrive);
      return;
    }
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);
    setLoadingFolders(true);
    try {
      const fId = newPath[newPath.length - 1].id;
      const res = await fetch(`/api/drive?action=folders&drive_id=${selectedDrive?.id}&folder_id=${fId}`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setLoadingFolders(false);
  };

  const saveToDrive = async () => {
    if (!driveAction || !selectedDrive) return;
    setUploading(true);
    setUploadResult(null);
    const targetFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;

    try {
      if (driveAction.type === "single" && driveAction.attId) {
        const res = await fetch("/api/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upload_attachment",
            messageId, attachmentId: driveAction.attId,
            fileName: driveAction.attName || "attachment",
            folderId: targetFolderId, driveId: selectedDrive.id,
          }),
        });
        const data = await res.json();
        if (data.success) { setUploadResult("Saved to Drive!"); }
        else { setUploadResult(`Error: ${data.error}`); }
      } else if (driveAction.type === "all") {
        const downloadable = attachments.filter((a: any) => !a.isInline);
        let saved = 0;
        for (const att of downloadable) {
          const res = await fetch("/api/drive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "upload_attachment",
              messageId, attachmentId: att.id,
              fileName: att.name,
              folderId: targetFolderId, driveId: selectedDrive.id,
            }),
          });
          const data = await res.json();
          if (data.success) saved++;
        }
        const label = saved === 1 ? "1 file" : `${saved} files`;
        setUploadResult(`Saved ${label} to Drive!`);
      }
    } catch (e: any) {
      setUploadResult(`Error: ${e.message}`);
    }
    setUploading(false);
  };

  // Compute non-inline attachments for display
  const visibleAttachments = loaded ? attachments.filter((a: any) => !a.isInline) : [];

  return (
    <div className="mt-3">
      {!loaded ? (
        <button
          onClick={loadAttachments}
          disabled={loading}
          className="flex items-center gap-1.5 text-[11px] text-[#58A6FF] hover:text-[#79B8FF] transition-colors"
        >
          <Paperclip size={12} />
          {loading ? "Loading attachments..." : "Show attachments"}
        </button>
      ) : visibleAttachments.length === 0 ? (
        <div className="text-[11px] text-[#484F58] flex items-center gap-1">
          <Paperclip size={11} /> No downloadable attachments
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[#484F58] font-semibold flex items-center gap-1">
              <Paperclip size={11} /> {visibleAttachments.length} attachment{visibleAttachments.length !== 1 ? "s" : ""}
              {uploading && <span className="text-[10px] text-[#58A6FF] ml-2">Uploading to Drive...</span>}
              {uploadResult && !showDrivePicker && (
                <span className={`text-[10px] ml-2 ${uploadResult.startsWith("Error") ? "text-[#F85149]" : "text-[#4ADE80]"}`}>
                  {uploadResult}
                </span>
              )}
            </span>
            {visibleAttachments.length > 1 && (
              <div className="flex gap-2">
                <button
                  onClick={() => openDrivePicker("all")}
                  className="flex items-center gap-1 text-[10px] text-[#58A6FF] hover:text-[#79B8FF] font-semibold transition-colors"
                >
                  <ExternalLink size={10} />
                  Save All to Drive
                </button>
                <button
                  onClick={downloadAllAttachments}
                  disabled={downloadingAll}
                  className="flex items-center gap-1 text-[10px] text-[#4ADE80] hover:text-[#3BC96E] font-semibold transition-colors"
                >
                  <Download size={10} />
                  {downloadingAll ? "Downloading..." : "Download All"}
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleAttachments.map((att: any) => (
              <div key={att.id} className="flex items-center gap-1">
                <button
                  onClick={() => downloadAttachment(att.id, att.name)}
                  disabled={downloading === att.id}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] hover:border-[#4ADE80]/30 hover:bg-[#12161B] transition-all group"
                >
                  {getFileIcon(att.name, att.contentType)}
                  <span className="text-[11px] text-[#E6EDF3] max-w-[150px] truncate">{att.name}</span>
                  <span className="text-[9px] text-[#484F58]">{formatSize(att.size)}</span>
                  <Download size={10} className="text-[#484F58] group-hover:text-[#4ADE80] transition-colors" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); openDrivePicker("single", att.id, att.name); }}
                  title="Save to Google Drive"
                  className="w-7 h-7 rounded-lg bg-[#0B0E11] border border-[#1E242C] hover:border-[#58A6FF]/30 flex items-center justify-center transition-all"
                >
                  <ExternalLink size={10} className="text-[#484F58] hover:text-[#58A6FF]" />
                </button>
              </div>
            ))}
          </div>
        </div>
        )}

      {/* Drive Picker Modal */}
      {showDrivePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDrivePicker(false)}>
          <div className="w-full max-w-md bg-[#12161B] border border-[#1E242C] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[#1E242C] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[#E6EDF3]">
                  {driveAction?.type === "all" ? "Save All to Google Drive" : `Save "${driveAction?.attName}" to Drive`}
                </div>
                <div className="text-[10px] text-[#484F58]">Choose a shared drive and folder</div>
              </div>
              <button onClick={() => setShowDrivePicker(false)} className="w-7 h-7 rounded-md text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C] flex items-center justify-center">
                <X size={16} />
              </button>
            </div>

            <div className="p-4 max-h-[350px] overflow-y-auto">
              {!selectedDrive ? (
                <>
                  <div className="text-[11px] text-[#484F58] font-semibold mb-2">Select a Shared Drive:</div>
                  {loadingDrives ? (
                    <div className="text-center py-6 text-[#484F58] text-[12px]">Loading drives...</div>
                  ) : drives.length === 0 ? (
                    <div className="text-center py-6 text-[#484F58] text-[12px]">No shared drives found. Make sure the service account has access.</div>
                  ) : (
                    <div className="space-y-1">
                      {drives.map((d) => (
                        <button key={d.id} onClick={() => selectDrive(d)}
                          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-[#1E242C] text-left transition-colors">
                          <FolderOpen size={16} className="text-[#F0883E]" />
                          <span className="text-[12px] text-[#E6EDF3] font-medium">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-1 mb-3 text-[11px] flex-wrap">
                    <button onClick={() => { setSelectedDrive(null); setFolderPath([]); setFolders([]); }}
                      className="text-[#58A6FF] hover:underline">Drives</button>
                    <span className="text-[#484F58]">/</span>
                    <button onClick={() => navigateToPathIndex(-1)}
                      className="text-[#58A6FF] hover:underline">{selectedDrive.name}</button>
                    {folderPath.map((fp, i) => (
                      <span key={fp.id} className="flex items-center gap-1">
                        <span className="text-[#484F58]">/</span>
                        <button onClick={() => navigateToPathIndex(i)}
                          className="text-[#58A6FF] hover:underline">{fp.name}</button>
                      </span>
                    ))}
                  </div>

                  {loadingFolders ? (
                    <div className="text-center py-4 text-[#484F58] text-[12px]">Loading folders...</div>
                  ) : (
                    <div className="space-y-0.5">
                      {folders.map((f) => (
                        <button key={f.id} onClick={() => openFolder(f)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#1E242C] text-left transition-colors">
                          <FolderOpen size={14} className="text-[#F0883E]" />
                          <span className="text-[12px] text-[#E6EDF3]">{f.name}</span>
                        </button>
                      ))}
                      {/* New Folder button */}
                      <button
                        onClick={async () => {
                          const name = prompt("New folder name:");
                          if (!name?.trim()) return;
                          const parentId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : selectedDrive?.id;
                          try {
                            const res = await fetch("/api/drive", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                action: "create_folder",
                                folderName: name.trim(),
                                parentFolderId: parentId,
                              }),
                            });
                            const data = await res.json();
                            if (data.success && data.folder) {
                              // Add to list and navigate into it
                              setFolders((prev) => [...prev, { id: data.folder.id, name: data.folder.name }]);
                            }
                          } catch (e) { console.error("Create folder failed:", e); }
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#1E242C] text-left transition-colors border border-dashed border-[#1E242C] mt-1"
                      >
                        <Plus size={14} className="text-[#4ADE80]" />
                        <span className="text-[12px] text-[#4ADE80] font-medium">New Folder</span>
                      </button>
                      {folders.length === 0 && (
                        <div className="text-[11px] text-[#484F58] py-1">No subfolders yet.</div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            {uploadResult && (
              <div className={`mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] ${
                uploadResult.startsWith("Error") ? "bg-[rgba(248,81,73,0.1)] text-[#F85149]" : "bg-[rgba(74,222,128,0.1)] text-[#4ADE80]"
              }`}>
                {uploadResult}
              </div>
            )}

            {(selectedDrive || folderPath.length > 0) && (
              <div className="px-4 py-3 border-t border-[#1E242C] flex justify-between items-center">
                <div className="text-[10px] text-[#484F58]">
                  Saving to: {folderPath.length > 0 ? folderPath.map((p) => p.name).join(" / ") : selectedDrive?.name || "Drive root"}
                </div>
                <button
                  onClick={saveToDrive}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-[11px] font-bold disabled:opacity-50"
                >
                  <ExternalLink size={12} />
                  {uploading ? "Uploading..." : "Save Here"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
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
  globalSearchQuery,
}: ConversationDetailProps) {
  const [replyText, setReplyText] = useState("");
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpCustomDate, setFollowUpCustomDate] = useState("");
  const [followUpCustomTime, setFollowUpCustomTime] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [settingFollowUp, setSettingFollowUp] = useState(false);
  const [showInlineCompose, setShowInlineCompose] = useState(false);
  const [inlineComposeTo, setInlineComposeTo] = useState("");
  const [inlineComposeSubject, setInlineComposeSubject] = useState("");
  const [inlineComposeBody, setInlineComposeBody] = useState("");
  const [inlineComposeCc, setInlineComposeCc] = useState("");
  const [inlineComposeBcc, setInlineComposeBcc] = useState("");
  const [showInlineComposeCc, setShowInlineComposeCc] = useState(false);
  const [showInlineComposeBcc, setShowInlineComposeBcc] = useState(false);
  const [sendingInlineCompose, setSendingInlineCompose] = useState(false);
  const [activeReminder, setActiveReminder] = useState<any>(null);

  // In-thread search
  const [threadSearch, setThreadSearch] = useState("");
  const [threadSearchActive, setThreadSearchActive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const matchRefs = useRef<(HTMLElement | null)[]>([]);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  // Scroll to current match
  useEffect(() => {
    if (!threadSearchActive || !threadSearch) return;
    const timer = setTimeout(() => {
      const container = messagesScrollRef.current;
      if (!container) return;
      const marks = container.querySelectorAll("mark[data-match-idx]");
      if (marks.length === 0) return;
      const idx = ((currentMatchIndex % marks.length) + marks.length) % marks.length;
      // Reset all
      marks.forEach((m) => (m as HTMLElement).style.background = "rgba(245,213,71,0.4)");
      // Highlight and scroll to current
      const target = marks[idx] as HTMLElement;
      if (target) {
        target.style.background = "rgba(245,213,71,0.8)";
        // Find the closest scrollable parent and scroll
        const targetTop = target.offsetTop;
        let parent = target.offsetParent as HTMLElement | null;
        let accumulatedTop = target.offsetTop;
        while (parent && parent !== container) {
          accumulatedTop += parent.offsetTop;
          parent = parent.offsetParent as HTMLElement | null;
        }
        container.scrollTop = accumulatedTop - container.clientHeight / 2;
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [currentMatchIndex, threadSearch, threadSearchActive]);

  // Reset search when conversation changes
  useEffect(() => {
    setThreadSearch("");
    setThreadSearchActive(false);
    setCurrentMatchIndex(0);
    matchRefs.current = [];
  }, [convo?.id]);

  // Fetch existing reminder for this conversation
  useEffect(() => {
    if (!convo?.id || !currentUser?.id) { setActiveReminder(null); return; }
    fetch("/api/reminders?user_id=" + currentUser.id)
      .then((r) => r.json())
      .then((data) => {
        const match = (data.reminders || []).find(
          (r: any) => r.conversation_id === convo.id && !r.is_dismissed
        );
        setActiveReminder(match || null);
      })
      .catch(() => setActiveReminder(null));
  }, [convo?.id, currentUser?.id, showFollowUp]); // re-fetch after setting a reminder
  const [replyAttachments, setReplyAttachments] = useState<{ name: string; size: number; type: string; data: string }[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const [showReplyDrive, setShowReplyDrive] = useState(false);
  const [replyDriveFolders, setReplyDriveFolders] = useState<any[]>([]);
  const [replyDriveFiles, setReplyDriveFiles] = useState<any[]>([]);
  const [replyDrivePath, setReplyDrivePath] = useState<{ id: string; name: string }[]>([]);
  const [replyDriveLoading, setReplyDriveLoading] = useState(false);
  const [replyDriveDefaultFolder, setReplyDriveDefaultFolder] = useState<string | null>(null);
  const [showReplyTemplateModal, setShowReplyTemplateModal] = useState(false);
  const [replyTemplates, setReplyTemplates] = useState<any[]>([]);
  const [showReplyEditor, setShowReplyEditor] = useState(false);
  const [replySignature, setReplySignature] = useState("");

  // Fetch account signature for replies
  useEffect(() => {
    if (convo?.email_account_id) {
      import("@/lib/supabase").then(({ createBrowserClient }) => {
        const sb = createBrowserClient();
        sb.from("email_accounts")
          .select("signature, signature_enabled")
          .eq("id", convo.email_account_id)
          .single()
          .then(({ data }: any) => {
            if (data?.signature_enabled && data?.signature) {
              setReplySignature(data.signature);
            } else {
              setReplySignature("");
            }
          });
      });
    }
  }, [convo?.email_account_id]);
  const [noteText, setNoteText] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [showTaskInput, setShowTaskInput] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [deletingTasks, setDeletingTasks] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskText, setEditTaskText] = useState("");
  const [editTaskAssigneeIds, setEditTaskAssigneeIds] = useState<string[]>([]);
  const [editTaskDueDate, setEditTaskDueDate] = useState("");
  const [editTaskCategoryId, setEditTaskCategoryId] = useState("");
  const [editTaskDueTime, setEditTaskDueTime] = useState("");
  const [activeTab, setActiveTab] = useState("messages");
  const [sending, setSending] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskAssigneeIds, setNewTaskAssigneeIds] = useState<string[]>([]);
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskDueTime, setNewTaskDueTime] = useState("");
  const [newTaskCategoryId, setNewTaskCategoryId] = useState("");
  const [taskCategories, setTaskCategories] = useState<any[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<any[]>([]);
  const [showTaskTemplates, setShowTaskTemplates] = useState(false);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [accountAccessMap, setAccountAccessMap] = useState<Record<string, string[]>>({});
  const [creatingSuggestedTasks, setCreatingSuggestedTasks] = useState<string[]>([]);
  const [creatingAllSuggestedTasks, setCreatingAllSuggestedTasks] = useState(false);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardCc, setForwardCc] = useState("");
  const [forwardSubject, setForwardSubject] = useState("");
  const [forwardBody, setForwardBody] = useState("");
  const [forwardSending, setForwardSending] = useState(false);
  const [trashingConversation, setTrashingConversation] = useState(false);

  const {
    notes,
    tasks,
    messages,
    activities,
    refetch: refetchDetail,
  } = useConversationDetail(convo?.id || null);

  // Auto-activate thread search when coming from global search
  useEffect(() => {
    if (globalSearchQuery && convo?.id) {
      setThreadSearch(globalSearchQuery);
      setThreadSearchActive(true);
      setCurrentMatchIndex(0);
      matchRefs.current = [];
      setActiveTab("messages");
    }
  }, [convo?.id, globalSearchQuery]);

  // Re-scroll when messages load
  useEffect(() => {
    if (!threadSearchActive || !threadSearch || messages.length === 0) return;
    const timer = setTimeout(() => {
      const container = messagesScrollRef.current;
      if (!container) return;
      const marks = container.querySelectorAll("mark[data-match-idx]");
      if (marks.length === 0) return;
      const idx = ((currentMatchIndex % marks.length) + marks.length) % marks.length;
      marks.forEach((m) => (m as HTMLElement).style.background = "rgba(245,213,71,0.4)");
      const target = marks[idx] as HTMLElement;
      if (target) {
        target.style.background = "rgba(245,213,71,0.8)";
        let accumulatedTop = target.offsetTop;
        let parent = target.offsetParent as HTMLElement | null;
        while (parent && parent !== container) {
          accumulatedTop += parent.offsetTop;
          parent = parent.offsetParent as HTMLElement | null;
        }
        container.scrollTop = accumulatedTop - container.clientHeight / 2;
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [messages.length, threadSearchActive]);

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

  // Load task categories and user groups (including account-based groups)
  useEffect(() => {
    import("@/lib/supabase").then(({ createBrowserClient }) => {
      const sb = createBrowserClient();
      sb.from("task_categories").select("*").eq("is_active", true).order("sort_order")
        .then(({ data }) => setTaskCategories(data || []));

      // Load task templates
      sb.from("task_templates").select("*").eq("is_active", true).order("sort_order")
        .then(({ data }) => setTaskTemplates(data || []), () => setTaskTemplates([]));

      // Load manual user groups
      sb.from("user_groups").select("*, user_group_members(team_member_id)").eq("is_active", true).order("created_at")
        .then(async ({ data: manualGroups }) => {
          const groups = [...(manualGroups || [])];

          // Also create virtual groups from account_access
          const [accRes, accessRes] = await Promise.all([
            sb.from("email_accounts").select("id, name, icon, color").eq("is_active", true),
            sb.from("account_access").select("email_account_id, team_member_id"),
          ]);

          const accounts = accRes.data || [];
          const accessRows = accessRes.data || [];

          // Build account -> members map
          const accountMembers: Record<string, string[]> = {};
          for (const row of accessRows) {
            if (!accountMembers[row.email_account_id]) accountMembers[row.email_account_id] = [];
            accountMembers[row.email_account_id].push(row.team_member_id);
          }
          setAccountAccessMap(accountMembers);

          // Create virtual groups for accounts that have access restrictions
          for (const acc of accounts) {
            const memberIds = accountMembers[acc.id];
            if (memberIds && memberIds.length > 0) {
              groups.push({
                id: `account:${acc.id}`,
                name: acc.name,
                icon: acc.icon || "📬",
                color: acc.color || "#58A6FF",
                is_active: true,
                _isAccountGroup: true,
                user_group_members: memberIds.map((id) => ({ team_member_id: id })),
              });
            }
          }

          setUserGroups(groups);
        });
    });
  }, []);

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

  // Members who have access to this conversation's email account
  const assignableMembers = useMemo(() => {
    const active = teamMembers.filter((m) => m.is_active !== false);
    if (!convo?.email_account_id) return active;
    const allowedIds = accountAccessMap[convo.email_account_id];
    if (!allowedIds || allowedIds.length === 0) return active; // no restrictions = all users
    return active.filter((m) => allowedIds.includes(m.id));
  }, [teamMembers, convo?.email_account_id, accountAccessMap]);

  const getTaskAssignees = (task: any) =>
    task.assignees?.length ? task.assignees : task.assignee ? [task.assignee] : [];

  const handleAddNoteInternal = async () => {
    if (!convo || !noteText.trim()) return;
    await onAddNote(convo.id, noteText.trim(), noteTitle.trim());
    setNoteText("");
    setNoteTitle("");
    setNoteText("");
    setShowNoteInput(false);
    await refetchDetail();
  };

  const handleAddTaskInternal = async () => {
    if (!convo || !newTaskText.trim()) return;

    // Calculate due_time from hours using supplier business hours
    let computedDueDate = newTaskDueDate || undefined;
    let computedDueTime: string | undefined = undefined;
    if (newTaskDueTime) {
      const hours = parseInt(newTaskDueTime);
      if (hours > 0) {
        // Fetch supplier hours if available
        let supplierHrs: SupplierHours | null = null;
        try {
          if ((convo as any)?.supplier_contact_id) {
            const sb = (await import("@/lib/supabase")).createBrowserClient();
            const { data: sc } = await sb.from("supplier_contacts")
              .select("timezone, work_start, work_end, work_days")
              .eq("id", (convo as any).supplier_contact_id)
              .single();
            if (sc) supplierHrs = sc;
          }
        } catch (_e) { /* use defaults */ }

        const result = addBusinessHours(new Date(), hours, supplierHrs);
        computedDueDate = computedDueDate || result.dueDate;
        computedDueTime = result.dueTime;
      }
    }

    await onAddTask(
      convo.id,
      newTaskText.trim(),
      newTaskAssigneeIds.length > 0
        ? newTaskAssigneeIds
        : currentUser?.id
          ? [currentUser.id]
          : [],
      computedDueDate,
      newTaskCategoryId || undefined,
      computedDueTime
    );

    await refetchDetail();
    setActiveTab("tasks");
    setNewTaskText("");
    setNewTaskAssigneeIds([]);
    setNewTaskDueDate("");
    setNewTaskDueTime("");
    setNewTaskCategoryId("");
    setShowTaskInput(false);
  };

  const handleDeleteTasks = async (taskIds: string[]) => {
    if (taskIds.length === 0) return;
    if (!confirm(`Delete ${taskIds.length} task${taskIds.length !== 1 ? "s" : ""}? This removes the task for all assignees.`)) return;
    setDeletingTasks(true);
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_ids: taskIds }),
      });
      setSelectedTaskIds([]);
      await refetchDetail();
    } catch (e) { console.error(e); }
    setDeletingTasks(false);
  };

  const startEditTask = (task: any) => {
    const assignees = task.assignees || [];
    setEditingTaskId(task.id);
    setEditTaskText(task.text || "");
    setEditTaskAssigneeIds(assignees.map((a: any) => a.id));
    setEditTaskDueDate(task.due_date || "");
    setEditTaskDueTime(task.due_time || "");
    setEditTaskCategoryId(task.category_id || "");
  };

  const cancelEditTask = () => {
    setEditingTaskId(null);
    setEditTaskText("");
    setEditTaskAssigneeIds([]);
    setEditTaskDueDate("");
    setEditTaskDueTime("");
    setEditTaskCategoryId("");
  };

  const saveEditTask = async () => {
    if (!editingTaskId || !editTaskText.trim()) return;
    try {
      // Calculate due_time from hours using supplier business hours
      let computedDueDate = editTaskDueDate || null;
      let computedDueTime: string | null = editTaskDueTime || null;
      if (editTaskDueTime && !editTaskDueTime.includes(":")) {
        // It's hours, not a time string
        const hours = parseInt(editTaskDueTime);
        if (hours > 0) {
          let supplierHrs: SupplierHours | null = null;
          try {
            if ((convo as any)?.supplier_contact_id) {
              const sb = (await import("@/lib/supabase")).createBrowserClient();
              const { data: sc } = await sb.from("supplier_contacts")
                .select("timezone, work_start, work_end, work_days")
                .eq("id", (convo as any).supplier_contact_id)
                .single();
              if (sc) supplierHrs = sc;
            }
          } catch (_e) { /* use defaults */ }

          const result = addBusinessHours(new Date(), hours, supplierHrs);
          computedDueDate = computedDueDate || result.dueDate;
          computedDueTime = result.dueTime;
        }
      }

      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: editingTaskId,
          text: editTaskText.trim(),
          due_date: computedDueDate,
          due_time: computedDueTime,
          assignee_ids: editTaskAssigneeIds,
          category_id: editTaskCategoryId || null,
        }),
      });

      // Update task_assignees: rebuild the join table
      const { createBrowserClient } = await import("@/lib/supabase");
      const sb = createBrowserClient();
      await sb.from("task_assignees").delete().eq("task_id", editingTaskId);
      if (editTaskAssigneeIds.length > 0) {
        await sb.from("task_assignees").insert(
          editTaskAssigneeIds.map((mid) => ({ task_id: editingTaskId, team_member_id: mid }))
        );
      }

      cancelEditTask();
      await refetchDetail();
    } catch (e) { console.error(e); }
  };

  const openReplyTemplatePicker = async () => {
    setShowReplyTemplateModal(true);
    if (replyTemplates.length === 0) {
      import("@/lib/supabase").then(({ createBrowserClient }) => {
        const sb = createBrowserClient();
        sb.from("email_templates").select("*").eq("is_active", true).order("scope").order("sort_order")
          .then(({ data }) => setReplyTemplates(data || []));
      });
    }
  };

  const openReplyDrivePicker = async () => {
    setShowReplyDrive(true);
    setReplyDriveFolders([]); setReplyDriveFiles([]); setReplyDrivePath([]);
    setReplyDriveLoading(true);
    try {
      const configRes = await fetch("/api/drive?action=config");
      const config = await configRes.json();
      if (config.mode === "direct" && config.folderId) {
        setReplyDriveDefaultFolder(config.folderId);
        setReplyDrivePath([{ id: config.folderId, name: "Training Files" }]);
        const [fr, fi] = await Promise.all([
          fetch(`/api/drive?action=folders&folder_id=${config.folderId}`),
          fetch(`/api/drive?action=files&folder_id=${config.folderId}`),
        ]);
        setReplyDriveFolders((await fr.json()).folders || []);
        setReplyDriveFiles((await fi.json()).files || []);
      }
    } catch (e) { console.error(e); }
    setReplyDriveLoading(false);
  };

  const navigateReplyDriveFolder = async (folder: any) => {
    setReplyDrivePath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setReplyDriveLoading(true);
    try {
      const [fr, fi] = await Promise.all([
        fetch(`/api/drive?action=folders&folder_id=${folder.id}`),
        fetch(`/api/drive?action=files&folder_id=${folder.id}`),
      ]);
      setReplyDriveFolders((await fr.json()).folders || []);
      setReplyDriveFiles((await fi.json()).files || []);
    } catch (e) { console.error(e); }
    setReplyDriveLoading(false);
  };

  const navigateReplyDrivePath = async (index: number) => {
    const newPath = index < 0 ? [{ id: replyDriveDefaultFolder!, name: "Training Files" }] : replyDrivePath.slice(0, index + 1);
    setReplyDrivePath(newPath);
    setReplyDriveLoading(true);
    try {
      const fId = newPath[newPath.length - 1].id;
      const [fr, fi] = await Promise.all([
        fetch(`/api/drive?action=folders&folder_id=${fId}`),
        fetch(`/api/drive?action=files&folder_id=${fId}`),
      ]);
      setReplyDriveFolders((await fr.json()).folders || []);
      setReplyDriveFiles((await fi.json()).files || []);
    } catch (e) { console.error(e); }
    setReplyDriveLoading(false);
  };

  const attachReplyDriveFile = async (file: any) => {
    try {
      const res = await fetch(`/api/drive?action=download&file_id=${file.id}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(blob);
      });
      setReplyAttachments((prev) => [...prev, {
        name: file.name, size: file.size || 0,
        type: file.mimeType || "application/octet-stream", data,
      }]);
    } catch (e) { console.error(e); }
  };

  const handleSendReplyInternal = async () => {
    if (!convo) return;
    const textContent = replyText.replace(/<[^>]*>/g, "").trim();
    if (!textContent && replyAttachments.length === 0) return;
    setSending(true);
    try {
      await onSendReply(convo.id, replyText, replyAttachments.length > 0 ? replyAttachments : undefined);
      setReplyText("");
      setReplyAttachments([]);
      await refetchDetail();
    } finally {
      setSending(false);
    }
  };

  const handleReplyAction = () => {
    setActiveTab("messages");

    const latestInbound =
      [...messages].reverse().find((msg: any) => !msg.is_outbound) || messages[messages.length - 1];

    if (!replyText.trim() && latestInbound) {
      const fromLine = latestInbound.from_name
        ? `\n\n---\nOn ${
            latestInbound.sent_at
              ? new Date(latestInbound.sent_at).toLocaleString()
              : "an earlier message"
          }, ${latestInbound.from_name} <${latestInbound.from_email || ""}> wrote:\n`
        : `\n\n---\nPrevious message:\n`;

      const quotedBody = String(latestInbound.body_text || latestInbound.snippet || "")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");

      setReplyText(`${fromLine}${quotedBody}`);
    }

    setTimeout(() => {
      replyTextareaRef.current?.focus();
      replyTextareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  };

  const handleOpenForward = () => {
    if (!convo) return;

    const latestMessage = messages[messages.length - 1];
    const sourceBody = String(latestMessage?.body_text || latestMessage?.snippet || convo.preview || "");

    const formattedForward = [
      "",
      "",
      "---------- Forwarded message ---------",
      `From: ${latestMessage?.from_name || convo.from_name || ""} <${latestMessage?.from_email || convo.from_email || ""}>`,
      latestMessage?.to_addresses ? `To: ${latestMessage.to_addresses}` : "",
      latestMessage?.cc_addresses ? `Cc: ${latestMessage.cc_addresses}` : "",
      `Subject: ${latestMessage?.subject || convo.subject || ""}`,
      latestMessage?.sent_at ? `Date: ${new Date(latestMessage.sent_at).toLocaleString()}` : "",
      "",
      sourceBody,
    ]
      .filter(Boolean)
      .join("\n");

    setForwardTo("");
    setForwardCc("");
    setForwardSubject(
      convo.subject?.toLowerCase().startsWith("fwd:")
        ? convo.subject
        : `Fwd: ${convo.subject || "(No subject)"}`
    );
    setForwardBody(formattedForward);
    setShowForwardModal(true);
  };

  const handleSendForward = async () => {
    if (!convo) return;
    if (!forwardTo.trim() || !forwardSubject.trim() || !forwardBody.trim()) return;

    try {
      setForwardSending(true);

      const res = await fetch("/api/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account_id: convo.email_account_id,
          to: forwardTo.trim(),
          cc: forwardCc.trim(),
          subject: forwardSubject.trim(),
          body: forwardBody,
          actor_id: currentUser?.id || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to forward email");
      }

      setShowForwardModal(false);
      setForwardTo("");
      setForwardCc("");
      setForwardSubject("");
      setForwardBody("");
    } catch (error: any) {
      console.error("Forward failed:", error);
      alert(error?.message || "Failed to forward email");
    } finally {
      setForwardSending(false);
    }
  };

  const handleTrashConversation = async () => {
    if (!convo) return;
    if (trashingConversation) return;
    if (!confirm("Move this conversation to trash?")) return;

    try {
      setTrashingConversation(true);

      const res = await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: convo.id,
          status: "trash",
          actor_id: currentUser?.id || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to move conversation to trash");
      }

      window.location.reload();
    } catch (error: any) {
      console.error("Trash failed:", error);
      alert("Trash failed: " + (error?.message || "Unknown error"));
    } finally {
      setTrashingConversation(false);
    }
  };

  const handleSetFollowUp = async (remindAt: string) => {
    if (!convo || !currentUser?.id) return;
    setSettingFollowUp(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          user_id: currentUser.id,
          remind_at: remindAt,
          note: followUpNote.trim() || null,
        }),
      });
      const data = await res.json();
      setActiveReminder(data.reminder || { remind_at: remindAt, note: followUpNote.trim() || null });
      setShowFollowUp(false);
      setFollowUpNote("");
      setFollowUpCustomDate("");
      setFollowUpCustomTime("");
    } catch (e) {
      console.error("Failed to set follow-up:", e);
    } finally {
      setSettingFollowUp(false);
    }
  };

  const handleDismissReminder = async () => {
    if (!activeReminder?.id) return;
    try {
      await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeReminder.id, dismiss: true }),
      });
      setActiveReminder(null);
      setShowFollowUp(false);
    } catch (e) {
      console.error("Failed to dismiss reminder:", e);
    }
  };

  const handleInlineComposeSend = async () => {
    if (!convo || !inlineComposeTo.trim()) return;
    setSendingInlineCompose(true);
    try {
      const subject = inlineComposeSubject.trim() || convo.subject;
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          account_id: convo.email_account_id,
          to: inlineComposeTo.trim(),
          cc: inlineComposeCc.trim() || undefined,
          bcc: inlineComposeBcc.trim() || undefined,
          subject,
          body: inlineComposeBody,
          actor_id: currentUser?.id,
        }),
      });
      if (res.ok) {
        setShowInlineCompose(false);
        setInlineComposeTo(""); setInlineComposeSubject(""); setInlineComposeBody("");
        setInlineComposeCc(""); setInlineComposeBcc("");
        setShowInlineComposeCc(false); setShowInlineComposeBcc(false);
        refetchDetail();
      } else {
        const err = await res.json();
        alert("Send failed: " + (err.error || "Unknown error"));
      }
    } catch (e: any) {
      alert("Send failed: " + e.message);
    } finally {
      setSendingInlineCompose(false);
    }
  };

  const getFollowUpTime = (preset: string): string => {
    const now = new Date();
    switch (preset) {
      case "2h": return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
      case "4h": return new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
      case "tomorrow_9am": {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
      }
      case "tomorrow_2pm": {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(14, 0, 0, 0);
        return d.toISOString();
      }
      case "next_monday": {
        const d = new Date(now);
        const daysUntilMonday = (8 - d.getDay()) % 7 || 7;
        d.setDate(d.getDate() + daysUntilMonday);
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
      }
      default: return now.toISOString();
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
    () => suggestedTaskItems.filter((item: SuggestedTaskItem) => !item.alreadyCreated),
    [suggestedTaskItems]
  );


  const openActionItemStates = useMemo<OpenActionItemState[]>(() => {
    return (threadSummary?.summary?.open_action_items || [])
      .filter((item: string) => typeof item === "string" && item.trim())
      .map((item: string, index: number) => {
        const match = getTaskMatchMeta(item, tasks);
        const state: OpenActionItemState["state"] = !match.matchedTask
          ? "needs_task"
          : match.isCompleted
            ? "completed"
            : "tracked";

        return {
          id: `${normalizeSuggestedTaskText(item) || item}-${index}`,
          text: item.trim(),
          taskMatch: match.matchedTask,
          score: match.score,
          state,
        };
      });
  }, [threadSummary?.summary?.open_action_items, tasks]);

  const completedItemStates = useMemo<CompletedItemState[]>(() => {
    return (threadSummary?.summary?.completed_items || [])
      .filter((item: string) => typeof item === "string" && item.trim())
      .map((item: string, index: number) => {
        const match = getTaskMatchMeta(item, tasks);
        const state: CompletedItemState["state"] = !match.matchedTask
          ? "ai_only"
          : match.isCompleted
            ? "confirmed_completed"
            : "still_open";

        return {
          id: `${normalizeSuggestedTaskText(item) || item}-${index}`,
          text: item.trim(),
          taskMatch: match.matchedTask,
          score: match.score,
          state,
        };
      });
  }, [threadSummary?.summary?.completed_items, tasks]);

  const createSuggestedTask = async (taskText: string) => {
    if (!convo || !taskText.trim()) return;

    const normalized = normalizeSuggestedTaskText(taskText);
    if (existingTaskTextSet.has(normalized)) return;

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

          {/* ── Participants row ── */}
          {convo.from_email !== "internal" && (() => {
            const seen = new Set<string>();
            const participants: { name: string; email: string }[] = [];
            for (const msg of (messages || [])) {
              const addAddr = (raw: string | null | undefined, fallbackName?: string) => {
                if (!raw) return;
                for (const part of raw.split(",")) {
                  const trimmed = part.trim().toLowerCase();
                  if (!trimmed || seen.has(trimmed)) continue;
                  seen.add(trimmed);
                  // Try to extract "Name <email>" format
                  const match = part.match(/^(.+?)\s*<(.+?)>$/);
                  if (match) {
                    participants.push({ name: match[1].trim(), email: match[2].trim().toLowerCase() });
                  } else {
                    participants.push({ name: fallbackName || trimmed.split("@")[0], email: trimmed });
                  }
                }
              };
              // From
              if (msg.from_email && !seen.has(msg.from_email.toLowerCase())) {
                seen.add(msg.from_email.toLowerCase());
                participants.push({ name: msg.from_name || msg.from_email.split("@")[0], email: msg.from_email.toLowerCase() });
              }
              // To + CC
              addAddr(msg.to_addresses);
              addAddr(msg.cc_addresses);
            }
            if (participants.length <= 1) return null;
            const MAX_SHOW = 5;
            const shown = participants.slice(0, MAX_SHOW);
            const extra = participants.length - MAX_SHOW;
            return (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Users size={11} className="text-[#484F58] shrink-0" />
                {shown.map((p, i) => (
                  <span key={p.email} title={`${p.name} <${p.email}>`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#12161B] border border-[#1E242C] text-[10px] text-[#7D8590] max-w-[160px] truncate">
                    <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-white shrink-0"
                      style={{ background: i === 0 ? "#58A6FF" : i === 1 ? "#4ADE80" : i === 2 ? "#BC8CFF" : i === 3 ? "#F0883E" : "#F5D547" }}>
                      {(p.name || "?").slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate">{p.name || p.email}</span>
                  </span>
                ))}
                {extra > 0 && (
                  <span className="text-[10px] text-[#484F58]">+{extra} more</span>
                )}
              </div>
            );
          })()}

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

          <CallAssignment
            conversationId={convo.id}
            tasks={tasks}
            teamMembers={teamMembers}
            taskCategories={taskCategories}
            onRefetch={refetchDetail}
          />

          <div className="flex gap-1">
            {/* Compose Email button for internal/team conversations */}
            {convo.from_email === "internal" && (
              <button
                onClick={() => setShowInlineCompose(!showInlineCompose)}
                title="Compose email to supplier"
                className={`h-8 px-3 rounded-md border flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                  showInlineCompose
                    ? "border-[#4ADE80]/40 bg-[#4ADE80]/10 text-[#4ADE80]"
                    : "border-[#1E242C] bg-[#12161B] text-[#7D8590] hover:bg-[#181D24] hover:text-[#E6EDF3]"
                }`}
              >
                <Mail size={14} />
                Compose Email
              </button>
            )}

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

            <button
              onClick={handleReplyAction}
              title="Reply"
              className="w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] flex items-center justify-center hover:bg-[#181D24]"
            >
              <Reply size={16} />
            </button>

            <button
              onClick={handleOpenForward}
              title="Forward"
              className="w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] flex items-center justify-center hover:bg-[#181D24]"
            >
              <Forward size={16} />
            </button>

            {/* Follow-up / Snooze */}
            <div className="relative">
              <button
                onClick={() => setShowFollowUp(!showFollowUp)}
                title={activeReminder ? "Follow-up set — click to view" : "Set follow-up reminder"}
                className={`w-8 h-8 rounded-md border flex items-center justify-center hover:bg-[#181D24] relative ${
                  activeReminder
                    ? "text-[#F0883E] border-[#F0883E]/40 bg-[#F0883E]/10"
                    : showFollowUp ? "text-[#F0883E] border-[#F0883E]/30 bg-[#12161B]" : "text-[#7D8590] border-[#1E242C] bg-[#12161B]"
                }`}
              >
                <AlarmClock size={16} />
                {activeReminder && !activeReminder.is_fired && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#F0883E] border border-[#0B0E11]" />
                )}
              </button>

              {showFollowUp && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowFollowUp(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-[280px] bg-[#0F1318] border border-[#1E242C] rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-[#1E242C]">
                      <div className="text-xs font-bold text-[#E6EDF3]">Follow-up Reminder</div>
                      <div className="text-[10px] text-[#484F58] mt-0.5">Get notified to follow up on this email</div>
                    </div>

                    {/* Show existing active reminder */}
                    {activeReminder && (
                      <div className="mx-2 mt-2 p-2.5 rounded-lg border border-[#F0883E]/20 bg-[#F0883E]/5">
                        <div className="flex items-center gap-2 mb-1">
                          <AlarmClock size={12} className="text-[#F0883E]" />
                          <span className="text-[11px] font-semibold text-[#F0883E]">
                            {activeReminder.is_fired ? "Reminder fired" : "Reminder set"}
                          </span>
                        </div>
                        <div className="text-[11px] text-[#E6EDF3]">
                          {new Date(activeReminder.remind_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                        {activeReminder.note && (
                          <div className="text-[10px] text-[#7D8590] mt-0.5">{activeReminder.note}</div>
                        )}
                        <button
                          onClick={handleDismissReminder}
                          className="mt-2 w-full px-2 py-1 rounded-md border border-[#1E242C] text-[10px] text-[#7D8590] hover:text-[#F85149] hover:border-[#F85149]/30 transition-colors"
                        >
                          Dismiss reminder
                        </button>
                      </div>
                    )}

                    {/* Quick presets */}
                    <div className="p-2 space-y-0.5">
                      <div className="px-2.5 py-1 text-[10px] text-[#484F58] font-semibold uppercase">
                        {activeReminder ? "Reschedule" : "Quick set"}
                      </div>
                      {[
                        { key: "2h", label: "In 2 hours" },
                        { key: "4h", label: "In 4 hours" },
                        { key: "tomorrow_9am", label: "Tomorrow 9:00 AM" },
                        { key: "tomorrow_2pm", label: "Tomorrow 2:00 PM" },
                        { key: "next_monday", label: "Next Monday 9:00 AM" },
                      ].map((preset) => (
                        <button
                          key={preset.key}
                          disabled={settingFollowUp}
                          onClick={() => handleSetFollowUp(getFollowUpTime(preset.key))}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-[#12161B] transition-colors disabled:opacity-50"
                        >
                          <AlarmClock size={12} className="text-[#F0883E] flex-shrink-0" />
                          <span className="text-[11px] text-[#E6EDF3]">{preset.label}</span>
                        </button>
                      ))}
                    </div>

                    {/* Custom date/time */}
                    <div className="px-3 py-2 border-t border-[#1E242C] space-y-2">
                      <div className="text-[10px] text-[#484F58] font-semibold uppercase">Custom</div>
                      <div className="flex gap-1.5">
                        <input
                          type="date"
                          value={followUpCustomDate}
                          onChange={(e) => setFollowUpCustomDate(e.target.value)}
                          className="flex-1 px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
                        />
                        <input
                          type="time"
                          value={followUpCustomTime}
                          onChange={(e) => setFollowUpCustomTime(e.target.value)}
                          className="w-24 px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
                        />
                      </div>
                      <input
                        type="text"
                        value={followUpNote}
                        onChange={(e) => setFollowUpNote(e.target.value)}
                        placeholder="Add a note (optional)"
                        className="w-full px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                      />
                      <button
                        disabled={!followUpCustomDate || settingFollowUp}
                        onClick={() => {
                          const dateStr = followUpCustomDate + "T" + (followUpCustomTime || "09:00") + ":00";
                          handleSetFollowUp(new Date(dateStr).toISOString());
                        }}
                        className="w-full px-3 py-1.5 rounded-lg bg-[#F0883E] text-[#0B0E11] text-xs font-semibold hover:bg-[#f09e5e] disabled:opacity-50 transition-colors"
                      >
                        {settingFollowUp ? "Setting..." : activeReminder ? "Reschedule" : "Set Reminder"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            <button
              onClick={handleTrashConversation}
              title="Trash"
              disabled={trashingConversation}
              className="w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] flex items-center justify-center hover:bg-[#181D24] disabled:opacity-50"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex border-b border-[#161B22] px-5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); if (tab.id === "tasks" || tab.id === "notes") refetchDetail(); }}
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
        ref={messagesScrollRef}
        className={`${
          isReviewTab ? "flex-1 overflow-hidden px-5 py-4" : "flex-1 overflow-y-auto px-5 py-4"
        }`}
      >
        {activeTab === "messages" && (
          <>
            {/* Attachment summary bar — shows all attachments across all messages */}
            <ThreadAttachmentBar messages={messages} />

            {/* In-thread search bar */}
            {threadSearchActive ? (
              (() => {
                const sq = threadSearch.trim().toLowerCase();
                const totalMatches = sq ? messages.reduce((count: number, msg: any) => {
                  const bt = msg.body_text || (msg.body_html ? msg.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") : "") || msg.snippet || "";
                  return count + (bt.toLowerCase().split(sq).length - 1);
                }, 0) : 0;
                const safeIndex = totalMatches > 0 ? ((currentMatchIndex % totalMatches) + totalMatches) % totalMatches : 0;

                return (
                  <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl border border-[#4ADE80]/30 bg-[#0F1318]">
                    <Search size={14} className="text-[#484F58] flex-shrink-0" />
                    <input
                      value={threadSearch}
                      onChange={(e) => { setThreadSearch(e.target.value); setCurrentMatchIndex(0); matchRefs.current = []; }}
                      placeholder="Search in this thread..."
                      autoFocus
                      className="flex-1 bg-transparent text-sm text-[#E6EDF3] outline-none placeholder:text-[#484F58]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (e.shiftKey) setCurrentMatchIndex((p) => Math.max(0, p - 1));
                          else setCurrentMatchIndex((p) => p + 1);
                        }
                        if (e.key === "Escape") { setThreadSearchActive(false); setThreadSearch(""); }
                      }}
                    />
                    {threadSearch && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[#484F58] tabular-nums">{totalMatches > 0 ? (safeIndex + 1) + "/" + totalMatches : "0 results"}</span>
                        <button onClick={() => setCurrentMatchIndex((p) => Math.max(0, p - 1))} className="w-6 h-6 rounded flex items-center justify-center text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C]"><ChevronUp size={14} /></button>
                        <button onClick={() => setCurrentMatchIndex((p) => p + 1)} className="w-6 h-6 rounded flex items-center justify-center text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C]"><ChevronDown size={14} /></button>
                      </div>
                    )}
                    <button onClick={() => { setThreadSearchActive(false); setThreadSearch(""); matchRefs.current = []; }} className="text-[#484F58] hover:text-[#E6EDF3]"><X size={14} /></button>
                  </div>
                );
              })()
            ) : (
              <div className="flex justify-end mb-2">
                <button onClick={() => setThreadSearchActive(true)} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] text-[#484F58] hover:text-[#7D8590] hover:bg-[#12161B] transition-colors">
                  <Search size={12} /> Search in thread
                </button>
              </div>
            )}

            {(() => {
              // Count matches across all messages for navigation
              matchRefs.current = [];
              let globalMatchIdx = 0;
              const searchQ = threadSearch.trim().toLowerCase();

              return messages.map((msg: any) => {
                const bodyText = msg.body_text || (msg.body_html ? msg.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") : "") || msg.snippet || "";
                const matchCountInMsg = searchQ ? (bodyText.toLowerCase().split(searchQ).length - 1) : 0;
                const msgStartIdx = globalMatchIdx;
                globalMatchIdx += matchCountInMsg;

                return (
                  <div
                    key={msg.id}
                    className={`mb-4 p-4 rounded-xl border ${
                      msg.is_outbound
                        ? "bg-[rgba(74,222,128,0.04)] border-[rgba(74,222,128,0.1)]"
                        : "bg-[#12161B] border-[#161B22]"
                    } ${searchQ && matchCountInMsg > 0 ? "ring-1 ring-[#F5D547]/20" : ""}`}
                  >
                <MessageHeader msg={msg} convo={convo} />
                <div className="text-[13px] leading-relaxed text-[#7D8590]">
                  {msg.body_html && !searchQ ? (
                    <div
                      className="prose prose-sm prose-invert max-w-none [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[#1E242C] [&_td]:p-2 [&_th]:border [&_th]:border-[#1E242C] [&_th]:p-2 [&_th]:bg-[#161B22] [&_img]:max-w-full"
                      dangerouslySetInnerHTML={{ __html: msg.body_html }}
                    />
                  ) : (
                    <div className="whitespace-pre-wrap">
                      {searchQ ? (
                        <HighlightedText text={bodyText || "(No text content)"} query={searchQ} matchRefs={matchRefs} startIndex={msgStartIdx} />
                      ) : (
                        msg.body_text || msg.snippet || "(No text content)"
                      )}
                    </div>
                  )}
                </div>
                {msg.has_attachments && (
                  <MessageAttachments messageId={msg.id} />
                )}
                  </div>
                );
              });
            })()}

            {messages.length === 0 && (
              <div className="text-center py-10">
                {convo.from_email === "internal" ? (
                  <div className="space-y-3">
                    <MessageSquare size={32} className="mx-auto text-[#484F58]" />
                    <p className="text-[#484F58] text-sm">Team conversation — no emails yet</p>
                    <button
                      onClick={() => setShowInlineCompose(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold hover:bg-[#3FCF73] transition-colors"
                    >
                      <Send size={14} />
                      Compose Email
                    </button>
                  </div>
                ) : (
                  <p className="text-[#484F58] text-sm">No messages yet. Click the sync button in the sidebar to fetch emails.</p>
                )}
              </div>
            )}

            {/* Inline compose for internal conversations */}
            {showInlineCompose && convo.from_email === "internal" && (
              <div className="mt-4 rounded-xl border border-[#4ADE80]/20 bg-[#0F1318] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-[#E6EDF3]">New Email</div>
                  <button onClick={() => setShowInlineCompose(false)} className="text-[#484F58] hover:text-[#E6EDF3]"><X size={14} /></button>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-[#484F58] font-semibold">To *</label>
                    <div className="flex gap-2">
                      {!showInlineComposeCc && <button onClick={() => setShowInlineComposeCc(true)} className="text-[9px] text-[#484F58] hover:text-[#7D8590]">Cc</button>}
                      {!showInlineComposeBcc && <button onClick={() => setShowInlineComposeBcc(true)} className="text-[9px] text-[#484F58] hover:text-[#7D8590]">Bcc</button>}
                    </div>
                  </div>
                  <input
                    value={inlineComposeTo}
                    onChange={(e) => setInlineComposeTo(e.target.value)}
                    placeholder="supplier@example.com (comma-separated for multiple)"
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                  />
                </div>
                {showInlineComposeCc && (
                  <div>
                    <label className="block text-[10px] text-[#484F58] font-semibold mb-1">Cc</label>
                    <input value={inlineComposeCc} onChange={(e) => setInlineComposeCc(e.target.value)}
                      placeholder="cc@example.com"
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
                  </div>
                )}
                {showInlineComposeBcc && (
                  <div>
                    <label className="block text-[10px] text-[#484F58] font-semibold mb-1">Bcc</label>
                    <input value={inlineComposeBcc} onChange={(e) => setInlineComposeBcc(e.target.value)}
                      placeholder="bcc@example.com"
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] text-[#484F58] font-semibold mb-1">Subject</label>
                  <input
                    value={inlineComposeSubject}
                    onChange={(e) => setInlineComposeSubject(e.target.value)}
                    placeholder={convo.subject}
                    className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#484F58] font-semibold mb-1">Message</label>
                  <RichTextEditor
                    value={inlineComposeBody}
                    onChange={setInlineComposeBody}
                    compact
                    signature={replySignature}
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setShowInlineCompose(false)}
                    className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-xs text-[#7D8590] hover:text-[#E6EDF3]">
                    Cancel
                  </button>
                  <button
                    onClick={handleInlineComposeSend}
                    disabled={sendingInlineCompose || !inlineComposeTo.trim() || !inlineComposeBody.replace(/<[^>]*>/g, "").trim()}
                    className="px-4 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold hover:bg-[#3FCF73] disabled:opacity-50 flex items-center gap-2"
                  >
                    {sendingInlineCompose ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {sendingInlineCompose ? "Sending..." : "Send Email"}
                  </button>
                </div>
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
                <input
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Note title (e.g. Follow-up needed, Pricing info, Decision)"
                  className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm font-semibold text-[#E6EDF3] placeholder:text-[#484F58] outline-none mb-2 focus:border-[#4ADE80]"
                />
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Write an internal note..."
                  rows={4}
                  className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none focus:border-[#4ADE80]"
                />
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => {
                      setShowNoteInput(false);
                      setNoteText("");
                      setNoteTitle("");
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-[#7D8590] text-sm hover:bg-[#181D24]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddNoteInternal}
                    disabled={!noteText.trim()}
                    className="px-3 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-sm font-semibold hover:bg-[#3FCF73] disabled:opacity-40"
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
                  {note.title && (
                    <div className="text-[14px] font-bold text-[#E6EDF3] mb-1.5 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#58A6FF] flex-shrink-0" />
                      {note.title}
                    </div>
                  )}
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
                  <div className="text-[13px] text-[#7D8590] whitespace-pre-wrap">{note.text}</div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="h-full overflow-y-auto pr-2 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[#E6EDF3]">Thread Tasks</div>
              <div className="flex items-center gap-2">
                {selectedTaskIds.length > 0 && currentUser?.role === "admin" && (
                  <button
                    onClick={() => handleDeleteTasks(selectedTaskIds)}
                    disabled={deletingTasks}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[rgba(248,81,73,0.3)] bg-[rgba(248,81,73,0.08)] text-[11px] font-semibold text-[#F85149] hover:bg-[rgba(248,81,73,0.14)] disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                    {deletingTasks ? "Deleting..." : `Delete (${selectedTaskIds.length})`}
                  </button>
                )}
                <button
                  onClick={() => setShowTaskInput((v) => !v)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[12px] font-semibold text-[#58A6FF] hover:bg-[#181D24]"
                >
                  <Plus size={13} />
                  New task
                </button>
              </div>
            </div>

            {showTaskInput && (
              <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4 space-y-3">
                {/* Task template picker */}
                {taskTemplates.length > 0 && (
                  <div>
                    <button onClick={() => setShowTaskTemplates(!showTaskTemplates)}
                      className="flex items-center gap-1.5 text-[10px] text-[#58A6FF] hover:text-[#79B8FF] font-semibold mb-1">
                      <FileText size={11} /> {showTaskTemplates ? "Hide templates" : "Use template"}
                    </button>
                    {showTaskTemplates && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {taskTemplates.map((tpl: any) => (
                          <button key={tpl.id} onClick={() => {
                            setNewTaskText(tpl.text || "");
                            if (tpl.category_id) setNewTaskCategoryId(tpl.category_id);
                            if (tpl.deadline_hours) setNewTaskDueTime(String(tpl.deadline_hours));
                            if (tpl.assignee_ids && Array.isArray(tpl.assignee_ids)) {
                              setNewTaskAssigneeIds(tpl.assignee_ids.filter((id: string) => assignableMembers.some((m) => m.id === id)));
                            }
                            setShowTaskTemplates(false);
                          }}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[#0B0E11] border border-[#1E242C] text-[#7D8590] hover:text-[#E6EDF3] hover:border-[#4ADE80]/30 transition-colors"
                          >
                            {tpl.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <textarea
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  placeholder="What needs to be done?"
                  rows={3}
                  className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none focus:border-[#4ADE80]"
                />

                {/* Category picker */}
                {taskCategories.length > 0 && (
                  <div>
                    <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Category</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setNewTaskCategoryId("")}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                          !newTaskCategoryId ? "bg-[#1E242C] text-[#E6EDF3] ring-1 ring-[#4ADE80]" : "bg-[#0B0E11] text-[#484F58] border border-[#1E242C] hover:text-[#7D8590]"
                        }`}
                      >
                        None
                      </button>
                      {taskCategories.map((cat: any) => (
                        <button
                          key={cat.id}
                          onClick={() => setNewTaskCategoryId(cat.id)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                            newTaskCategoryId === cat.id ? "ring-1 ring-[#4ADE80] bg-[#1E242C]" : "bg-[#0B0E11] border border-[#1E242C] hover:bg-[#1E242C]"
                          }`}
                        >
                          <span className="text-[13px]">{cat.icon}</span>
                          <span style={{ color: cat.color }}>{cat.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Date and Time */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Due Date</div>
                    <input
                      type="date"
                      value={newTaskDueDate}
                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                      className="w-full h-9 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 text-[12px] text-[#E6EDF3] outline-none focus:border-[#4ADE80] [color-scheme:dark]"
                    />
                  </div>
                  <div className="w-36">
                    <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Start Within</div>
                    <select
                      value={newTaskDueTime}
                      onChange={(e) => setNewTaskDueTime(e.target.value)}
                      className="w-full h-9 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-2 text-[12px] text-[#E6EDF3] outline-none focus:border-[#4ADE80] [color-scheme:dark]"
                    >
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

                {/* Assignees with Select All + Groups */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] text-[#484F58] font-semibold">Assign to</div>
                    <button
                      onClick={() => {
                        if (newTaskAssigneeIds.length === assignableMembers.length) {
                          setNewTaskAssigneeIds([]);
                        } else {
                          setNewTaskAssigneeIds(assignableMembers.map((m) => m.id));
                        }
                      }}
                      className="text-[10px] text-[#58A6FF] hover:text-[#79B8FF] font-semibold"
                    >
                      {newTaskAssigneeIds.length === assignableMembers.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  {/* Group quick-select */}
                  {userGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {userGroups.map((g: any) => {
                        const memberIds = (g.user_group_members || []).map((m: any) => m.team_member_id);
                        const isSelected = memberIds.length > 0 && memberIds.every((id: string) => newTaskAssigneeIds.includes(id));
                        return (
                          <button key={g.id} onClick={() => {
                            if (isSelected) {
                              setNewTaskAssigneeIds((prev) => prev.filter((id) => !memberIds.includes(id)));
                            } else {
                              setNewTaskAssigneeIds((prev) => Array.from(new Set([...prev, ...memberIds])));
                            }
                          }}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                              isSelected ? "ring-1 ring-[#4ADE80] bg-[rgba(74,222,128,0.1)]" : "bg-[#0B0E11] border border-[#1E242C] hover:border-[#484F58]"
                            }`}>
                            <span className="text-[11px]">{g.icon}</span>
                            <span style={{ color: isSelected ? "#4ADE80" : g.color }}>{g.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="rounded-lg border border-[#1E242C] bg-[#0B0E11] p-2 space-y-1 max-h-32 overflow-y-auto">
                    {assignableMembers
                      .map((member) => {
                        const checked = newTaskAssigneeIds.includes(member.id);
                        return (
                          <label key={member.id} className="flex items-center gap-2 text-[12px] text-[#E6EDF3] px-1 py-0.5 rounded hover:bg-[#1E242C] cursor-pointer">
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
                            <Avatar initials={member.initials} color={member.color} size={16} />
                            <span>{member.name}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowTaskInput(false);
                      setNewTaskText("");
                      setNewTaskAssigneeIds([]);
                      setNewTaskDueDate("");
                      setNewTaskDueTime("");
                      setNewTaskCategoryId("");
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-[#7D8590] text-sm hover:bg-[#181D24]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddTaskInternal}
                    disabled={!newTaskText.trim()}
                    className="px-3 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-sm font-semibold hover:bg-[#3FCF73] disabled:opacity-40"
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

              if (editingTaskId === task.id) {
                return (
                  <div key={task.id} className="rounded-xl border border-[#4ADE80]/30 bg-[#12161B] p-4 space-y-3">
                    <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">Edit Task</div>
                    <textarea
                      value={editTaskText}
                      onChange={(e) => setEditTaskText(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none focus:border-[#4ADE80]"
                    />
                    {/* Category */}
                    {taskCategories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => setEditTaskCategoryId("")}
                          className={`px-2 py-1 rounded-lg text-[10px] font-medium ${!editTaskCategoryId ? "bg-[#1E242C] text-[#E6EDF3] ring-1 ring-[#4ADE80]" : "bg-[#0B0E11] text-[#484F58] border border-[#1E242C]"}`}>
                          None
                        </button>
                        {taskCategories.map((cat: any) => (
                          <button key={cat.id} onClick={() => setEditTaskCategoryId(cat.id)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-medium flex items-center gap-1 ${editTaskCategoryId === cat.id ? "ring-1 ring-[#4ADE80]" : "border border-[#1E242C]"}`}
                            style={{ background: `${cat.color}18`, color: cat.color }}>
                            <span>{cat.icon}</span> {cat.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Due date + hours */}
                    <div className="flex items-center gap-2">
                      <input type="date" value={editTaskDueDate} onChange={(e) => setEditTaskDueDate(e.target.value)}
                        className="px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[12px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]" />
                      <select value={editTaskDueTime} onChange={(e) => setEditTaskDueTime(e.target.value)}
                        className="px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[12px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">No time limit</option>
                        {[1,2,3,4,5,6,8,10,12,16,24,36,48].map((h) => (
                          <option key={h} value={String(h)}>{h}h</option>
                        ))}
                      </select>
                      {editTaskDueTime && editTaskDueTime.includes(":") && (
                        <span className="text-[10px] text-[#484F58]">Current: {editTaskDueTime.slice(0, 5)}</span>
                      )}
                    </div>
                    {/* Assignees */}
                    <div>
                      <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Assignees</div>
                      <div className="flex flex-wrap gap-1.5">
                        {/* Select all / Deselect all */}
                        <button
                          onClick={() => setEditTaskAssigneeIds(editTaskAssigneeIds.length === teamMembers.length ? [] : teamMembers.map((m) => m.id))}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-[#0B0E11] text-[#484F58] border border-[#1E242C] hover:text-[#7D8590]"
                        >
                          {editTaskAssigneeIds.length === teamMembers.length ? "Deselect all" : "Select all"}
                        </button>
                        {/* User groups */}
                        {userGroups.map((g: any) => {
                          const gMembers = (g.user_group_members || []).map((gm: any) => gm.team_member_id);
                          return (
                            <button key={g.id} onClick={() => {
                              const allSelected = gMembers.every((id: string) => editTaskAssigneeIds.includes(id));
                              setEditTaskAssigneeIds(allSelected
                                ? editTaskAssigneeIds.filter((id) => !gMembers.includes(id))
                                : Array.from(new Set([...editTaskAssigneeIds, ...gMembers]))
                              );
                            }}
                              className="px-2 py-1 rounded-lg text-[10px] font-medium border border-[#1E242C] bg-[#0B0E11] hover:text-[#E6EDF3]"
                              style={{ color: g.color }}>
                              {g.icon || "👥"} {g.name}
                            </button>
                          );
                        })}
                        {teamMembers.map((m) => {
                          const selected = editTaskAssigneeIds.includes(m.id);
                          return (
                            <button key={m.id} onClick={() => setEditTaskAssigneeIds(selected ? editTaskAssigneeIds.filter((id) => id !== m.id) : [...editTaskAssigneeIds, m.id])}
                              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-all ${selected ? "ring-1 ring-[#4ADE80]" : "border border-[#1E242C]"}`}
                              style={{ background: selected ? `${m.color}20` : "#0B0E11", color: selected ? m.color : "#7D8590" }}>
                              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-[#0B0E11]" style={{ background: m.color }}>{m.initials}</span>
                              {m.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex justify-end gap-2">
                      <button onClick={cancelEditTask}
                        className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-xs text-[#7D8590]">Cancel</button>
                      <button onClick={saveEditTask} disabled={!editTaskText.trim()}
                        className="px-4 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold disabled:opacity-40">Save</button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={task.id} className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4 group/task">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(task.id)}
                      onChange={(e) => {
                        setSelectedTaskIds((prev) =>
                          e.target.checked ? [...prev, task.id] : prev.filter((id) => id !== task.id)
                        );
                      }}
                      className="mt-1 accent-[#4ADE80]"
                    />
                    <button
                      onClick={async () => {
                        if (assignees.length > 1 && currentUser) {
                          // Multi-assignee: toggle current user's completion
                          try {
                            await fetch("/api/tasks", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ task_id: task.id, toggle_assignee_id: currentUser.id }),
                            });
                            await refetchDetail();
                          } catch (e) { console.error(e); }
                        } else {
                          // Single assignee: toggle whole task
                          onToggleTask(task.id, !(task.status === "completed" || task.is_done));
                        }
                      }}
                      title={assignees.length > 1 ? "Mark my part as done" : "Toggle task completion"}
                      className="mt-0.5"
                    >
                      {(() => {
                        if (task.status === "dismissed") return <Ban size={18} className="text-[#F0883E] opacity-60" />;
                        if (assignees.length > 1 && currentUser) {
                          const myEntry = assignees.find((a: any) => a.id === currentUser.id);
                          const allDone = assignees.every((a: any) => a.is_done);
                          if (allDone) return <CheckCircle size={18} className="text-[#4ADE80]" />;
                          if (myEntry?.is_done) return <CheckCircle size={18} className="text-[#58A6FF]" />;
                          return <Circle size={18} className="text-[#7D8590]" />;
                        }
                        return (task.status === "completed" || task.is_done)
                          ? <CheckCircle size={18} className="text-[#4ADE80]" />
                          : <Circle size={18} className="text-[#7D8590]" />;
                      })()}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium ${
                          task.status === "dismissed"
                            ? "text-[#F0883E] italic opacity-70"
                            : task.status === "completed" || task.is_done
                            ? "text-[#7D8590] line-through"
                            : "text-[#E6EDF3]"
                        }`}
                      >
                        {task.status === "dismissed" && <Ban size={12} className="inline mr-1 -mt-0.5" />}
                        {task.text}
                      </div>

                      {/* Dismiss reason */}
                      {task.status === "dismissed" && task.dismiss_reason && (
                        <div className="mt-1 px-2 py-1 rounded bg-[rgba(240,136,62,0.08)] border border-[rgba(240,136,62,0.15)]">
                          <span className="text-[10px] text-[#F0883E] font-semibold">Dismissed: </span>
                          <span className="text-[10px] text-[#7D8590]">{task.dismiss_reason}</span>
                          {task.dismissed_at && (
                            <span className="text-[10px] text-[#484F58] ml-2">
                              {new Date(task.dismissed_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Progress for multi-assignee tasks */}
                      {assignees.length > 1 && (() => {
                        const doneCount = assignees.filter((a: any) => a.is_done).length;
                        return (
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 rounded-full bg-[#1E242C] max-w-[120px]">
                              <div className="h-full rounded-full transition-all" style={{
                                width: `${(doneCount / assignees.length) * 100}%`,
                                background: doneCount === assignees.length ? "#4ADE80" : "#58A6FF",
                              }} />
                            </div>
                            <span className="text-[10px] text-[#484F58]">{doneCount}/{assignees.length} done</span>
                          </div>
                        );
                      })()}

                      <div className="flex flex-wrap gap-2 mt-2">
                        {/* Category badge */}
                        {task.category_id && (() => {
                          const cat = taskCategories.find((c: any) => c.id === task.category_id);
                          return cat ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: `${cat.color}18`, color: cat.color }}>
                              <span className="text-[12px]">{cat.icon}</span> {cat.name}
                            </span>
                          ) : null;
                        })()}

                        {assignees.length > 1 ? (
                          <select
                            value={(() => {
                              if (!currentUser) return "todo";
                              const myEntry = assignees.find((a: any) => a.id === currentUser.id);
                              return (myEntry as any)?.personal_status || (myEntry?.is_done ? "completed" : "todo");
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
                                await refetchDetail();
                              } catch (e2) { console.error(e2); }
                            }}
                            className="h-8 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-2 text-[11px] text-[#E6EDF3] outline-none"
                          >
                            <option value="todo">📋 To do</option>
                            <option value="in_progress">🔄 In progress</option>
                            <option value="completed">✅ Done (me)</option>
                          </select>
                        ) : (
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
                        )}

                        {task.due_date && (
                          <>
                            <span className="inline-flex items-center rounded-full px-2 py-1 text-[11px] bg-[rgba(245,213,71,0.12)] text-[#F5D547]">
                              Start by: {task.due_date}{task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
                            </span>
                            <TaskCountdown
                              dueDate={task.due_date}
                              dueTime={task.due_time}
                              isCompleted={task.status === "completed" || task.status === "dismissed" || task.is_done}
                            />
                          </>
                        )}

                        {/* Reset SLA Timer */}
                        {task.due_date && task.status !== "completed" && task.status !== "dismissed" && !task.is_done && (
                          <button
                            onClick={async () => {
                              const reason = prompt("Reason for resetting the timer:\n(e.g., contact was busy, no answer, rescheduled)");
                              if (!reason || !reason.trim()) return;
                              try {
                                // Add note with reason
                                await onAddNote(convo!.id, `⏱️ SLA Reset — Task: "${task.text.slice(0, 50)}"\nReason: ${reason.trim()}\nPrevious deadline: ${task.due_date}${task.due_time ? " " + task.due_time : ""}`);

                                // Calculate same number of hours as original deadline
                                const hours = task.due_time ? Math.max(1, Math.round((new Date(task.due_date + "T" + task.due_time).getTime() - new Date(task.created_at).getTime()) / (1000 * 60 * 60))) : 24;

                                // Fetch supplier hours for timezone-aware business hours
                                let supplierHrs: SupplierHours | null = null;
                                try {
                                  const sb = (await import("@/lib/supabase")).createBrowserClient();
                                  if ((convo as any)?.supplier_contact_id) {
                                    const { data: sc } = await sb.from("supplier_contacts")
                                      .select("timezone, work_start, work_end, work_days")
                                      .eq("id", (convo as any).supplier_contact_id)
                                      .single();
                                    if (sc) supplierHrs = sc;
                                  }
                                } catch (_e) { /* use defaults */ }

                                // Reset using business hours calculation
                                const result = addBusinessHours(new Date(), hours, supplierHrs);

                                await onUpdateTask(task.id, { dueDate: result.dueDate });
                                // Update due_time directly
                                const sb = (await import("@/lib/supabase")).createBrowserClient();
                                await sb.from("tasks").update({ due_time: result.dueTime }).eq("id", task.id);

                                await refetchDetail();
                              } catch (e) { console.error("Reset SLA failed:", e); }
                            }}
                            className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-[#F0883E] bg-[rgba(240,136,62,0.1)] hover:bg-[rgba(240,136,62,0.2)] transition-colors"
                            title="Reset the SLA timer and log a reason"
                          >
                            <AlarmClock size={11} /> Reset timer
                          </button>
                        )}

                        {assignees.map((member: any) => (
                          <button
                            key={member.id}
                            onClick={async () => {
                              try {
                                await fetch("/api/tasks", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ task_id: task.id, toggle_assignee_id: member.id }),
                                });
                                await refetchDetail();
                              } catch (e) { console.error(e); }
                            }}
                            title={member.is_done ? `${member.name} — completed. Click to undo` : `${member.name} — click to mark done`}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-all ${
                              member.is_done ? "line-through opacity-60" : ""
                            }`}
                            style={{
                              background: member.is_done ? "rgba(74,222,128,0.15)" : `${member.color}20`,
                              color: member.is_done ? "#4ADE80" : member.color,
                            }}
                          >
                            {member.is_done ? (
                              <CheckCircle size={14} className="text-[#4ADE80]" />
                            ) : (
                              <Avatar initials={member.initials} color={member.color} size={16} />
                            )}
                            {member.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => startEditTask(task)}
                      className="p-1 rounded text-[#484F58] hover:text-[#58A6FF] hover:bg-[rgba(88,166,255,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                      title="Edit task"
                    >
                      <Pencil size={13} />
                    </button>
                    {task.status === "dismissed" ? (
                      <button
                        onClick={async () => {
                          try {
                            await fetch("/api/tasks", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ task_id: task.id, status: "todo" }),
                            });
                            if (convo) await onAddNote(convo.id, `🔄 Task reopened: "${task.text.slice(0, 50)}"`);
                            await refetchDetail();
                          } catch (e) { console.error(e); }
                        }}
                        className="p-1 rounded text-[#484F58] hover:text-[#4ADE80] hover:bg-[rgba(74,222,128,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                        title="Reopen this task"
                      >
                        <RotateCcw size={13} />
                      </button>
                    ) : (
                      task.status !== "completed" && !task.is_done && (
                        <button
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
                              if (convo) await onAddNote(convo.id, `🚫 Task dismissed: "${task.text.slice(0, 50)}"\nReason: ${reason.trim()}`);
                              await refetchDetail();
                            } catch (e) { console.error(e); }
                          }}
                          className="p-1 rounded text-[#484F58] hover:text-[#F0883E] hover:bg-[rgba(240,136,62,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                          title="Dismiss — no longer needed"
                        >
                          <Ban size={13} />
                        </button>
                      )
                    )}
                    {currentUser?.role === "admin" && (
                      <button
                        onClick={() => handleDeleteTasks([task.id])}
                        className="p-1 rounded text-[#484F58] hover:text-[#F85149] hover:bg-[rgba(248,81,73,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                        title="Delete task"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
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
              <div className="flex items-start justify-between gap-3">
                <div>
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

                {externalEmail && (
                  <a
                    href={`/contacts/${encodeURIComponent(externalEmail)}?account=${convo.email_account_id || ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#0B0E11] text-[12px] font-semibold text-[#58A6FF] hover:bg-[#181D24] shrink-0"
                  >
                    <ExternalLink size={13} />
                    Command Center
                  </a>
                )}
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
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[#7D8590]">
                      Open Action Items
                    </div>
                    <div className="text-[11px] text-[#484F58]">AI items synced with thread tasks</div>
                  </div>
                  {openActionItemStates.length > 0 ? (
                    <div className="space-y-2">
                      {openActionItemStates.map((item: OpenActionItemState) => {
                        const isCreating = creatingSuggestedTasks.includes(item.text);
                        return (
                          <div
                            key={item.id}
                            className="rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-[#E6EDF3]">{item.text}</div>
                                {item.taskMatch?.text && (
                                  <div className="mt-1 text-[11px] text-[#7D8590]">
                                    Matched task: {item.taskMatch.text}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {item.state === "needs_task" && (
                                  <button
                                    type="button"
                                    onClick={() => createSuggestedTask(item.text)}
                                    disabled={isCreating}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#F5D547] text-[#0B0E11] text-[11px] font-semibold hover:opacity-90 disabled:opacity-60"
                                  >
                                    {isCreating ? "Creating..." : "Create task"}
                                  </button>
                                )}

                                {item.state === "tracked" && (
                                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[rgba(88,166,255,0.12)] text-[#58A6FF]">
                                    Tracked by task
                                  </span>
                                )}

                                {item.state === "completed" && (
                                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[rgba(74,222,128,0.12)] text-[#4ADE80]">
                                    Completed in tasks
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
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
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[#7D8590]">
                      Completed Items
                    </div>
                    <div className="text-[11px] text-[#484F58]">AI items checked against task completion</div>
                  </div>
                  {completedItemStates.length > 0 ? (
                    <div className="space-y-2">
                      {completedItemStates.map((item: CompletedItemState) => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-[#E6EDF3] flex items-start gap-2">
                                <span className="mt-0.5 text-[#4ADE80]">✓</span>
                                <span>{item.text}</span>
                              </div>
                              {item.taskMatch?.text && (
                                <div className="mt-1 text-[11px] text-[#7D8590]">
                                  Matched task: {item.taskMatch.text}
                                </div>
                              )}
                            </div>

                            {item.state === "confirmed_completed" && (
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[rgba(74,222,128,0.12)] text-[#4ADE80] shrink-0">
                                Confirmed by task state
                              </span>
                            )}

                            {item.state === "still_open" && (
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[rgba(245,213,71,0.12)] text-[#F5D547] shrink-0">
                                Still open in tasks
                              </span>
                            )}

                            {item.state === "ai_only" && (
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[#12161B] text-[#7D8590] border border-[#1E242C] shrink-0">
                                AI only
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
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
        <div className="px-4 py-2 border-t border-[#161B22] shrink-0">
          {!showReplyEditor ? (
            <button
              onClick={() => setShowReplyEditor(true)}
              className="w-full px-4 py-2 rounded-lg border border-[#1E242C] bg-[#0B0E11] text-[#484F58] text-[13px] text-left hover:border-[#4ADE80]/30 hover:text-[#7D8590] transition-all"
            >
              Write a reply...
            </button>
          ) : (
            <div className="flex flex-col gap-1.5">
              <RichTextEditor
                value={replyText}
                onChange={setReplyText}
                placeholder="Write a reply..."
                compact
                minHeight={50}
                autoFocus
                signature={replySignature}
                onAttach={() => replyFileInputRef.current?.click()}
                onDrive={() => openReplyDrivePicker()}
                onTemplate={() => openReplyTemplatePicker()}
              />
              {/* Reply attachments */}
              <input ref={replyFileInputRef} type="file" multiple onChange={async (e) => {
                const files = e.target.files;
                if (!files) return;
                const newAtts: { name: string; size: number; type: string; data: string }[] = [];
                for (let i = 0; i < files.length; i++) {
                  const file = files[i];
                  if (file.size > 25 * 1024 * 1024) continue;
                  const data = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result as string).split(",")[1]);
                    reader.readAsDataURL(file);
                  });
                  newAtts.push({ name: file.name, size: file.size, type: file.type || "application/octet-stream", data });
                }
                setReplyAttachments((prev) => [...prev, ...newAtts]);
                if (replyFileInputRef.current) replyFileInputRef.current.value = "";
              }} className="hidden" />
              {replyAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 py-1">
                  {replyAttachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[10px]">
                      <Paperclip size={10} className="text-[#58A6FF]" />
                      <span className="text-[#E6EDF3] max-w-[120px] truncate">{att.name}</span>
                      <button onClick={() => setReplyAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-[#484F58] hover:text-[#F85149]"><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between items-center">
                <button
                  onClick={() => { setShowReplyEditor(false); setReplyText(""); setReplyAttachments([]); }}
                  className="text-[11px] text-[#484F58] hover:text-[#7D8590] transition-colors"
                >
                  Collapse
                </button>
                <button
                  onClick={handleSendReplyInternal}
                  disabled={sending || (!replyText.replace(/<[^>]*>/g, "").trim() && replyAttachments.length === 0)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] disabled:opacity-40 transition-all text-[11px] font-bold"
                >
                  <Send size={12} />
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>

              {/* Reply Template Picker Modal */}
              {showReplyTemplateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowReplyTemplateModal(false)}>
                  <div className="w-full max-w-lg bg-[#12161B] border border-[#1E242C] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="px-5 py-3 border-b border-[#1E242C] flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-[#E6EDF3]">Insert Template</div>
                        <div className="text-[10px] text-[#484F58]">Click a template to insert into reply</div>
                      </div>
                      <button onClick={() => setShowReplyTemplateModal(false)} className="w-7 h-7 rounded-md text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C] flex items-center justify-center">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto">
                      {replyTemplates.length === 0 ? (
                        <div className="text-center py-8 text-[#484F58] text-[12px]">No templates yet. Create them in Settings.</div>
                      ) : (
                        <div className="p-2 space-y-0.5">
                          {["organization", "personal"].map((scope) => {
                            const scopeTemplates = replyTemplates.filter((t: any) => t.scope === scope);
                            if (scopeTemplates.length === 0) return null;
                            return (
                              <div key={scope}>
                                <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-widest px-3 pt-2 pb-1">
                                  {scope === "organization" ? "🏢 Organization" : "👤 Personal"}
                                </div>
                                {scopeTemplates.map((tpl: any) => (
                                  <button key={tpl.id} onClick={() => { setReplyText(tpl.body); setShowReplyTemplateModal(false); }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#1E242C] text-left transition-colors">
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[12px] font-semibold text-[#E6EDF3]">{tpl.name}</div>
                                      <div className="text-[10px] text-[#484F58] truncate mt-0.5">
                                        {tpl.body.replace(/<[^>]*>/g, "").slice(0, 80)}...
                                      </div>
                                    </div>
                                    {tpl.category && (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-[rgba(88,166,255,0.12)] text-[#58A6FF] shrink-0">{tpl.category}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Reply Drive Picker Modal */}
              {showReplyDrive && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowReplyDrive(false)}>
                  <div className="w-full max-w-md bg-[#12161B] border border-[#1E242C] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="px-5 py-3 border-b border-[#1E242C] flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-[#E6EDF3]">Insert from Google Drive</div>
                        <div className="text-[10px] text-[#484F58]">Click a file to attach it</div>
                      </div>
                      <button onClick={() => setShowReplyDrive(false)} className="w-7 h-7 rounded-md text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C] flex items-center justify-center">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="p-4 max-h-[400px] overflow-y-auto">
                      {replyDrivePath.length > 0 && (
                        <div className="flex items-center gap-1 mb-3 text-[11px] flex-wrap">
                          {replyDrivePath.map((fp, i) => (
                            <span key={fp.id} className="flex items-center gap-1">
                              {i > 0 && <span className="text-[#484F58]">/</span>}
                              <button onClick={() => navigateReplyDrivePath(i)} className="text-[#58A6FF] hover:underline">{fp.name}</button>
                            </span>
                          ))}
                        </div>
                      )}
                      {replyDriveLoading ? (
                        <div className="text-center py-6 text-[#484F58] text-[12px]">Loading...</div>
                      ) : (
                        <div className="space-y-0.5">
                          {replyDriveFolders.map((f) => (
                            <button key={f.id} onClick={() => navigateReplyDriveFolder(f)}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#1E242C] text-left transition-colors">
                              <FolderOpen size={14} className="text-[#F0883E]" />
                              <span className="text-[12px] text-[#E6EDF3]">{f.name}</span>
                            </button>
                          ))}
                          {replyDriveFiles.map((f) => (
                            <button key={f.id} onClick={() => { attachReplyDriveFile(f); setShowReplyDrive(false); }}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[rgba(74,222,128,0.08)] text-left transition-colors">
                              <FileText size={14} className="text-[#58A6FF]" />
                              <span className="text-[12px] text-[#E6EDF3] flex-1 truncate">{f.name}</span>
                            </button>
                          ))}
                          {replyDriveFolders.length === 0 && replyDriveFiles.length === 0 && (
                            <div className="text-[11px] text-[#484F58] py-4 text-center">No files in this folder</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!isReviewTab && (
        <TeamChat
          conversationId={convo.id}
          currentUser={currentUser}
          teamMembers={teamMembers}
        />
      )}

      {showForwardModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-[#1E242C] bg-[#0F1318] shadow-2xl flex flex-col">
      <div className="flex items-center justify-between border-b border-[#1E242C] px-5 py-4 shrink-0">
        <div>
          <div className="text-sm font-semibold text-[#E6EDF3]">Forward Message</div>
          <div className="text-xs text-[#7D8590]">
            Send this conversation content to another recipient
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowForwardModal(false)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] hover:bg-[#181D24]"
          title="Close"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[#7D8590]">To</label>
          <input
            type="text"
            value={forwardTo}
            onChange={(e) => setForwardTo(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[#7D8590]">Cc</label>
          <input
            type="text"
            value={forwardCc}
            onChange={(e) => setForwardCc(e.target.value)}
            placeholder="optional cc recipients"
            className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[#7D8590]">Subject</label>
          <input
            type="text"
            value={forwardSubject}
            onChange={(e) => setForwardSubject(e.target.value)}
            className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[#7D8590]">Message</label>
          <textarea
            value={forwardBody}
            onChange={(e) => setForwardBody(e.target.value)}
            rows={14}
            className="w-full rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#E6EDF3] placeholder:text-[#484F58] outline-none resize-y"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[#1E242C] px-5 py-4 shrink-0 bg-[#0F1318]">
        <div className="text-[11px] text-[#7D8590]">
          Save draft is not wired yet in this forward flow.
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowForwardModal(false)}
            className="px-3 py-2 rounded-lg border border-[#1E242C] text-[#7D8590] text-sm hover:bg-[#181D24]"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSendForward}
            disabled={
              forwardSending ||
              !forwardTo.trim() ||
              !forwardSubject.trim() ||
              !forwardBody.trim()
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-sm font-semibold hover:bg-[#3FCF73] disabled:opacity-50"
          >
            <Send size={14} />
            {forwardSending ? "Sending..." : "Send Forward"}
          </button>
        </div>
      </div>
    </div>
  </div>
)}

    </div>
  );
}