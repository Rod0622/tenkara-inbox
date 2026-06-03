"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Loader2, AlertCircle, TrendingUp, Clock, Activity } from "lucide-react";

// ── StatusReportsView ──────────────────────────────────────────────────
//
// Tab content for Team Coverage → Reports (Batch 6, Feature 5).
// Renders three stacked sections fed by a single endpoint:
//   1. Distribution (status × account matrix)
//   2. Aging (sortable table of supplier-account pairs by days at status)
//   3. Activity (recent supplier_status_changed transitions)
//
// Each section has a CSV download button. Activity has its own time
// range selector (7 / 30 / 90 / All).
//
// Loading + error states are per-section UX-wise but actually share a
// single fetch — the endpoint returns all three in one round-trip.

type DistributionRow = {
  status_id: string | null;
  status_name: string;
  status_color: string | null;
  status_bg_color: string | null;
  account_id: string;
  account_name: string;
  count: number;
};

type AgingRow = {
  supplier_id: string;
  supplier_name: string | null;
  supplier_email: string | null;
  account_id: string;
  account_name: string | null;
  status_id: string;
  status_name: string | null;
  status_color: string | null;
  status_bg_color: string | null;
  updated_at: string;
  days_at_status: number;
};

type ActivityRow = {
  id: string;
  created_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_color: string | null;
  actor_initials: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  account_id: string | null;
  account_name: string | null;
  previous_status_name: string | null;
  new_status_name: string | null;
};

type AgingBuckets = { lt7: number; d7to30: number; d30to90: number; gt90: number };

type ReportsResponse = {
  distribution: DistributionRow[];
  aging: AgingRow[];
  aging_buckets: AgingBuckets;
  activity: ActivityRow[];
  range: string;
  generated_at: string;
};

