"use client";

import { useEffect, useState } from "react";
import { Calendar, Plus, Trash2, X } from "lucide-react";

interface OOOPeriod {
  id: string;
  user_id: string;
  start_date: string;
  end_date: string | null;
  is_active_indefinite: boolean;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

interface UserOOOPopoverProps {
  // The user whose OOO is being viewed/edited
  targetUserId: string;
  targetUserName: string;
  // The user performing the action (for permission checks server-side)
  actorId: string;
  // Whether the actor can edit (i.e., target is themselves OR they're admin)
  canEdit: boolean;
  // Anchor positioning — popover renders fixed; parent passes coords
  anchorTop?: number;
  anchorLeft?: number;
  // Close handler
  onClose: () => void;
  // Called when OOO data changes so parent can refresh
  onChange?: () => void;
}

export default function UserOOOPopover({
  targetUserId,
  targetUserName,
  actorId,
  canEdit,
  anchorTop,
  anchorLeft,
  onClose,
  onChange,
}: UserOOOPopoverProps) {
  const [periods, setPeriods] = useState<OOOPeriod[]>([]);
  const [isCurrentlyOOO, setIsCurrentlyOOO] = useState(false);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newNote, setNewNote] = useState("");

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/team/ooo?user_id=${targetUserId}`);
      const data = await res.json();
      setPeriods(data.periods || []);
      setIsCurrentlyOOO(!!data.is_currently_ooo);
    } catch (err) {
      console.error("Failed to fetch OOO:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [targetUserId]);

  // Find the indefinite "active right now" row, if any
  const indefinitePeriod = periods.find((p) => p.is_active_indefinite);

  const toggleIndefinite = async (next: boolean) => {
    if (!canEdit) return;
    if (next) {
      // Create new indefinite OOO
      await fetch("/api/team/ooo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetUserId,
          is_active_indefinite: true,
          created_by: actorId,
        }),
      });
    } else {
      // Delete the indefinite row
      if (indefinitePeriod) {
        await fetch(`/api/team/ooo?id=${indefinitePeriod.id}&actor_id=${actorId}`, {
          method: "DELETE",
        });
      }
    }
    await fetchData();
    onChange?.();
  };

  const addScheduledPeriod = async () => {
    if (!canEdit || !newStart) return;
    await fetch("/api/team/ooo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: targetUserId,
        start_date: newStart,
        end_date: newEnd || null,
        is_active_indefinite: false,
        note: newNote || null,
        created_by: actorId,
      }),
    });
    setNewStart("");
    setNewEnd("");
    setNewNote("");
    setAdding(false);
    await fetchData();
    onChange?.();
  };

  const deletePeriod = async (id: string) => {
    if (!canEdit) return;
    if (!confirm("Remove this OOO period?")) return;
    await fetch(`/api/team/ooo?id=${id}&actor_id=${actorId}`, { method: "DELETE" });
    await fetchData();
    onChange?.();
  };

  // Position styles — if anchor passed, use absolute positioning above the anchor
  const popoverStyle: React.CSSProperties = anchorTop !== undefined && anchorLeft !== undefined
    ? { position: "fixed", bottom: `calc(100vh - ${anchorTop}px + 8px)`, left: anchorLeft, width: 320, zIndex: 60 }
    : { position: "fixed", bottom: 60, left: 8, width: 320, zIndex: 60 };

  const scheduledPeriods = periods.filter((p) => !p.is_active_indefinite);

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      <div
        style={popoverStyle}
        className="bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[500px]"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
          <span className="text-xs font-bold text-[var(--text-primary)]">
            {canEdit ? "Out of Office" : `${targetUserName}'s status`}
          </span>
          <button onClick={onClose} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {loading ? (
            <div className="text-center py-4 text-[var(--text-muted)] text-xs">Loading...</div>
          ) : (
            <>
              {/* Current status */}
              <div className="flex items-center gap-2 px-2 py-2 bg-[var(--surface)] rounded-lg">
                <span
                  className={`w-2 h-2 rounded-full ${isCurrentlyOOO ? "bg-[#FCA5A5]" : "bg-[var(--accent)]"}`}
                />
                <span className="text-[11px] text-[var(--text-primary)] font-semibold">
                  {isCurrentlyOOO ? "Currently OOO" : "Active"}
                </span>
              </div>

              {/* Indefinite toggle */}
              {canEdit && (
                <label className="flex items-center justify-between px-2 py-2 bg-[var(--surface)] rounded-lg cursor-pointer">
                  <span className="text-[11px] text-[var(--text-primary)]">I'm currently OOO (until cleared)</span>
                  <input
                    type="checkbox"
                    checked={!!indefinitePeriod}
                    onChange={(e) => toggleIndefinite(e.target.checked)}
                    className="cursor-pointer"
                  />
                </label>
              )}

              {/* Scheduled periods */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Scheduled OOO</span>
                  {canEdit && !adding && (
                    <button
                      onClick={() => setAdding(true)}
                      className="text-[10px] text-[var(--info)] hover:text-[var(--info)] flex items-center gap-1"
                    >
                      <Plus size={10} /> Add
                    </button>
                  )}
                </div>

                {scheduledPeriods.length === 0 && !adding ? (
                  <div className="text-[11px] text-[var(--text-muted)] py-2">No scheduled OOO periods</div>
                ) : (
                  <div className="space-y-2">
                    {scheduledPeriods.map((p) => {
                      const start = new Date(p.start_date);
                      const end = p.end_date ? new Date(p.end_date) : null;
                      const now = new Date();
                      const isActive = start <= now && (!end || end >= now);
                      return (
                        <div
                          key={p.id}
                          className={`px-2 py-2 rounded-md border text-[11px] ${
                            isActive ? "border-[#5C2828] bg-[#1F1414] text-[#FCA5A5]" : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-1 flex-1 min-w-0">
                              <Calendar size={10} className="shrink-0" />
                              <span className="truncate">
                                {start.toLocaleDateString()}
                                {end ? ` → ${end.toLocaleDateString()}` : " → indefinite"}
                              </span>
                            </div>
                            {canEdit && (
                              <button
                                onClick={() => deletePeriod(p.id)}
                                className="text-[var(--text-secondary)] hover:text-[var(--danger)] shrink-0"
                                title="Remove"
                              >
                                <Trash2 size={11} />
                              </button>
                            )}
                          </div>
                          {p.note && <div className="mt-1 text-[var(--text-secondary)] truncate">{p.note}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {adding && canEdit && (
                  <div className="mt-2 space-y-1.5 p-2 bg-[var(--surface)] rounded-lg border border-[var(--border)]">
                    <div>
                      <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Start date</label>
                      <input
                        type="date"
                        value={newStart}
                        onChange={(e) => setNewStart(e.target.value)}
                        className="w-full px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">End date (blank = indefinite)</label>
                      <input
                        type="date"
                        value={newEnd}
                        onChange={(e) => setNewEnd(e.target.value)}
                        className="w-full px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">Note (optional)</label>
                      <input
                        type="text"
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder="e.g. annual leave"
                        className="w-full px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={addScheduledPeriod}
                        disabled={!newStart}
                        className="flex-1 px-2 py-1 rounded bg-[var(--accent)] text-[var(--bg)] text-[10px] font-bold hover:bg-[var(--accent-strong)] disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => {
                          setAdding(false);
                          setNewStart("");
                          setNewEnd("");
                          setNewNote("");
                        }}
                        className="flex-1 px-2 py-1 rounded bg-[var(--border)] text-[var(--text-secondary)] text-[10px] hover:bg-[var(--border-strong)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}