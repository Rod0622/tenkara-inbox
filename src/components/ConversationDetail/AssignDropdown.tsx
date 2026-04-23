"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, User, X } from "lucide-react";
import type { TeamMember } from "@/types";
import Avatar from "./Avatar";

export default function AssignDropdown({
  currentAssignee,
  currentUser,
  teamMembers,
  onAssign,
  conversationId,
}: {
  currentAssignee: TeamMember | null | undefined;
  currentUser: TeamMember | null;
  teamMembers: TeamMember[];
  onAssign: (
    conversationId: string,
    assigneeId: string | null,
    updatedConversation?: any
  ) => Promise<void>;
  conversationId: string;
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

  const handleAssign = async (memberId: string | null) => {
    setAssigning(true);
    try {
      const res = await fetch("/api/conversations/assign", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          assignee_id: memberId,
          actor_id: currentUser?.id,
        }),
      });
      const result = await res.json().catch(() => ({}));
      await onAssign(conversationId, memberId, result.conversation);
    } catch (error) {
      console.error("Assign failed:", error);
    } finally {
      setAssigning(false);
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      {currentAssignee ? (
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={assigning}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[12px] font-medium hover:bg-[#181D24] transition-all"
        >
          <Avatar initials={currentAssignee.initials} color={currentAssignee.color} size={18} />
          <span style={{ color: currentAssignee.color }}>{currentAssignee.name}</span>
          <ChevronDown size={12} className="text-[#484F58]" />
        </button>
      ) : (
        <div className="flex">
          <button
            onClick={() => currentUser && handleAssign(currentUser.id)}
            disabled={assigning}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-l-lg border border-[#1E242C] border-r-0 bg-[#12161B] text-[12px] font-medium hover:bg-[#181D24] transition-all"
          >
            <User size={14} className="text-[#4ADE80]" />
            <span className="text-[#E6EDF3]">{assigning ? "Assigning..." : "Assign to me"}</span>
          </button>
          <button
            onClick={() => setOpen((v) => !v)}
            className="px-2 py-1.5 rounded-r-lg border border-[#1E242C] bg-[#12161B] hover:bg-[#181D24] transition-all"
          >
            <ChevronDown size={12} className="text-[#484F58]" />
          </button>
        </div>
      )}

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1">
          <div className="px-3 py-2 border-b border-[#1E242C]">
            <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
              Assign to team member
            </div>
          </div>

          {currentAssignee && (
            <button
              onClick={() => handleAssign(null)}
              className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[#F85149] hover:bg-[#1E242C]"
            >
              <X size={14} />
              Unassign
            </button>
          )}

          {teamMembers
            .filter((m) => m.is_active !== false)
            .map((member) => {
              const active = currentAssignee?.id === member.id;
              return (
                <button
                  key={member.id}
                  onClick={() => handleAssign(member.id)}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] hover:bg-[#1E242C] ${
                    active ? "text-[#4ADE80]" : "text-[#E6EDF3]"
                  }`}
                >
                  <Avatar initials={member.initials} color={member.color} size={20} />
                  <div className="flex-1 text-left">
                    <div className="font-medium">
                      {member.name}
                      {member.id === currentUser?.id && (
                        <span className="text-[10px] text-[#484F58] ml-1">(me)</span>
                      )}
                    </div>
                    <div className="text-[10px] text-[#484F58]">{member.department}</div>
                  </div>
                  {active && <Check size={14} className="text-[#4ADE80]" />}
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ── Call Assignment Dropdown ──────────────────────────