function fmtRelative(iso: string): string {
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
  for (const r of rows) {
    lines.push(cols.map(c => esc(r[c])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function StatusReportsView() {
  const [range, setRange] = useState<string>("30");
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Sort state for aging table
  type AgingSort = "days_desc" | "days_asc" | "supplier" | "account" | "status";
  const [agingSort, setAgingSort] = useState<AgingSort>("days_desc");

  const fetchReports = async (r: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/team-coverage/status-reports?range=${encodeURIComponent(r)}`);
      const j = await res.json();
      if (!res.ok) {
        setError(j.error || `HTTP ${res.status}`);
        setData(null);
      } else {
        setData(j);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReports(range); }, [range]);

  // ── Distribution: pivot rows into a table (statuses × accounts) ──
  const { statusRows, accountColumns, statusRowTotals, accountTotals, grandTotal } = useMemo(() => {
    const dist = data?.distribution || [];
    const accountIds = Array.from(new Set(dist.map(r => r.account_id)));
    const accountNameById = new Map(dist.map(r => [r.account_id, r.account_name]));
    const accountColumns = accountIds.map(id => ({ id, name: accountNameById.get(id) || id }));

    // Preserve incoming order of status_ids (the endpoint already sorts by sort_order)
    const statusOrder: (string | null)[] = [];
    const statusNameById = new Map<string | null, { name: string; color: string | null; bg: string | null }>();
    for (const r of dist) {
      if (!statusOrder.includes(r.status_id)) {
        statusOrder.push(r.status_id);
        statusNameById.set(r.status_id, { name: r.status_name, color: r.status_color, bg: r.status_bg_color });
      }
    }

    // Lookup: count per (status_id, account_id)
    const cellKey = (sid: string | null, aid: string) => `${sid ?? "__none__"}::${aid}`;
    const countByCell = new Map<string, number>();
    for (const r of dist) countByCell.set(cellKey(r.status_id, r.account_id), r.count);

    const statusRows = statusOrder.map(sid => {
      const meta = statusNameById.get(sid)!;
      const cells = accountColumns.map(c => ({
        account_id: c.id,
        count: countByCell.get(cellKey(sid, c.id)) || 0,
      }));
      const rowTotal = cells.reduce((sum, c) => sum + c.count, 0);
      return { status_id: sid, status_name: meta.name, status_color: meta.color, status_bg_color: meta.bg, cells, rowTotal };
    });

    const statusRowTotals = new Map(statusRows.map(s => [s.status_id, s.rowTotal]));
    const accountTotals = new Map<string, number>();
    let grandTotal = 0;
    for (const c of accountColumns) {
      let sum = 0;
      for (const r of statusRows) {
        sum += r.cells.find(cell => cell.account_id === c.id)?.count || 0;
      }
      accountTotals.set(c.id, sum);
      grandTotal += sum;
    }
    return { statusRows, accountColumns, statusRowTotals, accountTotals, grandTotal };
  }, [data?.distribution]);

  // ── Aging: apply sort ──
  const agingSorted = useMemo(() => {
    const rows = (data?.aging || []).slice();
    switch (agingSort) {
      case "days_desc": return rows.sort((a, b) => b.days_at_status - a.days_at_status);
      case "days_asc":  return rows.sort((a, b) => a.days_at_status - b.days_at_status);
      case "supplier":  return rows.sort((a, b) => (a.supplier_name || "").localeCompare(b.supplier_name || ""));
      case "account":   return rows.sort((a, b) => (a.account_name || "").localeCompare(b.account_name || ""));
      case "status":    return rows.sort((a, b) => (a.status_name || "").localeCompare(b.status_name || ""));
    }
  }, [data?.aging, agingSort]);

  // CSV builders — flatten to download-friendly rows
  const downloadDistributionCsv = () => {
    const rows: any[] = [];
    for (const r of statusRows) {
      for (const c of accountColumns) {
        rows.push({
          status: r.status_name,
          account: c.name,
          supplier_count: r.cells.find(cell => cell.account_id === c.id)?.count || 0,
        });
      }
    }
    downloadCSV(`status-distribution-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };
  const downloadAgingCsv = () => {
    const rows = (data?.aging || []).map(r => ({
      supplier: r.supplier_name || "",
      supplier_email: r.supplier_email || "",
      account: r.account_name || "",
      status: r.status_name || "",
      days_at_status: r.days_at_status,
      last_updated_at: r.updated_at || "",
    }));
    downloadCSV(`status-aging-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };
  const downloadActivityCsv = () => {
    const rows = (data?.activity || []).map(r => ({
      when: r.created_at,
      actor: r.actor_name || "",
      supplier: r.supplier_name || "",
      account: r.account_name || "",
      previous_status: r.previous_status_name || "",
      new_status: r.new_status_name || "",
    }));
    downloadCSV(`status-activity-${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  if (loading && !data) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-[12px] py-10 justify-center">
        <Loader2 size={14} className="animate-spin" /> Loading reports…
      </div>
    );
  }
  if (error && !data) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 max-w-md mx-auto mt-6">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-red-500 mb-1">
          <AlertCircle size={14} /> Reports failed to load
        </div>
        <div className="text-[12px] text-[var(--text-secondary)] mb-2">{error}</div>
        <button
          onClick={() => fetchReports(range)}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface)]"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!data) return null;

  const buckets = data.aging_buckets;

  return (
    <div className="space-y-4">
      {/* ── Distribution ────────────────────────────────────────── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-[var(--accent)]" />
            <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">Distribution</h2>
            <span className="text-[11px] text-[var(--text-muted)]">supplier counts by status × account</span>
          </div>
          <button
            onClick={downloadDistributionCsv}
            disabled={statusRows.length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--surface)] disabled:opacity-40"
            title="Download Distribution as CSV"
          >
            <Download size={11} />
            CSV
          </button>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] border-b border-[var(--border)]">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">STATUS</th>
                {accountColumns.map(c => (
                  <th key={c.id} className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">{c.name}</th>
                ))}
                <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {statusRows.length === 0 ? (
                <tr><td colSpan={accountColumns.length + 2} className="text-center py-10 text-[var(--text-muted)]">No data.</td></tr>
              ) : statusRows.map(r => (
                <tr key={r.status_id || "__none__"} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]">
                  <td className="px-3 py-2">
                    {r.status_color ? (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold inline-block"
                        style={{ color: `#${r.status_color}`, backgroundColor: `#${r.status_bg_color}` }}
                      >
                        {r.status_name}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)] italic">{r.status_name}</span>
                    )}
                  </td>
                  {accountColumns.map(c => {
                    const cell = r.cells.find(ce => ce.account_id === c.id);
                    const v = cell?.count || 0;
                    return (
                      <td key={c.id} className="text-right px-3 py-2 tabular-nums">
                        {v > 0
                          ? <span className="text-[var(--text-primary)] font-medium">{v}</span>
                          : <span className="text-[var(--text-muted)]">0</span>}
                      </td>
                    );
                  })}
                  <td className="text-right px-3 py-2 tabular-nums font-semibold text-[var(--text-primary)]">
                    {statusRowTotals.get(r.status_id) || 0}
                  </td>
                </tr>
              ))}
              {statusRows.length > 0 && (
                <tr className="bg-[var(--bg)] font-semibold">
                  <td className="px-3 py-2 text-[var(--text-secondary)]">TOTAL</td>
                  {accountColumns.map(c => (
                    <td key={c.id} className="text-right px-3 py-2 tabular-nums text-[var(--text-primary)]">{accountTotals.get(c.id) || 0}</td>
                  ))}
                  <td className="text-right px-3 py-2 tabular-nums text-[var(--text-primary)]">{grandTotal}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Aging ────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-[var(--warning)]" />
            <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">Aging</h2>
            <span className="text-[11px] text-[var(--text-muted)]">days at current status</span>
          </div>
          <button
            onClick={downloadAgingCsv}
            disabled={(data?.aging || []).length === 0}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--surface)] disabled:opacity-40"
            title="Download Aging as CSV"
          >
            <Download size={11} />
            CSV
          </button>
        </header>

        <div className="px-4 py-3 border-b border-[var(--border)] flex flex-wrap gap-2 bg-[var(--surface)]">
          <BucketChip label="< 7 days"   value={buckets.lt7}      color="var(--accent)" />
          <BucketChip label="7-30 days"  value={buckets.d7to30}   color="var(--info)" />
          <BucketChip label="30-90 days" value={buckets.d30to90}  color="var(--warning)" />
          <BucketChip label="> 90 days"  value={buckets.gt90}     color="#F87171" />
        </div>

        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] border-b border-[var(--border)] sticky top-0 z-10">
              <tr>
                <SortableHeader label="SUPPLIER" active={agingSort === "supplier"} onClick={() => setAgingSort("supplier")} />
                <SortableHeader label="ACCOUNT"  active={agingSort === "account"}  onClick={() => setAgingSort("account")} />
                <SortableHeader label="STATUS"   active={agingSort === "status"}   onClick={() => setAgingSort("status")} />
                <SortableHeader
                  label={agingSort === "days_asc" ? "DAYS ↑" : "DAYS ↓"}
                  active={agingSort === "days_desc" || agingSort === "days_asc"}
                  align="right"
                  onClick={() => setAgingSort(agingSort === "days_desc" ? "days_asc" : "days_desc")}
                />
              </tr>
            </thead>
            <tbody>
              {agingSorted.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-10 text-[var(--text-muted)]">No suppliers with a status set yet.</td></tr>
              ) : agingSorted.map(r => (
                <tr key={`${r.supplier_id}-${r.account_id}`} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]">
                  <td className="px-3 py-2">
                    <div className="font-medium text-[var(--text-primary)]">{r.supplier_name || "—"}</div>
                    {r.supplier_email && <div className="text-[10px] text-[var(--text-muted)]">{r.supplier_email}</div>}
                  </td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{r.account_name || "—"}</td>
                  <td className="px-3 py-2">
                    {r.status_color ? (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-semibold inline-block"
                        style={{ color: `#${r.status_color}`, backgroundColor: `#${r.status_bg_color}` }}
                      >
                        {r.status_name}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)]">{r.status_name || "—"}</span>
                    )}
                  </td>
                  <td className="text-right px-3 py-2 tabular-nums">
                    <span className={
                      r.days_at_status >= 90 ? "text-[#F87171] font-semibold" :
                      r.days_at_status >= 30 ? "text-[var(--warning)] font-medium" :
                      r.days_at_status >= 7  ? "text-[var(--info)]" :
                      "text-[var(--text-secondary)]"
                    }>{r.days_at_status}d</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Activity ─────────────────────────────────────────────── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <header className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="flex items-center gap-2">
            <Activity size={14} className="text-[var(--info)]" />
            <h2 className="text-[12px] font-semibold text-[var(--text-primary)]">Status change activity</h2>
            <span className="text-[11px] text-[var(--text-muted)]">{(data?.activity || []).length} transitions in this window</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={range}
              onChange={(e) => setRange(e.target.value)}
              className="px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] outline-none"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">All time</option>
            </select>
            <button
              onClick={downloadActivityCsv}
              disabled={(data?.activity || []).length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--surface)] disabled:opacity-40"
              title="Download Activity as CSV"
            >
              <Download size={11} />
              CSV
            </button>
          </div>
        </header>
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] border-b border-[var(--border)] sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase w-32">WHEN</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">WHO</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">SUPPLIER</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">ACCOUNT</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">CHANGE</th>
              </tr>
            </thead>
            <tbody>
              {(data?.activity || []).length === 0 ? (
                <tr><td colSpan={5} className="text-center py-10 text-[var(--text-muted)]">No status changes in this time range.</td></tr>
              ) : (data?.activity || []).map(r => (
                <tr key={r.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]">
                  <td className="px-3 py-2 text-[var(--text-muted)]" title={new Date(r.created_at).toLocaleString()}>
                    {fmtRelative(r.created_at)}
                  </td>
                  <td className="px-3 py-2">
                    {r.actor_name ? (
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
                              style={{ backgroundColor: r.actor_color || "#6B7280" }}>
                          {r.actor_initials || "?"}
                        </span>
                        <span>{r.actor_name}</span>
                      </div>
                    ) : <span className="text-[var(--text-muted)] italic">System</span>}
                  </td>
                  <td className="px-3 py-2">{r.supplier_name || "—"}</td>
                  <td className="px-3 py-2 text-[var(--text-secondary)]">{r.account_name || "—"}</td>
                  <td className="px-3 py-2">
                    {r.previous_status_name && r.new_status_name ? (
                      <span>
                        <span className="text-[var(--text-secondary)]">{r.previous_status_name}</span>
                        <span className="text-[var(--text-muted)] mx-1">→</span>
                        <span className="text-[var(--text-primary)] font-medium">{r.new_status_name}</span>
                      </span>
                    ) : r.new_status_name ? (
                      <span><span className="text-[var(--text-muted)]">set to </span><span className="font-medium">{r.new_status_name}</span></span>
                    ) : r.previous_status_name ? (
                      <span><span className="text-[var(--text-muted)]">cleared (was {r.previous_status_name})</span></span>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="text-[10px] text-[var(--text-muted)] text-center pt-2">
        Generated {fmtRelative(data.generated_at)} · <button onClick={() => fetchReports(range)} className="underline hover:text-[var(--text-secondary)]">Refresh</button>
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────────────────────
function BucketChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]"
      style={{ borderColor: value > 0 ? color : undefined }}
    >
      <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{label}</span>
      <span className="text-[13px] font-bold tabular-nums" style={{ color: value > 0 ? color : "var(--text-muted)" }}>{value}</span>
    </div>
  );
}

function SortableHeader({
  label, active, onClick, align = "left",
}: {
  label: string; active: boolean; onClick: () => void; align?: "left" | "right";
}) {
  return (
    <th className={`px-3 py-2 font-semibold uppercase ${align === "right" ? "text-right" : "text-left"} ${active ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>
      <button onClick={onClick} className="hover:text-[var(--text-primary)] transition-colors">
        {label}
      </button>
    </th>
  );
}