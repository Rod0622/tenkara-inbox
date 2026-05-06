"use client";

import {
  Bookmark, CheckCircle, Circle, Clock, Eye, Flag, FolderOpen,
  GitBranch, GitMerge, Mail, MessageSquare, Plus, Send, Tag,
  Trash2, User, Palette, ClipboardList,
} from "lucide-react";
import type { TeamMember } from "@/types";
import Avatar from "./Avatar";
import type { LookupMaps } from "./ActivityList";

/**
 * ActivityItem — Batch 12 rewrite
 *
 * - Q1-A: extends existing component (doesn't rebuild from scratch)
 * - Q2-B: shows resolved details inline (e.g. "Assigned to Maria",
 *         "Added label: Brands / Apple", "Status: open → closed")
 * - Q3-C: smart timestamps — relative for recent (< 24h), absolute date
 *         for older, year for very old. Tooltip shows full timestamp.
 * - All 17+ action types from /api/* are now handled, no more
 *   generic "Activity" fallback for common actions.
 */

// ─── Smart timestamp formatting (Q3-C) ──────────────────────────
function formatTimestamp(iso: string): { display: string; tooltip: string } {
  if (!iso) return { display: "", tooltip: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { display: "", tooltip: iso };

  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffHr = Math.round(diffMs / 3600000);
  const diffDays = Math.round(diffMs / 86400000);

  let display: string;
  if (diffMs < 0 || diffMin < 1) display = "just now";
  else if (diffMin < 60) display = `${diffMin} min ago`;
  else if (diffHr < 24) display = `${diffHr}h ago`;
  else if (diffDays < 7) display = `${diffDays}d ago`;
  else if (d.getFullYear() === now.getFullYear()) {
    display = d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  } else {
    display = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  const tooltip = d.toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
  return { display, tooltip };
}

// ─── Action type → label/color/icon map ────────────────────────
// Covers all action types written by /api routes (audited via grep).
// Falls back gracefully for any future action types we haven't mapped yet.
const ACTION_MAP: Record<string, { label: string; color: string; icon: any }> = {
  // Assignment
  assigned: { label: "Assigned", color: "#4ADE80", icon: User },
  unassigned: { label: "Unassigned", color: "#F0883E", icon: User },

  // Conversation lifecycle
  conversation_created: { label: "Conversation created", color: "#58A6FF", icon: Mail },
  status_changed: { label: "Status changed", color: "#A371F7", icon: Flag },
  moved_to_folder: { label: "Moved to folder", color: "#58A6FF", icon: FolderOpen },

  // Labels
  label_added: { label: "Label added", color: "#BC8CFF", icon: Tag },
  label_removed: { label: "Label removed", color: "#F0883E", icon: Tag },

  // Notes & tasks
  note_added: { label: "Note added", color: "#A371F7", icon: MessageSquare },
  note_created: { label: "Note added", color: "#A371F7", icon: MessageSquare }, // alias for legacy rows
  task_created: { label: "Task created", color: "#58A6FF", icon: Plus },
  task_completed: { label: "Task completed", color: "#4ADE80", icon: CheckCircle },
  task_reopened: { label: "Task reopened", color: "#F5D547", icon: Circle },
  task_deleted: { label: "Task deleted", color: "#F85149", icon: Trash2 },

  // Email
  reply_sent: { label: "Reply sent", color: "#4ADE80", icon: Send },
  email_composed: { label: "Email sent", color: "#4ADE80", icon: Send },

  // Color tagging
  color_set: { label: "Color set", color: "#F5D547", icon: Palette },
  color_cleared: { label: "Color cleared", color: "#7D8590", icon: Palette },

  // Follow-ups
  follow_up_set: { label: "Follow-up set", color: "#F5D547", icon: Clock },
  follow_up_executed: { label: "Follow-up sent", color: "#4ADE80", icon: Send },

  // Forms
  form_submitted: { label: "Form submitted", color: "#58A6FF", icon: ClipboardList },

  // Merging
  merge: { label: "Threads merged", color: "#BC8CFF", icon: GitMerge },
  unmerge: { label: "Thread unmerged", color: "#F0883E", icon: GitBranch },

  // Other
  viewed: { label: "Viewed", color: "#58A6FF", icon: Eye },
  starred: { label: "Starred", color: "#F5D547", icon: Bookmark },
  unstarred: { label: "Unstarred", color: "#7D8590", icon: Bookmark },
};

// ─── Detail rendering (Q2-B) ──────────────────────────────────
// Returns a JSX fragment to render inline as supplemental context
// for an activity row, or null if no useful detail can be shown.
function renderDetail(activity: any, lookups?: LookupMaps): React.ReactNode {
  const action = activity.action;
  const details = activity.details || {};

  const memberName = (id: string | null | undefined): string => {
    if (!id) return "(unknown)";
    return lookups?.teamMembers?.[id]?.name || "(deleted)";
  };

  switch (action) {
    case "assigned": {
      const assignee = details.assignee_id;
      if (!assignee) return null;
      return <span>to <span className="text-[#E6EDF3] font-medium">{memberName(assignee)}</span></span>;
    }
    case "unassigned": {
      const prev = details.previous_assignee_id;
      if (!prev) return null;
      return <span>from <span className="text-[#E6EDF3] font-medium">{memberName(prev)}</span></span>;
    }
    case "label_added":
    case "label_removed": {
      const id = details.label_id || details.added_label_id || details.removed_label_id;
      if (!id) return null;
      // Prefer the lookup (most accurate, includes parent path), fall back to stored name from when event fired
      const lookupResult = lookups?.labels?.[id];
      const display = lookupResult
        ? (lookupResult.parent_name ? `${lookupResult.parent_name} / ${lookupResult.name}` : lookupResult.name)
        : (details.label_name || "(deleted)");
      return <span><span className="text-[#E6EDF3] font-medium">{display}</span></span>;
    }
    case "moved_to_folder": {
      const id = details.folder_id;
      if (!id) return null;
      // Prefer the lookup, fall back to stored folder_name from when event fired
      const display = lookups?.folders?.[id]?.name || details.folder_name || "(deleted)";
      return <span>to <span className="text-[#E6EDF3] font-medium">{display}</span></span>;
    }
    case "status_changed": {
      const from = details.previous_status || details.from;
      const to = details.new_status || details.status || details.to;
      if (!to && !from) return null;
      return (
        <span>
          {from && <span className="text-[#7D8590]">{from}</span>}
          {from && to && <span className="text-[#484F58] mx-1">→</span>}
          {to && <span className="text-[#E6EDF3] font-medium">{to}</span>}
        </span>
      );
    }
    case "task_created": {
      const text = details.task_text || details.text;
      if (!text) return null;
      const trimmed = String(text).length > 80 ? String(text).slice(0, 80) + "…" : text;
      return <span className="text-[#E6EDF3] italic">"{trimmed}"</span>;
    }
    case "note_added":
    case "note_created": {
      const previewText = details.note_title || details.title || details.preview;
      if (!previewText) return null;
      const trimmed = String(previewText).length > 80 ? String(previewText).slice(0, 80) + "…" : previewText;
      return <span className="text-[#E6EDF3] italic">"{trimmed}"</span>;
    }
    case "color_set": {
      const color = details.color;
      if (!color) return null;
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
          <span className="text-[#7D8590]">{color}</span>
        </span>
      );
    }
    case "reply_sent":
    case "email_composed": {
      const to = details.to;
      if (!to) return null;
      const trimmed = String(to).length > 60 ? String(to).slice(0, 60) + "…" : to;
      return <span>to <span className="text-[#E6EDF3]">{trimmed}</span></span>;
    }
    case "follow_up_set": {
      const dueAt = details.due_at || details.scheduled_at;
      if (!dueAt) return null;
      try {
        return <span>for <span className="text-[#E6EDF3]">{new Date(dueAt).toLocaleString()}</span></span>;
      } catch { return null; }
    }
    case "form_submitted": {
      const formName = details.form_name || details.template_name;
      if (!formName) return null;
      return <span>: <span className="text-[#E6EDF3]">{formName}</span></span>;
    }
    case "merge":
    case "unmerge": {
      const subject = details.merged_subject || details.unmerged_subject;
      if (!subject) return null;
      const trimmed = String(subject).length > 60 ? String(subject).slice(0, 60) + "…" : subject;
      return <span>: <span className="text-[#E6EDF3]">{trimmed}</span></span>;
    }
    default:
      return null;
  }
}

export default function ActivityItem({
  activity,
  teamMembers,
  lookups,
}: {
  activity: any;
  teamMembers: TeamMember[];
  lookups?: LookupMaps;
}) {
  const actor =
    activity.actor ||
    teamMembers.find((member) => member.id === activity.actor_id) ||
    null;

  const config = ACTION_MAP[activity.action] || {
    label: activity.action ? activity.action.replace(/_/g, " ") : "Activity",
    color: "#7D8590",
    icon: MessageSquare,
  };
  const Icon = config.icon;
  const detail = renderDetail(activity, lookups);
  const ts = formatTimestamp(activity.created_at);

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[#161B22] last:border-b-0">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `${config.color}20`, color: config.color }}
      >
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[13px] font-semibold" style={{ color: config.color }}>
            {config.label}
          </span>
          {detail && (
            <span className="text-[12px] text-[#7D8590]">{detail}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-[#484F58]">
          {actor && (
            <>
              <Avatar initials={actor.initials} color={actor.color} size={16} />
              <span style={{ color: actor.color }}>{actor.name}</span>
              <span className="text-[#484F58]">·</span>
            </>
          )}
          <span title={ts.tooltip}>{ts.display}</span>
        </div>
      </div>
    </div>
  );
}

// ── Thread Attachment Bar (top-level summary) ───────