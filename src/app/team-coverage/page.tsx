"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  ArrowLeft, ChevronRight, Loader2, Users, Mail, Filter, X, Search, ExternalLink, ChevronDown,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────
interface TeamMember {
  id: string;
  name: string;
  initials: string | null;
  color: string | null;
  avatar_url: string | null;
  role: string | null;
}

interface AccountLite {
  id: string;
  name: string;
}

interface OverviewRow {
  team_member: TeamMember;
  counts: Record<string, number>;   // keyed by account_id
  total: number;
  latest_at: string | null;
}

interface SupplierStatus {
  id: string;
  name: string;
  color: string;
  background_color: string;
  sort_order?: number;
  is_active?: boolean;
}

interface DrillRow {
  supplier: { id: string; name: string; email: string } | null;
  account:  { id: string; name: string } | null;
  last_contact_at: string;
  total_outbound: number;
  status: SupplierStatus | null;
  latest_conversation: {
    id: string;
    subject: string | null;
    last_message_at: string | null;
    labels: { id: string; name: string; color: string; background_color: string }[];
  } | null;
}

// ── Helpers ────────────────────────────────────────────────────────────
function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  const now = Date.now();
  const mins = Math.floor((now - then) / 60000);
  if (mins < 1)    return "just now";
  if (mins < 60)   return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  const days = Math.floor(mins / 1440);
  if (days < 30)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function memberInitials(m: TeamMember): string {
  if (m.initials) return m.initials;
  const parts = (m.name || "?").trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase() || "?";
}

