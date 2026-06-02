"use client";

import {
  Bookmark, CheckCircle, Circle, Clock, Eye, Flag, FolderOpen,
  GitBranch, GitMerge, Mail, MessageSquare, Pencil, Pin, Plus, Send,
  Smile, Tag, Trash2, User, UserCheck, Palette, ClipboardList, Phone,
  PhoneMissed, BellRing,
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
  assigned: { label: "Assigned", color: "var(--accent)", icon: User },
  unassigned: { label: "Unassigned", color: "var(--warning)", icon: User },

  // Conversation lifecycle
  conversation_created: { label: "Conversation created", color: "var(--info)", icon: Mail },
  status_changed: { label: "Status changed", color: "#A371F7", icon: Flag },
  moved_to_folder: { label: "Moved to folder", color: "var(--info)", icon: FolderOpen },
  subject_renamed: { label: "Subject renamed", color: "var(--info)", icon: Pencil },

  // Labels
  label_added: { label: "Label added", color: "#BC8CFF", icon: Tag },
  label_removed: { label: "Label removed", color: "var(--warning)", icon: Tag },

  // Notes & tasks
  note_added: { label: "Note added", color: "#A371F7", icon: MessageSquare },
  note_created: { label: "Note added", color: "#A371F7", icon: MessageSquare }, // alias for legacy rows
  note_edited: { label: "Note edited", color: "var(--info)", icon: Pencil },
  note_deleted: { label: "Note deleted", color: "var(--danger)", icon: Trash2 },
  task_created: { label: "Task created", color: "var(--info)", icon: Plus },
  task_edited: { label: "Task edited", color: "var(--info)", icon: Pencil },
  task_completed: { label: "Task completed", color: "var(--accent)", icon: CheckCircle },
  task_reopened: { label: "Task reopened", color: "var(--highlight)", icon: Circle },
  task_deleted: { label: "Task deleted", color: "var(--danger)", icon: Trash2 },
  task_left: { label: "Left task", color: "var(--warning)", icon: User },

  // Pins (per-user, but logged so the team can audit)
  pin_added: { label: "Pinned", color: "var(--accent)", icon: Pin },
  pin_removed: { label: "Unpinned", color: "var(--text-secondary)", icon: Pin },

  // Primary contact
  primary_contact_changed: { label: "Primary contact changed", color: "var(--info)", icon: UserCheck },
  primary_contact_reset: { label: "Primary contact reset to auto", color: "var(--text-secondary)", icon: UserCheck },

  // Comments / Team Chat
  comment_added: { label: "Team chat sent", color: "#A371F7", icon: MessageSquare },
  comment_edited: { label: "Team chat edited", color: "var(--info)", icon: Pencil },
  comment_deleted: { label: "Team chat deleted", color: "var(--danger)", icon: Trash2 },
  reaction_added: { label: "Reaction added", color: "var(--highlight)", icon: Smile },
  reaction_removed: { label: "Reaction removed", color: "var(--text-secondary)", icon: Smile },

  // Email
  reply_sent: { label: "Reply sent", color: "var(--accent)", icon: Send },
  email_composed: { label: "Email sent", color: "var(--accent)", icon: Send },

  // Color tagging
  color_set: { label: "Color set", color: "var(--highlight)", icon: Palette },
  color_cleared: { label: "Color cleared", color: "var(--text-secondary)", icon: Palette },

  // Follow-ups
  follow_up_set: { label: "Follow-up set", color: "var(--highlight)", icon: Clock },
  follow_up_executed: { label: "Follow-up sent", color: "var(--accent)", icon: Send },

  // Forms
  form_submitted: { label: "Form submitted", color: "var(--info)", icon: ClipboardList },

  // Merging
  merge: { label: "Threads merged", color: "#BC8CFF", icon: GitMerge },
  unmerge: { label: "Thread unmerged", color: "var(--warning)", icon: GitBranch },

  // Other
  viewed: { label: "Viewed", color: "var(--info)", icon: Eye },
  starred: { label: "Starred", color: "var(--highlight)", icon: Bookmark },
  unstarred: { label: "Unstarred", color: "var(--text-secondary)", icon: Bookmark },

  // Quo (call integration)
  quo_call_logged: { label: "Call logged", color: "var(--accent)", icon: Phone },
  quo_call_linked: { label: "Call linked", color: "var(--info)", icon: Phone },
  quo_call_followup_set: { label: "Call follow-up set", color: "var(--highlight)", icon: BellRing },
  quo_call_followup_canceled: { label: "Call follow-up canceled", color: "var(--text-secondary)", icon: BellRing },
  quo_call_followup_redial: { label: "Redial reminder fired", color: "var(--highlight)", icon: Phone },
  quo_call_followup_escalated: { label: "Call follow-up escalated", color: "var(--danger)", icon: PhoneMissed },
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
      return <span>to <span className="text-[var(--text-primary)] font-medium">{memberName(assignee)}</span></span>;
    }
    case "unassigned": {
      const prev = details.previous_assignee_id;
      if (!prev) return null;
      return <span>from <span className="text-[var(--text-primary)] font-medium">{memberName(prev)}</span></span>;
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
      return <span><span className="text-[var(--text-primary)] font-medium">{display}</span></span>;
    }
    case "moved_to_folder": {
      const id = details.folder_id;
      if (!id) return null;
      // Prefer the lookup, fall back to stored folder_name from when event fired
      const display = lookups?.folders?.[id]?.name || details.folder_name || "(deleted)";
      return <span>to <span className="text-[var(--text-primary)] font-medium">{display}</span></span>;
    }
    case "status_changed": {
      const from = details.previous_status || details.from;
      const to = details.new_status || details.status || details.to;
      if (!to && !from) return null;
      return (
        <span>
          {from && <span className="text-[var(--text-secondary)]">{from}</span>}
          {from && to && <span className="text-[var(--text-muted)] mx-1">→</span>}
          {to && <span className="text-[var(--text-primary)] font-medium">{to}</span>}
        </span>
      );
    }
    case "task_created": {
      const text = details.task_text || details.text;
      if (!text) return null;
      const trimmed = String(text).length > 80 ? String(text).slice(0, 80) + "…" : text;
      return <span className="text-[var(--text-primary)] italic">"{trimmed}"</span>;
    }
    case "subject_renamed": {
      const oldS = details.old_subject;
      const newS = details.new_subject;
      if (!newS) return null;
      const t = (s: string) => String(s).length > 50 ? String(s).slice(0, 50) + "…" : s;
      return (
        <span>
          {oldS && <span className="text-[var(--text-secondary)] italic">"{t(oldS)}"</span>}
          {oldS && <span className="text-[var(--text-muted)] mx-1">→</span>}
          <span className="text-[var(--text-primary)] font-medium italic">"{t(newS)}"</span>
        </span>
      );
    }
    case "note_added":
    case "note_created": {
      const previewText = details.note_title || details.title || details.preview;
      if (!previewText) return null;
      const trimmed = String(previewText).length > 80 ? String(previewText).slice(0, 80) + "…" : previewText;
      return <span className="text-[var(--text-primary)] italic">"{trimmed}"</span>;
    }
    case "note_edited":
    case "note_deleted": {
      const previewText = details.preview;
      if (!previewText) return null;
      const trimmed = String(previewText).length > 80 ? String(previewText).slice(0, 80) + "…" : previewText;
      return <span className="text-[var(--text-primary)] italic">"{trimmed}"</span>;
    }
    case "task_edited": {
      const text = details.text;
      const changed = Array.isArray(details.changed) ? details.changed : [];
      if (!text && changed.length === 0) return null;
      const trimmed = text && String(text).length > 60 ? String(text).slice(0, 60) + "…" : text;
      return (
        <span>
          {trimmed && <span className="text-[var(--text-primary)] italic">"{trimmed}"</span>}
          {trimmed && changed.length > 0 && <span className="text-[var(--text-muted)] mx-1">·</span>}
          {changed.length > 0 && <span className="text-[var(--text-secondary)]">{changed.join(", ")}</span>}
        </span>
      );
    }
    case "task_left": {
      const text = details.text;
      const reason = details.reason;
      const trimmedText = text && String(text).length > 60 ? String(text).slice(0, 60) + "…" : text;
      const trimmedReason = reason && String(reason).length > 80 ? String(reason).slice(0, 80) + "…" : reason;
      if (!trimmedText && !trimmedReason) return null;
      return (
        <span>
          {trimmedText && <span className="text-[var(--text-primary)] italic">"{trimmedText}"</span>}
          {trimmedText && trimmedReason && <span className="text-[var(--text-muted)] mx-1">·</span>}
          {trimmedReason && <span className="text-[var(--text-secondary)]">reason: {trimmedReason}</span>}
        </span>
      );
    }
    case "task_deleted": {
      // Two flavors: normal delete (just text) or remove-me sole-assignee
      // delete (text + reason). Both render the same way — show what was
      // there plus the reason if present.
      const text = details.text;
      const reason = details.reason;
      const trimmedText = text && String(text).length > 60 ? String(text).slice(0, 60) + "…" : text;
      const trimmedReason = reason && String(reason).length > 80 ? String(reason).slice(0, 80) + "…" : reason;
      if (!trimmedText && !trimmedReason) return null;
      return (
        <span>
          {trimmedText && <span className="text-[var(--text-primary)] italic">"{trimmedText}"</span>}
          {trimmedText && trimmedReason && <span className="text-[var(--text-muted)] mx-1">·</span>}
          {trimmedReason && <span className="text-[var(--text-secondary)]">reason: {trimmedReason}</span>}
        </span>
      );
    }
    case "primary_contact_changed": {
      const from = details.from_email;
      const to = details.to_email;
      if (!to) return null;
      const t = (s: string) => String(s).length > 40 ? String(s).slice(0, 40) + "…" : s;
      return (
        <span>
          {from && <span className="text-[var(--text-secondary)]">{t(from)}</span>}
          {from && to && <span className="text-[var(--text-muted)] mx-1">→</span>}
          <span className="text-[var(--text-primary)] font-medium">{t(to)}</span>
        </span>
      );
    }
    case "primary_contact_reset": {
      const prev = details.previous_email;
      if (!prev) return null;
      return <span>was <span className="text-[var(--text-secondary)]">{prev}</span></span>;
    }
    case "comment_added":
    case "comment_edited":
    case "comment_deleted": {
      const previewText = details.preview;
      if (!previewText) return null;
      const trimmed = String(previewText).length > 80 ? String(previewText).slice(0, 80) + "…" : previewText;
      return <span className="text-[var(--text-primary)] italic">"{trimmed}"</span>;
    }
    case "reaction_added":
    case "reaction_removed": {
      const emoji = details.emoji;
      if (!emoji) return null;
      return <span className="text-[var(--text-primary)] text-base">{emoji}</span>;
    }
    case "color_set": {
      const color = details.color;
      if (!color) return null;
      return (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: color }} />
          <span className="text-[var(--text-secondary)]">{color}</span>
        </span>
      );
    }
    case "reply_sent":
    case "email_composed": {
      const to = details.to;
      if (!to) return null;
      const trimmed = String(to).length > 60 ? String(to).slice(0, 60) + "…" : to;
      return <span>to <span className="text-[var(--text-primary)]">{trimmed}</span></span>;
    }
    case "follow_up_set": {
      const dueAt = details.due_at || details.scheduled_at;
      if (!dueAt) return null;
      try {
        return <span>for <span className="text-[var(--text-primary)]">{new Date(dueAt).toLocaleString()}</span></span>;
      } catch { return null; }
    }
    case "form_submitted": {
      const formName = details.form_name || details.template_name;
      if (!formName) return null;
      return <span>: <span className="text-[var(--text-primary)]">{formName}</span></span>;
    }
    case "merge":
    case "unmerge": {
      // Both events share a similar shape: details.{merged|unmerged}_subject
      // identifies the thread that was folded in / out. Newer entries (after
      // the merge-audit fix) also include from_name/from_email and per-record
      // counts (messages, tasks, etc.) for richer context.
      const subject = details.merged_subject || details.unmerged_subject;
      const fromName = details.merged_from_name || details.unmerged_from_name;
      const fromEmail = details.merged_from_email || details.unmerged_from_email;
      const moved = details.moved || {};
      const msgCount = typeof moved.messages === "number" ? moved.messages : null;

      // Old-format entries (no enriched details) just show the label without
      // a subtitle — same as before. Once you re-merge anything new, the
      // richer subtitle appears.
      if (!subject) return null;

      const trimmed = String(subject).length > 60 ? String(subject).slice(0, 60) + "…" : subject;
      const sender = fromName || fromEmail;

      return (
        <span>
          : <span className="text-[var(--text-primary)]">{trimmed}</span>
          {sender && (
            <span className="text-[var(--text-muted)]"> · from {sender}</span>
          )}
          {msgCount !== null && msgCount > 0 && activity.action === "merge" && (
            <span className="text-[var(--text-muted)]"> · {msgCount} message{msgCount === 1 ? "" : "s"}</span>
          )}
        </span>
      );
    }
    case "quo_call_logged":
    case "quo_call_linked": {
      const dir = details.direction;
      const phone = details.participant_phone;
      const outcome = details.outcome;
      const supplier = details.supplier_name;
      const person = details.person_name;
      const parts: string[] = [];
      if (dir) parts.push(dir);
      if (outcome && outcome !== "answered") parts.push(`(${outcome})`);
      if (person) parts.push(`with ${person}`);
      else if (supplier) parts.push(`with ${supplier}`);
      else if (phone) parts.push(`from ${phone}`);
      if (parts.length === 0) return null;
      return <span className="text-[var(--text-primary)]">{parts.join(" ")}</span>;
    }
    case "quo_call_followup_redial": {
      const attempt = details.attempt;
      const max = details.max_attempts;
      if (!attempt) return null;
      return <span>attempt <span className="text-[var(--text-primary)] font-medium">{attempt}{max ? ` of ${max}` : ""}</span></span>;
    }
    case "quo_call_followup_escalated": {
      const ac = details.attempt_count;
      const mx = details.max_attempts;
      if (ac === undefined && mx === undefined) return null;
      return <span>after <span className="text-[var(--text-primary)] font-medium">{ac}{mx ? ` of ${mx}` : ""}</span> attempts</span>;
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
    color: "var(--text-secondary)",
    icon: MessageSquare,
  };
  const Icon = config.icon;
  const detail = renderDetail(activity, lookups);
  const ts = formatTimestamp(activity.created_at);

  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-[var(--surface-2)] last:border-b-0">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `color-mix(in srgb, ${config.color} 14%, transparent)`, color: config.color }}
      >
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-[13px] font-semibold" style={{ color: config.color }}>
            {config.label}
          </span>
          {detail && (
            <span className="text-[12px] text-[var(--text-secondary)]">{detail}</span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-[var(--text-muted)]">
          {actor && (
            <>
              <Avatar initials={actor.initials} color={actor.color} size={16} />
              <span style={{ color: actor.color }}>{actor.name}</span>
              <span className="text-[var(--text-muted)]">·</span>
            </>
          )}
          <span title={ts.tooltip} className="font-mono">{ts.display}</span>
        </div>
      </div>
    </div>
  );
}

// ── Thread Attachment Bar (top-level summary) ───────