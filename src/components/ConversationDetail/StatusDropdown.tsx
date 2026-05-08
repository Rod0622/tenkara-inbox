"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Circle, X, RotateCcw } from "lucide-react";
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
  const [showCloseModal, setShowCloseModal] = useState(false);
  const [targetFolderId, setTargetFolderId] = useState<string>("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Restrict folders to this conversation's email account, hide system folders
  // we shouldn't close TO (Inbox / Trash / Spam are not stage destinations;
  // Sent / Drafts aren't either). What's left: any custom folders + Completed.
  const accountFolders = (folders || []).filter(
    (f: any) => f.email_account_id === emailAccountId
  );
  const closableFolders = accountFolders.filter((f: any) => {
    const name = String(f.name || "").toLowerCase();
    if (!f.is_system) return true; // custom folders always closable
    if (name === "completed") return true; // the dedicated end-state
    return false; // Inbox / Trash / Spam / Sent / Drafts — not close targets
  });

  // Default the target to the account's "Completed" folder
  useEffect(() => {
    if (!showCloseModal) return;
    const completed = closableFolders.find(
      (f: any) => String(f.name || "").toLowerCase() === "completed"
    );
    if (completed?.id) setTargetFolderId(completed.id);
    else if (closableFolders[0]?.id) setTargetFolderId(closableFolders[0].id);
  }, [showCloseModal]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Only the assignee may close. Anyone may reopen a closed convo.
  const canClose = isAssignedToCurrentUser && !isClosed;
  const canReopen = isClosed;

  const handleConfirmClose = async () => {
    if (!targetFolderId || !currentUser?.id) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/conversations/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          target_folder_id: targetFolderId,
          actor_id: currentUser.id,
          note: note.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert("Close failed: " + (err.error || "Unknown error"));
        return;
      }
      setShowCloseModal(false);
      setNote("");
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
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[12px] font-medium hover:bg-[#181D24] transition-all"
          title={isClosed ? "Conversation is closed" : "Conversation is open"}
        >
          <Circle size={10} fill={statusColor} stroke={statusColor} />
          <span style={{ color: statusColor }}>{statusLabel}</span>
          <ChevronDown size={12} className="text-[#484F58]" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1">
            <div className="px-3 py-2 border-b border-[#1E242C]">
              <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
                Conversation status
              </div>
            </div>

            {/* Open option (current state when not closed) */}
            <div
              className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] ${
                !isClosed ? "text-[#4ADE80]" : "text-[#7D8590]"
              }`}
            >
              <Circle size={12} fill="#4ADE80" stroke="#4ADE80" />
              <span className="flex-1">Open</span>
              {!isClosed && <Check size={14} className="text-[#4ADE80]" />}
            </div>

            {/* Close option */}
            {canClose && (
              <button
                onClick={() => {
                  setOpen(false);
                  setShowCloseModal(true);
                }}
                className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[#E6EDF3] hover:bg-[#1E242C] text-left"
              >
                <Circle size={12} fill="#7D8590" stroke="#7D8590" />
                <span className="flex-1">Close…</span>
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
                className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[#484F58] cursor-not-allowed"
              >
                <Circle size={12} fill="#7D8590" stroke="#7D8590" />
                <span className="flex-1">Close…</span>
              </div>
            )}

            {/* Reopen option */}
            {canReopen && (
              <button
                onClick={handleReopen}
                className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[#4ADE80] hover:bg-[#1E242C] text-left"
              >
                <RotateCcw size={12} />
                <span className="flex-1">Reopen</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Close modal — folder picker + optional note */}
      {showCloseModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => !submitting && setShowCloseModal(false)}
        >
          <div
            className="w-full max-w-md bg-[#161B22] border border-[#1E242C] rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-[#1E242C] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[#E6EDF3]">Close conversation</div>
                <div className="text-[10px] text-[#484F58] mt-0.5">
                  Move to a folder. The conversation will be unassigned and marked closed.
                </div>
              </div>
              <button
                onClick={() => !submitting && setShowCloseModal(false)}
                className="w-7 h-7 rounded-md text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#7D8590] mb-1">
                  Move to folder
                </label>
                <select
                  value={targetFolderId}
                  onChange={(e) => setTargetFolderId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] [color-scheme:dark]"
                >
                  {closableFolders.length === 0 && (
                    <option value="">No folders available</option>
                  )}
                  {closableFolders.map((f: any) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {String(f.name || "").toLowerCase() === "completed"
                        ? " (default)"
                        : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#7D8590] mb-1">
                  Note (optional)
                </label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Why are you closing this? (visible in conversation notes)"
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                />
              </div>
            </div>

            <div className="px-4 pb-4 flex justify-end gap-2">
              <button
                onClick={() => setShowCloseModal(false)}
                disabled={submitting}
                className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-[#7D8590] text-sm hover:bg-[#1E242C] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmClose}
                disabled={submitting || !targetFolderId}
                className="px-4 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-sm font-bold hover:bg-[#5FE890] disabled:opacity-40"
              >
                {submitting ? "Closing…" : "Close conversation"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
