"use client";

import { CheckCircle, Circle, Eye, MessageSquare, Plus, Reply, Send, Trash2, User } from "lucide-react";
import type { TeamMember } from "@/types";
import Avatar from "./Avatar";

export default function ActivityItem({
  activity,
  teamMembers,
}: {
  activity: any;
  teamMembers: TeamMember[];
}) {
  const actor =
    activity.actor ||
    teamMembers.find((member) => member.id === activity.actor_id) ||
    null;

  const actionMap: Record<string, { label: string; color: string; icon: any }> = {
    viewed: { label: "Viewed", color: "#58A6FF", icon: Eye },
    assigned: { label: "Assigned", color: "#4ADE80", icon: User },
    unassigned: { label: "Unassigned", color: "#F0883E", icon: User },
    note_created: { label: "Note added", color: "#A371F7", icon: MessageSquare },
    task_created: { label: "Task created", color: "#58A6FF", icon: Plus },
    task_completed: { label: "Task completed", color: "#4ADE80", icon: CheckCircle },
    task_reopened: { label: "Task reopened", color: "#F5D547", icon: Circle },
    task_deleted: { label: "Task deleted", color: "#F85149", icon: Trash2 },
    reply_sent: { label: "Reply sent", color: "#4ADE80", icon: Send },
  };

  const config = actionMap[activity.action] || {
    label: activity.action || "Activity",
    color: "#7D8590",
    icon: MessageSquare,
  };
  const Icon = config.icon;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-[#161B22] last:border-b-0">
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
        style={{ background: `${config.color}20`, color: config.color }}
      >
        <Icon size={14} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold" style={{ color: config.color }}>
          {config.label}
        </div>
        <div className="flex items-center gap-2 mt-1 text-[11px] text-[#484F58]">
          {actor && (
            <>
              <Avatar initials={actor.initials} color={actor.color} size={16} />
              <span style={{ color: actor.color }}>{actor.name}</span>
            </>
          )}
          <span>
            {activity.created_at ? new Date(activity.created_at).toLocaleString() : ""}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Thread Attachment Bar (top-level summary) ───────
