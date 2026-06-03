"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

// ── MultiSelectDropdown ───────────────────────────────────────────────
//
// Reusable checkbox-style multi-select. Used by the Team Coverage page
// for both the account filter and the teammate filter, plus the compare
// teammate picker.
//
// Behavior:
//   - Selected = empty array means "all" (shown as the placeholder).
//   - Click an option to toggle it.
//   - Searchable when there are more than ~6 options.
//   - Closes on outside click.
//   - Trigger shows count: "All", "Rove", "Rove + 2 more", "3 selected".
//
// Props:
//   options           Array of { id, label, sublabel? }
//   selected          Array of selected ids (Set is fine too via Array.from)
//   onChange          Called with the new array of selected ids
//   placeholder       Text shown when nothing selected (= all)
//   searchPlaceholder Optional hint inside the search box
//   maxLabel          If selected count > this, show "N selected" instead of names
//   className         Extra classes for the trigger button
export function MultiSelectDropdown({
  options,
  selected,
  onChange,
  placeholder = "All",
  searchPlaceholder = "Search...",
  maxLabel = 2,
  className = "",
}: {
  options: { id: string; label: string; sublabel?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  maxLabel?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Filter options by search query (case-insensitive substring)
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.label.toLowerCase().includes(q) ||
      (o.sublabel || "").toLowerCase().includes(q)
    );
  }, [options, query]);

  const showSearch = options.length > 6;

  // Trigger label: empty selection = placeholder, else names or count
  const triggerLabel = useMemo(() => {
    if (selected.length === 0) return placeholder;
    const selectedOptions = options.filter(o => selected.includes(o.id));
    if (selectedOptions.length <= maxLabel) {
      return selectedOptions.map(o => o.label).join(", ");
    }
    return `${selectedOptions.length} selected`;
  }, [selected, options, placeholder, maxLabel]);

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter(s => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const selectAll = () => onChange([]);
  const allChecked = selected.length === 0;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] hover:border-[var(--text-muted)] transition-colors ${className}`}
      >
        <span className="truncate max-w-48">{triggerLabel}</span>
        <ChevronDown size={12} className="text-[var(--text-muted)] shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 left-0 w-64 rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-xl py-1">
          {showSearch && (
            <div className="px-2 pb-1 border-b border-[var(--border)] mb-1">
              <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)]">
                <Search size={11} className="text-[var(--text-muted)]" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="flex-1 bg-transparent outline-none text-[11px] text-[var(--text-primary)]"
                />
                {query && (
                  <button onClick={() => setQuery("")} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>
          )}
          {/* "Select all" pseudo-row */}
          <button
            onClick={selectAll}
            className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg)] flex items-center gap-2 text-[11px]"
          >
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
              allChecked
                ? "bg-[var(--accent)] border-[var(--accent)]"
                : "border-[var(--border)]"
            }`}>
              {allChecked && <Check size={9} className="text-[var(--bg)]" strokeWidth={3} />}
            </span>
            <span className="font-medium">{placeholder}</span>
          </button>
          <div className="border-t border-[var(--border)] my-1" />
          {/* Individual options */}
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-[var(--text-muted)] italic">No matches.</div>
            ) : (
              filtered.map(o => {
                const isChecked = selected.includes(o.id);
                return (
                  <button
                    key={o.id}
                    onClick={() => toggle(o.id)}
                    className="w-full text-left px-3 py-1.5 hover:bg-[var(--bg)] flex items-center gap-2 text-[11px]"
                  >
                    <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
                      isChecked
                        ? "bg-[var(--accent)] border-[var(--accent)]"
                        : "border-[var(--border)]"
                    }`}>
                      {isChecked && <Check size={9} className="text-[var(--bg)]" strokeWidth={3} />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{o.label}</div>
                      {o.sublabel && (
                        <div className="text-[10px] text-[var(--text-muted)] truncate">{o.sublabel}</div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
