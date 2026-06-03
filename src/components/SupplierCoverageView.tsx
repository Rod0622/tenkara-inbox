"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import {
  Search, X, Download, Loader2, AlertCircle, ChevronRight, ChevronLeft, ArrowLeft,
  ExternalLink, Building2, Users as UsersIcon, ArrowUpDown,
} from "lucide-react";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";

// ── SupplierCoverageView (Batch 7) ─────────────────────────────────────
//
// Renders the supplier-first cut of Team Coverage.
//   • No `supplierId` prop → supplier LIST: paginated/filtered table of
//     suppliers with aggregated stats. Click any row to drill in.
//   • `supplierId` prop set → supplier DRILL: per-supplier breakdown
//     of which teammates reached out, sliced by account.
//
// State that lives here:
//   • Search/sort/filters for the list (local component state)
//   • Pagination cursor
//   • Loaded data (suppliers list or single-supplier drill)
//
// The parent (team-coverage/page.tsx) only manages the URL param
// `supplier=<id>` via the navigation callbacks.

type Account = { id: string; name: string };
type SupplierStatus = { id: string; name: string; color: string; background_color: string };

type SupplierListRow = {
  id: string;
  name: string | null;
  email: string | null;
  account_count: number;
  teammate_count: number;
  total_outbound: number;
  last_contact_at: string | null;
  statuses_by_account: StatusBadge[];
};
type StatusBadge = {
  account_id: string;
  account_name: string | null;
  status_id: string | null;
  status_name: string | null;
  status_color: string | null;
  status_bg_color: string | null;
};
type SupplierListResponse = {
  suppliers: SupplierListRow[];
  total: number;
  limit: number;
  offset: number;
};

