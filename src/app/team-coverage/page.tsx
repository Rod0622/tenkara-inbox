"use client";

import { useEffect, useMemo, useState, useCallback, Suspense } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, ChevronRight, Loader2, Users, ExternalLink, ChevronDown, Search, X, BarChart3, Building2,
} from "lucide-react";
import { MultiSelectDropdown } from "@/components/MultiSelectDropdown";
import StatusReportsView from "@/components/StatusReportsView";
import SupplierCoverageView from "@/components/SupplierCoverageView";

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
  counts: Record<string, number>;
  total: number;
  latest_at: string | null;
}

interface SupplierStatus {
  id: string;
  name: string;
  color: string;
  background_color: string;
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
    labels: { id: string; name: string; color: string }[];
  } | null;
}

interface CompareGroup {
  key: string;
  teammate_ids: string[];
  label: string;
  rows: {
    supplier: { id: string; name: string; email: string } | null;
    account: { id: string; name: string } | null;
    status: SupplierStatus | null;
    labels: { id: string; name: string; color: string }[];
    last_contact_at: string;
    per_teammate_outbound: Record<string, number>;
    latest_conversation: { id: string; subject: string | null; last_message_at: string | null } | null;
  }[];
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

// ── Default export: wraps the page in <Suspense> ──────────────────────
// Required because the inner component uses `useSearchParams()`, which
// triggers a CSR bailout during Next.js 14 static generation. Without
// the Suspense boundary, the production build fails.
export default function TeamCoveragePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="flex items-center gap-2 text-[var(--text-muted)] text-[12px]">
          <Loader2 size={14} className="animate-spin" /> Loading Team Coverage…
        </div>
      </div>
    }>
      <TeamCoveragePageInner />
    </Suspense>
  );
}

