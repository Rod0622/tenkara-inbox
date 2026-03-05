"use client";

import { useMemo } from "react";
import { Search } from "lucide-react";
import type { ConversationListProps, Conversation, TeamMember } from "@/types";

function Avatar({ initials, color, size = 20 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold text-[#0B0E11] flex-shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.4, background: color }}
    >
      {initials}
    </div>
  );
}

function LabelBadge({ name, color, bgColor }: { name: string; color: string; bgColor: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold whitespace-nowrap"
      style={{ background: bgColor, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {name}
    </span>
  );
}

function groupByDate(convos: Conversation[]): Record<string, Conversation[]> {
  const groups: Record<string, Conversation[]> = {};
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  convos.forEach((c) => {
    const d = new Date(c.last_message_at);
    let label: string;
    if (d >= today) label = "Today";
    else if (d >= yesterday) label = "Yesterday";
    else if (d >= weekAgo) label = "This Week";
    else label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    if (!groups[label]) groups[label] = [];
    groups[label].push(c);
  });

  return groups;
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  if (d >= today) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function ConversationList({
  conversations, activeConvo, setActiveConvo, searchQuery, setSearchQuery, teamMembers,
}: ConversationListProps) {
  const grouped = useMemo(() => groupByDate(conversations), [conversations]);

  return (
    <div className="w-[360px] min-w-[360px] h-full bg-[#12161B] border-r border-[#1E242C] flex flex-col overflow-hidden">
      {/* Search */}
      <div className="p-3 pb-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
          <Search size={16} className="text-[#484F58]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="flex-1 bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] placeholder:text-[#484F58]"
          />
          <span className="text-[11px] text-[#484F58] bg-[#1E242C] px-1.5 py-0.5 rounded">⌘K</span>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-1.5">
        {Object.entries(grouped).map(([date, convos]) => (
          <div key={date}>
            <div className="text-[11px] font-semibold text-[#484F58] px-2.5 pt-3 pb-1.5 tracking-wide">
              {date}
            </div>
            {convos.map((c) => {
              const isActive = activeConvo?.id === c.id;
              const assignee = c.assignee || teamMembers.find((t) => t.id === c.assignee_id);
              const labels = c.labels?.map((cl) => cl.label).filter(Boolean) || [];

              return (
                <button
                  key={c.id}
                  onClick={() => setActiveConvo(c)}
                  className={`relative flex gap-2.5 p-2.5 mb-0.5 rounded-lg w-full text-left transition-all ${
                    isActive ? "bg-[#1E242C]" : "hover:bg-[#181D24]"
                  }`}
                >
                  {/* Unread dot */}
                  {c.is_unread && (
                    <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-[#4ADE80]" />
                  )}

                  <div className="flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex items-center gap-1.5 mb-0.5">
                      {assignee && (
                        <Avatar initials={assignee.initials} color={assignee.color} size={18} />
                      )}
                      <span className={`text-[13px] truncate flex-1 ${c.is_unread ? "font-bold text-[#E6EDF3]" : "font-medium text-[#7D8590]"}`}>
                        {c.from_name}
                      </span>
                      <span className="text-[11px] text-[#484F58] tabular-nums whitespace-nowrap">
                        {formatTime(c.last_message_at)}
                      </span>
                    </div>

                    {/* Subject */}
                    <div className={`text-[12.5px] truncate mb-1 ${c.is_unread ? "font-semibold text-[#E6EDF3]" : "text-[#7D8590]"}`}>
                      {c.subject}
                    </div>

                    {/* Preview */}
                    <div className="text-[11.5px] text-[#484F58] truncate mb-1.5">
                      {c.preview}
                    </div>

                    {/* Labels */}
                    {labels.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        {labels.map((l) => l && (
                          <LabelBadge key={l.id} name={l.name} color={l.color} bgColor={l.bg_color} />
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}

        {conversations.length === 0 && (
          <div className="text-center py-16 text-[#484F58] text-sm">
            No conversations found
          </div>
        )}
      </div>
    </div>
  );
}
