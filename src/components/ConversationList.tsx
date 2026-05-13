"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { Search, Filter, X, Calendar, User, Mail, ChevronDown, Star, MailOpen, Archive, Trash2, Check, Paperclip, AlarmClock, Tag, RotateCcw } from "lucide-react";
import type { ConversationListProps, Conversation, TeamMember } from "@/types";
import { createBrowserClient } from "@/lib/supabase";

function Avatar({ initials, color, size = 20 }: { initials: string; color: string; size?: number }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-semibold text-[var(--bg)] flex-shrink-0"
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
      ? <mark key={i} className="bg-[var(--highlight)]/40 text-[var(--text-primary)] rounded px-0.5">{part}</mark>
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
        <span className="text-[10px] font-semibold text-[var(--text-muted)] uppercase">Labels</span>
        {(filters.labelIds || []).length > 1 && (
          <button
            onClick={() => setFilters({ ...filters, labelLogic: filters.labelLogic === "and" ? "or" : "and" })}
            className="px-2 py-0.5 rounded text-[9px] font-bold border border-[var(--border)] text-[var(--info)] hover:bg-[var(--surface)] transition-colors"
          >
            {filters.labelLogic === "and" ? "AND" : "OR"}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {labels.map((label) => {
          const isActive = (filters.labelIds || []).includes(label.id);
          // Batch 8: show "Parent / Child" if this label has a parent
          const parent = label.parent_label_id ? labels.find((l) => l.id === label.parent_label_id) : null;
          const display = parent ? `${parent.name} / ${label.name}` : label.name;
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
              {display}
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
    <div className="p-3 border-b border-[var(--border)] bg-[var(--surface)] animate-fade-in">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Filters</span>
        <div className="flex gap-2">
          <button
            onClick={() => setFilters(defaultFilters)}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Clear all
          </button>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Date Range — Presets */}
      <div className="mb-2.5">
        <div className="text-[10px] font-semibold text-[var(--text-muted)] mb-1 flex items-center gap-1">
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
                  ? "bg-[var(--accent)] text-[var(--bg)]"
                  : "bg-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border)]"
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
              <label className="text-[9px] text-[var(--text-muted)] uppercase font-semibold tracking-wider block mb-0.5">From</label>
              <input
                type="date"
                value={filters.dateFrom}
                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                className="w-full px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]/40 [color-scheme:dark]"
              />
            </div>
            <div className="text-[var(--text-muted)] text-[10px] pt-3">→</div>
            <div className="flex-1">
              <label className="text-[9px] text-[var(--text-muted)] uppercase font-semibold tracking-wider block mb-0.5">To</label>
              <input
                type="date"
                value={filters.dateTo}
                onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                className="w-full px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]/40 [color-scheme:dark]"
              />
            </div>
            {(filters.dateFrom || filters.dateTo) && (
              <button
                onClick={() => setFilters({ ...filters, dateFrom: "", dateTo: "" })}
                className="pt-3 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
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
        <div className="text-[10px] font-semibold text-[var(--text-muted)] mb-1 flex items-center gap-1">
          <User size={10} /> Assigned to
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setFilters({ ...filters, assignedTo: null })}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              filters.assignedTo === null
                ? "bg-[var(--accent)] text-[var(--bg)]"
                : "bg-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border)]"
            }`}
          >
            Anyone
          </button>
          <button
            onClick={() => setFilters({ ...filters, assignedTo: "unassigned" })}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              filters.assignedTo === "unassigned"
                ? "bg-[var(--accent)] text-[var(--bg)]"
                : "bg-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border)]"
            }`}
          >
            Unassigned
          </button>
          {teamMembers.map((m) => (
            <button
              key={m.id}
              onClick={() => setFilters({ ...filters, assignedTo: m.id })}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                filters.assignedTo === m.id
                  ? "bg-[var(--accent)] text-[var(--bg)]"
                  : "bg-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border)]"
              }`}
            >
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0"
                style={{ background: filters.assignedTo === m.id ? "var(--bg)" : m.color, color: filters.assignedTo === m.id ? "var(--accent)" : "var(--bg)" }}>
                {m.initials}
              </span>
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {/* From email */}
      <div className="mb-2.5">
        <div className="text-[10px] font-semibold text-[var(--text-muted)] mb-1 flex items-center gap-1">
          <Mail size={10} /> From / To
        </div>
        <input
          value={filters.fromEmail}
          onChange={(e) => setFilters({ ...filters, fromEmail: e.target.value })}
          placeholder="Filter by email address..."
          className="w-full px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]/40"
        />
      </div>

      {/* Labels filter */}
      <LabelFilter filters={filters} setFilters={setFilters} />

      {/* Quick toggles */}
      <div className="flex gap-3">
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={filters.unreadOnly}
            onChange={(e) => setFilters({ ...filters, unreadOnly: e.target.checked })}
            className="accent-[var(--accent)] w-3 h-3"
          />
          Unread only
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-[var(--text-secondary)] cursor-pointer">
          <input
            type="checkbox"
            checked={filters.starredOnly}
            onChange={(e) => setFilters({ ...filters, starredOnly: e.target.checked })}
            className="accent-[var(--accent)] w-3 h-3"
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
  searchScope = "all", setSearchScope, activeMailbox, activeFolder, folderSubView = "unassigned", emailAccounts = [], folders = [],
  teamMembers, onBulkAction, searchSnippets, searchTaskResults = [], onOpenConversation,
}: ConversationListProps & { folderSubView?: "unassigned" | "all" | "closed"; searchTaskResults?: any[]; onOpenConversation?: (id: string) => void }) {
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [highlightedConvoId, setHighlightedConvoId] = useState<string | null>(null);
  const highlightConvoRef = useRef<HTMLDivElement>(null);
  const [reminderConvoIds, setReminderConvoIds] = useState<Record<string, string>>({}); // convo_id -> remind_at
  const [searchTab, setSearchTab] = useState<"conversations" | "tasks">("conversations");
  const [taskUserFilter, setTaskUserFilter] = useState<string>("all");

  // Phase 3: Closed sub-view fetches from /api/conversations/closed-from
  // (separate data source — closures table, not the conversations array).
  const [closedConvos, setClosedConvos] = useState<any[]>([]);
  const [closedLoading, setClosedLoading] = useState(false);
  const [closedNextCursor, setClosedNextCursor] = useState<string | null>(null);
  const [closedHasMore, setClosedHasMore] = useState(false);

  // Fetch closed conversations whenever Closed sub-view is active.
  useEffect(() => {
    if (folderSubView !== "closed" || !activeFolder) {
      setClosedConvos([]);
      setClosedNextCursor(null);
      setClosedHasMore(false);
      return;
    }
    let cancelled = false;
    setClosedLoading(true);
    fetch(`/api/conversations/closed-from?folder_id=${activeFolder}&limit=50`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setClosedConvos(d.conversations || []);
        setClosedNextCursor(d.next_cursor || null);
        setClosedHasMore(!!d.has_more);
      })
      .catch((e) => {
        if (!cancelled) console.error("[ConversationList] closed-from fetch failed:", e);
      })
      .then(() => {
        if (!cancelled) setClosedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [folderSubView, activeFolder]);

  const loadMoreClosed = async () => {
    if (!activeFolder || !closedNextCursor || closedLoading) return;
    setClosedLoading(true);
    try {
      const r = await fetch(
        `/api/conversations/closed-from?folder_id=${activeFolder}&limit=50&before=${encodeURIComponent(closedNextCursor)}`
      );
      const d = await r.json();
      setClosedConvos((prev) => [...prev, ...(d.conversations || [])]);
      setClosedNextCursor(d.next_cursor || null);
      setClosedHasMore(!!d.has_more);
    } catch (e) {
      console.error("[ConversationList] loadMoreClosed failed:", e);
    } finally {
      setClosedLoading(false);
    }
  };

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

    // Phase 3: Closed sub-view uses closedConvos as source (closures table),
    // not the regular conversations array.
    if (folderSubView === "closed" && activeFolder) {
      result = closedConvos;
    } else if (activeFolder) {
      // Sub-view filtering for "unassigned" and "all" modes (scoped to a folder).
      if (folderSubView === "unassigned") {
        // Folder name click: unassigned + status appropriate to the folder type.
        // Spam → status="spam"; Trash → status="trash"; everything else → "open".
        // Note: match by NAME only (not is_system) and skip folder_id check on Spam/Trash
        // since their conversations may have folder_id=NULL or differ from the system folder.
        const activeF = (folders || []).find((f: any) => f.id === activeFolder);
        const fName = String(activeF?.name || "").trim().toLowerCase();
        const isSpam = fName === "spam";
        const isTrash = fName === "trash";
        const isSpamOrTrash = isSpam || isTrash;
        const requiredStatus = isSpam ? "spam" : isTrash ? "trash" : "open";

        if (isSpamOrTrash) {
          // Trust upstream page.tsx filter; just narrow to status + unassigned.
          result = result.filter(
            (c: any) => c.status === requiredStatus && !c.assignee_id
          );
        } else {
          result = result.filter(
            (c: any) =>
              c.folder_id === activeFolder &&
              c.status === requiredStatus &&
              !c.assignee_id
          );
        }
      } else if (folderSubView === "all") {
        // All sub-view: any conversation in this folder, any status, any assignee.
        // Spam/Trash fall back to status if folder_id is missing.
        const activeF = (folders || []).find((f: any) => f.id === activeFolder);
        const fName = String(activeF?.name || "").trim().toLowerCase();
        if (fName === "spam") {
          result = result.filter((c: any) => c.status === "spam" || c.folder_id === activeFolder);
        } else if (fName === "trash") {
          result = result.filter((c: any) => c.status === "trash" || c.folder_id === activeFolder);
        } else {
          result = result.filter((c: any) => c.folder_id === activeFolder);
        }
      }
    }

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
  }, [conversations, filters, folderSubView, activeFolder, closedConvos, folders]);

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

  // Detect whether the current folder view is the system Trash folder.
  // When true, the bulk action bar swaps the "Delete" button (which moves to
  // trash — pointless when already there) for a "Restore" button.
  const isTrashFolder = (() => {
    if (!activeFolder) return false;
    const selectedFolder = folders.find((f: any) => f.id === activeFolder);
    return !!(
      selectedFolder?.is_system &&
      String(selectedFolder.name || "").toLowerCase() === "trash"
    );
  })();

  return (
    <div className="w-[360px] min-w-[360px] h-full bg-[var(--surface)] border-r border-[var(--border)] flex flex-col overflow-hidden">
      {/* Search + Filter toggle */}
      <div className="p-3 pb-2">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)]">
          <Search size={16} className="text-[var(--text-muted)]" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search conversations..."
            className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] text-[13px] placeholder:text-[var(--text-muted)]"
          />
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] transition-all ${
              hasActiveFilters
                ? "bg-[rgba(74,222,128,0.12)] text-[var(--accent)]"
                : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
            title="Filters"
          >
            <Filter size={12} />
            {hasActiveFilters && <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />}
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
                    ? "bg-[var(--accent)]/12 text-[var(--accent)] border border-[var(--accent)]/30"
                    : "text-[var(--text-muted)] hover:text-[var(--text-secondary)] border border-[var(--border)]"
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
          <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-[var(--surface-2)] border border-[var(--border)]">
            <button
              onClick={selectAll}
              className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--text-primary)] hover:text-[var(--accent)] transition-colors mr-1"
            >
              <div className={`w-3.5 h-3.5 rounded border-[1.5px] flex items-center justify-center transition-all ${
                selectedIds.size === filteredConversations.length
                  ? "border-[var(--accent)] bg-[var(--accent)]"
                  : "border-[var(--text-muted)]"
              }`}>
                {selectedIds.size === filteredConversations.length && (
                  <Check size={9} className="text-[var(--bg)]" />
                )}
              </div>
              <span className="text-[var(--accent)] tabular-nums">{selectedIds.size}</span>
            </button>

            <div className="w-px h-4 bg-[var(--border)] mx-0.5" />

            <button
              onClick={() => handleBulkAction("star")}
              className="p-1.5 rounded hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--highlight)] transition-all"
              title="Star selected"
            >
              <Star size={13} />
            </button>
            <button
              onClick={() => handleBulkAction("mark_unread")}
              className="p-1.5 rounded hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[#BC8CFF] transition-all"
              title="Mark as unread"
            >
              <MailOpen size={13} />
            </button>
            <button
              onClick={() => handleBulkAction("archive")}
              className="p-1.5 rounded hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--info)] transition-all"
              title="Archive selected"
            >
              <Archive size={13} />
            </button>
            {isTrashFolder ? (
              <button
                onClick={() => handleBulkAction("restore")}
                className="p-1.5 rounded hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--accent)] transition-all"
                title="Restore selected from trash"
              >
                <RotateCcw size={13} />
              </button>
            ) : (
              <button
                onClick={() => handleBulkAction("delete")}
                className="p-1.5 rounded hover:bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--danger)] transition-all"
                title="Delete selected"
              >
                <Trash2 size={13} />
              </button>
            )}

            <div className="flex-1" />

            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
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
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${searchTab === "conversations" ? "bg-[var(--border)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
              Conversations ({conversations.length})
            </button>
            <button onClick={() => setSearchTab("tasks")}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-all ${searchTab === "tasks" ? "bg-[var(--border)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
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
            <span className="text-[9px] text-[var(--text-muted)] uppercase">Filter:</span>
            <button onClick={() => setTaskUserFilter("all")}
              className={`px-2 py-0.5 rounded text-[9px] font-medium ${taskUserFilter === "all" ? "bg-[var(--accent)]/12 text-[var(--accent)] border border-[var(--accent)]/30" : "text-[var(--text-muted)] border border-[var(--border)]"}`}>
              All
            </button>
            {teamMembers.map(m => (
              <button key={m.id} onClick={() => setTaskUserFilter(taskUserFilter === m.id ? "all" : m.id)}
                className={`px-2 py-0.5 rounded text-[9px] font-medium flex items-center gap-1 ${taskUserFilter === m.id ? "bg-[var(--accent)]/12 text-[var(--accent)] border border-[var(--accent)]/30" : "text-[var(--text-muted)] border border-[var(--border)]"}`}>
                <span className="w-3 h-3 rounded-full flex items-center justify-center text-[6px] font-bold text-[var(--bg)]" style={{ background: m.color }}>{m.initials}</span>
                {m.name.split(" ")[0]}
              </button>
            ))}
          </div>
          {searchTaskResults
            .filter((t: any) => taskUserFilter === "all" || (t.task_assignees || []).some((a: any) => a.team_member_id === taskUserFilter))
            .map((t: any) => {
              const assignees = (t.task_assignees || []).map((a: any) => a.team_member || {});
              const statusColors: Record<string, string> = { todo: "var(--info)", in_progress: "var(--highlight)", completed: "var(--accent)", dismissed: "var(--warning)" };
              return (
                <div key={t.id}
                  className="relative flex flex-col gap-1 p-2.5 mb-0.5 rounded-lg hover:bg-[var(--surface-2)] cursor-pointer transition-all"
                  onClick={() => t.conversation?.id && onOpenConversation?.(t.conversation.id)}
                >
                  <div className="flex items-start gap-2">
                    <div className="w-2 h-2 rounded-full mt-1.5 shrink-0" style={{ background: statusColors[t.status] || "var(--text-muted)" }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-[var(--text-primary)] leading-tight">{t.text}</div>
                      {t.conversation?.subject && (
                        <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">Thread: {t.conversation.subject}</div>
                      )}
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-secondary)]">{t.status}</span>
                        {t.category && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: (t.category.color || "var(--text-muted)") + "20", color: t.category.color || "var(--text-muted)" }}>{t.category.name}</span>
                        )}
                        {t.due_date && (
                          <span className="text-[9px] text-[var(--warning)]">{t.due_date}</span>
                        )}
                        {assignees.map((a: any) => (
                          <span key={a.id} className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold text-[var(--bg)]" style={{ background: a.color || "var(--text-muted)" }} title={a.name}>{(a.initials || "?").slice(0, 2)}</span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          {searchTaskResults.filter((t: any) => taskUserFilter === "all" || (t.task_assignees || []).some((a: any) => a.team_member_id === taskUserFilter)).length === 0 && (
            <div className="text-center py-8 text-[var(--text-muted)] text-[11px]">No tasks match this filter</div>
          )}
        </div>
      )}

      {/* Conversation list — hide when showing task search results */}
      {(searchTab === "conversations" || searchQuery.trim().length < 2 || !searchTaskResults || searchTaskResults.length === 0) && (
      <div className="flex-1 overflow-y-auto px-1.5">
        {Object.entries(grouped).map(([date, convos]) => {
          // Phase 4d: distinguish "month + year" labels (e.g. "April 2026")
          // from relative labels ("Today", "Yesterday", "This Week").
          // Months get the magazine treatment: italic serif month + mono year + hairline rule.
          const monthMatch = date.match(/^([A-Z][a-z]+)\s+(\d{4})$/);
          return (
          <div key={date}>
            {monthMatch ? (
              <div className="flex items-baseline gap-3 px-2.5 pt-5 pb-2">
                <span className="font-serif italic text-[var(--text-secondary)] text-[14px] leading-none">{monthMatch[1]}</span>
                <span className="font-mono text-[10px] tracking-widest text-[var(--text-muted)] leading-none">{monthMatch[2]}</span>
                <div className="flex-1 border-t border-[var(--border)]" />
              </div>
            ) : (
              <div className="text-[10px] font-semibold uppercase text-[var(--text-muted)] px-2.5 pt-3 pb-1.5 tracking-widest">
                {date}
              </div>
            )}
            {convos.map((c) => {
              const isActive = activeConvo?.id === c.id;
              const isSelected = selectedIds.has(c.id);
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
                      ? "bg-[var(--accent)]/10 ring-2 ring-[var(--accent)]/30 border border-[var(--accent)]"
                      : isActive ? "bg-[var(--border)]" : isSelected ? "bg-[rgba(74,222,128,0.06)]" : "hover:bg-[var(--surface-2)]"
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
                        ? "border-[var(--accent)] bg-[var(--accent)]"
                        : "border-[var(--text-muted)] hover:border-[var(--text-secondary)]"
                    }`}>
                      {isSelected && <Check size={10} className="text-[var(--bg)]" />}
                    </div>
                  </div>

                  {/* Unread dot */}
                  {c.is_unread && !isSelecting && (
                    <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1 h-1 rounded-full bg-[var(--accent)]" />
                  )}

                  <div className="flex-1 min-w-0">
                    {/* Header row */}
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className={`text-[13px] truncate flex-1 ${c.is_unread ? "font-bold text-[var(--text-primary)]" : "font-medium text-[var(--text-secondary)]"}`}>
                        {c.from_name}
                      </span>
                      {c.is_starred && <span className="text-[var(--highlight)] text-[12px]">★</span>}
                      {reminderConvoIds[c.id] && (
                        <span className="text-[var(--warning)] flex-shrink-0" title={"Follow-up: " + new Date(reminderConvoIds[c.id]).toLocaleString()}>
                          <AlarmClock size={12} />
                        </span>
                      )}
                      <span className="text-[11px] text-[var(--text-muted)] tabular-nums font-mono whitespace-nowrap">
                        {formatTime(c.last_message_at)}
                      </span>
                    </div>

                    {/* Subject */}
                    <div className={`text-[12.5px] truncate mb-1 flex items-center gap-1 ${c.is_unread ? "font-semibold text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
                      {/*
                        Paperclip indicator. Shows when EITHER the
                        trigger-maintained attachment_count is positive OR
                        the legacy has_attachments flag is true. Belt and
                        suspenders: covers backfilled threads (count > 0)
                        AND newly-arrived messages that haven't had their
                        attachments captured yet (flag is true even if
                        count is still 0). Tenkara gold at 13px.
                      */}
                      {(((c as any).attachment_count ?? 0) > 0 || (c as any).has_attachments) && (
                        <Paperclip
                          size={13}
                          className="text-[var(--accent)] flex-shrink-0"
                          aria-label="Has attachment"
                        />
                      )}
                      <span className="truncate">{searchQuery.trim().length >= 2 ? highlightText(c.subject, searchQuery) : c.subject}</span>
                    </div>

                    {/* Preview / Search snippet */}
                    <div className="text-[11.5px] text-[var(--text-muted)] truncate mb-1.5">
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
          );
        })}

        {filteredConversations.length === 0 && (
          <div className="text-center py-16 text-[var(--text-muted)] text-sm">
            {folderSubView === "closed" && activeFolder
              ? (closedLoading ? "Loading…" : "No closed conversations from this folder yet")
              : hasActiveFilters
                ? "No conversations match your filters"
                : "No conversations found"}
          </div>
        )}

        {folderSubView === "closed" && activeFolder && closedHasMore && (
          <div className="text-center py-3">
            <button
              onClick={loadMoreClosed}
              disabled={closedLoading}
              className="text-[11px] px-3 py-1 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface)] disabled:opacity-50 transition-colors"
            >
              {closedLoading ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}