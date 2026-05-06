"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import type { TeamMember } from "@/types";
import { createBrowserClient } from "@/lib/supabase";
import ActivityItem from "./ActivityItem";

/**
 * ActivityList — Batch 12
 *
 * Wraps the activity feed for a conversation with:
 *   - Search filter (Q5-C): match on actor name OR action keyword
 *   - Day grouping (Q4-B): "Today", "Yesterday", "Apr 30, 2026", etc.
 *   - Lookup tables for resolving label_id / folder_id / team_member_id to names (Q2-B)
 *
 * Lookups are fetched once when the component mounts (i.e. first time the user
 * opens the Activity tab). They're shared across all rendered ActivityItem
 * instances via context-passed maps.
 */

export interface LookupMaps {
  labels: Record<string, { name: string; parent_name?: string | null }>;
  folders: Record<string, { name: string }>;
  teamMembers: Record<string, TeamMember>;
}

const supabase = createBrowserClient();

function dayKey(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  // Compare on YYYY-MM-DD in local time
  const ymd = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  if (ymd(d) === ymd(today)) return "Today";
  if (ymd(d) === ymd(yesterday)) return "Yesterday";

  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric", weekday: "long" }
    : { month: "short", day: "numeric", year: "numeric" }
  );
}

export default function ActivityList({
  activities,
  teamMembers,
  conversationLabels,
}: {
  activities: any[];
  teamMembers: TeamMember[];
  /** Labels currently on this conversation — used as a fallback for label_id resolution. */
  conversationLabels?: any[];
}) {
  const [labelsMap, setLabelsMap] = useState<LookupMaps["labels"]>({});
  const [foldersMap, setFoldersMap] = useState<LookupMaps["folders"]>({});
  const [searchTerm, setSearchTerm] = useState("");

  // Pre-seed labels map from the conversation's currently-applied labels
  // (cheap, immediate, covers most cases without an API call).
  useEffect(() => {
    if (!conversationLabels || conversationLabels.length === 0) return;
    setLabelsMap(prev => {
      const next = { ...prev };
      for (const cl of conversationLabels) {
        if (cl.label && cl.label.id) {
          next[cl.label.id] = {
            name: cl.label.name,
            parent_name: cl.label.parent_label_id ? null : null, // resolved below if present
          };
        }
      }
      return next;
    });
  }, [conversationLabels]);

  // Fetch full labels and folders for ID resolution. One-time on mount.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from("labels").select("id, name, parent_label_id"),
      supabase.from("folders").select("id, name"),
    ]).then(([labelRes, folderRes]: any) => {
      if (cancelled) return;
      const labelData: any[] = labelRes?.data || [];
      const folderData: any[] = folderRes?.data || [];

      const byId: Record<string, { id: string; name: string; parent_label_id: string | null }> = {};
      for (const l of labelData) byId[l.id] = l;

      const labelsBuilt: LookupMaps["labels"] = {};
      for (const l of labelData) {
        const parent = l.parent_label_id ? byId[l.parent_label_id] : null;
        labelsBuilt[l.id] = {
          name: l.name,
          parent_name: parent?.name || null,
        };
      }
      setLabelsMap(labelsBuilt);

      const foldersBuilt: LookupMaps["folders"] = {};
      for (const f of folderData) foldersBuilt[f.id] = { name: f.name };
      setFoldersMap(foldersBuilt);
    });
    return () => { cancelled = true; };
  }, []);

  // Build team-member map for quick lookup
  const membersMap = useMemo(() => {
    const m: Record<string, TeamMember> = {};
    for (const tm of teamMembers) m[tm.id] = tm;
    return m;
  }, [teamMembers]);

  const lookups: LookupMaps = useMemo(
    () => ({ labels: labelsMap, folders: foldersMap, teamMembers: membersMap }),
    [labelsMap, foldersMap, membersMap]
  );

  // Apply search filter — match on actor name or action keyword
  const filtered = useMemo(() => {
    if (!searchTerm.trim()) return activities;
    const q = searchTerm.toLowerCase();
    return activities.filter((a: any) => {
      const actor = a.actor || membersMap[a.actor_id];
      if (actor?.name && actor.name.toLowerCase().includes(q)) return true;
      if ((a.action || "").toLowerCase().includes(q)) return true;
      // Also search in resolved details for richer matches (e.g. label names)
      const details = a.details || {};
      if (details.label_id && labelsMap[details.label_id]?.name?.toLowerCase().includes(q)) return true;
      if (details.folder_id && foldersMap[details.folder_id]?.name?.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [activities, searchTerm, membersMap, labelsMap, foldersMap]);

  // Group by day key, preserving descending order
  const grouped = useMemo(() => {
    const groups: { key: string; items: any[] }[] = [];
    let currentKey = "";
    let currentItems: any[] = [];
    for (const a of filtered) {
      const k = dayKey(a.created_at);
      if (k !== currentKey) {
        if (currentItems.length > 0) groups.push({ key: currentKey, items: currentItems });
        currentKey = k;
        currentItems = [];
      }
      currentItems.push(a);
    }
    if (currentItems.length > 0) groups.push({ key: currentKey, items: currentItems });
    return groups;
  }, [filtered]);

  return (
    <div className="h-full overflow-y-auto pr-2">
      {/* Search box */}
      <div className="sticky top-0 z-10 bg-[#0B0E11] pb-2 -mt-1 pt-1">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#484F58] pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search activity..."
            className="w-full pl-7 pr-7 py-1.5 rounded-lg bg-[#0F1318] border border-[#1E242C] text-[12px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]/40 placeholder:text-[#484F58]"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[#484F58] hover:text-[#F85149]"
              title="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {searchTerm && (
          <div className="text-[10px] text-[#7D8590] mt-1 px-1">
            {filtered.length} of {activities.length} activities match
          </div>
        )}
      </div>

      {activities.length === 0 && (
        <div className="text-center py-10 text-[#484F58] text-sm">
          No activity recorded yet
        </div>
      )}

      {activities.length > 0 && filtered.length === 0 && searchTerm && (
        <div className="text-center py-8 text-[#484F58] text-sm">
          No activities match "{searchTerm}"
        </div>
      )}

      {grouped.map((group) => (
        <div key={group.key} className="mb-2">
          {/* Day header */}
          <div className="sticky top-[42px] z-[5] bg-[#0B0E11]/95 backdrop-blur-sm py-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[#484F58] px-1">
              {group.key}
            </div>
          </div>
          {/* Items */}
          <div className="space-y-0.5">
            {group.items.map((activity) => (
              <ActivityItem
                key={activity.id}
                activity={activity}
                teamMembers={teamMembers}
                lookups={lookups}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
