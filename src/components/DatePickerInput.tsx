"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, X } from "lucide-react";
import { DayPicker } from "react-day-picker";
import "react-day-picker/dist/style.css";

/**
 * DatePickerInput — Batch 11
 *
 * Replaces native <input type="date"> for the search filters with a popover-style
 * calendar (react-day-picker). The native one looks ugly and varies wildly across
 * browsers; this gives a consistent dark-themed picker.
 *
 * Stores value as ISO date string (YYYY-MM-DD) so it's a drop-in for existing
 * filter state shape (filters.dateFrom / filters.dateTo).
 */
export default function DatePickerInput({
  value,
  onChange,
  placeholder = "Pick a date",
  ariaLabel,
}: {
  value: string;            // ISO YYYY-MM-DD or empty string
  onChange: (next: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Parse ISO YYYY-MM-DD as a local-day Date (avoid TZ shifting). If empty/invalid → undefined.
  const selected: Date | undefined = (() => {
    if (!value) return undefined;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return undefined;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? undefined : d;
  })();

  // Format for the trigger button label
  const display = selected
    ? selected.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "";

  // Convert chosen Date back to ISO YYYY-MM-DD using local components (no TZ shift)
  const handleSelect = (d: Date | undefined) => {
    if (!d) {
      onChange("");
      setOpen(false);
      return;
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    onChange(`${yyyy}-${mm}-${dd}`);
    setOpen(false);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel || placeholder}
        className="w-full flex items-center gap-1.5 px-2 py-1 rounded bg-[#0B0E11] border border-[#1E242C] text-[11px] text-left outline-none hover:border-[#4ADE80]/40 focus:border-[#4ADE80]/40 transition-colors"
      >
        <CalendarIcon size={11} className="text-[#484F58] shrink-0" />
        <span className={`flex-1 truncate ${display ? "text-[#E6EDF3]" : "text-[#484F58]"}`}>
          {display || placeholder}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onChange(""); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onChange(""); } }}
            className="text-[#484F58] hover:text-[#F85149] shrink-0 cursor-pointer"
            aria-label="Clear date"
          >
            <X size={11} />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 rounded-lg border border-[#1E242C] bg-[#12161B] shadow-2xl shadow-black/60 p-2">
          <DayPicker
            mode="single"
            selected={selected}
            onSelect={handleSelect}
            showOutsideDays
            classNames={{
              root: "rdp-tenkara",
              months: "flex",
              month: "space-y-2",
              caption: "flex justify-between items-center px-1 py-1",
              caption_label: "text-[12px] font-semibold text-[#E6EDF3]",
              nav: "flex items-center gap-1",
              nav_button: "h-6 w-6 rounded hover:bg-[#1E242C] text-[#7D8590] flex items-center justify-center",
              nav_button_previous: "",
              nav_button_next: "",
              table: "w-full border-collapse",
              head_row: "flex",
              head_cell: "w-8 h-7 text-[10px] font-semibold uppercase text-[#484F58] flex items-center justify-center",
              row: "flex w-full",
              cell: "w-8 h-8 text-center text-[11px] p-0",
              day: "w-8 h-8 rounded text-[#E6EDF3] hover:bg-[#1E242C] focus:outline-none focus:bg-[#1E242C]",
              day_selected: "!bg-[#4ADE80] !text-[#0B0E11] font-semibold hover:!bg-[#4ADE80]",
              day_today: "ring-1 ring-[#4ADE80]/40",
              day_outside: "text-[#484F58] opacity-50",
              day_disabled: "text-[#484F58] opacity-30 cursor-not-allowed",
            }}
          />
        </div>
      )}
    </div>
  );
}
