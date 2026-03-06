"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Search, Filter, X, Calendar, User, Mail, ChevronDown } from "lucide-react";
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

// ── Filter Panel ─────────────────────────────────────
interface Filters {
  dateRange: "all" | "today" | "yesterday" | "week" | "month";
  assignedTo: string | null; // team member id or null for any
  unreadOnly: boolean;
  starredOnly: boolean;
  fromEmail: string;
}

const defaultFilters: Filters = {
  dateRange: "all",
  assignedTo: null,
  unreadOnly: false,
  starredOnly: false,
  fromEmail: "",
};

function FilterPanel({
  filters,
  setFilters,
  teamMembers,
  onClose,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  teamMembers: TeamMember[];
  onClose: () => void;
}) {
  return (
    <div className="p-3 border-b border-[#1E242C] bg-[#0D1117] animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-[#484F58] uppercase tracking-wider">Filters</span>
        <div className="flex gap-2">
          <button
            onClick={() => setFilters(defaultFilters)}
            className="text-[10px] text-[#484F58] hover:text-[#7D8590] transition-colors"
          >
            Clear all
          </button>
          <button onClick={onClose} className="text-[#484F58] hover:text-[#7D8590]">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Date Range */}
      <div className="mb-2.5">
        <div className="text-[10px] font-semibold text-[#484F58] mb-1 flex items-center gap-1">
          <Calendar size={10} /> Date
        </div>
        <div className="flex flex-wrap gap-1">
          {[
            { value: "all", label: "All" },
            { value: "today", label: "Today" },
            { value: "yesterday", label: "Yesterday" },
            { value: "week", label: "This Week" },
            { value: "month", label: "This Month" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilters({ ...filters, dateRange: opt.value as any })}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                filters.dateRange === opt.value
                  ? "bg-[#4ADE80] text-[#0B0E11]"
                  : "bg-[#1E242C] text-[#7D8590] hover:bg-[#242930]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Assigned To */}
      <div className="mb-2.5">
        <div className="text-[10px] font-semibold text-[#484F58] mb-1 flex items-center gap-1">
          <User size={10} /> Assigned to
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilters({ ...filters, assignedTo: null })}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              filters.assignedTo === null
                ? "bg-[#4ADE80] text-[#0B0E11]"
                : "bg-[#1E242C] text-[#7D8590] hover:bg-[#242930]"
            }`}
          >
            Anyone
          </button>
          <button
            onClick={() => setFilters({ ...filters, assignedTo: "unassigned" })}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              filters.assignedTo === "unassigned"
                ? "bg-[#4ADE80] text-[#0B0E11]"
                : "bg-[#1E242C] text-[#7D8590] hover:bg-[#242930]"
            }`}
          >
            Unassigned
          </button>
          {teamMembers.slice(0, 6).map((m) => (
            <button
              key={m.id}
              onClick={() => setFilters({ ...filters, assignedTo: m.id })}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                filters.assignedTo === m.id
                  ? "bg-[#4ADE80] text-[#0B0E11]"
                  : "bg-[#1E242C] text-[#7D8590] hover:bg-[#242930]"
              }`}
            >
              {m.initials}
            </button>
          ))}
        </div>
      </div>

      {/* From email */}
      <div className="mb-2.5">
        <div className="text-[10px] font-semibold text-[#484F58] mb-1 flex items-center gap-1">
          <Mail size={10} /> From / To
        </div>
        <input
          value={filters.fromEmail}
          onChange={(e) => setFilters({ ...filters, fromEmail: e.target.value })}
          placeholder="Filter by email address..."
          className="w-full px-2 py-1 rounded bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] placeholder:text-[#484F58] outline-none focus:border-[#4ADE80]/40"
        />
      </div>

      {/* Quick toggles */}
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-[10px] text-[#7D8590] cursor-pointer">
          <input
            type="checkbox"
            checked={filters.unreadOnly}
            onChange={(e) => setFilters({ ...filters, unreadOnly: e.target.checked })}
            className="accent-[#4ADE80] w-3 h-3"
          />
          Unread only
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-[#7D8590] cursor-pointer">
          <input
            type="checkbox"
            checked={filters.starredOnly}
            onChange={(e) => setFilters({ ...filters, starredOnly: e.target.checked })}
            className="accent-[#4ADE80] w-3 h-3"
          />
          Starred only
        </label>
      </div>
    </div>
  );
}

// ── Main ConversationList ────────────────────────────
export default function ConversationList({
  conversations, activeConvo, setActiveConvo, searchQuery, setSearchQuery, teamMembers,
}: ConversationListProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);

  const hasActiveFilters =
    filters.dateRange !== "all" ||
    filters.assignedTo !== null ||
    filters.unreadOnly ||
    filters.starredOnly ||
    filters.fromEmail !== "";

  // Apply filters
  const filteredConversations = useMemo(() => {
    let result = conversations;

    // Date range
    if (filters.dateRange !== "all") {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      let cutoff: Date;
      switch (filters.dateRange) {
        case "today": cutoff = today; break;
        case "yesterday": cutoff = new Date(today.getTime() - 86400000); break;
        case "week": cutoff = new Date(today.getTime() - 7 * 86400000); break;
        case "month": cutoff = new Date(today.getTime() - 30 * 86400000); break;
        default: cutoff = new Date(0);
      }
      result = result.filter((c) => new Date(c.last_message_at) >= cutoff);
    }

    // Assigned to
    if (filters.assignedTo === "unassigned") {
      result = result.filter((c) => !c.assignee_id);
    } else if (filters.assignedTo) {
      result = result.filter((c) => c.assignee_id === filters.assignedTo);
    }

    // Unread only
    if (filters.unreadOnly) {
      result = result.filter((c) => c.is_unread);
    }

    // Starred only
    if (filters.starredOnly) {
      result = result.filter((c) => c.is_starred);
    }

    // From email filter
    if (filters.fromEmail.trim()) {
      const q = filters.fromEmail.toLowerCase();
      result = result.filter(
        (c) =>
          c.from_email?.toLowerCase().includes(q) ||
          c.from_name?.toLowerCase().includes(q)
      );
    }

    return result;
  }, [conversations, filters]);

  const grouped = useMemo(() => groupByDate(filteredConversations), [filteredConversations]);

  return (
    <div className="w-[360px] min-w-[360px] h-full bg-[#12161B] border-r border-[#1E242C] flex flex-col overflow-hidden">
      {/* Search + Filter toggle */}
      <div className="p-3 pb-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
          <Search size={16} className="text-[#484F58]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="flex-1 bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] placeholder:text-[#484F58]"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-all ${
              hasActiveFilters
                ? "bg-[rgba(74,222,128,0.12)] text-[#4ADE80]"
                : "text-[#484F58] hover:text-[#7D8590]"
            }`}
            title="Filters"
          >
            <Filter size={12} />
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-[#4ADE80]" />}
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <FilterPanel
          filters={filters}
          setFilters={setFilters}
          teamMembers={teamMembers}
          onClose={() => setShowFilters(false)}
        />
      )}

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
                      {c.is_starred && <span className="text-[#F5D547] text-[12px]">★</span>}
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

        {filteredConversations.length === 0 && (
          <div className="text-center py-16 text-[#484F58] text-sm">
            {hasActiveFilters ? "No conversations match your filters" : "No conversations found"}
          </div>
        )}
      </div>
    </div>
  );
}