"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X, ChevronDown, Pencil, Check } from "lucide-react";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";

// ── Types ──────────────────────────────────────────────────────────────
interface UserLite { id: string; name: string; initials?: string | null; color?: string | null; avatar_url?: string | null; }
interface AccountLite { id: string; name: string; email: string; }
interface OutreachStatus { id: string; name: string; sort_order: number; color: string | null; }
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
  const [optionsLoaded, setOptionsLoaded] = useState(false);

  // Active filters (global bar — sent to server)
  const [accountFilter,  setAccountFilter]  = useState<string[]>([]);
  const [statusFilter,   setStatusFilter]   = useState<string[]>([]);
  const [assigneeFilter, setAssigneeFilter] = useState<string[]>([]);
  const [search,         setSearch]         = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [createdFrom,    setCreatedFrom]    = useState("");
  const [createdTo,      setCreatedTo]      = useState("");

  // ── Per-column filters (applied client-side on top of the global bar) ─
  // These don't refetch from the server — they narrow the already-loaded
  // row set. The set is capped at 5000 server-side, which is plenty of
  // headroom for any team's active outreach pipeline; the in-browser
  // filter pass is microseconds even at that size.
  const [colSubject,     setColSubject]     = useState("");
  const [colLabels,      setColLabels]      = useState<string[]>([]);  // label names
  const [colSublabels,   setColSublabels]   = useState<string[]>([]);  // sublabel names
  const [colCreatedFrom, setColCreatedFrom] = useState("");
  const [colCreatedTo,   setColCreatedTo]   = useState("");
  const [colSupplier,    setColSupplier]    = useState("");
  const [colAssignees,   setColAssignees]   = useState<string[]>([]);  // team_member ids
  const [colCallers,     setColCallers]     = useState<string[]>([]);  // team_member ids
  const [colStatuses,    setColStatuses]    = useState<string[]>([]);  // outreach_status ids
  const [colLastFrom,    setColLastFrom]    = useState("");
  const [colLastTo,      setColLastTo]      = useState("");
  const [colMaterial,    setColMaterial]    = useState("");
  const [colFollowUp,    setColFollowUp]    = useState("");

  // Data
  const [rows, setRows] = useState<Row[]>([]);
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
        setOptionsLoaded(true);
      } catch (e: any) {
        console.error("[outreach-tracker] options load failed:", e);
        setOptionsLoaded(true); // unblock the rows fetch anyway
      }
    })();
  }, []);

  // ── Rows fetch whenever filters change ───────────────────────────────
  const loadRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (accountFilter.length)  params.set("account_ids",  accountFilter.join(","));
      if (statusFilter.length)   params.set("status_ids",   statusFilter.join(","));
      if (assigneeFilter.length) params.set("assignee_ids", assigneeFilter.join(","));
      if (searchDebounced)       params.set("q", searchDebounced);
      if (createdFrom)           params.set("created_from", createdFrom);
      if (createdTo)             params.set("created_to",   createdTo);
      const url = `/api/outreach-tracker/conversations${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setRows(data.rows || []);
    } catch (e: any) {
      console.error("[outreach-tracker] rows load failed:", e);
      setError(e?.message || "Failed to load conversations");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [accountFilter, statusFilter, assigneeFilter, searchDebounced, createdFrom, createdTo]);

  useEffect(() => {
    if (!optionsLoaded) return;
    loadRows();
  }, [loadRows, optionsLoaded]);

  // ── Derived sets for column-filter dropdowns ────────────────────────
  // We use whatever's currently in `rows` so dropdowns only offer values
  // that actually exist in the data — saves users from picking a label
  // that would produce zero results.
  const uniqueLabels = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const l of r.labels) set.add(l);
    return Array.from(set).sort();
  }, [rows]);
  const uniqueSublabels = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) for (const l of r.sublabels) set.add(l);
    return Array.from(set).sort();
  }, [rows]);
  const uniqueCallers = useMemo(() => {
    const seen = new Map<string, UserLite>();
    for (const r of rows) if (r.caller) seen.set(r.caller.id, r.caller);
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [rows]);

  // ── Apply per-column filters to the server-loaded rows ──────────────
  const filteredRows = useMemo(() => {
    // Pre-lowercase the text filters once — saves N comparisons per
    // keystroke at scale. (At 5000 rows this matters for input responsiveness.)
    const sSubject  = colSubject.toLowerCase();
    const sSupplier = colSupplier.toLowerCase();
    const sMaterial = colMaterial.toLowerCase();
    const sFollowUp = colFollowUp.toLowerCase();

    // Convert date range cutoffs once. Treat the "to" as inclusive end-of-day.
    const cFromMs = colCreatedFrom ? new Date(colCreatedFrom).getTime() : -Infinity;
    const cToMs   = colCreatedTo   ? new Date(colCreatedTo).getTime() + 86399999 : Infinity;
    const lFromMs = colLastFrom    ? new Date(colLastFrom).getTime() : -Infinity;
    const lToMs   = colLastTo      ? new Date(colLastTo).getTime() + 86399999 : Infinity;

    return rows.filter((r) => {
      if (sSubject && !(r.subject || "").toLowerCase().includes(sSubject)) return false;
      if (colLabels.length    && !colLabels.some((l)    => r.labels.includes(l)))    return false;
      if (colSublabels.length && !colSublabels.some((l) => r.sublabels.includes(l))) return false;

      if (colCreatedFrom || colCreatedTo) {
        const t = r.created_at ? new Date(r.created_at).getTime() : NaN;
        if (isNaN(t) || t < cFromMs || t > cToMs) return false;
      }
      if (sSupplier) {
        const email = (r.supplier.email || "").toLowerCase();
        const name  = (r.supplier.name  || "").toLowerCase();
        if (!email.includes(sSupplier) && !name.includes(sSupplier)) return false;
      }
      if (colAssignees.length && !colAssignees.includes(r.assignee?.id || "__none__")) return false;
      if (colCallers.length   && !colCallers.includes(r.caller?.id     || "__none__")) return false;
      if (colStatuses.length  && !colStatuses.includes(r.outreach_status?.id || "__none__")) return false;

      if (colLastFrom || colLastTo) {
        const t = r.last_message_at ? new Date(r.last_message_at).getTime() : NaN;
        if (isNaN(t) || t < lFromMs || t > lToMs) return false;
      }
      if (sMaterial && !(r.material_inquiry || "").toLowerCase().includes(sMaterial)) return false;
      if (sFollowUp && !(r.follow_up_log    || "").toLowerCase().includes(sFollowUp)) return false;

      return true;
    });
  }, [
    rows,
    colSubject, colLabels, colSublabels,
    colCreatedFrom, colCreatedTo,
    colSupplier, colAssignees, colCallers, colStatuses,
    colLastFrom, colLastTo, colMaterial, colFollowUp,
  ]);

  const clearColumnFilters = () => {
    setColSubject(""); setColLabels([]); setColSublabels([]);
    setColCreatedFrom(""); setColCreatedTo("");
    setColSupplier(""); setColAssignees([]); setColCallers([]); setColStatuses([]);
    setColLastFrom(""); setColLastTo("");
    setColMaterial(""); setColFollowUp("");
  };

  const hasColumnFilters =
    !!colSubject || colLabels.length > 0 || colSublabels.length > 0 ||
    !!colCreatedFrom || !!colCreatedTo ||
    !!colSupplier || colAssignees.length > 0 || colCallers.length > 0 || colStatuses.length > 0 ||
    !!colLastFrom || !!colLastTo ||
    !!colMaterial || !!colFollowUp;

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
    setSearch("");
    setCreatedFrom("");
    setCreatedTo("");
  };
  const hasActiveFilters =
    accountFilter.length > 0 ||
    statusFilter.length > 0 ||
    assigneeFilter.length > 0 ||
    search.trim().length > 0 ||
    !!createdFrom ||
    !!createdTo;

  return (
    <div className="flex flex-col h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="border-b border-[var(--surface-2)] px-6 py-4">
        <h1 className="text-xl font-semibold">Outreach Tracker</h1>
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
        {hasColumnFilters && (
          <button
            onClick={clearColumnFilters}
            className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1"
          >
            Clear column filters
          </button>
        )}
        <div className="ml-auto text-xs text-[var(--text-muted)]">
          {loading ? "Loading…" :
            hasColumnFilters
              ? `${filteredRows.length} of ${rows.length} conversation${rows.length === 1 ? "" : "s"}`
              : `${rows.length} conversation${rows.length === 1 ? "" : "s"}`
          }
        </div>
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
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
              {/* ── Per-column filter row ───────────────────────────
                  Compact inputs aligned with each column header. All
                  filtering here is client-side on the already-loaded
                  row set; narrowing is instant. */}
              <tr className="text-left">
                <FilterCell sticky>
                  <input
                    type="text"
                    value={colSubject}
                    onChange={(e) => setColSubject(e.target.value)}
                    placeholder="Filter…"
                    className="w-full bg-[var(--surface)] border border-[var(--surface-2)] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[var(--accent)]"
                  />
                </FilterCell>
                <FilterCell>
                  <MiniMultiSelect
                    placeholder="Any"
                    options={uniqueLabels.map((l) => ({ id: l, label: l }))}
                    selected={colLabels}
                    onChange={setColLabels}
                  />
                </FilterCell>
                <FilterCell>
                  <MiniMultiSelect
                    placeholder="Any"
                    options={uniqueSublabels.map((l) => ({ id: l, label: l }))}
                    selected={colSublabels}
                    onChange={setColSublabels}
                  />
                </FilterCell>
                <FilterCell>
                  <div className="flex items-center gap-0.5">
                    <input
                      type="date"
                      value={colCreatedFrom}
                      onChange={(e) => setColCreatedFrom(e.target.value)}
                      className="w-[110px] bg-[var(--surface)] border border-[var(--surface-2)] rounded px-1 py-1 text-[11px] focus:outline-none focus:border-[var(--accent)]"
                    />
                    <span className="text-[10px] text-[var(--text-muted)]">→</span>
                    <input
                      type="date"
                      value={colCreatedTo}
                      onChange={(e) => setColCreatedTo(e.target.value)}
                      className="w-[110px] bg-[var(--surface)] border border-[var(--surface-2)] rounded px-1 py-1 text-[11px] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </FilterCell>
                <FilterCell>
                  <input
                    type="text"
                    value={colSupplier}
                    onChange={(e) => setColSupplier(e.target.value)}
                    placeholder="Filter…"
                    className="w-full bg-[var(--surface)] border border-[var(--surface-2)] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[var(--accent)]"
                  />
                </FilterCell>
                <FilterCell>
                  <MiniMultiSelect
                    placeholder="Any"
                    options={assignees.map((u) => ({ id: u.id, label: u.name }))}
                    selected={colAssignees}
                    onChange={setColAssignees}
                  />
                </FilterCell>
                <FilterCell>
                  <MiniMultiSelect
                    placeholder="Any"
                    options={uniqueCallers.map((u) => ({ id: u.id, label: u.name }))}
                    selected={colCallers}
                    onChange={setColCallers}
                  />
                </FilterCell>
                <FilterCell>
                  <MiniMultiSelect
                    placeholder="Any"
                    options={statuses.map((s) => ({ id: s.id, label: s.name }))}
                    selected={colStatuses}
                    onChange={setColStatuses}
                  />
                </FilterCell>
                <FilterCell>
                  <div className="flex items-center gap-0.5">
                    <input
                      type="date"
                      value={colLastFrom}
                      onChange={(e) => setColLastFrom(e.target.value)}
                      className="w-[110px] bg-[var(--surface)] border border-[var(--surface-2)] rounded px-1 py-1 text-[11px] focus:outline-none focus:border-[var(--accent)]"
                    />
                    <span className="text-[10px] text-[var(--text-muted)]">→</span>
                    <input
                      type="date"
                      value={colLastTo}
                      onChange={(e) => setColLastTo(e.target.value)}
                      className="w-[110px] bg-[var(--surface)] border border-[var(--surface-2)] rounded px-1 py-1 text-[11px] focus:outline-none focus:border-[var(--accent)]"
                    />
                  </div>
                </FilterCell>
                <FilterCell>
                  <input
                    type="text"
                    value={colMaterial}
                    onChange={(e) => setColMaterial(e.target.value)}
                    placeholder="Filter…"
                    className="w-full bg-[var(--surface)] border border-[var(--surface-2)] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[var(--accent)]"
                  />
                </FilterCell>
                <FilterCell>
                  <input
                    type="text"
                    value={colFollowUp}
                    onChange={(e) => setColFollowUp(e.target.value)}
                    placeholder="Filter…"
                    className="w-full bg-[var(--surface)] border border-[var(--surface-2)] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[var(--accent)]"
                  />
                </FilterCell>
              </tr>
            </thead>
            <tbody>
              {filteredRows.length === 0 && !loading ? (
                <tr>
                  <td colSpan={11} className="text-center py-8 text-[var(--text-muted)]">
                    No conversations match the current filters.
                  </td>
                </tr>
              ) : (
                filteredRows.map((row) => (
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

// ── Filter row cell (matches Th sticky behavior) ──────────────────────
function FilterCell({
  children,
  sticky = false,
}: {
  children: React.ReactNode;
  sticky?: boolean;
}) {
  return (
    <th
      className={`px-3 pt-1 pb-2 border-b border-[var(--surface-2)] font-normal align-top ${
        sticky ? "sticky left-0 z-10 bg-[var(--bg)] shadow-[2px_0_0_0_var(--surface-2)]" : ""
      }`}
    >
      {children}
    </th>
  );
}

// ── Compact multi-select for column filters ───────────────────────────
// Button shows "Any" or a count; clicking opens a checkbox list. Designed
// to fit inside a table header cell — width is content-driven, not the
// big MultiSelectDropdown which assumes its own row of real estate.
function MiniMultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Any",
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const visible = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const buttonLabel =
    selected.length === 0
      ? placeholder
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.label || "1 selected"
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative inline-block w-full">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-between gap-1 w-full bg-[var(--surface)] border border-[var(--surface-2)] hover:border-[var(--text-muted)] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[var(--accent)]"
      >
        <span className={`truncate ${selected.length === 0 ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`}>
          {buttonLabel}
        </span>
        <ChevronDown size={11} className="flex-shrink-0 text-[var(--text-muted)]" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-[var(--surface)] border border-[var(--surface-2)] rounded-md shadow-lg z-50 min-w-[200px] max-w-[280px] max-h-[280px] overflow-hidden flex flex-col">
          {options.length > 8 && (
            <div className="p-1.5 border-b border-[var(--surface-2)] flex-shrink-0">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full bg-[var(--bg)] border border-[var(--surface-2)] rounded px-2 py-1 text-[12px] focus:outline-none focus:border-[var(--accent)]"
                autoFocus
              />
            </div>
          )}
          <div className="overflow-auto py-1 flex-1">
            {visible.length === 0 ? (
              <div className="px-3 py-2 text-[12px] text-[var(--text-muted)]">No options</div>
            ) : (
              visible.map((o) => (
                <label
                  key={o.id}
                  className="flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-[var(--surface-2)] cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(o.id)}
                    onChange={() => toggle(o.id)}
                    className="accent-[var(--accent)]"
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              ))
            )}
          </div>
          {selected.length > 0 && (
            <div className="border-t border-[var(--surface-2)] flex-shrink-0">
              <button
                onClick={() => { onChange([]); setSearch(""); }}
                className="w-full text-left px-3 py-1.5 text-[12px] text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
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