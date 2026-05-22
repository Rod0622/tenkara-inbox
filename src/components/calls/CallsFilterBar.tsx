// src/components/calls/CallsFilterBar.tsx
//
// Top filter bar for the All Calls view. Filters propagate up to CallsView
// which refetches when any of them change.

"use client";

import { useState, useEffect } from "react";
import { Search, X, Filter as FilterIcon, Phone } from "lucide-react";

export type CallsFilters = {
  range: "today" | "7d" | "30d" | "all";
  direction: "all" | "inbound" | "outbound";
  outcome: "all" | "answered" | "voicemail" | "missed" | "no_answer";
  team_member_id: string;   // "all" | "me" | <uuid>
  has_follow_up: "all" | "true" | "false";
  orphans: "all" | "only" | "exclude";
  q: string;
};

export const DEFAULT_FILTERS: CallsFilters = {
  range: "30d",
  direction: "all",
  outcome: "all",
  team_member_id: "all",
  has_follow_up: "all",
  orphans: "all",
  q: "",
};

interface TeamMemberOption {
  id: string;
  name: string;
  initials: string;
  color: string;
}

interface Props {
  filters: CallsFilters;
  onChange: (f: CallsFilters) => void;
  teamMembers: TeamMemberOption[];
  totalCount: number;
  onRefresh: () => void;
}

export default function CallsFilterBar({ filters, onChange, teamMembers, totalCount, onRefresh }: Props) {
  // Local search debounce — propagate up after 300ms idle so we don't refetch
  // on every keystroke
  const [searchLocal, setSearchLocal] = useState(filters.q);
  useEffect(() => { setSearchLocal(filters.q); }, [filters.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchLocal !== filters.q) onChange({ ...filters, q: searchLocal });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchLocal]);

  const setF = <K extends keyof CallsFilters>(key: K, value: CallsFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const hasActiveFilters =
    filters.range !== DEFAULT_FILTERS.range ||
    filters.direction !== DEFAULT_FILTERS.direction ||
    filters.outcome !== DEFAULT_FILTERS.outcome ||
    filters.team_member_id !== DEFAULT_FILTERS.team_member_id ||
    filters.has_follow_up !== DEFAULT_FILTERS.has_follow_up ||
    filters.orphans !== DEFAULT_FILTERS.orphans ||
    filters.q !== "";

  const resetAll = () => {
    setSearchLocal("");
    onChange(DEFAULT_FILTERS);
  };

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)]">
      {/* Top row: title + count + search + reset */}
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="flex items-center gap-2 shrink-0">
          <Phone size={16} className="text-[var(--accent)]" />
          <h1 className="text-[15px] font-bold text-[var(--text-primary)]">All calls</h1>
          <span className="text-[11px] text-[var(--text-muted)] font-mono">{totalCount}</span>
        </div>

        <div className="flex-1 relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search phone, supplier, contact, notes…"
            value={searchLocal}
            onChange={(e) => setSearchLocal(e.target.value)}
            className="w-full pl-8 pr-8 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
          />
          {searchLocal && (
            <button
              onClick={() => setSearchLocal("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X size={12} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {hasActiveFilters && (
            <button
              onClick={resetAll}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1"
            >
              Clear filters
            </button>
          )}
          <button
            onClick={onRefresh}
            className="text-[11px] text-[var(--info)] hover:underline px-2 py-1"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Filter chips row */}
      <div className="flex items-center gap-2 px-5 pb-3 flex-wrap text-[11px]">
        {/* Date range */}
        <ChipGroup
          label="When"
          value={filters.range}
          onChange={(v) => setF("range", v as CallsFilters["range"])}
          options={[
            { value: "today", label: "Today" },
            { value: "7d", label: "7 days" },
            { value: "30d", label: "30 days" },
            { value: "all", label: "All time" },
          ]}
        />

        {/* Direction */}
        <ChipGroup
          label="Direction"
          value={filters.direction}
          onChange={(v) => setF("direction", v as CallsFilters["direction"])}
          options={[
            { value: "all", label: "All" },
            { value: "inbound", label: "Inbound" },
            { value: "outbound", label: "Outbound" },
          ]}
        />

        {/* Outcome */}
        <ChipGroup
          label="Outcome"
          value={filters.outcome}
          onChange={(v) => setF("outcome", v as CallsFilters["outcome"])}
          options={[
            { value: "all", label: "All" },
            { value: "answered", label: "Answered" },
            { value: "voicemail", label: "Voicemail" },
            { value: "missed", label: "Missed" },
            { value: "no_answer", label: "No answer" },
          ]}
        />

        {/* Team member */}
        <div className="inline-flex items-center gap-1.5">
          <span className="text-[var(--text-muted)] font-semibold">Who:</span>
          <select
            value={filters.team_member_id}
            onChange={(e) => setF("team_member_id", e.target.value)}
            className="px-2 py-1 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          >
            <option value="all">All</option>
            <option value="me">Me</option>
            <optgroup label="Team members">
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </optgroup>
          </select>
        </div>

        {/* Follow-up */}
        <ChipGroup
          label="Follow-up"
          value={filters.has_follow_up}
          onChange={(v) => setF("has_follow_up", v as CallsFilters["has_follow_up"])}
          options={[
            { value: "all", label: "All" },
            { value: "true", label: "Needs follow-up" },
            { value: "false", label: "No follow-up" },
          ]}
        />

        {/* Orphans */}
        <ChipGroup
          label="Linking"
          value={filters.orphans}
          onChange={(v) => setF("orphans", v as CallsFilters["orphans"])}
          options={[
            { value: "all", label: "All" },
            { value: "only", label: "Orphans only" },
            { value: "exclude", label: "Hide orphans" },
          ]}
        />
      </div>
    </div>
  );
}

function ChipGroup({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="inline-flex items-center gap-1.5">
      <span className="text-[var(--text-muted)] font-semibold">{label}:</span>
      <div className="inline-flex items-center bg-[var(--bg)] rounded-md p-0.5 border border-[var(--border)]">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
              value === opt.value
                ? "bg-[var(--accent)] text-[var(--bg)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