// ── Page component ─────────────────────────────────────────────────────
export default function TeamCoveragePage() {
  const { data: session } = useSession();
  const userRole = (session as any)?.teamMember?.role || null;
  const currentUserId = (session as any)?.teamMember?.id || null;
  // Admin-only — non-admins get a friendly "Admin access required" page.
  // (Codebase has no "manager" role today; if one is added later, update here.)
  const isAllowed = userRole === "admin";

  // ── Filters (shared between overview & drill-in) ─────────────────────
  const [accountFilter, setAccountFilter]   = useState<string>("");   // "" = all accounts
  const [statusFilter, setStatusFilter]     = useState<string>("");   // "" = all, "__none__" = no status
  const [searchQuery, setSearchQuery]       = useState<string>("");

  // ── Overview state ───────────────────────────────────────────────────
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [overviewRows, setOverviewRows] = useState<OverviewRow[]>([]);

  // ── Drill-in state ───────────────────────────────────────────────────
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null);
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillRows, setDrillRows] = useState<DrillRow[]>([]);
  const [drillError, setDrillError] = useState<string | null>(null);

  // ── Status options (for the picker + filter) ─────────────────────────
  const [availableStatuses, setAvailableStatuses] = useState<SupplierStatus[]>([]);

  // Initial loads
  useEffect(() => {
    fetch("/api/supplier-statuses")
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => setAvailableStatuses(d.statuses || []))
      .catch(() => {});
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const params = new URLSearchParams();
      if (accountFilter) params.set("account_id", accountFilter);
      const res = await fetch(`/api/team-coverage?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setAccounts(data.accounts || []);
        setOverviewRows(data.rows || []);
      }
    } catch (e) {
      console.error("Overview load failed:", e);
    } finally {
      setOverviewLoading(false);
    }
  }, [accountFilter]);

  useEffect(() => { if (isAllowed && !selectedMember) loadOverview(); }, [isAllowed, selectedMember, loadOverview]);

  const loadDrill = useCallback(async (memberId: string) => {
    setDrillLoading(true);
    setDrillError(null);
    try {
      const params = new URLSearchParams();
      if (accountFilter) params.set("account_id", accountFilter);
      if (statusFilter)  params.set("status_id", statusFilter);
      const res = await fetch(`/api/team-coverage/${memberId}?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDrillRows(data.rows || []);
        // Log debug info even on success — useful for verification
        if (data._debug) console.info("[team-coverage drill-in]", data._debug);
      } else {
        const msg = data.error || `HTTP ${res.status}`;
        setDrillError(msg);
        setDrillRows([]);
        console.error("[team-coverage drill-in] server error:", msg, data._debug);
      }
    } catch (e: any) {
      setDrillError(e?.message || "Network error");
      setDrillRows([]);
      console.error("Drill load failed:", e);
    } finally {
      setDrillLoading(false);
    }
  }, [accountFilter, statusFilter]);

  useEffect(() => {
    if (selectedMember) loadDrill(selectedMember.id);
  }, [selectedMember, accountFilter, statusFilter, loadDrill]);

  // ── Search filtering (client-side for both views) ─────────────────────
  const filteredOverview = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return overviewRows;
    return overviewRows.filter(r => r.team_member.name.toLowerCase().includes(q));
  }, [overviewRows, searchQuery]);

  const filteredDrill = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return drillRows;
    return drillRows.filter(r =>
      (r.supplier?.name || "").toLowerCase().includes(q) ||
      (r.supplier?.email || "").toLowerCase().includes(q) ||
      (r.latest_conversation?.subject || "").toLowerCase().includes(q)
    );
  }, [drillRows, searchQuery]);

  // ── Set status on a (supplier, account) pair, with optimistic update ──
  const setStatus = useCallback(async (
    supplierId: string, accountId: string, statusId: string | null
  ) => {
    // Optimistic update: patch the row locally first, then sync.
    setDrillRows(rs => rs.map(r => {
      if (r.supplier?.id !== supplierId || r.account?.id !== accountId) return r;
      const newStatus = statusId
        ? (availableStatuses.find(s => s.id === statusId) || null)
        : null;
      return { ...r, status: newStatus };
    }));

    try {
      const res = await fetch("/api/supplier-account-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_contact_id: supplierId,
          email_account_id: accountId,
          status_id: statusId,
          actor_id: currentUserId,
        }),
      });
      if (!res.ok) {
        // Reload on failure to undo the optimistic patch
        if (selectedMember) loadDrill(selectedMember.id);
        const json = await res.json().catch(() => ({}));
        alert("Failed to set status: " + (json.error || "Unknown error"));
      }
    } catch (e: any) {
      if (selectedMember) loadDrill(selectedMember.id);
      alert("Failed to set status: " + (e?.message || String(e)));
    }
  }, [availableStatuses, currentUserId, selectedMember, loadDrill]);

  if (!isAllowed) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="max-w-md text-center">
          <Users size={32} className="text-[var(--text-muted)] mx-auto mb-3" />
          <h1 className="text-lg font-semibold text-[var(--text-primary)] mb-1">Team Coverage</h1>
          <p className="text-[12px] text-[var(--text-muted)] mb-4">
            This page is for admins only — it shows team-wide supplier coverage.
          </p>
          <Link href="/" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface)]">
            <ArrowLeft size={12} /> Back to inbox
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      <div className="max-w-7xl mx-auto px-6 py-5">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <ArrowLeft size={16} />
            </Link>
            <h1 className="text-[18px] font-semibold flex items-center gap-2">
              <Users size={18} />
              Team Coverage
              {selectedMember && (
                <>
                  <ChevronRight size={14} className="text-[var(--text-muted)]" />
                  <span className="text-[var(--text-primary)]">{selectedMember.name}</span>
                </>
              )}
            </h1>
          </div>
          {selectedMember && (
            <button
              onClick={() => { setSelectedMember(null); setSearchQuery(""); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface)]"
            >
              <ArrowLeft size={12} /> Back to overview
            </button>
          )}
        </div>

        {/* ── Filter bar ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Account filter */}
          <select
            value={accountFilter}
            onChange={(e) => setAccountFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[12px] outline-none"
          >
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          {/* Status filter — only in drill-in view */}
          {selectedMember && (
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[12px] outline-none"
            >
              <option value="">All statuses</option>
              <option value="__none__">No status set</option>
              {availableStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          )}

          {/* Search */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex-1 max-w-md">
            <Search size={13} className="text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={selectedMember ? "Search supplier..." : "Search teammate..."}
              className="flex-1 bg-transparent outline-none text-[12px] text-[var(--text-primary)]"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={12} />
              </button>
            )}
          </div>

          {(accountFilter || statusFilter || searchQuery) && (
            <button
              onClick={() => { setAccountFilter(""); setStatusFilter(""); setSearchQuery(""); }}
              className="px-2.5 py-1.5 rounded-lg text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              Clear filters
            </button>
          )}
        </div>

        {/* ── Body: overview OR drill-in ─────────────────────────────── */}
        {!selectedMember ? (
          // Overview table
          overviewLoading ? (
            <div className="flex items-center gap-2 text-[var(--text-muted)] text-[12px] py-10 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading team coverage…
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-[var(--bg)] border-b border-[var(--border)]">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">TEAMMATE</th>
                    {accounts
                      .filter(a => !accountFilter || a.id === accountFilter)
                      .map(a => (
                        <th key={a.id} className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">
                          {a.name}
                        </th>
                      ))}
                    <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)]">TOTAL</th>
                    <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)]">LATEST</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOverview.length === 0 ? (
                    <tr>
                      <td colSpan={accounts.length + 4} className="text-center py-10 text-[var(--text-muted)]">
                        No teammates match.
                      </td>
                    </tr>
                  ) : (
                    filteredOverview.map((r) => (
                      <tr
                        key={r.team_member.id}
                        onClick={() => setSelectedMember(r.team_member)}
                        className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)] cursor-pointer transition-colors"
                      >
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                              style={{ backgroundColor: r.team_member.color || "#6B7280" }}
                            >
                              {memberInitials(r.team_member)}
                            </span>
                            <div>
                              <div className="font-medium">{r.team_member.name}</div>
                              {r.team_member.role && (
                                <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{r.team_member.role}</div>
                              )}
                            </div>
                          </div>
                        </td>
                        {accounts
                          .filter(a => !accountFilter || a.id === accountFilter)
                          .map(a => (
                            <td key={a.id} className="text-right px-3 py-2.5 tabular-nums">
                              {r.counts[a.id] > 0
                                ? <span className="text-[var(--text-primary)] font-medium">{r.counts[a.id]}</span>
                                : <span className="text-[var(--text-muted)]">0</span>}
                            </td>
                          ))}
                        <td className="text-right px-3 py-2.5 tabular-nums font-bold">
                          {r.total > 0 ? r.total : <span className="text-[var(--text-muted)] font-normal">0</span>}
                        </td>
                        <td className="text-right px-3 py-2.5 text-[var(--text-muted)]">{fmtRelative(r.latest_at)}</td>
                        <td className="px-2 text-[var(--text-muted)]"><ChevronRight size={14} /></td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )
        ) : (
          // Drill-in supplier list
          drillLoading ? (
            <div className="flex items-center gap-2 text-[var(--text-muted)] text-[12px] py-10 justify-center">
              <Loader2 size={14} className="animate-spin" /> Loading {selectedMember.name}'s suppliers…
            </div>
          ) : drillError ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
              <div className="text-[12px] font-semibold text-red-500 mb-1">Drill-in failed</div>
              <div className="text-[12px] text-[var(--text-secondary)] mb-2">{drillError}</div>
              <div className="text-[10px] text-[var(--text-muted)]">
                Open DevTools → Console and look for the "[team-coverage drill-in]" log entry to see the full debug info.
              </div>
              <button
                onClick={() => selectedMember && loadDrill(selectedMember.id)}
                className="mt-3 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface)]"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              <div className="text-[11px] text-[var(--text-muted)] mb-2">
                {filteredDrill.length} supplier{filteredDrill.length === 1 ? "" : "s"} contacted
              </div>
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-[var(--bg)] border-b border-[var(--border)]">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">SUPPLIER</th>
                      <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">ACCOUNT</th>
                      <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] w-56">STATUS</th>
                      <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">LABELS</th>
                      <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] w-24">OUTBOUND</th>
                      <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] w-24">LAST</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDrill.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="text-center py-10 text-[var(--text-muted)]">
                          No suppliers match the current filters.
                        </td>
                      </tr>
                    ) : (
                      filteredDrill.map((r, i) => (
                        <tr key={`${r.supplier?.id}-${r.account?.id}-${i}`} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]">
                          <td className="px-3 py-2">
                            <div className="font-medium">{r.supplier?.name || "—"}</div>
                            <div className="text-[10px] text-[var(--text-muted)]">{r.supplier?.email}</div>
                          </td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]">{r.account?.name || "—"}</td>
                          <td className="px-3 py-2">
                            <StatusPicker
                              currentStatus={r.status}
                              availableStatuses={availableStatuses}
                              onChange={(statusId) => {
                                if (r.supplier && r.account) {
                                  setStatus(r.supplier.id, r.account.id, statusId);
                                }
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {(r.latest_conversation?.labels || []).slice(0, 5).map(l => (
                                <span
                                  key={l.id}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-medium"
                                  style={{ color: `#${l.color}`, backgroundColor: `#${l.background_color}` }}
                                >
                                  {l.name}
                                </span>
                              ))}
                              {(r.latest_conversation?.labels?.length || 0) > 5 && (
                                <span className="text-[10px] text-[var(--text-muted)]">+{(r.latest_conversation!.labels.length - 5)}</span>
                              )}
                            </div>
                          </td>
                          <td className="text-right px-3 py-2 tabular-nums">{r.total_outbound}</td>
                          <td className="text-right px-3 py-2 text-[var(--text-muted)]">
                            {r.latest_conversation ? (
                              <Link
                                href={`/?convo=${r.latest_conversation.id}`}
                                className="hover:text-[var(--text-primary)] inline-flex items-center gap-1"
                                title={r.latest_conversation.subject || ""}
                              >
                                {fmtRelative(r.last_contact_at)}
                                <ExternalLink size={10} />
                              </Link>
                            ) : (
                              fmtRelative(r.last_contact_at)
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

// ── Inline status picker ──────────────────────────────────────────────
// Click to expand a dropdown of all active statuses (plus a "Clear" option).
// Closes on outside click. Optimistic update is handled by the parent's
// setStatus function; this is a thin presentational dropdown.
function StatusPicker({
  currentStatus,
  availableStatuses,
  onChange,
}: {
  currentStatus: SupplierStatus | null;
  availableStatuses: SupplierStatus[];
  onChange: (statusId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-status-picker]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative inline-block" data-status-picker>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors hover:opacity-80"
        style={
          currentStatus
            ? { color: `#${currentStatus.color}`, backgroundColor: `#${currentStatus.background_color}` }
            : { color: "var(--text-muted)", backgroundColor: "var(--bg)", border: "1px dashed var(--border)" }
        }
      >
        <span>{currentStatus?.name || "Set status"}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 w-60 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg py-1">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)] italic"
          >
            Clear status
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          {availableStatuses.map(s => (
            <button
              key={s.id}
              onClick={() => { onChange(s.id); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg)] flex items-center gap-2"
            >
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold inline-block"
                style={{ color: `#${s.color}`, backgroundColor: `#${s.background_color}` }}
              >
                {s.name}
              </span>
              {currentStatus?.id === s.id && (
                <span className="ml-auto text-[10px] text-[var(--accent)]">✓</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}