// ── Main page component ────────────────────────────────────────────────
function TeamCoveragePageInner() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const userRole = (session as any)?.teamMember?.role || null;
  const currentUserId = (session as any)?.teamMember?.id || null;
  const isAllowed = userRole === "admin";

  // ── URL-synced state ─────────────────────────────────────────────────
  // Single-teammate drill-in: ?teammate=<id>
  // Compare view:              ?teammates=<id>,<id>[,<id>...]
  // Account filter:            ?accounts=<id>,<id>
  //
  // Browser back from drill-in or compare goes to /team-coverage (overview)
  // automatically because each view has its own URL state.
  const selectedTeammateId = searchParams.get("teammate") || null;
  const compareTeammateIds = useMemo(() => {
    const raw = searchParams.get("teammates");
    if (!raw) return [];
    return raw.split(",").map(s => s.trim()).filter(Boolean);
  }, [searchParams]);
  const accountFilterIds = useMemo(() => {
    const raw = searchParams.get("accounts");
    if (!raw) return [];
    return raw.split(",").map(s => s.trim()).filter(Boolean);
  }, [searchParams]);

  // Other (transient) filter state — not URL-synced
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  // Overview-only: filter rows to selected teammates
  const [overviewTeammateFilter, setOverviewTeammateFilter] = useState<string[]>([]);

  // ── Data state ───────────────────────────────────────────────────────
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [overviewRows, setOverviewRows] = useState<OverviewRow[]>([]);

  const [drillLoading, setDrillLoading] = useState(false);
  const [drillRows, setDrillRows] = useState<DrillRow[]>([]);
  const [drillTeamMember, setDrillTeamMember] = useState<TeamMember | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);

  const [compareLoading, setCompareLoading] = useState(false);
  const [compareGroups, setCompareGroups] = useState<CompareGroup[]>([]);
  const [compareTeammates, setCompareTeammates] = useState<TeamMember[]>([]);
  const [compareError, setCompareError] = useState<string | null>(null);

  const [availableStatuses, setAvailableStatuses] = useState<SupplierStatus[]>([]);

  // ── Bulk edit state (Batch 6, Feature 2) ─────────────────────────────
  // Only the drill-in view has bulk edit. Keys are `${supplier_id}::${account_id}`.
  const [bulkEditMode, setBulkEditMode] = useState(false);
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkApplying, setBulkApplying] = useState(false);
  // After a bulk apply, this holds the inverse op (previous statuses) so
  // the user can undo within 30 seconds. null when nothing to undo.
  const [undoState, setUndoState] = useState<{
    label: string;
    previousItems: { supplier_contact_id: string; email_account_id: string; status_id: string | null }[];
    expiresAt: number;
  } | null>(null);

  // Auto-dismiss the undo toast after expiresAt passes.
  useEffect(() => {
    if (!undoState) return;
    const ms = undoState.expiresAt - Date.now();
    if (ms <= 0) { setUndoState(null); return; }
    const t = setTimeout(() => setUndoState(null), ms);
    return () => clearTimeout(t);
  }, [undoState]);

  // Clear selection + exit bulk mode when leaving drill view.
  useEffect(() => {
    if (!selectedTeammateId) {
      setBulkEditMode(false);
      setBulkSelected(new Set());
    }
  }, [selectedTeammateId]);


  // Current mode. `view=reports` and `view=suppliers` override the others.
  // For suppliers view, presence of `supplier=<id>` further switches the
  // SupplierCoverageView into its drill state (handled inside the component).
  const viewParam = searchParams.get("view") || null;
  const supplierIdParam = searchParams.get("supplier") || null;
  const mode: "overview" | "drill" | "compare" | "reports" | "suppliers" =
    viewParam === "reports" ? "reports"
    : viewParam === "suppliers" ? "suppliers"
    : compareTeammateIds.length >= 2 ? "compare"
    : selectedTeammateId ? "drill"
    : "overview";

  // ── URL update helpers ───────────────────────────────────────────────
  const buildUrl = useCallback((overrides: { teammate?: string | null; teammates?: string[] | null; accounts?: string[] | null; view?: string | null; supplier?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString());
    if ("teammate" in overrides) {
      if (overrides.teammate) {
        params.set("teammate", overrides.teammate);
        params.delete("teammates");
      } else {
        params.delete("teammate");
      }
    }
    if ("teammates" in overrides) {
      if (overrides.teammates && overrides.teammates.length > 0) {
        params.set("teammates", overrides.teammates.join(","));
        params.delete("teammate");
      } else {
        params.delete("teammates");
      }
    }
    if ("accounts" in overrides) {
      if (overrides.accounts && overrides.accounts.length > 0) {
        params.set("accounts", overrides.accounts.join(","));
      } else {
        params.delete("accounts");
      }
    }
    if ("view" in overrides) {
      if (overrides.view) {
        params.set("view", overrides.view);
        // Switching to Reports / Suppliers clears any teammate/compare
        // selection so the page header doesn't show stale breadcrumbs.
        if (overrides.view === "reports" || overrides.view === "suppliers") {
          params.delete("teammate");
          params.delete("teammates");
        }
        // Switching views also clears any supplier drill cursor unless
        // we're explicitly setting the supplier in the same call.
        if (!("supplier" in overrides)) params.delete("supplier");
      } else {
        params.delete("view");
        params.delete("supplier");
      }
    }
    if ("supplier" in overrides) {
      if (overrides.supplier) {
        params.set("supplier", overrides.supplier);
      } else {
        params.delete("supplier");
      }
    }
    const qs = params.toString();
    return qs ? `/team-coverage?${qs}` : "/team-coverage";
  }, [searchParams]);

  const navigate = useCallback((overrides: any) => {
    router.push(buildUrl(overrides));
  }, [router, buildUrl]);

  // ── Data loaders ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/supplier-statuses")
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => setAvailableStatuses(d.statuses || []))
      .catch(() => {});
  }, []);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const p = new URLSearchParams();
      if (accountFilterIds.length > 0) p.set("account_ids", accountFilterIds.join(","));
      const res = await fetch(`/api/team-coverage?${p.toString()}`);
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
  }, [accountFilterIds]);

  const loadDrill = useCallback(async (teammateId: string) => {
    setDrillLoading(true);
    setDrillError(null);
    try {
      const p = new URLSearchParams();
      if (accountFilterIds.length > 0) p.set("account_ids", accountFilterIds.join(","));
      if (statusFilter) p.set("status_id", statusFilter);
      const res = await fetch(`/api/team-coverage/${teammateId}?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setDrillRows(data.rows || []);
        setDrillTeamMember(data.team_member || null);
        if (data._debug) console.info("[team-coverage drill-in]", data._debug);
      } else {
        const msg = data.error || `HTTP ${res.status}`;
        setDrillError(msg);
        setDrillRows([]);
        setDrillTeamMember(null);
        console.error("[team-coverage drill-in] server error:", msg, data._debug);
      }
    } catch (e: any) {
      setDrillError(e?.message || "Network error");
      setDrillRows([]);
      setDrillTeamMember(null);
    } finally {
      setDrillLoading(false);
    }
  }, [accountFilterIds, statusFilter]);

  const loadCompare = useCallback(async (teammateIds: string[]) => {
    setCompareLoading(true);
    setCompareError(null);
    try {
      const p = new URLSearchParams();
      p.set("teammate_ids", teammateIds.join(","));
      if (accountFilterIds.length > 0) p.set("account_ids", accountFilterIds.join(","));
      if (statusFilter) p.set("status_id", statusFilter);
      const res = await fetch(`/api/team-coverage/compare?${p.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setCompareGroups(data.groups || []);
        setCompareTeammates(data.teammates || []);
        if (data._debug) console.info("[team-coverage compare]", data._debug);
      } else {
        setCompareError(data.error || `HTTP ${res.status}`);
        setCompareGroups([]);
        setCompareTeammates([]);
        console.error("[team-coverage compare] server error:", data.error, data._debug);
      }
    } catch (e: any) {
      setCompareError(e?.message || "Network error");
      setCompareGroups([]);
      setCompareTeammates([]);
    } finally {
      setCompareLoading(false);
    }
  }, [accountFilterIds, statusFilter]);

  // Fetch data based on mode
  useEffect(() => {
    if (!isAllowed) return;
    if (mode === "overview") loadOverview();
  }, [isAllowed, mode, loadOverview]);
  useEffect(() => {
    if (!isAllowed) return;
    if (mode === "drill" && selectedTeammateId) loadDrill(selectedTeammateId);
  }, [isAllowed, mode, selectedTeammateId, loadDrill]);
  useEffect(() => {
    if (!isAllowed) return;
    if (mode === "compare" && compareTeammateIds.length >= 2) loadCompare(compareTeammateIds);
  }, [isAllowed, mode, compareTeammateIds, loadCompare]);

  // ── Filtering (search box; client-side) ───────────────────────────────
  const filteredOverview = useMemo(() => {
    let rows = overviewRows;
    if (overviewTeammateFilter.length > 0) {
      const set = new Set(overviewTeammateFilter);
      rows = rows.filter(r => set.has(r.team_member.id));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) rows = rows.filter(r => r.team_member.name.toLowerCase().includes(q));
    return rows;
  }, [overviewRows, overviewTeammateFilter, searchQuery]);

  const filteredDrill = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return drillRows;
    return drillRows.filter(r =>
      (r.supplier?.name || "").toLowerCase().includes(q) ||
      (r.supplier?.email || "").toLowerCase().includes(q) ||
      (r.latest_conversation?.subject || "").toLowerCase().includes(q)
    );
  }, [drillRows, searchQuery]);

  const filteredCompareGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return compareGroups;
    return compareGroups
      .map(g => ({
        ...g,
        rows: g.rows.filter((r: any) =>
          (r.supplier?.name || "").toLowerCase().includes(q) ||
          (r.supplier?.email || "").toLowerCase().includes(q)
        ),
      }))
      .filter(g => g.rows.length > 0);
  }, [compareGroups, searchQuery]);

  // ── Status edit (used in drill mode) ─────────────────────────────────
  const setStatus = useCallback(async (supplierId: string, accountId: string, statusId: string | null) => {
    // Optimistic update
    setDrillRows(rs => rs.map(r => {
      if (r.supplier?.id !== supplierId || r.account?.id !== accountId) return r;
      const newStatus = statusId ? (availableStatuses.find(s => s.id === statusId) || null) : null;
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
        if (selectedTeammateId) loadDrill(selectedTeammateId);
        const j = await res.json().catch(() => ({}));
        alert("Failed to set status: " + (j.error || "Unknown"));
      }
    } catch (e: any) {
      if (selectedTeammateId) loadDrill(selectedTeammateId);
      alert("Failed to set status: " + (e?.message || String(e)));
    }
  }, [availableStatuses, currentUserId, selectedTeammateId, loadDrill]);

  // ── Bulk apply (Batch 6, Feature 2) ──────────────────────────────────
  //
  // Sends the selected (supplier × account) pairs to /api/supplier-account-status/bulk
  // with the given statusId (or null to clear). On success:
  //   - Captures prior status of each affected row for undo
  //   - Optimistically updates drillRows in memory
  //   - Shows undo toast for 30 seconds
  //   - Clears selection but keeps bulk mode on for chaining
  // On failure: reloads drill to true server state, no undo.
  const applyBulkStatus = useCallback(async (statusId: string | null) => {
    if (bulkSelected.size === 0) return;
    if (bulkApplying) return;

    // Build the items array AND capture previous statuses for undo
    const items: { supplier_contact_id: string; email_account_id: string; status_id: string | null }[] = [];
    const previousItems: { supplier_contact_id: string; email_account_id: string; status_id: string | null }[] = [];
    for (const r of drillRows) {
      const k = `${r.supplier?.id}::${r.account?.id}`;
      if (!bulkSelected.has(k)) continue;
      if (!r.supplier?.id || !r.account?.id) continue;
      items.push({ supplier_contact_id: r.supplier.id, email_account_id: r.account.id, status_id: statusId });
      previousItems.push({
        supplier_contact_id: r.supplier.id,
        email_account_id: r.account.id,
        status_id: r.status?.id || null,
      });
    }
    if (items.length === 0) return;

    setBulkApplying(true);
    try {
      const res = await fetch("/api/supplier-account-status/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, actor_id: currentUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert("Bulk update failed: " + (data.error || `HTTP ${res.status}`));
        if (selectedTeammateId) loadDrill(selectedTeammateId);
        return;
      }
      if ((data.errors || []).length > 0) {
        console.warn("[bulk-update] partial errors:", data.errors);
      }

      // Optimistic in-memory update
      const newStatus = statusId ? (availableStatuses.find(s => s.id === statusId) || null) : null;
      const labelStatusName = newStatus?.name || "no status";
      setDrillRows(rs => rs.map(r => {
        const k = `${r.supplier?.id}::${r.account?.id}`;
        if (!bulkSelected.has(k)) return r;
        return { ...r, status: newStatus };
      }));

      // Show 30-second undo toast
      setUndoState({
        label: `Updated ${data.applied} supplier${data.applied === 1 ? "" : "s"} to "${labelStatusName}"`,
        previousItems,
        expiresAt: Date.now() + 30000,
      });

      // Clear selection but keep bulk mode on
      setBulkSelected(new Set());
    } catch (e: any) {
      alert("Bulk update failed: " + (e?.message || String(e)));
      if (selectedTeammateId) loadDrill(selectedTeammateId);
    } finally {
      setBulkApplying(false);
    }
  }, [bulkSelected, bulkApplying, drillRows, currentUserId, selectedTeammateId, loadDrill, availableStatuses]);

  // ── Undo last bulk apply (Batch 6, Feature 2) ────────────────────────
  //
  // Sends the captured `previousItems` back through the bulk endpoint to
  // restore prior statuses. Dismisses the toast on success or failure.
  const undoBulkApply = useCallback(async () => {
    if (!undoState) return;
    const { previousItems } = undoState;
    setUndoState(null);
    if (previousItems.length === 0) return;
    try {
      const res = await fetch("/api/supplier-account-status/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: previousItems, actor_id: currentUserId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert("Undo failed: " + (d.error || `HTTP ${res.status}`));
      }
      if (selectedTeammateId) loadDrill(selectedTeammateId);
    } catch (e: any) {
      alert("Undo failed: " + (e?.message || String(e)));
      if (selectedTeammateId) loadDrill(selectedTeammateId);
    }
  }, [undoState, currentUserId, selectedTeammateId, loadDrill]);

  // ── Compare picker handler ───────────────────────────────────────────
  const startCompare = (ids: string[]) => {
    if (ids.length < 2) return;
    if (ids.length > 4) {
      alert("Comparison view supports up to 4 teammates. Pick fewer.");
      return;
    }
    navigate({ teammates: ids });
  };

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

  // ── Account filter options for the dropdown ─────────────────────────
  const accountOptions = accounts.map(a => ({ id: a.id, label: a.name }));
  // Teammate filter options for the overview-row filter
  const teammateOptions = overviewRows.map(r => ({
    id: r.team_member.id,
    label: r.team_member.name,
    sublabel: r.team_member.role || undefined,
  }));

  // The header title arrow: in any non-overview mode, goes to overview.
  // In overview mode, goes home.
  const titleArrowHref = mode === "overview" ? "/" : "/team-coverage";

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      <div className="max-w-7xl mx-auto px-6 py-5">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <Link href={titleArrowHref} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <ArrowLeft size={16} />
            </Link>
            <h1 className="text-[18px] font-semibold flex items-center gap-2">
              <Users size={18} />
              Team Coverage
              {mode === "drill" && drillTeamMember && (
                <>
                  <ChevronRight size={14} className="text-[var(--text-muted)]" />
                  <span className="text-[var(--text-primary)]">{drillTeamMember.name}</span>
                </>
              )}
              {mode === "compare" && (
                <>
                  <ChevronRight size={14} className="text-[var(--text-muted)]" />
                  <span className="text-[var(--text-primary)]">Compare {compareTeammates.length || compareTeammateIds.length}</span>
                </>
              )}
              {mode === "reports" && (
                <>
                  <ChevronRight size={14} className="text-[var(--text-muted)]" />
                  <span className="text-[var(--text-primary)]">Reports</span>
                </>
              )}
              {mode === "suppliers" && (
                <>
                  <ChevronRight size={14} className="text-[var(--text-muted)]" />
                  <span className="text-[var(--text-primary)]">{supplierIdParam ? "Supplier drill" : "Suppliers"}</span>
                </>
              )}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {/* Suppliers tab (Batch 7). Supplier-first cut of the same data. */}
            <Link
              href={mode === "suppliers" ? "/team-coverage" : buildUrl({ view: "suppliers" })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-colors ${
                mode === "suppliers"
                  ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]"
                  : "bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
              }`}
            >
              <Building2 size={12} />
              {mode === "suppliers" ? "Exit suppliers" : "Suppliers"}
            </Link>
            {/* Reports tab (Batch 6, Feature 5). Always visible in the
                header so users can jump in/out of the analytics view
                from any other mode. */}
            <Link
              href={mode === "reports" ? "/team-coverage" : buildUrl({ view: "reports" })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[12px] transition-colors ${
                mode === "reports"
                  ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]"
                  : "bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
              }`}
            >
              <BarChart3 size={12} />
              {mode === "reports" ? "Exit reports" : "Reports"}
            </Link>
            {mode !== "overview" && mode !== "reports" && mode !== "suppliers" && (
              <Link
                href="/team-coverage"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface)]"
              >
                <ArrowLeft size={12} /> Back to overview
              </Link>
            )}
          </div>
        </div>

        {/* ── Filter bar — not shown in reports/suppliers modes (each has its own controls) ── */}
        {mode !== "reports" && mode !== "suppliers" && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {/* Account multi-select */}
          <MultiSelectDropdown
            options={accountOptions}
            selected={accountFilterIds}
            onChange={(ids) => navigate({ accounts: ids })}
            placeholder="All accounts"
            searchPlaceholder="Search account..."
          />

          {/* Status filter — drill + compare only */}
          {(mode === "drill" || mode === "compare") && (
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

          {/* Bulk Edit toggle — drill only (Batch 6, Feature 2). Toggle reveals
              a checkbox column on the table and a floating action bar at the
              bottom of the screen. */}
          {mode === "drill" && (
            <button
              onClick={() => {
                setBulkEditMode(v => !v);
                setBulkSelected(new Set());
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] border transition-colors ${
                bulkEditMode
                  ? "bg-[var(--info)]/10 border-[var(--info)]/40 text-[var(--info)]"
                  : "bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--text-muted)]"
              }`}
            >
              {bulkEditMode ? "Done editing" : "Bulk edit"}
            </button>
          )}

          {/* Teammate filter — overview only */}
          {mode === "overview" && (
            <MultiSelectDropdown
              options={teammateOptions}
              selected={overviewTeammateFilter}
              onChange={setOverviewTeammateFilter}
              placeholder="All teammates"
              searchPlaceholder="Search teammate..."
              maxLabel={1}
            />
          )}

          {/* Compare picker — overview only. Opens a multi-select and on
              confirming 2+ choices, navigates to compare URL. */}
          {mode === "overview" && (
            <CompareLauncher
              options={teammateOptions}
              onCompare={startCompare}
            />
          )}

          {/* Search */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] flex-1 max-w-md">
            <Search size={13} className="text-[var(--text-muted)]" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={mode === "overview" ? "Search teammate..." : "Search supplier..."}
              className="flex-1 bg-transparent outline-none text-[12px] text-[var(--text-primary)]"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
        )}

        {/* ── Body: overview / drill / compare / reports ─────────────── */}
        {mode === "overview" && (
          <OverviewTable
            loading={overviewLoading}
            accounts={accounts}
            rows={filteredOverview}
            accountFilterIds={accountFilterIds}
            onSelectTeammate={(id) => navigate({ teammate: id })}
          />
        )}

        {mode === "drill" && (
          <DrillTable
            loading={drillLoading}
            error={drillError}
            rows={filteredDrill}
            availableStatuses={availableStatuses}
            onSetStatus={setStatus}
            onRetry={() => selectedTeammateId && loadDrill(selectedTeammateId)}
            bulkEditMode={bulkEditMode}
            selectedKeys={bulkSelected}
            onToggleSelection={(supplierId, accountId) => {
              const key = `${supplierId}::${accountId}`;
              setBulkSelected(prev => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key); else next.add(key);
                return next;
              });
            }}
            onToggleSelectAll={(checked) => {
              if (!checked) { setBulkSelected(new Set()); return; }
              const next = new Set<string>();
              for (const r of filteredDrill) {
                if (r.supplier?.id && r.account?.id) next.add(`${r.supplier.id}::${r.account.id}`);
              }
              setBulkSelected(next);
            }}
          />
        )}

        {mode === "compare" && (
          <CompareView
            loading={compareLoading}
            error={compareError}
            teammates={compareTeammates}
            groups={filteredCompareGroups}
            onRetry={() => loadCompare(compareTeammateIds)}
          />
        )}

        {mode === "reports" && (
          <StatusReportsView />
        )}

        {mode === "suppliers" && (
          <SupplierCoverageView
            supplierId={supplierIdParam}
            accounts={accounts}
            availableStatuses={availableStatuses}
            accountFilterIds={accountFilterIds}
            onSelectSupplier={(id) => navigate({ view: "suppliers", supplier: id })}
            onClearSupplier={() => navigate({ view: "suppliers", supplier: null })}
            onChangeAccounts={(ids) => navigate({ accounts: ids })}
          />
        )}
      </div>

      {/* Floating bulk action bar — visible only when items are selected */}
      {mode === "drill" && bulkEditMode && bulkSelected.size > 0 && (
        <BulkActionBar
          selectedCount={bulkSelected.size}
          availableStatuses={availableStatuses}
          applying={bulkApplying}
          onApply={applyBulkStatus}
          onClear={() => setBulkSelected(new Set())}
        />
      )}

      {/* Undo toast — auto-dismisses after 30 seconds */}
      {undoState && (
        <UndoToast
          message={undoState.label}
          onUndo={undoBulkApply}
          onDismiss={() => setUndoState(null)}
        />
      )}
    </div>
  );
}

// ── Compare launcher (multi-select that triggers navigation when confirmed) ─
function CompareLauncher({ options, onCompare }: {
  options: { id: string; label: string; sublabel?: string }[];
  onCompare: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-compare-launcher]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (id: string) => {
    setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  };

  return (
    <div className="relative" data-compare-launcher>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--info)]/10 border border-[var(--info)]/30 text-[12px] text-[var(--info)] hover:bg-[var(--info)]/15"
      >
        Compare teammates
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl py-2">
          <div className="px-3 pb-2 text-[10px] text-[var(--text-muted)] border-b border-[var(--border)] mb-1">
            Pick 2–4 teammates to compare. You'll see who exclusively contacted which suppliers, and which overlap.
          </div>
          <div className="max-h-72 overflow-y-auto">
            {options.map(o => {
              const checked = picked.includes(o.id);
              return (
                <button
                  key={o.id}
                  onClick={() => toggle(o.id)}
                  className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg)] flex items-center gap-2 text-[11px]"
                >
                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                    checked ? "bg-[var(--info)] border-[var(--info)]" : "border-[var(--border)]"
                  }`}>
                    {checked && <span className="text-[8px] text-white font-bold">✓</span>}
                  </span>
                  <span>{o.label}</span>
                </button>
              );
            })}
          </div>
          <div className="border-t border-[var(--border)] mt-1 pt-2 px-3 flex items-center justify-between">
            <span className="text-[10px] text-[var(--text-muted)]">
              {picked.length} selected
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => { setPicked([]); setOpen(false); }}
                className="px-2 py-1 rounded text-[10px] text-[var(--text-muted)] hover:bg-[var(--bg)]"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (picked.length < 2) { alert("Pick at least 2 teammates"); return; }
                  setOpen(false);
                  onCompare(picked);
                  setPicked([]);
                }}
                disabled={picked.length < 2}
                className="px-2.5 py-1 rounded text-[10px] font-semibold bg-[var(--info)] text-white disabled:opacity-40"
              >
                Compare
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Overview table ────────────────────────────────────────────────────
function OverviewTable({ loading, accounts, rows, accountFilterIds, onSelectTeammate }: {
  loading: boolean;
  accounts: AccountLite[];
  rows: OverviewRow[];
  accountFilterIds: string[];
  onSelectTeammate: (id: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-[12px] py-10 justify-center">
        <Loader2 size={14} className="animate-spin" /> Loading team coverage…
      </div>
    );
  }
  const visibleAccounts = accountFilterIds.length === 0
    ? accounts
    : accounts.filter(a => accountFilterIds.includes(a.id));
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className="max-h-[70vh] overflow-y-auto overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-[var(--bg)] border-b border-[var(--border)] sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">TEAMMATE</th>
              {visibleAccounts.map(a => (
                <th key={a.id} className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] uppercase">{a.name}</th>
              ))}
              <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)]">TOTAL</th>
              <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)]">LATEST</th>
              <th className="w-8"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={visibleAccounts.length + 4} className="text-center py-10 text-[var(--text-muted)]">No teammates match.</td></tr>
            ) : (
              rows.map(r => (
                <tr
                  key={r.team_member.id}
                  onClick={() => onSelectTeammate(r.team_member.id)}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)] cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ backgroundColor: r.team_member.color || "#6B7280" }}>
                        {memberInitials(r.team_member)}
                      </span>
                      <div>
                        <div className="font-medium">{r.team_member.name}</div>
                        {r.team_member.role && <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">{r.team_member.role}</div>}
                      </div>
                    </div>
                  </td>
                  {visibleAccounts.map(a => (
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
    </div>
  );
}

// ── Drill-in table ────────────────────────────────────────────────────
function DrillTable({
  loading, error, rows, availableStatuses, onSetStatus, onRetry,
  bulkEditMode, selectedKeys, onToggleSelection, onToggleSelectAll,
}: {
  loading: boolean;
  error: string | null;
  rows: DrillRow[];
  availableStatuses: SupplierStatus[];
  onSetStatus: (supplierId: string, accountId: string, statusId: string | null) => void;
  onRetry: () => void;
  // Bulk-edit props (Batch 6, Feature 2). When bulkEditMode is true the
  // table shows a leading checkbox column; selectedKeys uses the same
  // `${supplierId}::${accountId}` key shape as the parent state.
  bulkEditMode: boolean;
  selectedKeys: Set<string>;
  onToggleSelection: (supplierId: string, accountId: string) => void;
  onToggleSelectAll: (checked: boolean) => void;
}) {
  if (loading) {
    return <div className="flex items-center gap-2 text-[var(--text-muted)] text-[12px] py-10 justify-center"><Loader2 size={14} className="animate-spin" /> Loading suppliers…</div>;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <div className="text-[12px] font-semibold text-red-500 mb-1">Drill-in failed</div>
        <div className="text-[12px] text-[var(--text-secondary)] mb-2">{error}</div>
        <button onClick={onRetry} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface)]">Retry</button>
      </div>
    );
  }

  // For the "select all" header checkbox state. Indeterminate when some
  // but not all rows are selected.
  const allKeys = rows
    .filter(r => r.supplier?.id && r.account?.id)
    .map(r => `${r.supplier!.id}::${r.account!.id}`);
  const selectedInTable = allKeys.filter(k => selectedKeys.has(k)).length;
  const allSelected = allKeys.length > 0 && selectedInTable === allKeys.length;

  return (
    <>
      <div className="text-[11px] text-[var(--text-muted)] mb-2">
        {rows.length} supplier{rows.length === 1 ? "" : "s"} contacted
        {bulkEditMode && selectedKeys.size > 0 && (
          <span className="text-[var(--info)] font-medium"> · {selectedKeys.size} selected</span>
        )}
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
        <div className="max-h-[70vh] overflow-y-auto overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] border-b border-[var(--border)] sticky top-0 z-10">
              <tr>
                {bulkEditMode && (
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) => onToggleSelectAll(e.target.checked)}
                      className="cursor-pointer"
                      title="Select all visible"
                    />
                  </th>
                )}
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">SUPPLIER</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">ACCOUNT</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)] w-56">STATUS</th>
                <th className="text-left px-3 py-2 font-semibold text-[var(--text-secondary)]">LABELS</th>
                <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] w-24">OUTBOUND</th>
                <th className="text-right px-3 py-2 font-semibold text-[var(--text-secondary)] w-24">LAST</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={bulkEditMode ? 7 : 6} className="text-center py-10 text-[var(--text-muted)]">No suppliers match the current filters.</td></tr>
              ) : (
                rows.map((r, i) => {
                  const key = (r.supplier?.id && r.account?.id) ? `${r.supplier.id}::${r.account.id}` : null;
                  const isSelected = key ? selectedKeys.has(key) : false;
                  return (
                    <tr
                      key={`${r.supplier?.id}-${r.account?.id}-${i}`}
                      className={`border-b border-[var(--border)] last:border-0 ${isSelected ? "bg-[var(--info)]/5" : "hover:bg-[var(--bg)]"}`}
                    >
                      {bulkEditMode && (
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            disabled={!key}
                            onChange={() => { if (r.supplier?.id && r.account?.id) onToggleSelection(r.supplier.id, r.account.id); }}
                            className="cursor-pointer"
                          />
                        </td>
                      )}
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.supplier?.name || "—"}</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{r.supplier?.email}</div>
                      </td>
                      <td className="px-3 py-2 text-[var(--text-secondary)]">{r.account?.name || "—"}</td>
                      <td className="px-3 py-2">
                        <StatusPicker
                          currentStatus={r.status}
                          availableStatuses={availableStatuses}
                          onChange={(statusId) => { if (r.supplier && r.account) onSetStatus(r.supplier.id, r.account.id, statusId); }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {(r.latest_conversation?.labels || []).slice(0, 5).map(l => (
                            <span key={l.id} className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: l.color }} />
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
                        <Link href={`/?convo=${r.latest_conversation.id}`} className="hover:text-[var(--text-primary)] inline-flex items-center gap-1" title={r.latest_conversation.subject || ""}>
                          {fmtRelative(r.last_contact_at)}
                          <ExternalLink size={10} />
                        </Link>
                      ) : (
                        fmtRelative(r.last_contact_at)
                      )}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// ── Compare (Venn) view ───────────────────────────────────────────────
function CompareView({ loading, error, teammates, groups, onRetry }: {
  loading: boolean;
  error: string | null;
  teammates: TeamMember[];
  groups: CompareGroup[];
  onRetry: () => void;
}) {
  if (loading) {
    return <div className="flex items-center gap-2 text-[var(--text-muted)] text-[12px] py-10 justify-center"><Loader2 size={14} className="animate-spin" /> Loading comparison…</div>;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
        <div className="text-[12px] font-semibold text-red-500 mb-1">Compare failed</div>
        <div className="text-[12px] text-[var(--text-secondary)] mb-2">{error}</div>
        <button onClick={onRetry} className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface)]">Retry</button>
      </div>
    );
  }
  const totalRows = groups.reduce((acc, g) => acc + g.rows.length, 0);
  return (
    <>
      {/* Teammate chips at top */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Comparing:</span>
        {teammates.map(t => (
          <span key={t.id} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--border)] text-[11px]">
            <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white" style={{ backgroundColor: t.color || "#6B7280" }}>
              {memberInitials(t)}
            </span>
            {t.name}
          </span>
        ))}
        <span className="text-[10px] text-[var(--text-muted)] ml-2">{totalRows} supplier-account pair{totalRows === 1 ? "" : "s"} total</span>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-[var(--text-muted)] text-[12px]">
          No suppliers match the current filters.
        </div>
      ) : (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {groups.map(group => (
            <CompareGroupCard key={group.key} group={group} teammates={teammates} />
          ))}
        </div>
      )}
    </>
  );
}

