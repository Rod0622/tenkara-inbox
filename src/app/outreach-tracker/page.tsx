"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Search, X, ChevronDown, Pencil, Check, ArrowLeft } from "lucide-react";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";

// ── Types ──────────────────────────────────────────────────────────────
interface UserLite { id: string; name: string; initials?: string | null; color?: string | null; avatar_url?: string | null; }
interface AccountLite { id: string; name: string; email: string; }
interface OutreachStatus { id: string; name: string; sort_order: number; color: string | null; }
interface LabelLite { id: string; name: string; parent_label_id: string | null; color: string | null; }
interface Row {
  id: string;
  subject: string;
  created_at: string;
  last_message_at: string | null;
  labels: string[];
  sublabels: string[];
  supplier: { email: string | null; name: string | null };
  assignee: UserLite | null;
  caller:   UserLite | null;
  account:  AccountLite | null;
  outreach_status: OutreachStatus | null;
  material_inquiry: string;
  follow_up_log: string;
}

// ── Helpers ────────────────────────────────────────────────────────────
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  // Locale-aware short date; matches the rest of the app's casual format.
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Same-page deep-link to a conversation. The inbox uses hash routing:
//   /#conversation=<id>&mailbox=<accountId>&folder=
function conversationHref(row: Row): string {
  const mailbox = row.account?.id || "";
  return `/#conversation=${encodeURIComponent(row.id)}&mailbox=${encodeURIComponent(mailbox)}&folder=`;
}

// Command-center link for the supplier. Falls back to "#" if no email.
function commandCenterHref(row: Row): string {
  const email = row.supplier.email;
  const account = row.account?.id || "";
  if (!email) return "#";
  return `/contacts/${encodeURIComponent(email)}${account ? `?account=${encodeURIComponent(account)}` : ""}`;
}

