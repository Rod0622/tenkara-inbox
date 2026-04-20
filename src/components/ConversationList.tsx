"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search, Filter, X, Calendar, User, Mail, ChevronDown, Star, MailOpen, Archive, Trash2, Check, Paperclip, AlarmClock, Tag } from "lucide-react";
import type { ConversationListProps, Conversation, TeamMember } from "@/types";
import { createBrowserClient } from "@/lib/supabase";

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

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} className="bg-[#F5D547]/40 text-[#E6EDF3] rounded px-0.5">{part}</mark>
      : part
  );
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
  dateRange: "all" | "today" | "yesterday" | "week" | "month" | "custom";
  dateFrom: string;
  dateTo: string;
  assignedTo: string | null;
  unreadOnly: boolean;
  starredOnly: boolean;
  fromEmail: string;
  labelIds: string[];
  labelLogic: "and" | "or";
}

const defaultFilters: Filters = {
  dateRange: "all",
  dateFrom: "",
  dateTo: "",
  assignedTo: null,
  unreadOnly: false,
  starredOnly: false,
  fromEmail: "",
  labelIds: [],
  labelLogic: "or",
};

function LabelFilter({ filters, setFilters }: { filters: Filters; setFilters: (f: Filters) => void }) {
  const [labels, setLabels] = useState<any[]>([]);

  useEffect(() => {
    const sb = createBrowserClient();
    sb.from("labels").select("*").order("name").then(({ data }) => setLabels(data || []));
  }, []);

  if (labels.length === 0) return null;

  const toggleLabel = (labelId: string) => {
    const current = filters.labelIds || [];
    const next = current.includes(labelId) ? current.filter((id) => id !== labelId) : [...current, labelId];
    setFilters({ ...filters, labelIds: next });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold text-[#484F58] uppercase">Labels</span>
        {(filters.labelIds || []).length > 1 && (
          <button
            onClick={() => setFilters({ ...filters, labelLogic: filters.labelLogic === "and" ? "or" : "and" })}
            className="px-2 py-0.5 rounded text-[9px] font-bold border border-[#1E242C] text-[#58A6FF] hover:bg-[#12161B] transition-colors"
          >
            {filters.labelLogic === "and" ? "AND" : "OR"}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {labels.map((label) => {
          const isActive = (filters.labelIds || []).includes(label.id);
          return (
            <button
              key={label.id}
              onClick={() => toggleLabel(label.id)}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all flex items-center gap-1 ${
                isActive ? "ring-1 ring-white/30" : "opacity-60 hover:opacity-100"
              }`}
              style={{ background: isActive ? label.bg_color : label.bg_color + "60", color: label.color }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: label.color }} />
              {label.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const handlePresetClick = (preset: string) => {
    if (preset === "custom") {
      setFilters({ ...filters, dateRange: "custom" });
    } else {
      setFilters({ ...filters, dateRange: preset as any, dateFrom: "", dateTo: "" });
    }
  };

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

      {/* Date Range — Presets */}
      <div className="mb-2.5">
        <div className="text-[10px] font-semibold text-[#484F58] mb-1 flex items-center gap-1">
          <Calendar size={10} /> Date
        </div>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {[
            { value: "all", label: "All" },
            { value: "today", label: "Today" },
            { value: "yesterday", label: "Yesterday" },
            { value: "week", label: "This Week" },
            { value: "month", label: "This Month" },
            { value: "custom", label: "Custom" },
          ].map((opt) => (
            <button
              key={opt.value}
              onClick={() => handlePresetClick(opt.value)}
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

        {/* Custom Date Range Inputs */}
        {filters.dateRange === "custom" && (
          <div className="flex items-center gap-2 mt-1.5 animate-fade-in">
            <div className="flex-1">
              <label className="text-[9px] text-[#484F58] uppercase font-semibold tracking-wider block mb-0.5">From</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                className="w-full px-2 py-1 rounded bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]/40 [color-scheme:dark]"
              />
            </div>
            <div className="text-[#484F58] text-[10px] pt-3">→</div>
            <div className="flex-1">
              <label className="text-[9px] text-[#484F58] uppercase font-semibold tracking-wider block mb-0.5">To</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                className="w-full px-2 py-1 rounded bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]/40 [color-scheme:dark]"
              />
            </div>
            {(filters.dateFrom || filters.dateTo) && (
              <button
                onClick={() => setFilters({ ...filters, dateFrom: "", dateTo: "" })}
                className="pt-3 text-[#484F58] hover:text-[#F85149] transition-colors"
                title="Clear dates"
              >
                <X size={12} />
              </button>
            )}
          </div>
        )}
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
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0"
                style={{ background: filters.assignedTo === m.id ? "#0B0E11" : m.color, color: filters.assignedTo === m.id ? "#4ADE80" : "#0B0E11" }}>
                {m.initials}
              </span>
              {m.name}
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

      {/* Labels filter */}
      <LabelFilter filters={filters} setFilters={setFilters} />

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
  conversations, activeConvo, setActiveConvo, searchQuery, setSearchQuery,
  searchScope = "all", setSearchScope, activeMailbox, activeFolder, emailAccounts = [], folders = [],
  teamMembers, onBulkAction, searchSnippets, searchTaskResults = [], onOpenConversation,
}: ConversationListProps & { searchTaskResults?: any[]; onOpenConversation?: (id: string) => void }) {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [highlightedConvoId, setHighlightedConvoId] = useState<string | null>(null);
  const highlightConvoRef = useRef<HTMLDivElement>(null);
  const [reminderConvoIds, setReminderConvoIds] = useState<Record<string, string>>({}); // convo_id -> remind_at
  const [searchTab, setSearchTab] = useState<"conversations" | "tasks">("conversations");
  const [taskUserFilter, setTaskUserFilter] = useState<string>("all");

  // Reset search tab when query changes
  useEffect(() => {
    setSearchTab("conversations");
    setTaskUserFilter("all");
  }, [searchQuery]);

  // Fetch active reminders to show alarm icons
  useEffect(() => {
    const sb = createBrowserClient();
    sb.from("follow_up_reminders")
      .select("conversation_id, remind_at")
      .eq("is_fired", false)
      .eq("is_dismissed", false)
      .then(({ data }) => {
        const map: Record<string, string> = {};
        for (const r of (data || [])) {
          map[r.conversation_id] = r.remind_at;
        }
        setReminderConvoIds(map);
      });
  }, [conversations]); // refresh when conversations change

  // Check URL hash for highlight param
  useEffect(() => {
    const checkHash = () => {
      const hash = window.location.hash.replace(/^#/, "");
      const params = new URLSearchParams(hash);
      if (params.get("highlight") === "true" && params.get("conversation")) {
        setHighlightedConvoId(params.get("conversation"));
        const timer = setTimeout(() => {
          setHighlightedConvoId(null);
          // Clean the highlight param but keep conversation
          const convoId = params.get("conversation");
          if (convoId) window.location.hash = "conversation=" + convoId;
        }, 5000);
        return () => clearTimeout(timer);
      }
    };
    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, []);

  // Scroll highlighted conversation into view
  useEffect(() => {
    if (highlightedConvoId && highlightConvoRef.current) {
      highlightConvoRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedConvoId]);

  const hasActiveFilters =
    filters.dateRange !== "all" ||
    filters.assignedTo !== null ||
    filters.unreadOnly ||
    filters.starredOnly ||
    filters.fromEmail !== "" ||
    filters.dateFrom !== "" ||
    filters.dateTo !== "" ||
    (filters.labelIds || []).length > 0;

  // Apply filters
  const filteredConversations = useMemo(() => {
    let result = conversations;

    // Date range
    if (filters.dateRange === "custom") {
      if (filters.dateFrom) {
        const from = new Date(filters.dateFrom);
        from.setHours(0, 0, 0, 0);
        result = result.filter((c) => new Date(c.last_message_at) >= from);
      }
      if (filters.dateTo) {
        const to = new Date(filters.dateTo);
        to.setHours(23, 59, 59, 999);
        result = result.filter((c) => new Date(c.last_message_at) <= to);
      }
    } else if (filters.dateRange !== "all") {
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

    // Label filter
    if ((filters.labelIds || []).length > 0) {
      result = result.filter((c) => {
        const convoLabelIds = (c.labels || []).map((cl: any) => cl.label_id || cl.label?.id).filter(Boolean);
        if (filters.labelLogic === "and") {
          return filters.labelIds.every((id) => convoLabelIds.includes(id));
        } else {
          return filters.labelIds.some((id) => convoLabelIds.includes(id));
        }
      });
    }

    return result;
  }, [conversations, filters]);

  const grouped = useMemo(() => groupByDate(filteredConversations), [filteredConversations]);

  // Clean up selected IDs when conversations change
  useEffect(() => {
    const validIds = new Set(filteredConversations.map((c) => c.id));
    setSelectedIds((prev) => {
      const cleaned = new Set(Array.from(prev).filter((id) => validIds.has(id)));
      return cleaned.size !== prev.size ? cleaned : prev;
    });
  }, [filteredConversations]);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === filteredConversations.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredConversations.map((c) => c.id)));
    }
  };

  const handleBulkAction = async (action: string, payload?: any) => {
    if (!onBulkAction || selectedIds.size === 0) return;
    await onBulkAction(Array.from(selectedIds), action, payload);
    setSelectedIds(new Set());
  };

  const isSelecting = selectedIds.size > 0;

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

        {/* Search scope selector — visible when searching */}
        {searchQuery.trim().length >= 1 && setSearchScope && (
          <div className="flex items-center gap-1 mt-1.5 px-1">
            {([
              { id: "all" as const, label: "All Accounts" },
              ...(activeMailbox ? [{ id: "account" as const, label: emailAccounts.find((a: any) => a.id === activeMailbox)?.name || "This Account" }] : []),
              ...(activeFolder ? [{ id: "folder" as const, label: folders.find((f: any) => f.id === activeFolder)?.name || "This Folder" }] : []),
            ]).map((scope) => (
              <button
                key={scope.id}
                onClick={() => setSearchScope(scope.id)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  searchScope === scope.id
                    ? "bg-[#4ADE80]/12 text-[#4ADE80] border border-[#4ADE80]/30"
                    : "text-[#484F58] hover:text-[#7D8590] border border-[#1E242C]"
                }`}
              >
                {scope.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Bulk action bar */}
      {isSelecting && (
        <div className="px-3 pb-2 animate-fade-in">
          <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[#161B22] border border-[#1E242C]">
            <button
              onClick={selectAll}
              className="flex items-center gap-1.5 text-[11px] font-medium text-[#E6EDF3] hover:text-[#4ADE80] transition-colors mr-1"
            >
              <div className={`w-3.5 h-3.5 rounded border-[1.5px] flex items-center justify-center transition-all ${
                selectedIds.size === filteredConversations.length
                  ? "border-[#4ADE80] bg-[#4ADE80]"
                  : "border-[#484F58]"
              }`}>
                {selectedIds.size === filteredConversations.length && (
                  <Check size={9} className="text-[#0B0E11]" />
                )}
              </div>
              <span className="text-[#4ADE80] tabular-nums">{selectedIds.size}</span>
            </button>

            <div className="w-px h-4 bg-[#1E242C] mx-0.5" />

            <button
              onClick={() => handleBulkAction("star")}
              className="p-1.5 rounded hover:bg-[#1E242C] text-[#7D8590] hover:text-[#F5D547] transition-all"
              title="Star selected"
            >
              <Star size={13} />
            </button>
            <button
              onClick={() => handleBulkAction("mark_unread")}
              className="p-1.5 rounded hover:bg-[#1E242C] text-[#7D8590] hover:text-[#BC8CFF] transition-all"
              title="Mark as unread"
            >
              <MailOpen size={13} />
            </button>
            <button
              onClick={() => handleBulkAction("archive")}
              className="p-1.5 rounded hover:bg-[#1E242C] text-[#7D8590] hover:text-[#58A6FF] transition-all"
              title="Archive selected"
            >
              <Archive size={13} />
            </button>
            <button
              onClick={() => handleBulkAction("delete")}
              className="p-1.5 rounded hover:bg-[#1E242C] text-[#7D8590] hover:text-[#F85149] transition-all"
              title="Delete selected"
            >
              <Trash2 size={13} />
            </button>

            <div className="flex-1" />

            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1 rounded text-[#484F58] hover:text-[#7D8590] transition-colors"
              title="Clear selection"
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

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
      {/* Search result tabs — Conversations vs Tasks */}
      {searchQuery.trim().length >= 2 && searchTaskResults && searchTaskResults.length > 0 && (
        <div className="px-3 pb-1">
          <div className="flex items-center gap-1">
            <button onClick={() => setSearchTab("conversations")}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${searchTab === "conversations" ? "bg-[#1E242C] text-[#E6EDF3]" : "text-[#484F58] hover:text-[#7D8590]"}`}>
              Conversations ({conversations.length})
            </button>
            <button onClick={() => setSearchTab("tasks")}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${searchTab === "tasks" ? "bg-[#1E242C] text-[#E6EDF3]" : "text-[#484F58] hover:text-[#7D8590]"}`}>
              Tasks ({searchTaskResults.length})
            </button>
          </div>
        </div>
      )}

      {/* Task search results */}
      {searchQuery.trim().length >= 2 && searchTab === "tasks" && searchTaskResults && searchTaskResults.length > 0 && (
        <div className="flex-1 overflow-y-auto px-1.5">
          {/* User filter */}
          <div className="px-2.5 py-2 flex items-center gap-1 flex-wrap">
            <span className="text-[9px] text-[#484F58] uppercase">Filter:</span>
            <button onClick={() => setTaskUserFilter("all")}
              className={`px-2 py-0.5 rounded text-[9px] font-medium ${taskUserFilter === "all" ? "bg-[#4ADE80]/12 text-[#4ADE80] border border-[#4ADE80]/30" : "text-[#484F58] border border-[#1E242C]"}`}>
              All
            </button>
            {teamMembers.filter(m => searchTaskResults!.some((t: any) => (t.task_assignees || []).some((a: any) => a.team_member_id === m.id))).map(m => (
              <button key={m.id} onClick={() => setTaskUserFilter(taskUserFilter === m.id ? "all" : m.id)}
                className={`px-2 py-0.5 rounded text-[9px] font-medium flex items-center gap-1 ${taskUserFilter === m.id ? "bg-[#4ADE80]/12 text-[#4ADE80] border border-[#4ADE80]/30" : "text-[#484F58] border border-[#1E242C]"}`}>
                <span className="w-3 h-3 rounded-full flex items-center justify-center text-[6px] font-bold text-[#0B0E11]" style={{ background: m.color }}>{m.initials}</span>
                {m.name.split(" ")[0]}
              </button>
            ))}
          </div>
          {searchTaskResults
            .filter((t: any) => taskUserFilter === "all" || (t.task_assignees || []).some((a: any) => a.team_member_id === taskUserFilter))
            .map((t: any) => {
              const assignees = (t.task_assignees || []).map((a: any) => a.team_member || {});
              const statusColors: Record<string, string> = { todo: "#58A6FF", in_progress: "#F5D547", completed: "#4ADE80", dismissed: "#F0883E" };
              return (
                <div key={t.id}
                  className="relative flex flex-col gap-1 p-2.5 mb-0.5 rounded-lg hover:bg-[#181D24] cursor-pointer transition-all"
                  onClick={() => t.conversation?.id && onOpenConversation?.(t.conversation.id)}
                >
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: statusColors[t.status] || "#484F58" }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-[#E6EDF3] leading-tight">{t.text}</div>
                      {t.conversation?.subject && (
                        <div className="text-[10px] text-[#484F58] truncate mt-0.5">Thread: {t.conversation.subject}</div>
                      )}
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-[9px] px-1.5 py-0.5 rounded border border-[#1E242C] text-[#7D8590]">{t.status}</span>
                        {t.category && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: (t.category.color || "#484F58") + "20", color: t.category.color || "#484F58" }}>{t.category.name}</span>
                        )}
                        {t.due_date && (
                          <span className="text-[9px] text-[#F0883E]">{t.due_date}</span>
                        )}
                        {assignees.map((a: any) => (
                          <span key={a.id} className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-[#0B0E11]" style={{ background: a.color || "#484F58" }} title={a.name}>{(a.initials || "?").slice(0, 2)}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          {searchTaskResults.filter((t: any) => taskUserFilter === "all" || (t.task_assignees || []).some((a: any) => a.team_member_id === taskUserFilter)).length === 0 && (
            <div className="text-center py-8 text-[#484F58] text-[11px]">No tasks match this filter</div>
          )}
        </div>
      )}

      {/* Conversation list — hide when showing task search results */}
      {(searchTab === "conversations" || searchQuery.trim().length < 2 || !searchTaskResults || searchTaskResults.length === 0) && (
      <div className="flex-1 overflow-y-auto px-1.5">
        {Object.entries(grouped).map(([date, convos]) => (
          <div key={date}>
            <div className="text-[11px] font-semibold text-[#484F58] px-2.5 pt-3 pb-1.5 tracking-wide">
              {date}
            </div>
            {convos.map((c) => {
              const isActive = activeConvo?.id === c.id;
              const isSelected = selectedIds.has(c.id);
              const assignee = c.assignee || teamMembers.find((t) => t.id === c.assignee_id);
              const labels = c.labels?.map((cl) => cl.label).filter(Boolean) || [];

              return (
                <div
                  key={c.id}
                  ref={c.id === highlightedConvoId ? highlightConvoRef : undefined}
                  draggable
                  onDragStart={(e) => {
                    const dragIds = isSelected && selectedIds.size > 0
                      ? Array.from(selectedIds)
                      : [c.id];
                    e.dataTransfer.setData("text/conversation-ids", JSON.stringify(dragIds));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className={`relative flex gap-2 p-2.5 mb-0.5 rounded-lg w-full text-left transition-all cursor-pointer group ${
                    c.id === highlightedConvoId
                      ? "bg-[#4ADE80]/10 ring-2 ring-[#4ADE80]/30 border border-[#4ADE80]"
                      : isActive ? "bg-[#1E242C]" : isSelected ? "bg-[rgba(74,222,128,0.06)]" : "hover:bg-[#181D24]"
                  }`}
                  onClick={() => setActiveConvo(c)}
                >
                  {/* Checkbox */}
                  <div
                    className={`flex-shrink-0 mt-1 transition-all ${isSelecting ? "w-5 opacity-100" : "w-0 opacity-0 group-hover:w-5 group-hover:opacity-100"}`}
                    onClick={(e) => toggleSelect(c.id, e)}
                  >
                    <div className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center transition-all cursor-pointer ${
                      isSelected
                        ? "border-[#4ADE80] bg-[#4ADE80]"
                        : "border-[#484F58] hover:border-[#7D8590]"
                    }`}>
                      {isSelected && <Check size={10} className="text-[#0B0E11]" />}
                    </div>
                  </div>

                  {/* Unread dot */}
                  {c.is_unread && !isSelecting && (
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
                      {reminderConvoIds[c.id] && (
                        <span className="text-[#F0883E] flex-shrink-0" title={"Follow-up: " + new Date(reminderConvoIds[c.id]).toLocaleString()}>
                          <AlarmClock size={12} />
                        </span>
                      )}
                      <span className="text-[11px] text-[#484F58] tabular-nums whitespace-nowrap">
                        {formatTime(c.last_message_at)}
                      </span>
                    </div>

                    {/* Subject */}
                    <div className={`text-[12.5px] truncate mb-1 flex items-center gap-1 ${c.is_unread ? "font-semibold text-[#E6EDF3]" : "text-[#7D8590]"}`}>
                      {(c as any).has_attachments && <Paperclip size={11} className="text-[#484F58] flex-shrink-0" />}
                      <span className="truncate">{searchQuery.trim().length >= 2 ? highlightText(c.subject, searchQuery) : c.subject}</span>
                    </div>

                    {/* Preview / Search snippet */}
                    <div className="text-[11.5px] text-[#484F58] truncate mb-1.5">
                      {searchQuery.trim().length >= 2 && searchSnippets?.[c.id] ? (
                        <span>{highlightText(searchSnippets[c.id], searchQuery)}</span>
                      ) : (
                        c.preview
                      )}
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
                </div>
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
      )}
    </div>
  );
}