// src/components/settings/PhoneBackfillTab.tsx
//
// Settings → Data Tools tab → Phone Backfill section.
//
// Workflow:
//   1. User pastes CSV in the textarea (supplier_name, person_name, phone)
//   2. Click "Preview" → API returns per-row classification
//   3. Review the rows (filter / toggle individual rows in/out)
//   4. Click "Apply checked rows" → writes only the checked ok_* rows
//   5. See results summary

"use client";

import { useMemo, useState } from "react";
import {
  Phone, Loader2, CheckCircle2, AlertCircle, Info, X, RotateCcw, ChevronDown, ChevronRight,
} from "lucide-react";

type RowStatus =
  | "ok_new_person"
  | "ok_set_phone"
  | "ok_will_overwrite"
  | "skip_supplier_not_found"
  | "skip_invalid_phone"
  | "skip_missing_data"
  | "skip_duplicate_person";

interface PreviewRow {
  line_number: number;
  raw: { supplier_name: string; person_name: string; phone: string };
  status: RowStatus;
  supplier_contact_id: string | null;
  supplier_contact_person_id: string | null;
  normalized_phone: string | null;
  existing_phone: string | null;
  message: string;
}

interface PreviewState {
  rows: PreviewRow[];
  summary: Record<string, number>;
  // Per-row inclusion toggle (only applies to ok_* statuses)
  excluded: Set<number>; // set of line numbers user has unchecked
}

function statusBadge(status: RowStatus): { label: string; cls: string; icon: any } {
  switch (status) {
    case "ok_new_person":
      return { label: "New contact", cls: "bg-[var(--accent)]/15 text-[var(--accent)]", icon: CheckCircle2 };
    case "ok_set_phone":
      return { label: "Set phone", cls: "bg-[var(--info)]/15 text-[var(--info)]", icon: CheckCircle2 };
    case "ok_will_overwrite":
      return { label: "Overwrite", cls: "bg-[var(--warning)]/15 text-[var(--warning)]", icon: AlertCircle };
    case "skip_supplier_not_found":
      return { label: "Supplier not found", cls: "bg-[var(--danger)]/15 text-[var(--danger)]", icon: X };
    case "skip_invalid_phone":
      return { label: "Invalid phone", cls: "bg-[var(--danger)]/15 text-[var(--danger)]", icon: X };
    case "skip_duplicate_person":
      return { label: "Duplicate contact", cls: "bg-[var(--warning)]/15 text-[var(--warning)]", icon: AlertCircle };
    case "skip_missing_data":
    default:
      return { label: "Missing data", cls: "bg-[var(--text-muted)]/15 text-[var(--text-muted)]", icon: X };
  }
}

const isOk = (s: RowStatus) => s === "ok_new_person" || s === "ok_set_phone" || s === "ok_will_overwrite";