function CompareGroupCard({ group, teammates }: { group: CompareGroup; teammates: TeamMember[] }) {
  const groupMembers = group.teammate_ids
    .map(id => teammates.find(t => t.id === id))
    .filter(Boolean) as TeamMember[];
  const isAll = group.teammate_ids.length === teammates.length;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <div className={`px-4 py-2 border-b border-[var(--border)] flex items-center gap-2 ${isAll ? "bg-[var(--info)]/8" : "bg-[var(--bg)]"}`}>
        <div className="flex items-center -space-x-1">
          {groupMembers.map(m => (
            <span key={m.id} className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white border-2 border-[var(--surface)]" style={{ backgroundColor: m.color || "#6B7280" }}>
              {memberInitials(m)}
            </span>
          ))}
        </div>
        <div className="text-[12px] font-semibold">{group.label}</div>
        <div className="text-[10px] text-[var(--text-muted)] ml-auto">{group.rows.length} supplier{group.rows.length === 1 ? "" : "s"}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="bg-[var(--bg)] border-b border-[var(--border)]">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold text-[var(--text-secondary)]">SUPPLIER</th>
              <th className="text-left px-3 py-1.5 font-semibold text-[var(--text-secondary)]">ACCOUNT</th>
              <th className="text-left px-3 py-1.5 font-semibold text-[var(--text-secondary)]">STATUS</th>
              <th className="text-left px-3 py-1.5 font-semibold text-[var(--text-secondary)]">LABELS</th>
              {groupMembers.map(m => (
                <th key={m.id} className="text-right px-3 py-1.5 font-semibold text-[var(--text-secondary)] uppercase">{memberInitials(m)}</th>
              ))}
              <th className="text-right px-3 py-1.5 font-semibold text-[var(--text-secondary)] w-20">LAST</th>
            </tr>
          </thead>
          <tbody>
            {group.rows.map((r: any, i: number) => (
              <tr key={`${r.supplier?.id}-${r.account?.id}-${i}`} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]">
                <td className="px-3 py-1.5">
                  <div className="font-medium">{r.supplier?.name || "—"}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{r.supplier?.email}</div>
                </td>
                <td className="px-3 py-1.5 text-[var(--text-secondary)]">{r.account?.name || "—"}</td>
                <td className="px-3 py-1.5">
                  {r.status ? (
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold" style={{ color: `#${r.status.color}`, backgroundColor: `#${r.status.background_color}` }}>
                      {r.status.name}
                    </span>
                  ) : (
                    <span className="text-[10px] text-[var(--text-muted)] italic">no status</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex flex-wrap gap-1.5">
                    {(r.labels || []).slice(0, 4).map((l: any) => (
                      <span key={l.id} className="inline-flex items-center gap-1 text-[10px] text-[var(--text-secondary)]">
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: l.color }} />
                        {l.name}
                      </span>
                    ))}
                  </div>
                </td>
                {groupMembers.map(m => (
                  <td key={m.id} className="text-right px-3 py-1.5 tabular-nums">
                    {r.per_teammate_outbound?.[m.id] || 0}
                  </td>
                ))}
                <td className="text-right px-3 py-1.5 text-[var(--text-muted)]">
                  {r.latest_conversation ? (
                    <Link href={`/?convo=${r.latest_conversation.id}`} className="hover:text-[var(--text-primary)] inline-flex items-center gap-1">
                      {fmtRelative(r.last_contact_at)}
                      <ExternalLink size={10} />
                    </Link>
                  ) : (
                    fmtRelative(r.last_contact_at)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Inline status picker ──────────────────────────────────────────────
function StatusPicker({ currentStatus, availableStatuses, onChange }: {
  currentStatus: SupplierStatus | null;
  availableStatuses: SupplierStatus[];
  onChange: (statusId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
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
          <button onClick={() => { onChange(null); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)] italic">
            Clear status
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          {availableStatuses.map(s => (
            <button key={s.id} onClick={() => { onChange(s.id); setOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg)] flex items-center gap-2">
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold inline-block" style={{ color: `#${s.color}`, backgroundColor: `#${s.background_color}` }}>
                {s.name}
              </span>
              {currentStatus?.id === s.id && <span className="ml-auto text-[10px] text-[var(--accent)]">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── BulkActionBar (Batch 6, Feature 2) ────────────────────────────────
//
// Floating bar pinned to the bottom of the viewport. Visible only when
// the drill-in view has 1+ selected rows AND bulk edit mode is on.
// Provides:
//   - Selected count
//   - Status picker (same options as elsewhere) + "Clear status" option
//   - Apply button (calls onApply with the chosen statusId or null)
//   - Clear-selection button (deselects all but keeps bulk mode on)
function BulkActionBar({
  selectedCount,
  availableStatuses,
  applying,
  onApply,
  onClear,
}: {
  selectedCount: number;
  availableStatuses: SupplierStatus[];
  applying: boolean;
  onApply: (statusId: string | null) => void;
  onClear: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<SupplierStatus | null>(null);
  const [pendingClear, setPendingClear] = useState(false);
  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-bulk-action-bar]")) setPickerOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [pickerOpen]);

  const handleApply = () => {
    if (pendingClear) onApply(null);
    else if (pendingStatus) onApply(pendingStatus.id);
  };

  const readyToApply = pendingClear || pendingStatus !== null;

  return (
    <div
      data-bulk-action-bar
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      style={{ minWidth: 420 }}
    >
      <div className="text-[12px] text-[var(--text-primary)] font-semibold">
        {selectedCount} selected
      </div>
      <div className="w-px h-5 bg-[var(--border)]" />
      <div className="relative">
        <button
          onClick={() => setPickerOpen(o => !o)}
          disabled={applying}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors disabled:opacity-50"
          style={
            pendingClear
              ? { color: "var(--text-muted)", backgroundColor: "var(--bg)", border: "1px dashed var(--border)" }
              : pendingStatus
              ? { color: `#${pendingStatus.color}`, backgroundColor: `#${pendingStatus.background_color}` }
              : { color: "var(--text-secondary)", backgroundColor: "var(--bg)", border: "1px solid var(--border)" }
          }
        >
          {pendingClear ? "Clear status" : pendingStatus?.name || "Pick status"}
          <ChevronDown size={12} />
        </button>
        {pickerOpen && (
          <div className="absolute bottom-full mb-1 left-0 w-60 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1">
            <button
              onClick={() => { setPendingClear(true); setPendingStatus(null); setPickerOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)] italic"
            >
              Clear status
            </button>
            <div className="border-t border-[var(--border)] my-1" />
            {availableStatuses.map(s => (
              <button
                key={s.id}
                onClick={() => { setPendingStatus(s); setPendingClear(false); setPickerOpen(false); }}
                className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg)] flex items-center gap-2"
              >
                <span
                  className="px-1.5 py-0.5 rounded text-[10px] font-semibold inline-block"
                  style={{ color: `#${s.color}`, backgroundColor: `#${s.background_color}` }}
                >
                  {s.name}
                </span>
                {pendingStatus?.id === s.id && <span className="ml-auto text-[10px] text-[var(--accent)]">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        onClick={handleApply}
        disabled={!readyToApply || applying}
        className="px-3 py-1.5 rounded-md text-[12px] font-semibold bg-[var(--info)] text-white disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {applying ? <Loader2 size={12} className="animate-spin" /> : `Apply to ${selectedCount}`}
      </button>
      <button
        onClick={onClear}
        disabled={applying}
        className="px-2 py-1.5 rounded-md text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg)] disabled:opacity-50"
      >
        Clear selection
      </button>
    </div>
  );
}

// ── UndoToast (Batch 6, Feature 2) ────────────────────────────────────
//
// Top-right toast shown for 30 seconds after a bulk apply. Click "Undo"
// to reverse the bulk operation. Click X to dismiss without undoing.
// Auto-dismisses on the parent's timer.
function UndoToast({
  message,
  onUndo,
  onDismiss,
}: {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-50 flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl max-w-md">
      <div className="text-[12px] text-[var(--text-primary)]">{message}</div>
      <button
        onClick={onUndo}
        className="px-3 py-1 rounded-md text-[11px] font-semibold text-[var(--info)] border border-[var(--info)]/30 hover:bg-[var(--info)]/10"
      >
        Undo
      </button>
      <button
        onClick={onDismiss}
        className="p-1 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        title="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  );
}