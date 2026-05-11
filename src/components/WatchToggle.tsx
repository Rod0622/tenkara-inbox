"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, BellOff, Eye, EyeOff, X } from "lucide-react";

interface WatcherRow {
  conversation_id: string;
  user_id: string;
  watched_at: string;
  watch_source: string;
  notify_on_new_message: boolean;
  notify_on_status_change: boolean;
  notify_on_assignee_change: boolean;
  notify_on_label_change: boolean;
  notify_on_comment: boolean;
}

interface WatchToggleProps {
  conversationId: string;
  userId: string;
  // Optional callback when watch state changes (parent can refresh)
  onChange?: (isWatching: boolean) => void;
  // Variant: header button (default) or menu item
  variant?: "header" | "menu";
}

const DEFAULT_PREFS = {
  notify_on_new_message: true,
  notify_on_status_change: true,
  notify_on_assignee_change: true,
  notify_on_label_change: false,
  notify_on_comment: false,
};

export default function WatchToggle({ conversationId, userId, onChange, variant = "header" }: WatchToggleProps) {
  const [watcher, setWatcher] = useState<WatcherRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  // Start-watching popup (Q4 β: choose settings up front)
  const [startPopupOpen, setStartPopupOpen] = useState(false);
  const [startPrefs, setStartPrefs] = useState({ ...DEFAULT_PREFS });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const isWatching = !!watcher;

  const fetchWatcher = async () => {
    try {
      const res = await fetch(`/api/conversations/watchers?conversation_id=${conversationId}&user_id=${userId}`);
      if (!res.ok) return;
      const data = await res.json();
      setWatcher(data.watcher || null);
    } catch (_e) {}
  };

  useEffect(() => {
    fetchWatcher();
  }, [conversationId, userId]);

  const startWatching = async (prefs: typeof DEFAULT_PREFS) => {
    setLoading(true);
    try {
      const res = await fetch("/api/conversations/watchers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          user_id: userId,
          watch_source: "manual",
          ...prefs,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setWatcher(data.watcher);
        onChange?.(true);
      }
    } finally {
      setLoading(false);
      setStartPopupOpen(false);
    }
  };

  const stopWatching = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/conversations/watchers?conversation_id=${conversationId}&user_id=${userId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setWatcher(null);
        onChange?.(false);
      }
    } finally {
      setLoading(false);
      setPopoverOpen(false);
    }
  };

  const updatePrefs = async (next: Partial<typeof DEFAULT_PREFS>) => {
    if (!watcher) return;
    const updated = { ...watcher, ...next };
    setWatcher(updated);
    try {
      await fetch("/api/conversations/watchers", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          user_id: userId,
          ...next,
        }),
      });
    } catch (_e) { /* keep optimistic */ }
  };

  const handleClick = () => {
    if (isWatching) {
      // Open the watcher-management popover (which has stop + settings)
      setPopoverOpen(!popoverOpen);
    } else {
      // Open the start-watching popup (Q4 β: ask settings up front)
      setStartPrefs({ ...DEFAULT_PREFS });
      setStartPopupOpen(true);
    }
  };

  // Menu variant — designed for inclusion in a dropdown / context menu
  if (variant === "menu") {
    return (
      <>
        <button
          onClick={handleClick}
          disabled={loading}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#9CA3AF] hover:bg-[#12161B] hover:text-[#E6EDF3] disabled:opacity-50"
        >
          {isWatching ? <EyeOff size={12} /> : <Eye size={12} />}
          {isWatching ? "Stop watching" : "Watch"}
        </button>
        {startPopupOpen && (
          <StartWatchingPopup
            prefs={startPrefs}
            setPrefs={setStartPrefs}
            onConfirm={() => startWatching(startPrefs)}
            onCancel={() => setStartPopupOpen(false)}
            loading={loading}
          />
        )}
      </>
    );
  }

  // Header variant — eye button
  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        disabled={loading}
        title={isWatching ? "You're watching this conversation" : "Watch this conversation"}
        className={`p-1.5 rounded-md transition-colors disabled:opacity-50 ${
          isWatching
            ? "text-[#58A6FF] hover:bg-[#1F2937]"
            : "text-[#7D8590] hover:bg-[#12161B] hover:text-[#E6EDF3]"
        }`}
      >
        {isWatching ? <Bell size={16} /> : <BellOff size={16} className="opacity-60" />}
      </button>

      {/* Watching-management popover */}
      {popoverOpen && watcher && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setPopoverOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-[280px] bg-[#0F1318] border border-[#1E242C] rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1E242C]">
              <span className="text-xs font-bold text-[#E6EDF3]">Watching this conversation</span>
              <button onClick={() => setPopoverOpen(false)} className="text-[#7D8590] hover:text-[#E6EDF3]">
                <X size={14} />
              </button>
            </div>
            <div className="p-3 space-y-2">
              <div className="text-[10px] text-[#7D8590] uppercase tracking-wider mb-1">Notify me about</div>
              <PrefToggle label="New messages" value={watcher.notify_on_new_message} onChange={(v) => updatePrefs({ notify_on_new_message: v })} />
              <PrefToggle label="Status changes (closed/reopened)" value={watcher.notify_on_status_change} onChange={(v) => updatePrefs({ notify_on_status_change: v })} />
              <PrefToggle label="Assignee changes" value={watcher.notify_on_assignee_change} onChange={(v) => updatePrefs({ notify_on_assignee_change: v })} />
              <PrefToggle label="Label changes" value={watcher.notify_on_label_change} onChange={(v) => updatePrefs({ notify_on_label_change: v })} />
              <PrefToggle label="Notes & comments" value={watcher.notify_on_comment} onChange={(v) => updatePrefs({ notify_on_comment: v })} />
              <button
                onClick={stopWatching}
                disabled={loading}
                className="w-full mt-3 px-2 py-1.5 rounded-md bg-[#1F1414] border border-[#5C2828] text-[11px] text-[#FCA5A5] hover:bg-[#2A1A1A] disabled:opacity-50"
              >
                Stop watching
              </button>
            </div>
          </div>
        </>
      )}

      {/* Start-watching popup (when first clicking Watch) */}
      {startPopupOpen && (
        <StartWatchingPopup
          prefs={startPrefs}
          setPrefs={setStartPrefs}
          onConfirm={() => startWatching(startPrefs)}
          onCancel={() => setStartPopupOpen(false)}
          loading={loading}
        />
      )}
    </>
  );
}

