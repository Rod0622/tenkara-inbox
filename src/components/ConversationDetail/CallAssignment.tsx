"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Phone, X } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";
import type { TeamMember } from "@/types";
import Avatar from "./Avatar";

export default function CallAssignment({
  conversationId,
  tasks,
  teamMembers,
  taskCategories,
  onRefetch,
}: {
  conversationId: string;
  tasks: any[];
  teamMembers: TeamMember[];
  taskCategories: any[];
  onRefetch: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Find callers (members with call skillset)
  const callers = teamMembers.filter((m: any) => m.has_call_skillset && m.is_active !== false);

  // Find existing call task on this thread
  const callCategory = taskCategories.find((c: any) => c.name?.toLowerCase().includes("call"));
  const existingCallTask = tasks.find((t: any) =>
    t.category_id === callCategory?.id ||
    t.text?.toLowerCase().includes("call")
  );
  const currentCaller = existingCallTask?.assignees?.[0] || 
    (existingCallTask?.assignee_id ? teamMembers.find((m) => m.id === existingCallTask.assignee_id) : null);

  const handleAssignCaller = async (member: TeamMember) => {
    setAssigning(true);
    try {
      if (existingCallTask) {
        // Update existing call task assignee
        await fetch("/api/tasks", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task_id: existingCallTask.id,
            assignee_ids: [member.id],
          }),
        });
        // Also update task_assignees: remove old, add new
        const sb = createBrowserClient();
        await sb.from("task_assignees").delete().eq("task_id", existingCallTask.id);
        await sb.from("task_assignees").insert({ task_id: existingCallTask.id, team_member_id: member.id });
      } else {
        // Create new call task
        await fetch("/api/tasks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            text: "Call Task",
            assignee_ids: [member.id],
            status: "todo",
            category_id: callCategory?.id || undefined,
          }),
        });
      }
      await onRefetch();
    } catch (e) { console.error(e); }
    setAssigning(false);
    setOpen(false);
  };

  const handleRemoveCaller = async () => {
    if (!existingCallTask) return;
    setAssigning(true);
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_ids: [existingCallTask.id] }),
      });
      await onRefetch();
    } catch (e) { console.error(e); }
    setAssigning(false);
    setOpen(false);
  };

  if (callers.length === 0 && !currentCaller) return (
    <button
      disabled
      title="No team members have call skillset. Enable in Settings → Team Members"
      className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px] font-semibold text-[var(--text-muted)] cursor-not-allowed"
    >
      <Phone size={12} />
      Call
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={assigning}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all ${
          currentCaller
            ? "border-[rgba(88,166,255,0.3)] bg-[rgba(88,166,255,0.08)] text-[var(--info)]"
            : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
        }`}
      >
        <Phone size={12} />
        {assigning ? "..." : currentCaller ? (currentCaller as any).name || "Caller" : "Call"}
        <ChevronDown size={10} className="text-[var(--text-muted)]" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shadow-2xl shadow-black/40 py-1">
          <div className="px-3 py-2 border-b border-[var(--border)]">
            <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
              Assign caller
            </div>
          </div>

          {currentCaller && (
            <button
              onClick={handleRemoveCaller}
              className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[var(--danger)] hover:bg-[rgba(248,81,73,0.08)] transition-colors"
            >
              <X size={13} />
              Remove call assignment
            </button>
          )}

          {callers.map((m) => {
            const isActive = currentCaller?.id === m.id;
            return (
              <button
                key={m.id}
                onClick={() => handleAssignCaller(m)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-[12px] transition-colors ${
                  isActive ? "bg-[rgba(88,166,255,0.08)]" : "hover:bg-[var(--border)]"
                }`}
              >
                <Avatar initials={m.initials} color={m.color} size={20} />
                <span className={isActive ? "text-[var(--info)] font-medium" : "text-[var(--text-primary)]"}>{m.name}</span>
                {isActive && <Check size={13} className="text-[var(--info)] ml-auto" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SLA Reset Panel ──────────────────────────────────