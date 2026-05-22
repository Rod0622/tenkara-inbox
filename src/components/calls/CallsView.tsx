// src/components/calls/CallsView.tsx
//
// Top-level container for the All Calls view. Manages filter state, fetches
// from /api/calls/all, and renders the filter bar + stats strip + list +
// orphan side panel.

"use client";

import { useEffect, useState, useCallback } from "react";
import CallsFilterBar, { CallsFilters, DEFAULT_FILTERS } from "./CallsFilterBar";
import CallsStatsStrip from "./CallsStatsStrip";
import CallsList from "./CallsList";
import OrphanCallPanel from "./OrphanCallPanel";

interface Props {
  // Callback when user clicks a linked call row — navigates back to the
  // inbox view and opens the conversation
  onOpenConversation: (conversationId: string) => void;
}

export default function CallsView({ onOpenConversation }: Props) {
  const [filters, setFilters] = useState<CallsFilters>(DEFAULT_FILTERS);
  const [calls, setCalls] = useState<any[]>([]);
  const [stats, setStats] = useState<any>({
    by_day: [],
    by_direction: { inbound: 0, outbound: 0 },
    by_outcome: { answered: 0, voicemail: 0, missed: 0, no_answer: 0, other: 0 },
    by_team_member: [],
    total_filtered: 0,
  });
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orphanCall, setOrphanCall] = useState<any | null>(null);

  const fetchCalls = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        range: filters.range,
        direction: filters.direction,
        outcome: filters.outcome,
        team_member_id: filters.team_member_id,
        has_follow_up: filters.has_follow_up,
        orphans: filters.orphans,
        q: filters.q,
        limit: "200",
      });
      const res = await fetch(`/api/calls/all?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setCalls(data.calls || []);
      setStats(data.stats || {});
      setTeamMembers(data.filter_options?.team_members || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  return (
    <div className="h-full flex flex-col bg-[var(--bg)]">
      <CallsFilterBar
        filters={filters}
        onChange={setFilters}
        teamMembers={teamMembers}
        totalCount={stats.total_filtered || 0}
        onRefresh={fetchCalls}
      />
      <CallsStatsStrip stats={stats} />
      {error ? (
        <div className="flex-1 flex items-center justify-center text-[var(--danger)] text-[12px]">
          {error}
        </div>
      ) : (
        <CallsList
          calls={calls}
          loading={loading}
          onOpenConversation={(conversationId) => onOpenConversation(conversationId)}
          onOpenOrphan={(call) => setOrphanCall(call)}
        />
      )}
      <OrphanCallPanel call={orphanCall} onClose={() => setOrphanCall(null)} />
    </div>
  );
}