function PrefToggle({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between px-2 py-1.5 rounded bg-[#12161B] cursor-pointer">
      <span className="text-[11px] text-[#E6EDF3]">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="cursor-pointer"
      />
    </label>
  );
}

function StartWatchingPopup({
  prefs,
  setPrefs,
  onConfirm,
  onCancel,
  loading,
}: {
  prefs: typeof DEFAULT_PREFS;
  setPrefs: (p: typeof DEFAULT_PREFS) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const update = (key: keyof typeof DEFAULT_PREFS) => (v: boolean) => setPrefs({ ...prefs, [key]: v });
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onCancel} />
      <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[360px] z-50 bg-[#0F1318] border border-[#1E242C] rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E242C]">
          <span className="text-sm font-bold text-[#E6EDF3]">Watch this conversation</span>
          <button onClick={onCancel} className="text-[#7D8590] hover:text-[#E6EDF3]">
            <X size={14} />
          </button>
        </div>
        <div className="p-4 space-y-2">
          <div className="text-[11px] text-[#7D8590] mb-2">
            Choose what events you want to be notified about for this conversation. You can change these later.
          </div>
          <PrefToggle label="New messages" value={prefs.notify_on_new_message} onChange={update("notify_on_new_message")} />
          <PrefToggle label="Status changes (closed/reopened)" value={prefs.notify_on_status_change} onChange={update("notify_on_status_change")} />
          <PrefToggle label="Assignee changes" value={prefs.notify_on_assignee_change} onChange={update("notify_on_assignee_change")} />
          <PrefToggle label="Label changes" value={prefs.notify_on_label_change} onChange={update("notify_on_label_change")} />
          <PrefToggle label="Notes & comments" value={prefs.notify_on_comment} onChange={update("notify_on_comment")} />
        </div>
        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 px-3 py-2 rounded-md bg-[#4ADE80] text-[#0B0E11] text-xs font-bold hover:bg-[#3fc671] disabled:opacity-50"
          >
            Start watching
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 px-3 py-2 rounded-md bg-[#1E242C] text-[#9CA3AF] text-xs hover:bg-[#252C36]"
          >
            Cancel
          </button>
        </div>
      </div>
    </>
  );
}