type DrillRow = {
  team_member: { id: string; name: string; initials: string | null; color: string | null; role: string | null } | null;
  account: { id: string; name: string } | null;
  total_outbound: number;
  last_contact_at: string;
  latest_conversation: { id: string; subject: string | null; last_message_at: string | null };
};
type DrillResponse = {
  supplier: { id: string; name: string | null; email: string | null; statuses_by_account: StatusBadge[] };
  rows: DrillRow[];
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function downloadCSV(filename: string, rows: any[]) {
  if (rows.length === 0) return;
  const cols = Object.keys(rows[0]);
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(","));
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─────────────────────────────────────────────────────────────────────
// Main view — switches between list and drill based on supplierId prop
// ─────────────────────────────────────────────────────────────────────
export default function SupplierCoverageView({
  supplierId,
  accounts,
  availableStatuses,
  accountFilterIds,
  onSelectSupplier,
  onClearSupplier,
  onChangeAccounts,
}: {
  supplierId: string | null;
  accounts: Account[];
  availableStatuses: SupplierStatus[];
  accountFilterIds: string[];
  onSelectSupplier: (id: string) => void;
  onClearSupplier: () => void;
  onChangeAccounts: (ids: string[]) => void;
}) {
  if (supplierId) {
    return (
      <SupplierDrillView
        supplierId={supplierId}
        accountFilterIds={accountFilterIds}
        accounts={accounts}
        onBack={onClearSupplier}
        onChangeAccounts={onChangeAccounts}
      />
    );
  }
  return (
    <SupplierListView
      accounts={accounts}
      availableStatuses={availableStatuses}
      accountFilterIds={accountFilterIds}
      onSelectSupplier={onSelectSupplier}
      onChangeAccounts={onChangeAccounts}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// LIST view
// ─────────────────────────────────────────────────────────────────────
type ListSort = "last_contact" | "name" | "outbound" | "accounts" | "teammates";

function SupplierListView({
  accounts,
  availableStatuses,
  accountFilterIds,
  onSelectSupplier,
  onChangeAccounts,
}: {
  accounts: Account[];
  availableStatuses: SupplierStatus[];
  accountFilterIds: string[];
  onSelectSupplier: (id: string) => void;
  onChangeAccounts: (ids: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sort, setSort] = useState<ListSort>("last_contact");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<SupplierListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const PAGE_SIZE = 50;

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  // Reset to page 0 whenever filters/sort change
  useEffect(() => { setOffset(0); }, [debouncedSearch, statusFilter, sort, order, accountFilterIds.join(",")]);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (debouncedSearch) p.set("q", debouncedSearch);
      if (accountFilterIds.length > 0) p.set("account_ids", accountFilterIds.join(","));
      if (statusFilter) p.set("status_id", statusFilter);
      p.set("sort", sort);
      p.set("order", order);
      p.set("limit", String(PAGE_SIZE));
      p.set("offset", String(offset));
      const res = await fetch(`/api/team-coverage/suppliers?${p.toString()}`);
      const j = await res.json();
      if (!res.ok) { setError(j.error || `HTTP ${res.status}`); setData(null); }
      else { setData(j); }
    } catch (e: any) {
      setError(e?.message || String(e)); setData(null);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, accountFilterIds, statusFilter, sort, order, offset]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const toggleSort = (newSort: ListSort) => {
    if (sort === newSort) {
      setOrder(order === "asc" ? "desc" : "asc");
    } else {
      setSort(newSort);
      setOrder(newSort === "name" ? "asc" : "desc");
    }
  };

  // CSV — exports all currently-filtered suppliers (not just current page).
  // Hits the endpoint with a high limit to get them all in one go.
  const downloadListCsv = async () => {
    try {
      const p = new URLSearchParams();
      if (debouncedSearch) p.set("q", debouncedSearch);
      if (accountFilterIds.length > 0) p.set("account_ids", accountFilterIds.join(","));
      if (statusFilter) p.set("status_id", statusFilter);
      p.set("sort", sort);
      p.set("order", order);
      p.set("limit", "200");
      p.set("offset", "0");
      // Page through if there are more
      const allRows: SupplierListRow[] = [];
      let cursor = 0;
      while (true) {
        p.set("offset", String(cursor));
        const res = await fetch(`/api/team-coverage/suppliers?${p.toString()}`);
        const j = await res.json();
        if (!res.ok) { alert("CSV export failed: " + (j.error || res.status)); return; }
        allRows.push(...(j.suppliers || []));
        cursor += (j.suppliers || []).length;
        if (allRows.length >= (j.total || 0)) break;
        if ((j.suppliers || []).length === 0) break;
        if (cursor > 5000) break; // hard cap
      }
      const csvRows = allRows.map(r => ({
        supplier_name: r.name || "",
        supplier_email: r.email || "",
        accounts_count: r.account_count,
        teammates_count: r.teammate_count,
        total_outbound: r.total_outbound,
        last_contact_at: r.last_contact_at || "",
        statuses: r.statuses_by_account
          .filter(s => s.status_name)
          .map(s => `${s.account_name}: ${s.status_name}`)
          .join("; "),
      }));
      downloadCSV(`suppliers-${new Date().toISOString().slice(0,10)}.csv`, csvRows);
    } catch (e: any) {
      alert("CSV export failed: " + (e?.message || String(e)));
    }
  };

  const total = data?.total || 0;
  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      {/* ── Filter bar ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <MultiSelectDropdown
          options={accounts.map(a => ({ id: a.id, label: a.name }))}
          selected={accountFilterIds}
          onChange={onChangeAccounts}
          placeholder="All accounts"
          searchPlaceholder="Search account..."
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[12px] outline-none"
        >
          <option value="">All statuses</option>
          <option value="__none__">No status set</option>
          {availableStatuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex-1 min-w-[220px] flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <Search size={12} className="text-[var(--text-muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search supplier name or email..."
            className="flex-1 bg-transparent outline-none text-[12px] text-[var(--text-primary)]"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <X size={12} />
            </button>
          )}
        </div>
        <button
          onClick={downloadListCsv}
          disabled={loading || total === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface)] disabled:opacity-40"
          title="Download all filtered suppliers as CSV"
        >
          <Download size={12} /> CSV
        </button>
      </div>

      {/* ── Result count line ───────────────────────────────────── */}
      <div className="text-[11px] text-[var(--text-muted)] mb-2">
        {loading && !data ? "Loading…" : total === 0 ? "No suppliers match." : `${total} supplier${total === 1 ? "" : "s"}`}
      </div>

      {/* ── Table ───────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 mb-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-red-500 mb-1">
            <AlertCircle size={14} /> Failed to load suppliers
          </div>
          <div className="text-[12px] text-[var(--text-secondary)] mb-2">{error}</div>
          <button onClick={fetchPage} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface)]">Retry</button>
        </div>
      )}

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="max-h-[65vh] overflow-y-auto overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] border-b border-[var(--border)] sticky top-0 z-10">
              <tr>
                <SortableHeader label="SUPPLIER" sortKey="name" current={sort} order={order} onClick={() => toggleSort("name")} />
                <SortableHeader label="ACCOUNTS" sortKey="accounts" current={sort} order={order} onClick={() => toggleSort("accounts")} align="right" />
                <SortableHeader label="TEAMMATES" sortKey="teammates" current={sort} order={order} onClick={() => toggleSort("teammates")} align="right" />
                <SortableHeader label="OUTBOUND" sortKey="outbound" current={sort} order={order} onClick={() => toggleSort("outbound")} align="right" />
                <SortableHeader label="LAST CONTACT" sortKey="last_contact" current={sort} order={order} onClick={() => toggleSort("last_contact")} align="right" />
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">STATUSES</th>
              </tr>
            </thead>
            <tbody>
              {loading && (!data || data.suppliers.length === 0) ? (
                <tr><td colSpan={6} className="text-center py-10 text-[var(--text-muted)]">
                  <Loader2 size={14} className="animate-spin inline mr-2" /> Loading suppliers…
                </td></tr>
              ) : (data?.suppliers || []).length === 0 ? (
                <tr><td colSpan={6} className="text-center py-10 text-[var(--text-muted)]">No suppliers match the current filters.</td></tr>
              ) : (data?.suppliers || []).map(s => (
                <tr
                  key={s.id}
                  onClick={() => onSelectSupplier(s.id)}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)] cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Building2 size={12} className="text-[var(--text-muted)] shrink-0" />
                      <div>
                        <div className="font-medium text-[var(--text-primary)]">{s.name || "—"}</div>
                        {s.email && <div className="text-[10px] text-[var(--text-muted)]">{s.email}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums">{s.account_count}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{s.teammate_count}</td>
                  <td className="text-right px-3 py-2 tabular-nums font-medium">{s.total_outbound}</td>
                  <td className="text-right px-3 py-2 text-[var(--text-muted)]" title={s.last_contact_at || ""}>
                    {fmtRelative(s.last_contact_at)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {s.statuses_by_account
                        .filter(st => st.status_name)
                        .slice(0, 4)
                        .map(st => (
                          <span
                            key={`${st.account_id}-${st.status_id}`}
                            className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                            style={{
                              color: st.status_color ? `#${st.status_color}` : "var(--text-secondary)",
                              backgroundColor: st.status_bg_color ? `#${st.status_bg_color}` : "var(--bg)",
                            }}
                            title={`${st.account_name}: ${st.status_name}`}
                          >
                            {st.status_name}
                          </span>
                        ))}
                      {s.statuses_by_account.filter(st => st.status_name).length > 4 && (
                        <span className="text-[10px] text-[var(--text-muted)]">+{s.statuses_by_account.filter(st => st.status_name).length - 4}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Pagination ─────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 text-[11px] text-[var(--text-muted)]">
          <span>Page {page} of {totalPages}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || loading}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] hover:bg-[var(--surface)] disabled:opacity-40"
            >
              <ChevronLeft size={12} /> Prev
            </button>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total || loading}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] hover:bg-[var(--surface)] disabled:opacity-40"
            >
              Next <ChevronRight size={12} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// DRILL view
// ─────────────────────────────────────────────────────────────────────
function SupplierDrillView({
  supplierId,
  accountFilterIds,
  accounts,
  onBack,
  onChangeAccounts,
}: {
  supplierId: string;
  accountFilterIds: string[];
  accounts: Account[];
  onBack: () => void;
  onChangeAccounts: (ids: string[]) => void;
}) {
  const [data, setData] = useState<DrillResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDrill = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      if (accountFilterIds.length > 0) p.set("account_ids", accountFilterIds.join(","));
      const res = await fetch(`/api/team-coverage/suppliers/${supplierId}?${p.toString()}`);
      const j = await res.json();
      if (!res.ok) { setError(j.error || `HTTP ${res.status}`); setData(null); }
      else { setData(j); }
    } catch (e: any) {
      setError(e?.message || String(e)); setData(null);
    } finally {
      setLoading(false);
    }
  }, [supplierId, accountFilterIds]);

  useEffect(() => { fetchDrill(); }, [fetchDrill]);

  const totalOutbound = useMemo(
    () => (data?.rows || []).reduce((sum, r) => sum + r.total_outbound, 0),
    [data?.rows]
  );

  const downloadDrillCsv = () => {
    const supplier = data?.supplier;
    const rows = (data?.rows || []).map(r => ({
      supplier: supplier?.name || "",
      supplier_email: supplier?.email || "",
      teammate: r.team_member?.name || "",
      account: r.account?.name || "",
      total_outbound: r.total_outbound,
      last_contact_at: r.last_contact_at,
      latest_conversation_subject: r.latest_conversation?.subject || "",
    }));
    const fname = (supplier?.name || "supplier").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    downloadCSV(`supplier-drill-${fname}-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-[12px] py-10 justify-center">
        <Loader2 size={14} className="animate-spin" /> Loading supplier…
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-red-500 mb-1">
          <AlertCircle size={14} /> Failed to load supplier
        </div>
        <div className="text-[12px] text-[var(--text-secondary)] mb-2">{error}</div>
        <div className="flex gap-2">
          <button onClick={fetchDrill} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface)]">Retry</button>
          <button onClick={onBack} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface)]">Back to suppliers</button>
        </div>
      </div>
    );
  }
  if (!data) return null;

  return (
    <div>
      {/* ── Header card with supplier info ───────────────────── */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface)]"
          >
            <ArrowLeft size={12} /> All suppliers
          </button>
          <div>
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[var(--text-primary)]">
              <Building2 size={14} className="text-[var(--text-muted)]" />
              {data.supplier.name || "—"}
            </div>
            {data.supplier.email && (
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{data.supplier.email}</div>
            )}
            {data.supplier.statuses_by_account.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {data.supplier.statuses_by_account
                  .filter(st => st.status_name)
                  .map(st => (
                    <span
                      key={`${st.account_id}-${st.status_id}`}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold"
                      style={{
                        color: st.status_color ? `#${st.status_color}` : "var(--text-secondary)",
                        backgroundColor: st.status_bg_color ? `#${st.status_bg_color}` : "var(--bg)",
                      }}
                    >
                      <span className="text-[var(--text-muted)] font-normal">{st.account_name}:</span>
                      {st.status_name}
                    </span>
                  ))}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={downloadDrillCsv}
          disabled={data.rows.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface)] disabled:opacity-40"
        >
          <Download size={12} /> CSV
        </button>
      </div>

      {/* ── Account filter inline ─────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <MultiSelectDropdown
          options={accounts.map(a => ({ id: a.id, label: a.name }))}
          selected={accountFilterIds}
          onChange={onChangeAccounts}
          placeholder="All accounts"
          searchPlaceholder="Search account..."
        />
        <div className="text-[11px] text-[var(--text-muted)]">
          {data.rows.length} teammate{data.rows.length === 1 ? "" : "s"} contacted · {totalOutbound} outbound message{totalOutbound === 1 ? "" : "s"}
        </div>
      </div>

      {/* ── Drill table ────────────────────────────────────────── */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] border-b border-[var(--border)] sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">TEAMMATE</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">ACCOUNT</th>
                <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">OUTBOUND</th>
                <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">LAST CONTACT</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">LATEST</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-[var(--text-muted)]">No teammates have contacted this supplier yet.</td></tr>
              ) : data.rows.map((r, i) => (
                <tr key={`${r.team_member?.id}-${r.account?.id}-${i}`} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: r.team_member?.color || "#6B7280" }}
                      >
                        {r.team_member?.initials || "?"}
                      </span>
                      <div>
                        <div className="font-medium text-[var(--text-primary)]">{r.team_member?.name || "—"}</div>
                        {r.team_member?.role && (
                          <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{r.team_member.role}</div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{r.account?.name || "—"}</td>
                  <td className="text-right px-3 py-2 tabular-nums font-medium">{r.total_outbound}</td>
                  <td className="text-right px-3 py-2 text-[var(--text-muted)]" title={r.last_contact_at}>
                    {fmtRelative(r.last_contact_at)}
                  </td>
                  <td className="px-3 py-2">
                    {r.latest_conversation?.id ? (
                      <Link
                        href={`/?convo=${r.latest_conversation.id}`}
                        className="text-[var(--info)] hover:underline inline-flex items-center gap-1"
                        title={r.latest_conversation.subject || ""}
                      >
                        {(r.latest_conversation.subject || "(no subject)").slice(0, 60)}
                        <ExternalLink size={10} />
                      </Link>
                    ) : (
                      <span className="text-[var(--text-muted)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Sortable header helper ─────────────────────────────────────────
function SortableHeader({
  label, sortKey, current, order, onClick, align = "left",
}: {
  label: string;
  sortKey: ListSort;
  current: ListSort;
  order: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  const active = current === sortKey;
  return (
    <th className={`px-3 py-2 font-semibold uppercase ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 hover:text-[var(--text-primary)] transition-colors ${
          active ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
        }`}
      >
        {label}
        {active ? (
          <span className="text-[10px]">{order === "asc" ? "↑" : "↓"}</span>
        ) : (
          <ArrowUpDown size={9} className="opacity-40" />
        )}
      </button>
    </th>
  );
}
