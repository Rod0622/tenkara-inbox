"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import UserOOOPopover from "./UserOOOPopover";
import type { TeamMember } from "@/types";

interface TeamMemberWithStatus extends TeamMember {
  is_currently_ooo?: boolean;
  ooo_end_date?: string | null;
  ooo_note?: string | null;
}

export default function SidebarTeamList({
  currentUser,
}: {
  currentUser: TeamMember | null;
}) {
  const [members, setMembers] = useState<TeamMemberWithStatus[]>([]);
  const [open, setOpen] = useState(false);
  const [popoverFor, setPopoverFor] = useState<TeamMemberWithStatus | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ top: number; left: number } | null>(null);
  const buttonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const fetchMembers = async () => {
    try {
      const res = await fetch("/api/team/ooo");
      if (!res.ok) return;
      const data = await res.json();
      setMembers(data.members || []);
    } catch (err) {
      console.error("Failed to fetch team:", err);
    }
  };

  useEffect(() => {
    fetchMembers();
    // Refresh team OOO status every 60s
    const id = setInterval(fetchMembers, 60000);
    return () => clearInterval(id);
  }, []);

  const handleMemberClick = (member: TeamMemberWithStatus) => {
    const btn = buttonRefs.current.get(member.id);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      setPopoverAnchor({ top: rect.top, left: rect.right + 8 });
    }
    setPopoverFor(member);
  };

  const isAdmin = currentUser?.role === "admin";

  // Sort: OOO members first (so they're more visible), then alphabetically
  const sortedMembers = [...members].sort((a, b) => {
    if (a.is_currently_ooo && !b.is_currently_ooo) return -1;
    if (!a.is_currently_ooo && b.is_currently_ooo) return 1;
    return (a.name || "").localeCompare(b.name || "");
  });

  const oooCount = members.filter((m) => m.is_currently_ooo).length;
  const activeCount = members.length - oooCount;

  return (
    <div className="px-2 pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-2.5 pb-1 flex items-center gap-1.5 text-[10px] font-bold text-[#484F58] uppercase tracking-widest hover:text-[#7D8590] transition-colors"
      >
        <Users size={10} />
        <span>Team</span>
        <span className="text-[#7D8590] normal-case font-normal tracking-normal ml-1">
          ({activeCount} active{oooCount > 0 ? `, ${oooCount} OOO` : ""})
        </span>
        <ChevronDown size={10} className={`ml-auto transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="space-y-0.5 mt-1">
          {sortedMembers.map((m) => {
            const canEdit = isAdmin || m.id === currentUser?.id;
            const isMe = m.id === currentUser?.id;
            return (
              <button
                key={m.id}
                ref={(el) => {
                  if (el) buttonRefs.current.set(m.id, el);
                }}
                onClick={() => handleMemberClick(m)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left hover:bg-[#12161B] transition-colors"
              >
                {/* Avatar */}
                <div className="relative shrink-0">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-[#0B0E11]"
                    style={{ background: m.color }}
                  >
                    {m.initials}
                  </div>
                  {/* Status dot */}
                  <span
                    className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-[#0B0E11] ${
                      m.is_currently_ooo ? "bg-[#FCA5A5]" : "bg-[#4ADE80]"
                    }`}
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-semibold text-[#E6EDF3] truncate">
                      {m.name}
                      {isMe && <span className="text-[#484F58] font-normal"> (you)</span>}
                    </span>
                  </div>
                  <div className="text-[10px] truncate">
                    {m.is_currently_ooo ? (
                      <span className="text-[#FCA5A5]">
                        🌴 OOO{m.ooo_end_date ? ` until ${new Date(m.ooo_end_date).toLocaleDateString()}` : ""}
                      </span>
                    ) : (
                      <span className="text-[#484F58]">{m.department || "—"}</span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {popoverFor && currentUser && (
        <UserOOOPopover
          targetUserId={popoverFor.id}
          targetUserName={popoverFor.name}
          actorId={currentUser.id}
          canEdit={isAdmin || popoverFor.id === currentUser.id}
          anchorTop={popoverAnchor?.top}
          anchorLeft={popoverAnchor?.left}
          onClose={() => {
            setPopoverFor(null);
            setPopoverAnchor(null);
          }}
          onChange={fetchMembers}
        />
      )}
    </div>
  );
}