export default function PhoneBackfillTab() {
  const [csv, setCsv] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{
    applied: number;
    failed: number;
    details: Array<{ line_number: number; ok: boolean; message: string }>;
  } | null>(null);
  const [showFailedDetails, setShowFailedDetails] = useState(false);
  // Filter the table to a single status (or "all")
  const [filter, setFilter] = useState<"all" | "ok" | "skip">("all");

  const handlePreview = async () => {
    if (!csv.trim()) {
      setError("Paste a CSV first");
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    setApplyResult(null);
    try {
      const res = await fetch("/api/suppliers/bulk-phones?mode=preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Preview failed");
      setPreview({
        rows: data.rows || [],
        summary: data.summary || {},
        excluded: new Set<number>(),
      });
    } catch (e: any) {
      setError(e?.message || "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!preview) return;
    // Apply only OK rows that haven't been excluded
    const toApply = preview.rows.filter((r) => isOk(r.status) && !preview.excluded.has(r.line_number));
    if (toApply.length === 0) {
      setError("No rows to apply");
      return;
    }
    if (!confirm(`Apply ${toApply.length} row${toApply.length === 1 ? "" : "s"}? This will write to supplier_contact_persons.`)) {
      return;
    }
    setApplying(true);
    setError(null);
    setApplyResult(null);
    try {
      const res = await fetch("/api/suppliers/bulk-phones?mode=apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: toApply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Apply failed");
      setApplyResult({
        applied: data.applied || 0,
        failed: data.failed || 0,
        details: data.details || [],
      });
      // Clear the CSV + preview after successful apply
      if ((data.failed || 0) === 0) {
        setCsv("");
        setPreview(null);
      }
    } catch (e: any) {
      setError(e?.message || "Apply failed");
    } finally {
      setApplying(false);
    }
  };

  const toggleRowExcluded = (lineNumber: number) => {
    setPreview((p) => {
      if (!p) return p;
      const next = new Set(p.excluded);
      if (next.has(lineNumber)) next.delete(lineNumber);
      else next.add(lineNumber);
      return { ...p, excluded: next };
    });
  };

  const reset = () => {
    setCsv("");
    setPreview(null);
    setApplyResult(null);
    setError(null);
    setFilter("all");
  };

  // Filtered rows for display
  const visibleRows = useMemo(() => {
    if (!preview) return [];
    return preview.rows.filter((r) => {
      if (filter === "all") return true;
      if (filter === "ok") return isOk(r.status);
      if (filter === "skip") return !isOk(r.status);
      return true;
    });
  }, [preview, filter]);

  const okCount = preview ? preview.rows.filter((r) => isOk(r.status)).length : 0;
  const skipCount = preview ? preview.rows.filter((r) => !isOk(r.status)).length : 0;
  const includedCount = preview ? preview.rows.filter((r) => isOk(r.status) && !preview.excluded.has(r.line_number)).length : 0;

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-[var(--text-primary)] flex items-center gap-2">
          <Phone size={18} className="text-[var(--accent)]" />
          Phone Backfill
        </h1>
        <p className="text-[12px] text-[var(--text-secondary)] mt-1">
          Bulk-add phone numbers to your supplier contacts. Calls from these numbers will then auto-match to suppliers in Quo.
        </p>
      </div>

      {/* Help panel */}
      <div className="px-4 py-3 rounded-lg bg-[var(--info)]/8 border border-[var(--info)]/30 flex items-start gap-3">
        <Info size={14} className="text-[var(--info)] mt-0.5 shrink-0" />
        <div className="text-[12px] text-[var(--text-primary)] space-y-2">
          <div>
            <strong>CSV format:</strong> <code className="px-1 py-0.5 bg-[var(--bg)] rounded text-[11px] font-mono">supplier_name, person_name, phone</code>
          </div>
          <div className="text-[var(--text-secondary)]">
            One contact per row. A header row is optional (auto-detected). Phones are normalized to E.164 — US numbers without a country code get +1 prepended. Existing contacts with the same name under a supplier are updated; new ones are auto-created.
          </div>
          <details className="mt-1">
            <summary className="cursor-pointer text-[var(--info)] text-[11px]">Show example</summary>
            <pre className="mt-2 px-2 py-1.5 bg-[var(--bg)] rounded text-[10px] font-mono whitespace-pre overflow-x-auto">
{`supplier_name,person_name,phone
Vita Organica,John Smith,+1 555 123 4567
Vita Organica,Jane Doe,(555) 999-1234
Rove Essentials,Mike Brown,5550001111`}
            </pre>
          </details>
        </div>
      </div>

      {/* CSV input */}
      {!preview && (
        <div>
          <label className="block text-[12px] font-semibold text-[var(--text-secondary)] mb-1.5">
            Paste your CSV
          </label>
          <textarea
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={"supplier_name,person_name,phone\nVita Organica,John Smith,+1 555 123 4567"}
            className="w-full h-40 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] font-mono text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
          />
          <div className="flex justify-between items-center mt-2">
            <div className="text-[10px] text-[var(--text-muted)]">
              {csv ? `${csv.split(/\r?\n/).filter((l) => l.trim()).length} non-empty lines` : ""}
            </div>
            <button
              onClick={handlePreview}
              disabled={loading || !csv.trim()}
              className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[12px] font-bold disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : null}
              Preview rows
            </button>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="px-3 py-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-xs text-[var(--danger)] flex items-start gap-2">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Apply result */}
      {applyResult && (
        <div className={`px-4 py-3 rounded-lg border ${
          applyResult.failed === 0
            ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]"
            : "bg-[var(--warning)]/10 border-[var(--warning)]/30 text-[var(--warning)]"
        }`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold">
              {applyResult.failed === 0
                ? `✓ Applied ${applyResult.applied} row${applyResult.applied === 1 ? "" : "s"} successfully`
                : `Applied ${applyResult.applied}, ${applyResult.failed} failed`}
            </div>
            <div className="flex items-center gap-2">
              {applyResult.failed > 0 && (
                <button
                  onClick={() => setShowFailedDetails((v) => !v)}
                  className="text-[11px] hover:underline inline-flex items-center gap-1"
                >
                  {showFailedDetails ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  {showFailedDetails ? "Hide" : "Show"} details
                </button>
              )}
              <button onClick={reset} className="text-[11px] hover:underline inline-flex items-center gap-1">
                <RotateCcw size={11} />
                Start over
              </button>
            </div>
          </div>
          {showFailedDetails && applyResult.failed > 0 && (
            <div className="mt-3 max-h-64 overflow-y-auto space-y-1 text-[11px]">
              {applyResult.details.filter((d) => !d.ok).map((d, i) => (
                <div key={`fail-${i}`} className="px-2 py-1 rounded bg-[var(--bg)]">
                  <span className="font-mono text-[var(--text-muted)]">Line {d.line_number}:</span>{" "}
                  <span className="text-[var(--text-primary)]">{d.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Preview table */}
      {preview && (
        <div className="space-y-3">
          {/* Summary + filter pills */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 text-[11px]">
              <button
                onClick={() => setFilter("all")}
                className={`px-2.5 py-1 rounded-md font-semibold ${
                  filter === "all" ? "bg-[var(--accent)] text-[var(--bg)]" : "bg-[var(--bg)] border border-[var(--border)] text-[var(--text-secondary)]"
                }`}
              >
                All ({preview.rows.length})
              </button>
              <button
                onClick={() => setFilter("ok")}
                className={`px-2.5 py-1 rounded-md font-semibold ${
                  filter === "ok" ? "bg-[var(--accent)] text-[var(--bg)]" : "bg-[var(--bg)] border border-[var(--border)] text-[var(--text-secondary)]"
                }`}
              >
                OK ({okCount})
              </button>
              <button
                onClick={() => setFilter("skip")}
                className={`px-2.5 py-1 rounded-md font-semibold ${
                  filter === "skip" ? "bg-[var(--accent)] text-[var(--bg)]" : "bg-[var(--bg)] border border-[var(--border)] text-[var(--text-secondary)]"
                }`}
              >
                Skipped ({skipCount})
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={reset}
                className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] inline-flex items-center gap-1"
              >
                <RotateCcw size={11} />
                Start over
              </button>
              <button
                onClick={handleApply}
                disabled={applying || includedCount === 0}
                className="px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold disabled:opacity-50 flex items-center gap-1.5"
              >
                {applying ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                Apply {includedCount} row{includedCount === 1 ? "" : "s"}
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
                <tr>
                  <th className="text-left px-3 py-2 w-[40px]">#</th>
                  <th className="text-left px-3 py-2 w-[50px]">✓</th>
                  <th className="text-left px-3 py-2 w-[140px]">Status</th>
                  <th className="text-left px-3 py-2">Supplier / Contact / Phone</th>
                  <th className="text-left px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {visibleRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center px-3 py-6 text-[var(--text-muted)] text-[11px] italic">
                      No rows match the current filter.
                    </td>
                  </tr>
                )}
                {visibleRows.map((row) => {
                  const badge = statusBadge(row.status);
                  const Icon = badge.icon;
                  const canToggle = isOk(row.status);
                  const isIncluded = canToggle && !preview.excluded.has(row.line_number);
                  return (
                    <tr key={row.line_number} className="hover:bg-[var(--bg)]/40">
                      <td className="px-3 py-2 text-[10px] font-mono text-[var(--text-muted)]">{row.line_number}</td>
                      <td className="px-3 py-2">
                        {canToggle ? (
                          <button
                            onClick={() => toggleRowExcluded(row.line_number)}
                            className={`w-4 h-4 rounded border flex items-center justify-center ${
                              isIncluded
                                ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--bg)]"
                                : "border-[var(--text-muted)]"
                            }`}
                            aria-label={isIncluded ? "Exclude" : "Include"}
                          >
                            {isIncluded && <CheckCircle2 size={10} />}
                          </button>
                        ) : (
                          <span className="text-[var(--text-muted)] text-[11px]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge.cls}`}>
                          <Icon size={10} />
                          {badge.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex flex-col">
                          <span className="text-[var(--text-primary)] font-medium">{row.raw.supplier_name || <em className="text-[var(--text-muted)]">(empty)</em>}</span>
                          <span className="text-[var(--text-secondary)] text-[11px]">{row.raw.person_name || <em className="text-[var(--text-muted)]">(empty)</em>}</span>
                          <span className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                            {row.normalized_phone || row.raw.phone || <em>(empty)</em>}
                          </span>
                          {row.existing_phone && row.normalized_phone && row.existing_phone !== row.normalized_phone && (
                            <span className="text-[10px] font-mono text-[var(--warning)]">
                              was: {row.existing_phone}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top text-[11px] text-[var(--text-secondary)]">
                        {row.message}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Bottom guide */}
          <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-3 flex-wrap">
            <span>Uncheck individual rows to exclude them from the import.</span>
            <span>·</span>
            <span>Only OK rows can be applied; skipped rows need to be fixed in the CSV first.</span>
          </div>
        </div>
      )}
    </div>
  );
}