// ── Main component ─────────────────────────────────────────────────────
export default function OutreachTrackerPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const actorId = (session?.user as any)?.id || null;

  // Lookups for filter dropdowns + the status cell editor
  const [accounts,  setAccounts]  = useState<AccountLite[]>([]);
  const [statuses,  setStatuses]  = useState<OutreachStatus[]>([]);
  const [assignees, setAssignees] = useState<UserLite[]>([]);
  const [labels,    setLabels]    = useState<LabelLite[]>([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  // Active filters (global bar — all sent to server)
  const [accountFilter,  setAccountFilter]  = useState<string[]>([]);
  const [statusFilter,   setStatusFilter]   = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [search,         setSearch]         = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [createdFrom,    setCreatedFrom]    = useState("");
  const [createdTo,      setCreatedTo]      = useState("");

  // ── Label + Sublabel filters ───────────────────────────────────────
  // Both live in the top filter bar alongside Account/Status/Assignee.
  // Server-side filtered via label_ids / sublabel_ids query params.
  // State holds label UUIDs (not names) so we can ship the actual ids
  // to the API; the dropdowns display the names but their `id` field
  // is the label UUID.
  const [labelFilter,    setLabelFilter]    = useState<string[]>([]);  // top-level label ids
  const [sublabelFilter, setSublabelFilter] = useState<string[]>([]);  // sublabel ids

  // Data
  const [rows, setRows] = useState<Row[]>([]);
  // Guards against out-of-order fetch responses: when filters change rapidly,
  // multiple requests can be in flight, and a slower earlier (e.g. unfiltered)
  // response can resolve AFTER a later filtered one, overwriting the table with
  // stale rows. Each request gets an incrementing id; only the latest applies.
  const rowsReqSeq = useRef(0);
  // Holds the in-flight rows request so a newer request can abort it. This
  // structurally prevents a slow stale request (e.g. the unfiltered mount
  // fetch) from resolving later and overwriting filtered results.
  const rowsAbort = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ── Debounce the search box so we don't spam the API on every keystroke ─
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── One-time options load ────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/outreach-tracker/options");
        if (!res.ok) throw new Error(`options ${res.status}`);
        const data = await res.json();
        setAccounts(data.accounts || []);
        setStatuses(data.statuses || []);
        setAssignees(data.assignees || []);
        setLabels(data.labels || []);
        setOptionsLoaded(true);
      } catch (e: any) {
        console.error("[outreach-tracker] options load failed:", e);
        setOptionsLoaded(true); // unblock the rows fetch anyway
      }
    })();
  }, []);

  // ── Split label catalog into the two dropdowns ───────────────────────
  // Top-level labels (parent_label_id === null) drive the Label filter;
  // children drive the Sublabel filter. Computed from the server-loaded
  // catalog, so the dropdowns always show every available label even
  // when no convs match the other filters.
  const parentLabels = useMemo(
    () => labels.filter((l) => !l.parent_label_id),
    [labels]
  );
  const childLabels = useMemo(
    () => labels.filter((l) => !!l.parent_label_id),
    [labels]
  );

  // ── Rows fetch whenever filters change ───────────────────────────────
  const loadRows = useCallback(async () => {
    const seq = ++rowsReqSeq.current;
    // Abort any request still in flight from a previous filter state.
    if (rowsAbort.current) rowsAbort.current.abort();
    const controller = new AbortController();
    rowsAbort.current = controller;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (accountFilter.length)  params.set("account_ids",  accountFilter.join(","));
      if (statusFilter.length)   params.set("status_ids",   statusFilter.join(","));
      if (assigneeFilter.length) params.set("assignee_ids", assigneeFilter.join(","));
      if (labelFilter.length)    params.set("label_ids",    labelFilter.join(","));
      if (sublabelFilter.length) params.set("sublabel_ids", sublabelFilter.join(","));
      if (searchDebounced)       params.set("q", searchDebounced);
      if (createdFrom)           params.set("created_from", createdFrom);
      if (createdTo)             params.set("created_to",   createdTo);
      const url = `/api/outreach-tracker/conversations${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      // Ignore if a newer request has since been issued (stale response).
      if (seq !== rowsReqSeq.current) return;
      setRows(data.rows || []);
    } catch (e: any) {
      // An aborted request is expected when filters change; ignore silently.
      if (e?.name === "AbortError") return;
      if (seq !== rowsReqSeq.current) return; // stale error; newer request owns state
      console.error("[outreach-tracker] rows load failed:", e);
      setError(e?.message || "Failed to load conversations");
      setRows([]);
    } finally {
      // Only the latest request clears the loading flag, so the spinner stays
      // up until the current filter's data actually arrives.
      if (seq === rowsReqSeq.current) setLoading(false);
    }
  }, [accountFilter, statusFilter, assigneeFilter, labelFilter, sublabelFilter, searchDebounced, createdFrom, createdTo]);

  useEffect(() => {
    if (!optionsLoaded) return;
    loadRows();
  }, [loadRows, optionsLoaded]);

  // ── PATCH a single conversation field, optimistic ────────────────────
  const patchConversation = useCallback(async (id: string, fields: Record<string, any>) => {
    // Optimistic local update first so the UI feels instant.
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r };
        if ("outreach_status_id" in fields) {
          const sid = fields.outreach_status_id;
          next.outreach_status = sid ? statuses.find((s) => s.id === sid) || null : null;
        }
        if ("material_inquiry" in fields) next.material_inquiry = fields.material_inquiry;
        if ("follow_up_log"    in fields) next.follow_up_log    = fields.follow_up_log;
        return next;
      })
    );
    try {
      const res = await fetch("/api/outreach-tracker/conversations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: id, actor_id: actorId, fields }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
    } catch (e: any) {
      console.error("[outreach-tracker] patch failed:", e);
      // On failure, refetch to restore truth.
      loadRows();
    }
  }, [actorId, statuses, loadRows]);

  // ── Subject edit (uses the existing cascade endpoint) ────────────────
  const patchSubject = useCallback(async (id: string, subject: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, subject } : r)));
    try {
      const res = await fetch("/api/conversations/subject", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: id, subject, actor_id: actorId }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      console.error("[outreach-tracker] subject patch failed:", e);
      loadRows();
    }
  }, [actorId, loadRows]);

  // ── Filter chip clears ───────────────────────────────────────────────
  const clearAllFilters = () => {
    setAccountFilter([]);
    setStatusFilter([]);
    setAssigneeFilter([]);
    setLabelFilter([]);
    setSublabelFilter([]);
    setSearch("");
    setCreatedFrom("");
    setCreatedTo("");
  };
  const hasActiveFilters =
    accountFilter.length > 0 ||
    statusFilter.length > 0 ||
    assigneeFilter.length > 0 ||
    labelFilter.length > 0 ||
    sublabelFilter.length > 0 ||
    search.trim().length > 0 ||
    !!createdFrom ||
    !!createdTo;

  return (
    <div className="flex flex-col h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      {/* Always-visible scrollbars on the table container — overrides
          macOS auto-hide so users can see scroll position and drag the
          thumb. Scoped to .tracker-scroll, no leak to other pages. */}
      <style jsx global>{`
        .tracker-scroll {
          scrollbar-width: thin;
          scrollbar-color: var(--surface-2) transparent;
        }
        .tracker-scroll::-webkit-scrollbar {
          width: 12px;
          height: 12px;
        }
        .tracker-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .tracker-scroll::-webkit-scrollbar-thumb {
          background: var(--surface-2);
          border-radius: 6px;
          border: 2px solid var(--bg);
        }
        .tracker-scroll::-webkit-scrollbar-thumb:hover {
          background: var(--text-muted);
        }
        .tracker-scroll::-webkit-scrollbar-corner {
          background: transparent;
        }
      `}</style>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-[var(--surface-2)] px-6 py-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            aria-label="Back to inbox"
          >
            <ArrowLeft size={16} /> Back to inbox
          </Link>
          <div className="h-4 w-px bg-[var(--surface-2)]" />
          <h1 className="text-xl font-semibold">Outreach Tracker</h1>
        </div>
        <p className="text-sm text-[var(--text-muted)] mt-0.5">
          One row per conversation. Status, material inquiry, and follow-up log are editable inline.
        </p>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────── */}
      <div className="px-6 py-3 border-b border-[var(--surface-2)] flex flex-wrap items-center gap-2">
        <MultiSelectDropdown
          options={accounts.map((a) => ({ id: a.id, label: a.name || a.email }))}
          selected={accountFilter}
          onChange={setAccountFilter}
          placeholder="All accounts"
          searchPlaceholder="Search account..."
        />
        <MultiSelectDropdown
          options={statuses.map((s) => ({ id: s.id, label: s.name }))}
          selected={statusFilter}
          onChange={setStatusFilter}
          placeholder="All statuses"
          searchPlaceholder="Search status..."
        />
        <MultiSelectDropdown
          options={assignees.map((u) => ({ id: u.id, label: u.name }))}
          selected={assigneeFilter}
          onChange={setAssigneeFilter}
          placeholder="All assignees"
          searchPlaceholder="Search assignee..."
        />
        <MultiSelectDropdown
          options={parentLabels.map((l) => ({ id: l.id, label: l.name }))}
          selected={labelFilter}
          onChange={setLabelFilter}
          placeholder="All labels"
          searchPlaceholder="Search label..."
        />
        <MultiSelectDropdown
          options={childLabels.map((l) => ({ id: l.id, label: l.name }))}
          selected={sublabelFilter}
          onChange={setSublabelFilter}
          placeholder="All sublabels"
          searchPlaceholder="Search sublabel..."
        />
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search subject or supplier..."
            className="bg-[var(--surface)] border border-[var(--surface-2)] rounded-md pl-7 pr-7 py-1.5 text-sm w-64 focus:outline-none focus:border-[var(--accent)]"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1 text-sm">
          <span className="text-[var(--text-muted)]">Created:</span>
          <input
            type="date"
            value={createdFrom}
            onChange={(e) => setCreatedFrom(e.target.value)}
            className="bg-[var(--surface)] border border-[var(--surface-2)] rounded-md px-2 py-1 text-xs"
          />
          <span className="text-[var(--text-muted)]">to</span>
          <input
            type="date"
            value={createdTo}
            onChange={(e) => setCreatedTo(e.target.value)}
            className="bg-[var(--surface)] border border-[var(--surface-2)] rounded-md px-2 py-1 text-xs"
          />
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearAllFilters}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto text-xs text-[var(--text-muted)]">
          {loading ? "Loading…" : `${rows.length} conversation${rows.length === 1 ? "" : "s"}`}
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto tracker-scroll">
        {error && (
          <div className="m-4 p-3 bg-[var(--surface)] border border-[#F85149] text-[#F85149] rounded-md text-sm">
            {error}
          </div>
        )}
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[var(--text-muted)]">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading conversations…
          </div>
        ) : (
          <table className="text-sm w-full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
            <thead className="sticky top-0 z-20 bg-[var(--bg)]">
              <tr className="text-left text-xs text-[var(--text-muted)]">
                <Th sticky>Conversation</Th>
                <Th>Label</Th>
                <Th>Sublabel</Th>
                <Th>Created</Th>
                <Th>Supplier</Th>
                <Th>Assignee</Th>
                <Th>Caller</Th>
                <Th>Status</Th>
                <Th>Last email</Th>
                <Th style={{ minWidth: 220 }}>Material inquiry</Th>
                <Th style={{ minWidth: 240 }}>Follow-up log</Th>
              </tr>
            </thead>
            <tbody key={`${accountFilter.join(",")}|${statusFilter.join(",")}|${assigneeFilter.join(",")}|${labelFilter.join(",")}|${sublabelFilter.join(",")}|${searchDebounced}|${createdFrom}|${createdTo}`}>
              {rows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={11} className="text-center py-8 text-[var(--text-muted)]">
                    No conversations match the current filters.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <TrackerRow
                    key={row.id}
                    row={row}
                    statuses={statuses}
                    onPatchSubject={patchSubject}
                    onPatchFields={(fields) => patchConversation(row.id, fields)}
                  />
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Header cell ────────────────────────────────────────────────────────
function Th({
  children,
  sticky = false,
  style,
}: {
  children: React.ReactNode;
  sticky?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <th
      className={`px-3 py-2 font-medium uppercase tracking-wide border-b border-[var(--surface-2)] whitespace-nowrap ${
        sticky ? "sticky left-0 z-10 bg-[var(--bg)] shadow-[2px_0_0_0_var(--surface-2)]" : ""
      }`}
      style={style}
    >
      {children}
    </th>
  );
}

// ── Row ────────────────────────────────────────────────────────────────
function TrackerRow({
  row,
  statuses,
  onPatchSubject,
  onPatchFields,
}: {
  row: Row;
  statuses: OutreachStatus[];
  onPatchSubject: (id: string, subject: string) => void;
  onPatchFields: (fields: Record<string, any>) => void;
}) {
  // Inline subject edit
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState(row.subject);

  // Inline textarea edits — local draft + debounced save
  const [materialDraft, setMaterialDraft] = useState(row.material_inquiry);
  const [followUpDraft, setFollowUpDraft] = useState(row.follow_up_log);

  // Keep drafts in sync if the row prop changes (e.g. after a refetch)
  useEffect(() => { setSubjectDraft(row.subject); }, [row.subject]);
  useEffect(() => { setMaterialDraft(row.material_inquiry); }, [row.material_inquiry]);
  useEffect(() => { setFollowUpDraft(row.follow_up_log); }, [row.follow_up_log]);

  // Debounced auto-save for the two textareas. 800ms after last keystroke.
  const materialTimer = useRef<any>(null);
  const followUpTimer = useRef<any>(null);
  useEffect(() => {
    if (materialDraft === row.material_inquiry) return;
    if (materialTimer.current) clearTimeout(materialTimer.current);
    materialTimer.current = setTimeout(() => {
      onPatchFields({ material_inquiry: materialDraft });
    }, 800);
    return () => clearTimeout(materialTimer.current);
  }, [materialDraft]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (followUpDraft === row.follow_up_log) return;
    if (followUpTimer.current) clearTimeout(followUpTimer.current);
    followUpTimer.current = setTimeout(() => {
      onPatchFields({ follow_up_log: followUpDraft });
    }, 800);
    return () => clearTimeout(followUpTimer.current);
  }, [followUpDraft]); // eslint-disable-line react-hooks/exhaustive-deps

  const commitSubject = () => {
    const trimmed = subjectDraft.trim();
    if (trimmed && trimmed !== row.subject) {
      onPatchSubject(row.id, trimmed);
    } else {
      setSubjectDraft(row.subject);
    }
    setEditingSubject(false);
  };

  return (
    <tr className="hover:bg-[var(--surface)] transition-colors border-b border-[var(--surface-2)]">
      {/* ── Conversation (sticky, editable, clickable) ─────────── */}
      <td
        className="px-3 py-2 sticky left-0 bg-[var(--bg)] hover:bg-[var(--surface)] z-10 shadow-[2px_0_0_0_var(--surface-2)] align-top"
        style={{ minWidth: 280, maxWidth: 340 }}
      >
        {editingSubject ? (
          <div className="flex items-start gap-1">
            <textarea
              value={subjectDraft}
              onChange={(e) => setSubjectDraft(e.target.value)}
              autoFocus
              rows={2}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitSubject(); }
                if (e.key === "Escape") { setSubjectDraft(row.subject); setEditingSubject(false); }
              }}
              className="flex-1 bg-[var(--surface-2)] border border-[var(--accent)] rounded-md px-2 py-1 text-sm resize-none focus:outline-none"
            />
            <button onClick={commitSubject} className="text-[var(--accent)] p-1" aria-label="Save">
              <Check size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-start gap-1.5 group">
            <a
              href={conversationHref(row)}
              className="flex-1 text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline line-clamp-2"
              title={row.subject}
            >
              {row.subject || "(no subject)"}
            </a>
            <button
              onClick={() => setEditingSubject(true)}
              className="opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--accent)] p-0.5 transition-opacity"
              aria-label="Rename"
              title="Rename conversation"
            >
              <Pencil size={12} />
            </button>
          </div>
        )}
      </td>

      {/* ── Labels / Sublabels (comma-separated) ─────────────────── */}
      <td className="px-3 py-2 align-top">
        <span className="text-[13px]">{row.labels.join(", ") || <span className="text-[var(--text-muted)]">—</span>}</span>
      </td>
      <td className="px-3 py-2 align-top">
        <span className="text-[13px]">{row.sublabels.join(", ") || <span className="text-[var(--text-muted)]">—</span>}</span>
      </td>

      {/* ── Created ─────────────────────────────────────────────── */}
      <td className="px-3 py-2 whitespace-nowrap text-[13px] align-top">{fmtDate(row.created_at)}</td>

      {/* ── Supplier (clickable -> command center) ──────────────── */}
      <td className="px-3 py-2 align-top">
        {row.supplier.email ? (
          <a
            href={commandCenterHref(row)}
            className="text-[var(--text-primary)] hover:text-[var(--accent)] hover:underline"
            title={row.supplier.email}
          >
            {row.supplier.name || row.supplier.email}
          </a>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </td>

      {/* ── Assignee ────────────────────────────────────────────── */}
      <td className="px-3 py-2 whitespace-nowrap align-top">
        <UserBadge user={row.assignee} />
      </td>

      {/* ── Caller ──────────────────────────────────────────────── */}
      <td className="px-3 py-2 whitespace-nowrap align-top">
        <UserBadge user={row.caller} />
      </td>

      {/* ── Status (dropdown) ──────────────────────────────────── */}
      <td className="px-3 py-2 whitespace-nowrap align-top">
        <StatusPicker
          current={row.outreach_status}
          options={statuses}
          onChange={(id) => onPatchFields({ outreach_status_id: id })}
        />
      </td>

      {/* ── Last email ──────────────────────────────────────────── */}
      <td className="px-3 py-2 whitespace-nowrap text-[13px] align-top">{fmtDate(row.last_message_at)}</td>

      {/* ── Material inquiry (textarea) ─────────────────────────── */}
      <td className="px-3 py-2 align-top">
        <textarea
          value={materialDraft}
          onChange={(e) => setMaterialDraft(e.target.value)}
          placeholder="Add materials, quantities..."
          rows={2}
          className="w-full bg-transparent border border-transparent hover:border-[var(--surface-2)] focus:border-[var(--accent)] rounded-md px-2 py-1 text-[13px] resize-y focus:outline-none"
        />
      </td>

      {/* ── Follow-up action log (textarea) ─────────────────────── */}
      <td className="px-3 py-2 align-top">
        <textarea
          value={followUpDraft}
          onChange={(e) => setFollowUpDraft(e.target.value)}
          placeholder="Log follow-up actions..."
          rows={2}
          className="w-full bg-transparent border border-transparent hover:border-[var(--surface-2)] focus:border-[var(--accent)] rounded-md px-2 py-1 text-[13px] resize-y focus:outline-none"
        />
      </td>
    </tr>
  );
}

// ── Assignee/caller badge ──────────────────────────────────────────────
function UserBadge({ user }: { user: UserLite | null }) {
  if (!user) return <span className="text-[var(--text-muted)] text-[13px]">—</span>;
  return (
    <div className="flex items-center gap-1.5">
      {user.avatar_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full object-cover" />
      ) : (
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium text-white"
          style={{ backgroundColor: user.color || "var(--accent)" }}
        >
          {user.initials || user.name.slice(0, 2).toUpperCase()}
        </div>
      )}
      <span className="text-[13px] whitespace-nowrap">{user.name}</span>
    </div>
  );
}

// ── Status picker ──────────────────────────────────────────────────────
function StatusPicker({
  current,
  options,
  onChange,
}: {
  current: OutreachStatus | null;
  options: OutreachStatus[];
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click-outside dismiss
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const bg = current?.color || "var(--surface-2)";
  const textColor = current ? "white" : "var(--text-muted)";
  const label = current?.name || "Not started";

  return (
    <div ref={ref} className="relative inline-block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium whitespace-nowrap hover:opacity-90"
        style={{ backgroundColor: bg, color: textColor }}
      >
        <span>{label}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-[var(--surface)] border border-[var(--surface-2)] rounded-md shadow-lg z-50 min-w-[220px] max-h-80 overflow-auto py-1">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] text-[var(--text-muted)]"
          >
            Not started
          </button>
          {options.map((s) => (
            <button
              key={s.id}
              onClick={() => { onChange(s.id); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] flex items-center gap-2"
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: s.color || "var(--text-muted)" }}
              />
              <span>{s.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}