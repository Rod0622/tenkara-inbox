"use client";

import { useState, useEffect, useRef } from "react";
import {
  Reply, Forward, Archive, Mail, User, Folder, Plus, Check, Send,
  ChevronDown, X, AtSign, MessageSquare, Star, MailOpen, Eye, EyeOff, Flag,
  Clock, Tag, UserPlus, UserMinus, CheckCircle, Circle, StickyNote, MailPlus,
} from "lucide-react";
import { useConversationDetail, useLabels } from "@/lib/hooks";
import type { ConversationDetailProps, TeamMember } from "@/types";

function Avatar({ initials, color, size = 28 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold text-[#0B0E11] flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38, background: color }}
    >
      {initials}
    </div>
  );
}

// ── Assign Dropdown ──────────────────────────────────
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
  onAssign: (conversationId: string, assigneeId: string | null, updatedConversation?: any) => Promise<void>;
  conversationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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
      const result = await res.json();
      // Pass the full updated conversation back so parent can update local state
      await onAssign(conversationId, memberId, result.conversation);
    } catch (err) {
      console.error("Assign failed:", err);
    }
    setAssigning(false);
    setOpen(false);
  };

  const isAssignedToMe = currentAssignee?.id === currentUser?.id;

  return (
    <div className="relative flex" ref={dropdownRef}>
      {/* Primary button: Assign to me (or show current assignee) */}
      {currentAssignee ? (
        <button
          onClick={() => setOpen(!open)}
          disabled={assigning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[12px] font-medium hover:bg-[#181D24] transition-all"
        >
          <Avatar initials={currentAssignee.initials} color={currentAssignee.color} size={18} />
          <span style={{ color: currentAssignee.color }}>{currentAssignee.name}</span>
          <ChevronDown size={12} className="text-[#484F58] ml-1" />
        </button>
      ) : (
        <div className="flex">
          {/* Main button: one-click assign to me */}
          <button
            onClick={() => currentUser && handleAssign(currentUser.id)}
            disabled={assigning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg border border-[#1E242C] bg-[#12161B] text-[12px] font-medium hover:bg-[#181D24] transition-all border-r-0"
          >
            <User size={14} className="text-[#4ADE80]" />
            <span className="text-[#E6EDF3]">{assigning ? "Assigning..." : "Assign to me"}</span>
          </button>
          {/* Dropdown arrow for other members */}
          <button
            onClick={() => setOpen(!open)}
            className="flex items-center px-1.5 py-1.5 rounded-r-lg border border-[#1E242C] bg-[#12161B] hover:bg-[#181D24] transition-all"
          >
            <ChevronDown size={12} className="text-[#484F58]" />
          </button>
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1 animate-fade-in">
          <div className="px-3 py-2 border-b border-[#1E242C]">
            <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
              Assign to team member
            </div>
          </div>

          {/* Unassign option */}
          {currentAssignee && (
            <button
              onClick={() => handleAssign(null)}
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[#F85149] hover:bg-[#1E242C] transition-colors"
            >
              <X size={14} />
              <span>Unassign</span>
            </button>
          )}

          {/* Team members */}
          {teamMembers
            .filter((m) => m.is_active !== false)
            .map((member) => {
              const isCurrent = currentAssignee?.id === member.id;
              return (
                <button
                  key={member.id}
                  onClick={() => handleAssign(member.id)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] hover:bg-[#1E242C] transition-colors ${
                    isCurrent ? "text-[#4ADE80]" : "text-[#E6EDF3]"
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
                  {isCurrent && <Check size={14} className="text-[#4ADE80]" />}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ── Team Chat (Internal Comments) ────────────────────
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
  const [showMentions, setShowMentions] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch comments
  useEffect(() => {
    if (!conversationId) return;
    fetchComments();
    // Poll every 5 seconds for new comments (Realtime would be better, but this works)
    const interval = setInterval(fetchComments, 5000);
    return () => clearInterval(interval);
  }, [conversationId]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/comments?conversation_id=${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setComments(data.comments || []);
      }
    } catch (err) {
      console.error("Failed to fetch comments:", err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || !currentUser) return;
    setSending(true);

    // Extract @mentions from input
    const mentionRegex = /@(\w+)/g;
    const mentionNames: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = mentionRegex.exec(input)) !== null) {
      mentionNames.push(match[1].toLowerCase());
    }
    const mentionIds = teamMembers
      .filter((m) =>
        mentionNames.some(
          (name) =>
            m.name.toLowerCase().includes(name) ||
            m.initials.toLowerCase() === name
        )
      )
      .map((m) => m.id);

    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          author_id: currentUser.id,
          body: input.trim(),
          mentions: mentionIds,
        }),
      });
      if (res.ok) {
        setInput("");
        fetchComments();
      }
    } catch (err) {
      console.error("Failed to send comment:", err);
    }
    setSending(false);
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    // Check if user is typing @mention
    const lastAt = value.lastIndexOf("@");
    if (lastAt !== -1 && lastAt === value.length - 1) {
      setShowMentions(true);
      setMentionFilter("");
    } else if (lastAt !== -1) {
      const afterAt = value.slice(lastAt + 1);
      if (!afterAt.includes(" ")) {
        setShowMentions(true);
        setMentionFilter(afterAt.toLowerCase());
      } else {
        setShowMentions(false);
      }
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (member: TeamMember) => {
    const lastAt = input.lastIndexOf("@");
    const before = input.slice(0, lastAt);
    setInput(`${before}@${member.name} `);
    setShowMentions(false);
    inputRef.current?.focus();
  };

  const filteredMembers = teamMembers.filter(
    (m) =>
      m.id !== currentUser?.id &&
      (mentionFilter === "" ||
        m.name.toLowerCase().includes(mentionFilter) ||
        m.initials.toLowerCase().includes(mentionFilter))
  );

  // Render comment body with highlighted @mentions
  const renderCommentBody = (body: string) => {
    const parts = body.split(/(@\w+(?:\s\w+)?)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        return (
          <span key={i} className="text-[#58A6FF] font-semibold">
            {part}
          </span>
        );
      }
      return part;
    });
  };

  return (
    <div className="border-t border-[#1E242C] bg-[#0D1117] flex flex-col" style={{ maxHeight: "280px" }}>
      {/* Chat header */}
      <div className="px-4 py-2 border-b border-[#161B22] flex items-center gap-2 shrink-0">
        <MessageSquare size={13} className="text-[#484F58]" />
        <span className="text-[11px] font-semibold text-[#484F58] uppercase tracking-wider">
          Team Chat
        </span>
        <span className="text-[10px] text-[#484F58] ml-1">
          (internal — not visible to sender)
        </span>
      </div>

      {/* Comments */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2 min-h-[60px]">
        {comments.length === 0 && (
          <div className="text-center py-3 text-[11px] text-[#484F58]">
            No team discussion yet. Start a conversation about this thread.
          </div>
        )}
        {comments.map((comment: any) => (
          <div key={comment.id} className="flex items-start gap-2 animate-fade-in">
            <Avatar
              initials={comment.author?.initials || "?"}
              color={comment.author?.color || "#484F58"}
              size={22}
            />
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-1.5">
                <span
                  className="text-[11px] font-bold"
                  style={{ color: comment.author?.color || "#7D8590" }}
                >
                  {comment.author?.name || "Unknown"}
                </span>
                <span className="text-[10px] text-[#484F58]">
                  {new Date(comment.created_at).toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <div className="text-[12px] text-[#E6EDF3] leading-relaxed mt-0.5">
                {renderCommentBody(comment.body)}
              </div>
            </div>
          </div>
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-[#161B22] relative shrink-0">
        {/* @mention dropdown */}
        {showMentions && filteredMembers.length > 0 && (
          <div className="absolute bottom-full left-3 mb-1 w-52 bg-[#161B22] border border-[#1E242C] rounded-lg shadow-xl py-1 z-50">
            {filteredMembers.map((member) => (
              <button
                key={member.id}
                onClick={() => insertMention(member)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-[#E6EDF3] hover:bg-[#1E242C] transition-colors"
              >
                <Avatar initials={member.initials} color={member.color} size={18} />
                <span className="font-medium">{member.name}</span>
                <span className="text-[#484F58] ml-auto">{member.department}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#0B0E11] focus-within:border-[#484F58] transition-colors">
          <button
            onClick={() => {
              setInput(input + "@");
              setShowMentions(true);
              setMentionFilter("");
              inputRef.current?.focus();
            }}
            className="text-[#484F58] hover:text-[#58A6FF] transition-colors shrink-0"
            title="Mention a teammate"
          >
            <AtSign size={14} />
          </button>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
              if (e.key === "Escape") setShowMentions(false);
            }}
            placeholder="Chat with your team..."
            className="flex-1 bg-transparent border-none outline-none text-[#E6EDF3] text-[12px] placeholder:text-[#484F58]"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || sending}
            className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-all ${
              input.trim() && !sending
                ? "bg-[#4ADE80] text-[#0B0E11] hover:bg-[#3FCF73]"
                : "text-[#484F58]"
            }`}
          >
            <Send size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Activity Timeline Item ──────────────────────────
const ACTIVITY_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  assigned: { icon: UserPlus, color: "#4ADE80", label: "Assigned" },
  unassigned: { icon: UserMinus, color: "#F85149", label: "Unassigned" },
  label_added: { icon: Tag, color: "#58A6FF", label: "Label added" },
  label_removed: { icon: Tag, color: "#7D8590", label: "Label removed" },
  starred: { icon: Star, color: "#F5D547", label: "Starred" },
  unstarred: { icon: Star, color: "#484F58", label: "Unstarred" },
  marked_read: { icon: Eye, color: "#7D8590", label: "Marked as read" },
  marked_unread: { icon: EyeOff, color: "#BC8CFF", label: "Marked as unread" },
  status_changed: { icon: Circle, color: "#39D2C0", label: "Status changed" },
  note_added: { icon: StickyNote, color: "#4ADE80", label: "Note added" },
  task_created: { icon: Plus, color: "#58A6FF", label: "Task created" },
  task_completed: { icon: CheckCircle, color: "#4ADE80", label: "Task completed" },
  task_reopened: { icon: Circle, color: "#F0883E", label: "Task reopened" },
  reply_sent: { icon: Send, color: "#4ADE80", label: "Reply sent" },
  email_composed: { icon: MailPlus, color: "#58A6FF", label: "Email sent" },
  email_received: { icon: Mail, color: "#BC8CFF", label: "Email received" },
  viewed: { icon: Eye, color: "#58A6FF", label: "Viewed" },
};

function ActivityItem({
  activity,
  isLast,
  teamMembers,
}: {
  activity: any;
  isLast: boolean;
  teamMembers: TeamMember[];
}) {
  const config = ACTIVITY_CONFIG[activity.action] || {
    icon: Clock,
    color: "#484F58",
    label: activity.action.replace(/_/g, " "),
  };
  const Icon = config.icon;
  const actor = activity.actor;
  const details = activity.details || {};

  // Build description
  let description = "";
  switch (activity.action) {
    case "assigned": {
      const assignee = teamMembers.find((m) => m.id === details.assignee_id);
      description = assignee ? `to ${assignee.name}` : "";
      break;
    }
    case "unassigned": {
      const prev = teamMembers.find((m) => m.id === details.previous_assignee_id);
      description = prev ? `from ${prev.name}` : "";
      break;
    }
    case "label_added":
    case "label_removed":
      description = details.label_name || "";
      break;
    case "status_changed":
      description = details.status || "";
      break;
    case "note_added":
    case "task_created":
    case "task_completed":
    case "task_reopened":
      description = details.text || details.preview || "";
      break;
    case "reply_sent":
    case "email_composed":
      description = details.to ? `to ${details.to}` : "";
      break;
    default:
      description = "";
  }

  const timeStr = new Date(activity.created_at).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="flex gap-3 relative">
      {/* Timeline line */}
      {!isLast && (
        <div className="absolute left-[13px] top-[28px] bottom-0 w-[1.5px] bg-[#1E242C]" />
      )}

      {/* Icon bubble */}
      <div
        className="w-[28px] h-[28px] rounded-full flex items-center justify-center flex-shrink-0 z-10"
        style={{ background: `${config.color}15`, border: `1.5px solid ${config.color}30` }}
      >
        <Icon size={13} style={{ color: config.color }} />
      </div>

      {/* Content */}
      <div className="flex-1 pb-4 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[12px] font-semibold" style={{ color: config.color }}>
            {config.label}
          </span>
          {description && (
            <span className="text-[11px] text-[#7D8590] truncate max-w-[200px]">
              {description}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {actor && (
            <>
              <Avatar initials={actor.initials} color={actor.color} size={14} />
              <span className="text-[10px] font-medium" style={{ color: actor.color }}>
                {actor.name}
              </span>
              <span className="text-[10px] text-[#484F58]">·</span>
            </>
          )}
          <span className="text-[10px] text-[#484F58]">{timeStr}</span>
        </div>
      </div>
    </div>
  );
}

// ── Label Picker (add/remove labels on thread) ──────
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
  const dropdownRef = useRef<HTMLDivElement>(null);
  const currentLabelIds = new Set(currentLabels.map((cl) => cl.label_id));

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const handleToggleLabel = async (labelId: string) => {
    const isAdding = !currentLabelIds.has(labelId);
    try {
      if (isAdding) {
        await fetch("/api/conversations/labels", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, labelId }),
        });
      } else {
        await fetch("/api/conversations/labels", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, labelId }),
        });
      }
      onToggle();
    } catch (err) {
      console.error("Label toggle failed:", err);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 rounded-md border border-[#1E242C] bg-[#12161B] text-[11px] font-medium text-[#7D8590] hover:bg-[#181D24] transition-all"
      >
        <Tag size={12} />
        <span>Labels</span>
        <ChevronDown size={10} className="text-[#484F58]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1 animate-fade-in">
          <div className="px-3 py-2 border-b border-[#1E242C]">
            <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">Toggle labels</div>
          </div>
          {allLabels.map((label) => {
            const isActive = currentLabelIds.has(label.id);
            return (
              <button
                key={label.id}
                onClick={() => handleToggleLabel(label.id)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] hover:bg-[#1E242C] transition-colors"
              >
                <div className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center transition-all ${
                  isActive ? "border-transparent" : "border-[#484F58]"
                }`} style={isActive ? { background: label.color } : {}}>
                  {isActive && <Check size={10} className="text-[#0B0E11]" />}
                </div>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: label.color }} />
                <span className={isActive ? "text-[#E6EDF3] font-medium" : "text-[#7D8590]"}>{label.name}</span>
              </button>
            );
          })}
          {allLabels.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-[#484F58] text-center">No labels — create some in Settings</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ConversationDetail ──────────────────────────
export default function ConversationDetail({
  conversation: convo, currentUser, teamMembers,
  onAddNote, onToggleTask, onAddTask, onAssign, onSendReply,
}: ConversationDetailProps) {
  const [replyText, setReplyText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [activeTab, setActiveTab] = useState("messages");
  const [sending, setSending] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [showTaskInput, setShowTaskInput] = useState(false);

  const { notes, tasks, messages, activities } = useConversationDetail(convo?.id || null);

  useEffect(() => {
    setActiveTab("messages");
    setShowNoteInput(false);
    setShowTaskInput(false);
    setReplyText("");
    setNoteText("");
    setNewTaskText("");
  }, [convo?.id]);

  // Mark as read when conversation is opened + log viewed activity
  useEffect(() => {
    if (convo?.id) {
      // Log that this user viewed the conversation
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
    }
  }, [convo?.id]);

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

  const assignee = convo.assignee || teamMembers.find((t) => t.id === convo.assignee_id);

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    await onAddNote(convo.id, noteText.trim());
    setNoteText("");
    setShowNoteInput(false);
  };

  const handleAddTask = async () => {
    if (!newTaskText.trim()) return;
    await onAddTask(convo.id, newTaskText.trim());
    setNewTaskText("");
    setShowTaskInput(false);
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    await onSendReply(convo.id, replyText.trim());
    setReplyText("");
    setSending(false);
  };

  const handleToggleRead = async () => {
    try {
      await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          is_unread: !convo.is_unread,
        }),
      });
    } catch (err) {
      console.error("Toggle read failed:", err);
    }
  };

  const handleToggleStar = async () => {
    try {
      await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          is_starred: !convo.is_starred,
        }),
      });
    } catch (err) {
      console.error("Toggle star failed:", err);
    }
  };

  const tabs = [
    { id: "messages", label: "Messages", count: messages.length },
    { id: "notes", label: "Notes", count: notes.length },
    { id: "tasks", label: "Tasks", count: tasks.length },
    { id: "activity", label: "Activity", count: activities.length },
  ];

  return (
    <div className="flex-1 flex flex-col bg-[#0B0E11] overflow-hidden">
      {/* Header with Assign */}
      <div className="px-5 py-3 border-b border-[#1E242C] flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-[#E6EDF3] truncate tracking-tight mb-1">
            {convo.subject}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-[#7D8590]">{convo.from_name}</span>
            <span className="text-[#484F58]">&lt;{convo.from_email}&gt;</span>
          </div>
          {/* Labels row */}
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {(convo.labels || []).map((cl) => cl.label && (
              <span
                key={cl.label_id || cl.label?.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold"
                style={{ background: cl.label.bg_color, color: cl.label.color }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: cl.label.color }} />
                {cl.label.name}
              </span>
            ))}
            <LabelPicker
              conversationId={convo.id}
              currentLabels={convo.labels || []}
              onToggle={() => {
                // Trigger a refetch — the realtime subscription handles this
              }}
            />
          </div>
        </div>

        {/* Action buttons + Assign */}
        <div className="flex items-center gap-2 shrink-0">
          <AssignDropdown
            currentAssignee={assignee}
            currentUser={currentUser}
            teamMembers={teamMembers}
            onAssign={onAssign}
            conversationId={convo.id}
          />
          <div className="flex gap-1">
            {/* Star */}
            <button
              onClick={handleToggleStar}
              title={convo.is_starred ? "Unstar" : "Star"}
              className={`w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] flex items-center justify-center hover:bg-[#181D24] transition-all ${
                convo.is_starred ? "text-[#F5D547]" : "text-[#7D8590]"
              }`}
            >
              <Star size={16} fill={convo.is_starred ? "#F5D547" : "none"} />
            </button>
            {/* Mark unread/read */}
            <button
              onClick={handleToggleRead}
              title={convo.is_unread ? "Mark as read" : "Mark as unread"}
              className="w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] flex items-center justify-center hover:bg-[#181D24] transition-all"
            >
              {convo.is_unread ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            {/* Reply, Forward, Archive */}
            {[
              { icon: Reply, title: "Reply" },
              { icon: Forward, title: "Forward" },
              { icon: Archive, title: "Archive" },
            ].map((btn, i) => {
              const Icon = btn.icon;
              return (
                <button
                  key={i}
                  title={btn.title}
                  className="w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] flex items-center justify-center hover:bg-[#181D24] transition-all"
                >
                  <Icon size={16} />
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tabs */}
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

      {/* Content area */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {/* Messages tab */}
        {activeTab === "messages" && messages.map((msg: any) => (
          <div
            key={msg.id}
            className={`mb-4 p-4 rounded-xl border animate-fade-in ${
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
                  {msg.is_outbound && <span className="text-[10px] text-[#4ADE80] ml-2">Sent</span>}
                </span>
                <span className="text-[11px] text-[#484F58] ml-2">{msg.from_email}</span>
              </div>
              <span className="text-[11px] text-[#484F58]">
                {msg.sent_at ? new Date(msg.sent_at).toLocaleString() : ""}
              </span>
            </div>
            <div className="text-[13px] leading-relaxed text-[#7D8590] whitespace-pre-wrap">
              {msg.body_text || "(No text content)"}
            </div>
          </div>
        ))}

        {activeTab === "messages" && messages.length === 0 && (
          <div className="text-center py-10 text-[#484F58] text-sm">
            No messages yet. Click the sync button (↻) in the sidebar to fetch emails.
          </div>
        )}

        {/* Notes tab */}
        {activeTab === "notes" && (
          <div>
            {notes.map((note) => (
              <div
                key={note.id}
                className="mb-3 p-3.5 rounded-xl bg-[rgba(74,222,128,0.06)] border border-[rgba(74,222,128,0.15)] animate-fade-in"
              >
                <div className="flex items-center gap-1.5 mb-1.5">
                  {note.author && (
                    <Avatar initials={note.author.initials} color={note.author.color} size={20} />
                  )}
                  <span className="text-xs font-semibold text-[#4ADE80]">{note.author?.name}</span>
                  <span className="text-[10px] text-[#484F58] ml-auto">
                    {new Date(note.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="text-[13px] text-[#E6EDF3] leading-relaxed">{note.text}</div>
              </div>
            ))}

            {!showNoteInput ? (
              <button
                onClick={() => setShowNoteInput(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] text-xs font-medium hover:bg-[#181D24] transition-all"
              >
                <Plus size={14} /> Add note
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#12161B] border border-[#4ADE80]">
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Write an internal note... (invisible to customer)"
                  rows={3}
                  autoFocus
                  className="w-full bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] resize-y leading-relaxed placeholder:text-[#484F58]"
                />
                <div className="flex gap-2 justify-end mt-2">
                  <button
                    onClick={() => { setShowNoteInput(false); setNoteText(""); }}
                    className="px-3 py-1.5 rounded text-[#7D8590] text-xs border border-[#1E242C]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddNote}
                    className="px-3.5 py-1.5 rounded bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold"
                  >
                    Add Note
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tasks tab */}
        {activeTab === "tasks" && (
          <div>
            {tasks.map((task) => (
              <div
                key={task.id}
                className={`flex items-start gap-2.5 p-3 mb-2 rounded-lg bg-[#12161B] border border-[#161B22] transition-opacity ${
                  task.is_done ? "opacity-50" : ""
                }`}
              >
                <button
                  onClick={() => onToggleTask(task.id, !task.is_done)}
                  className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 mt-0.5 border-2 transition-all ${
                    task.is_done
                      ? "border-[#4ADE80] bg-[rgba(74,222,128,0.12)]"
                      : "border-[#484F58]"
                  }`}
                >
                  {task.is_done && <Check size={12} className="text-[#4ADE80]" />}
                </button>
                <div className="flex-1">
                  <div className={`text-[13px] font-medium ${task.is_done ? "text-[#484F58] line-through" : "text-[#E6EDF3]"}`}>
                    {task.text}
                  </div>
                  <div className="flex gap-2 mt-1 text-[11px]">
                    {task.assignee && (
                      <span className="flex items-center gap-1" style={{ color: task.assignee.color }}>
                        <Avatar initials={task.assignee.initials} color={task.assignee.color} size={14} />
                        {task.assignee.name}
                      </span>
                    )}
                    {task.due_date && (
                      <span className="text-[#F5D547]">Due: {task.due_date}</span>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {tasks.length === 0 && !showTaskInput && (
              <div className="text-center py-10 text-[#484F58] text-sm">
                No tasks for this conversation
              </div>
            )}

            {/* Add task */}
            {!showTaskInput ? (
              <button
                onClick={() => setShowTaskInput(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-[#1E242C] bg-[#12161B] text-[#7D8590] text-xs font-medium hover:bg-[#181D24] transition-all mt-2"
              >
                <Plus size={14} /> New task
              </button>
            ) : (
              <div className="p-3 rounded-xl bg-[#12161B] border border-[#4ADE80] mt-2">
                <input
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddTask();
                    if (e.key === "Escape") { setShowTaskInput(false); setNewTaskText(""); }
                  }}
                  placeholder="What needs to be done?"
                  autoFocus
                  className="w-full bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] placeholder:text-[#484F58] mb-2"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => { setShowTaskInput(false); setNewTaskText(""); }}
                    className="px-3 py-1.5 rounded text-[#7D8590] text-xs border border-[#1E242C]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddTask}
                    disabled={!newTaskText.trim()}
                    className="px-3.5 py-1.5 rounded bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold"
                  >
                    Add Task
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Activity tab */}
        {activeTab === "activity" && (
          <div className="space-y-0.5">
            {activities.length === 0 && (
              <div className="text-center py-10 text-[#484F58] text-sm">
                No activity recorded yet
              </div>
            )}
            {activities.map((act: any, idx: number) => {
              const isLast = idx === activities.length - 1;
              return (
                <ActivityItem key={act.id} activity={act} isLast={isLast} teamMembers={teamMembers} />
              );
            })}
          </div>
        )}
      </div>

      {/* Reply bar */}
      <div className="px-5 py-3 border-t border-[#1E242C] bg-[#12161B] shrink-0">
        <div className="flex items-end gap-2.5 px-3.5 py-2.5 rounded-xl border border-[#1E242C] bg-[#0B0E11]">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply..."
            rows={1}
            className="flex-1 bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] resize-none leading-relaxed placeholder:text-[#484F58] max-h-[120px]"
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = t.scrollHeight + "px";
            }}
          />
          <button
            onClick={handleSendReply}
            disabled={!replyText.trim() || sending}
            className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${
              replyText.trim() && !sending
                ? "bg-[#4ADE80] text-[#0B0E11] cursor-pointer"
                : "bg-[#1E242C] text-[#484F58]"
            }`}
          >
            <Send size={16} />
          </button>
        </div>
      </div>

      {/* Team Chat — always visible at bottom */}
      <TeamChat
        conversationId={convo.id}
        currentUser={currentUser}
        teamMembers={teamMembers}
      />
    </div>
  );
}