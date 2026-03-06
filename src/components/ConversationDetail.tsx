"use client";

import { useState, useEffect } from "react";
import { Reply, Forward, Archive, Mail, User, Folder, Plus, Check, Send } from "lucide-react";
import { useConversationDetail } from "@/lib/hooks";
import type { ConversationDetailProps } from "@/types";

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

export default function ConversationDetail({
  conversation: convo, currentUser, teamMembers,
  onAddNote, onToggleTask, onAddTask, onAssign, onSendReply,
}: ConversationDetailProps) {
  const [replyText, setReplyText] = useState("");
  const [noteText, setNoteText] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [activeTab, setActiveTab] = useState("messages");
  const [sending, setSending] = useState(false);

  const { notes, tasks, messages } = useConversationDetail(convo?.id || null);

  // Reset on conversation change
  useEffect(() => {
    setActiveTab("messages");
    setShowNoteInput(false);
    setReplyText("");
    setNoteText("");
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

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    await onSendReply(convo.id, replyText.trim());
    setReplyText("");
    setSending(false);
  };

  const tabs = [
    { id: "messages", label: "Messages", count: messages.length },
    { id: "notes", label: "Team Notes", count: notes.length },
    { id: "tasks", label: "Tasks", count: tasks.length },
  ];

  return (
    <div className="flex-1 flex flex-col bg-[#0B0E11] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#1E242C] flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-base font-bold text-[#E6EDF3] truncate tracking-tight mb-1">
            {convo.subject}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-[#7D8590]">{convo.from_name}</span>
            <span className="text-[#484F58]">&lt;{convo.from_email}&gt;</span>
          </div>
        </div>
        <div className="flex gap-1">
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

      {/* Assignment bar */}
      <div className="px-5 py-2 border-b border-[#161B22] flex items-center gap-3 text-xs">
        <div className="flex items-center gap-1.5 text-[#7D8590]">
          <User size={14} />
          {assignee ? (
            <span className="flex items-center gap-1">
              <Avatar initials={assignee.initials} color={assignee.color} size={16} />
              <span className="font-semibold" style={{ color: assignee.color }}>{assignee.name}</span>
            </span>
          ) : (
            <span className="text-[#484F58] italic">Unassigned</span>
          )}
        </div>
        <span className="text-[#161B22]">|</span>
        <div className="flex items-center gap-1 text-[#7D8590]">
          <Folder size={14} />
          <span>{convo.email_account_id}</span>
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

            {tasks.length === 0 && (
              <div className="text-center py-10 text-[#484F58] text-sm">
                No tasks for this conversation
              </div>
            )}
          </div>
        )}
      </div>

      {/* Reply bar */}
      <div className="px-5 py-3 border-t border-[#1E242C] bg-[#12161B]">
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
    </div>
  );
}
