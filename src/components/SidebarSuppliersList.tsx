"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Package, Search, X } from "lucide-react";

type SupplierAccount = {
  id: string;
  name: string | null;
  email: string;
  icon?: string | null;
  color?: string | null;
};

type SupplierRow = {
  id: string;
  name: string | null;
  email: string;
  company: string | null;
  responsiveness_score: number | null;
  responsiveness_tier: string | null;
  qualifying_exchanges: number | null;
  last_engagement_at: string | null;
  accounts: SupplierAccount[];
};

/**
 * SidebarSuppliersList — collapsible panel in the sidebar that lists all
 * suppliers (rows in inbox.supplier_contacts) with their engaged email
 * accounts as clickable chips. Clicking a chip opens that supplier's
 * command center filtered to that account, in a new tab.
 */
export default function SidebarSuppliersList() {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [accounts, setAccounts] = useState<SupplierAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [accountFilter, setAccountFilter] = useState<string>(""); // "" = All

  const fetchSuppliers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/suppliers");
      if (!res.ok) return;
      const data = await res.json();
      setSuppliers(data.suppliers || []);
      setAccounts(data.accounts || []);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  // Lazy-load: only fetch when the panel is first opened
  useEffect(() => {
    if (open && suppliers.length === 0 && !loading) {
      fetchSuppliers();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return suppliers.filter((s) => {
      if (accountFilter && !s.accounts.some((a) => a.id === accountFilter)) return false;
      if (!q) return true;
      return (
        (s.name || "").toLowerCase().includes(q) ||
        (s.email || "").toLowerCase().includes(q) ||
        (s.company || "").toLowerCase().includes(q)
      );
    });
  }, [suppliers, search, accountFilter]);

  const openCommandCenter = (email: string, accountId: string) => {
    const url = `/contacts/${encodeURIComponent(email)}?account=${encodeURIComponent(accountId)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="px-2 pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-2.5 pb-1 flex items-center gap-1.5 text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest hover:text-[var(--text-secondary)] transition-colors"
      >
        <Package size={10} />
        <span>Suppliers</span>
        <span className="text-[var(--text-secondary)] normal-case font-normal tracking-normal ml-1">
          ({suppliers.length})
        </span>
        <ChevronDown
          size={10}
          className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-1 space-y-1.5">
          {/* Filter row */}
          <div className="px-1 flex items-center gap-1.5">
            <div className="relative flex-1">
              <Search
                size={11}
                className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-full pl-6 pr-6 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <X size={11} />
                </button>
              )}
            </div>
          </div>

          {/* Account filter */}
          {accounts.length > 1 && (
            <div className="px-1">
              <select
                value={accountFilter}
                onChange={(e) => setAccountFilter(e.target.value)}
                className="w-full px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              >
                <option value="">All accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name || a.email}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Scrollable list */}
          <div className="max-h-[60vh] overflow-y-auto pr-0.5 space-y-0.5">
            {loading && (
              <div className="text-[11px] text-[var(--text-muted)] px-2.5 py-2">Loading…</div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="text-[11px] text-[var(--text-muted)] px-2.5 py-2">
                {suppliers.length === 0 ? "No suppliers yet" : "No matches"}
              </div>
            )}
            {!loading &&
              filtered.map((s) => (
                <div
                  key={s.id}
                  className="px-2.5 py-1.5 rounded-md hover:bg-[var(--surface)] transition-colors"
                >
                  <div className="text-[11px] font-semibold text-[var(--text-primary)] truncate">
                    {s.name || s.email}
                  </div>
                  {(s.company || (s.name && s.email)) && (
                    <div className="text-[10px] text-[var(--text-muted)] truncate">
                      {s.company || s.email}
                    </div>
                  )}
                  {s.accounts.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {s.accounts.map((a) => (
                        <button
                          key={a.id}
                          onClick={() => openCommandCenter(s.email, a.id)}
                          title={`Open ${s.name || s.email} command center · ${a.name || a.email}`}
                          className="text-[9px] font-medium px-1.5 py-0.5 rounded-full border border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)] hover:bg-[var(--accent-dim)] hover:text-[var(--accent)] hover:border-[var(--accent)]/40 transition-colors"
                        >
                          {a.icon ? <span className="mr-0.5">{a.icon}</span> : null}
                          {a.name || a.email}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}