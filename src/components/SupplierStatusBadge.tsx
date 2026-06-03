"use client";

import { useEffect, useState, useCallback } from "react";
import { ChevronDown, Loader2, Tag } from "lucide-react";

// ── SupplierStatusBadge ───────────────────────────────────────────────
//
// Inline-editable status badge for the conversation header. Shows the
// current supplier-account status (e.g. "Quote Recorded"), with a
// dropdown to change it. Empty state shows "Set status" with a tag icon.
//
// Behavior:
//   - On mount, fetches GET /api/supplier-account-status for the (supplier,
//     account) pair, and GET /api/supplier-statuses for the picker options.
//   - On change, PATCHes /api/supplier-account-status with optimistic UI
//     and rollback on failure.
//   - Closes the dropdown on outside click.
//
// Props:
//   supplierContactId  the supplier this conversation is associated with
//   emailAccountId     the email account this conversation lives in
//   actorId            the current user's id (for audit on the PATCH)
//   onChanged          optional callback fired after a successful change
//                      (e.g. to refresh team-coverage data if visible)
//
// The component handles missing supplierContactId / emailAccountId
// gracefully — renders nothing in that case. This avoids crashes on
// conversations that don't have a supplier link yet (e.g. internal team
// chats, system notifications).
interface StatusOption {
  id: string;
  name: string;
  color: string;
  background_color: string;
}

export default function SupplierStatusBadge({
  supplierContactId,
  emailAccountId,
  actorId,
  onChanged,
}: {
  supplierContactId: string | null;
  emailAccountId: string | null;
  actorId: string | null;
  onChanged?: () => void;
}) {
  const [current, setCurrent] = useState<StatusOption | null>(null);
  const [options, setOptions] = useState<StatusOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Don't render if we can't address a unique (supplier × account) pair.
  // Internal team chats, system notifications, etc. won't have these.
  const enabled = !!(supplierContactId && emailAccountId);

  // Fetch options once on mount — they're workspace-wide and rarely change.
  useEffect(() => {
    fetch("/api/supplier-statuses")
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then(d => setOptions(d.statuses || []))
      .catch(() => {});
  }, []);

  // Fetch the current status whenever the (supplier, account) pair changes.
  const fetchCurrent = useCallback(async () => {
    if (!enabled) { setCurrent(null); return; }
    setLoading(true);
    try {
      const p = new URLSearchParams({
        supplier_contact_id: supplierContactId!,
        email_account_id: emailAccountId!,
      });
      const res = await fetch(`/api/supplier-account-status?${p.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setCurrent(data.status || null);
      }
    } catch (e) {
      console.error("[supplier-status] fetch current failed:", e);
    } finally {
      setLoading(false);
    }
  }, [supplierContactId, emailAccountId, enabled]);

  useEffect(() => { fetchCurrent(); }, [fetchCurrent]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-supplier-status-badge]")) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Save a new status (or null to clear). Optimistic update + rollback.
  const setStatus = async (statusId: string | null) => {
    if (!enabled) return;
    const prev = current;
    const next = statusId ? options.find(o => o.id === statusId) || null : null;
    setCurrent(next);
    setOpen(false);
    setSaving(true);
    try {
      const res = await fetch("/api/supplier-account-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_contact_id: supplierContactId,
          email_account_id: emailAccountId,
          status_id: statusId,
          actor_id: actorId,
        }),
      });
      if (!res.ok) {
        // Rollback on failure
        setCurrent(prev);
        const j = await res.json().catch(() => ({}));
        alert("Failed to update status: " + (j.error || "Unknown"));
      } else {
        onChanged?.();
      }
    } catch (e: any) {
      setCurrent(prev);
      alert("Failed to update status: " + (e?.message || String(e)));
    } finally {
      setSaving(false);
    }
  };

  if (!enabled) {
    // Render a muted disabled chip so the wire-up is always visible.
    // This conversation has no supplier_contact_id (or email_account_id) —
    // probably an internal team chat, system notification, or a conversation
    // where the sync hasn't classified the supplier yet. The status is
    // keyed on (supplier, account) so we can't track one here. Showing a
    // disabled state is clearer than vanishing.
    return (
      <div
        title="This conversation isn't linked to a supplier yet. Status tracking is keyed on (supplier × account) — link a supplier first."
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold opacity-60 cursor-not-allowed"
        style={{
          color: "var(--text-muted)",
          backgroundColor: "var(--surface)",
          border: "1px dashed var(--border)",
        }}
      >
        <Tag size={11} />
        <span>No supplier linked</span>
      </div>
    );
  }

  return (
    <div className="relative inline-block" data-supplier-status-badge>
      <button
        onClick={() => setOpen(o => !o)}
        title="Supplier status — click to change"
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[11px] font-semibold transition-colors hover:opacity-80 disabled:opacity-50"
        disabled={loading || saving}
        style={
          current
            ? { color: `#${current.color}`, backgroundColor: `#${current.background_color}` }
            : {
                color: "var(--text-muted)",
                backgroundColor: "var(--surface)",
                border: "1px dashed var(--border)",
              }
        }
      >
        {loading ? (
          <Loader2 size={11} className="animate-spin" />
        ) : current ? null : (
          <Tag size={11} />
        )}
        <span>{current?.name || "Set status"}</span>
        <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 w-64 max-h-80 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1">
          <div className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wider border-b border-[var(--border)] mb-1">
            Supplier status
          </div>
          <button
            onClick={() => setStatus(null)}
            className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--bg)] italic"
          >
            Clear status
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          {options.map(s => (
            <button
              key={s.id}
              onClick={() => setStatus(s.id)}
              className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg)] flex items-center gap-2"
            >
              <span
                className="px-1.5 py-0.5 rounded text-[10px] font-semibold inline-block"
                style={{ color: `#${s.color}`, backgroundColor: `#${s.background_color}` }}
              >
                {s.name}
              </span>
              {current?.id === s.id && (
                <span className="ml-auto text-[10px] text-[var(--accent)]">✓</span>
              )}
            </button>
          ))}
          {options.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-[var(--text-muted)] italic">
              No statuses defined. An admin can add them in Settings → Supplier Statuses.
            </div>
          )}
        </div>
      )}
    </div>
  );
}