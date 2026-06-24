"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Circle, RotateCcw } from "lucide-react";
import type { Folder, TeamMember } from "@/types";

// ────────────────────────────────────────────────────────────────────
// StatusDropdown
//
// Shows the conversation's current status (Open / Closed) and lets the
// assignee close it (or reopen it).
//
// Closing requires picking a target folder from the conversation's email
// account. Optional note can be attached. The actual close work is done
// by POST /api/conversations/close.
//
// Reopening just calls /api/conversations/status to flip status to "open".
// ────────────────────────────────────────────────────────────────────

export default function StatusDropdown({
  conversationId,
  currentStatus,
  currentAssigneeId,
  emailAccountId,
  currentUser,
  folders,
  onClosed,
  onReopened,
}: {
  conversationId: string;
  currentStatus: string | null;
  currentAssigneeId: string | null;
  emailAccountId: string | null;
  currentUser: TeamMember | null;
  folders: Folder[];
  onClosed?: () => void;
  onReopened?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const isClosed = currentStatus === "closed";
  const isAssignedToCurrentUser =
    currentUser?.id != null && currentUser.id === currentAssigneeId;
  const isAdmin = currentUser?.role === "admin";
  // The assignee may close their own conversation; admins may close ANY
  // conversation (even unassigned or assigned to someone else). Anyone may
  // reopen a closed convo.
  const canClose = (isAssignedToCurrentUser || isAdmin) && !isClosed;
  const canReopen = isClosed;

  // One-click close. No folder picker, no note — closing sets status=closed,
  // keeps the assignee and folder label, and the conversation moves to its
  // folder's "Closed" sub-view. A supplier reply reopens it.
  const handleClose = async () => {
    if (!currentUser?.id) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/conversations/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          actor_id: currentUser.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert("Close failed: " + (err.error || "Unknown error"));
        return;
      }
      setOpen(false);
      if (onClosed) onClosed();
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    if (!currentUser?.id) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          status: "open",
          actor_id: currentUser.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert("Reopen failed: " + (err.error || "Unknown error"));
        return;
      }
      setOpen(false);
      if (onReopened) onReopened();
    } finally {
      setSubmitting(false);
    }
  };

  // The pill button styling matches AssignDropdown / CallAssignment.
  // Color cues: green for Open, gray for Closed.
  const statusColor = isClosed ? "#7D8590" : "#4ADE80";
  const statusLabel = isClosed ? "Closed" : "Open";

  return (
    <>
      <div className="relative" ref={ref}>
        <button
          onClick={() => setOpen((v) => !v)}
          disabled={submitting}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-medium hover:bg-[var(--surface-2)] transition-all"
          title={isClosed ? "Conversation is closed" : "Conversation is open"}
        >
          <Circle size={10} fill={statusColor} stroke={statusColor} />
          <span style={{ color: statusColor }}>{statusLabel}</span>
          <ChevronDown size={12} className="text-[var(--text-muted)]" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shadow-2xl shadow-black/40 py-1">
            <div className="px-3 py-2 border-b border-[var(--border)]">
              <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                Conversation status
              </div>
            </div>

            {/* Open option (current state when not closed) */}
            <div
              className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] ${
                !isClosed ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
              }`}
            >
              <Circle size={12} fill="#4ADE80" stroke="#4ADE80" />
              <span className="flex-1">Open</span>
              {!isClosed && <Check size={14} className="text-[var(--accent)]" />}
            </div>

            {/* Close option — one click, no modal */}
            {canClose && (
              <button
                onClick={handleClose}
                disabled={submitting}
                className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] text-left disabled:opacity-50"
              >
                <Circle size={12} fill="#7D8590" stroke="#7D8590" />
                <span className="flex-1">{submitting ? "Closing…" : "Close"}</span>
              </button>
            )}

            {/* Disabled close hint when not the assignee */}
            {!canClose && !isClosed && (
              <div
                title={
                  isAssignedToCurrentUser
                    ? ""
                    : "Only the assignee can close this conversation"
                }
                className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--text-muted)] cursor-not-allowed"
              >
                <Circle size={12} fill="#7D8590" stroke="#7D8590" />
                <span className="flex-1">Close…</span>
              </div>
            )}

            {/* Reopen option */}
            {canReopen && (
              <button
                onClick={handleReopen}
                className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--accent)] hover:bg-[var(--surface-hover)] text-left"
              >
                <RotateCcw size={12} />
                <span className="flex-1">Reopen</span>
              </button>
            )}
          </div>
        )}
      </div>

    </>
  );
}