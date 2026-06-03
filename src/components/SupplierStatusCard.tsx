"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronDown, Loader2, Tag } from "lucide-react";

// ── SupplierStatusCard ────────────────────────────────────────────────
//
// Dedicated card on the supplier command center page (Batch 6, Feature 1)
// showing the supplier's status across every email account that has
// conversations with them. Each row has an inline status picker.
//
// Behavior:
//   - On mount, fetches statuses for this supplier across all accounts
//     in ONE call (GET /api/supplier-account-status?supplier_contact_id=X)
//   - Renders one row per account in `accounts`
//   - Click a row's picker → opens dropdown → select status → optimistic
//     update + PATCH /api/supplier-account-status, rollback on failure
//
// Props:
//   supplierContactId   identifies the supplier (top-level data field)
//   accounts            unique accounts this supplier has conversations
//                       with, computed by the page from threads
//   actorId             current user's id (for audit on the PATCH)
//
// If accounts is empty or supplierContactId is null, the card renders
// an empty-state explaining why (e.g. supplier hasn't been emailed yet).

interface StatusOption {
  id: string;
  name: string;
  color: string;
  background_color: string;
}

interface AccountLite {
  id: string;
  name: string;
}

export default function SupplierStatusCard({
  supplierContactId,
  accounts,
  actorId,
}: {
  supplierContactId: string | null;
  accounts: AccountLite[];
  actorId: string | null;
}) {
  // Per-account current status, keyed by email_account_id
  const [statusByAccount, setStatusByAccount] = useState<Map<string, StatusOption | null>>(new Map());
  // Available status options (workspace-wide)
  const [options, setOptions] = useState<StatusOption[]>([]);
  // Loading flags
  const [loadingStatuses, setLoadingStatuses] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);

  // Fetch workspace-wide status options once on mount
  useEffect(() => {
    fetch("/api/supplier-statuses")
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => { setOptions(d.statuses || []); })
      .catch(() => {})
      .finally(() => setLoadingOptions(false));
  }, []);

  // Fetch per-account statuses for this supplier (one batched call)
  const refreshStatuses = useCallback(async () => {
    if (!supplierContactId) {
      setStatusByAccount(new Map());
      return;
    }
    setLoadingStatuses(true);
    try {
      const res = await fetch(`/api/supplier-account-status?supplier_contact_id=${encodeURIComponent(supplierContactId)}`);
      if (res.ok) {
        const data = await res.json();
        const next = new Map<string, StatusOption | null>();
        for (const row of (data.statuses || [])) {
          next.set(row.email_account_id, row.status || null);
        }
        setStatusByAccount(next);
      }
    } catch (e) {
      console.error("[supplier-status-card] load failed:", e);
    } finally {
      setLoadingStatuses(false);
    }
  }, [supplierContactId]);

  useEffect(() => { refreshStatuses(); }, [refreshStatuses]);

  // Change handler — optimistic update + rollback on failure
  const setStatus = async (accountId: string, statusId: string | null) => {
    if (!supplierContactId) return;
    const prev = statusByAccount.get(accountId) || null;
    const next = statusId ? (options.find(o => o.id === statusId) || null) : null;
    setStatusByAccount(prevMap => {
      const m = new Map(prevMap);
      m.set(accountId, next);
      return m;
    });
    try {
      const res = await fetch("/api/supplier-account-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_contact_id: supplierContactId,
          email_account_id: accountId,
          status_id: statusId,
          actor_id: actorId,
        }),
      });
      if (!res.ok) {
        // Rollback
        setStatusByAccount(prevMap => {
          const m = new Map(prevMap);
          m.set(accountId, prev);
          return m;
        });
        const j = await res.json().catch(() => ({}));
        alert("Failed to update status: " + (j.error || "Unknown"));
      }
    } catch (e: any) {
      setStatusByAccount(prevMap => {
        const m = new Map(prevMap);
        m.set(accountId, prev);
        return m;
      });
      alert("Failed to update status: " + (e?.message || String(e)));
    }
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Tag size={16} className="text-[var(--info)]" />
          <span className="text-sm font-semibold">Supplier Status</span>
          <span className="text-[11px] text-[var(--text-muted)]">
            ({accounts.length} {accounts.length === 1 ? "account" : "accounts"})
          </span>
        </div>
        {loadingStatuses && <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" />}
      </div>

      {!supplierContactId ? (
        <div className="text-[11px] text-[var(--text-muted)] italic py-2">
          This contact isn&apos;t a supplier yet — no status tracking until it is.
        </div>
      ) : accounts.length === 0 ? (
        <div className="text-[11px] text-[var(--text-muted)] italic py-2">
          This supplier hasn&apos;t been contacted from any of your accounts yet.
        </div>
      ) : (
        <div className="space-y-1">
          {accounts.map(account => (
            <div
              key={account.id}
              className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-md hover:bg-[var(--bg)]"
            >
              <div className="text-[12px] text-[var(--text-secondary)] truncate">
                {account.name}
              </div>
              <StatusPicker
                currentStatus={statusByAccount.get(account.id) || null}
                availableStatuses={options}
                disabled={loadingOptions}
                onChange={(statusId) => setStatus(account.id, statusId)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Inline status picker — mirrors the dropdown used elsewhere ────────
function StatusPicker({
  currentStatus,
  availableStatuses,
  disabled,
  onChange,
}: {
  currentStatus: StatusOption | null;
  availableStatuses: StatusOption[];
  disabled?: boolean;
  onChange: (statusId: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-supplier-status-card-picker]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative inline-block shrink-0" data-supplier-status-card-picker>
      <button
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold transition-colors hover:opacity-80 disabled:opacity-50"
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
        <div className="absolute z-50 mt-1 right-0 w-60 max-h-72 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-lg py-1">
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
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold inline-block" style={{ color: `#${s.color}`, backgroundColor: `#${s.background_color}` }}>
                {s.name}
              </span>
              {currentStatus?.id === s.id && <span className="ml-auto text-[10px] text-[var(--accent)]">✓</span>}
            </button>
          ))}
          {availableStatuses.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-[var(--text-muted)] italic">
              No statuses defined. An admin can add them in Settings → Supplier Statuses.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
