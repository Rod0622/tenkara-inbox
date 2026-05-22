// src/components/calls/CallsList.tsx
//
// Flat list of call rows. Renders CallsListRow for each. Handles click
// dispatch: linked calls → onOpenConversation; orphans → onOpenOrphan.

"use client";

import { PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail as VmIcon, Bell, AlertCircle } from "lucide-react";

interface CallRow {
  id: string;
  conversation_id: string | null;
  direction: "inbound" | "outbound";
  outcome: string | null;
  status: string;
  participant_phone: string | null;
  workspace_phone: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  ai_summary: string | null;
  recording_url: string | null;
  voicemail_url: string | null;
  supplier_name: string | null;
  person_name: string | null;
  team_member_name: string | null;
  team_member_initials: string | null;
  team_member_color: string | null;
  attributed_team_member_name: string | null;
  attributed_team_member_initials: string | null;
  attributed_team_member_color: string | null;
  line_display_name: string | null;
  email_account_name: string | null;
  email_account_icon: string | null;
  email_account_color: string | null;
  has_follow_up: boolean;
}

interface Props {
  calls: CallRow[];
  loading: boolean;
  onOpenConversation: (conversationId: string, callId: string) => void;
  onOpenOrphan: (call: CallRow) => void;
}

function formatDuration(sec: number | null): string {
  if (!sec || sec < 0) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h ago`;
  if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / (60 * 24))}d ago`;
  return d.toLocaleDateString();
}

function outcomeBadge(outcome: string | null, direction: "inbound" | "outbound") {
  if (outcome === "answered") return { label: "Answered", cls: "bg-[var(--accent)]/15 text-[var(--accent)]" };
  if (outcome === "voicemail") return { label: "Voicemail", cls: "bg-[var(--warning)]/15 text-[var(--warning)]" };
  if (outcome === "missed") return { label: "Missed", cls: "bg-[var(--danger)]/15 text-[var(--danger)]" };
  if (outcome === "no_answer") return { label: "No answer", cls: "bg-[var(--text-muted)]/15 text-[var(--text-muted)]" };
  return { label: outcome || "—", cls: "bg-[var(--info)]/15 text-[var(--info)]" };
}

export default function CallsList({ calls, loading, onOpenConversation, onOpenOrphan }: Props) {
  if (loading && calls.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-[12px]">
        Loading calls…
      </div>
    );
  }

  if (calls.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 py-16">
        <div className="w-12 h-12 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center mb-3">
          <PhoneIncoming size={20} className="text-[var(--text-muted)]" />
        </div>
        <div className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">No calls match your filters</div>
        <div className="text-[11px] text-[var(--text-secondary)] max-w-sm">
          Try widening the date range or clearing filters. New calls will appear here as they're received via Quo.
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="divide-y divide-[var(--border)]">
        {calls.map((c) => {
          const isOrphan = !c.conversation_id;
          const badge = outcomeBadge(c.outcome, c.direction);
          const DirIcon = c.direction === "inbound"
            ? (c.outcome === "missed" ? PhoneMissed : PhoneIncoming)
            : PhoneOutgoing;
          const attributedName = c.attributed_team_member_name || c.team_member_name;
          const attributedColor = c.attributed_team_member_color || c.team_member_color;
          const attributedInitials = c.attributed_team_member_initials || c.team_member_initials;

          return (
            <button
              key={c.id}
              onClick={() => {
                if (isOrphan) onOpenOrphan(c);
                else onOpenConversation(c.conversation_id!, c.id);
              }}
              className="w-full text-left px-5 py-3 hover:bg-[var(--surface)] transition-colors flex items-center gap-3"
            >
              {/* Direction icon */}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                c.outcome === "missed" ? "bg-[var(--danger)]/10 text-[var(--danger)]" :
                c.direction === "inbound" ? "bg-[var(--info)]/10 text-[var(--info)]" :
                "bg-[var(--accent)]/10 text-[var(--accent)]"
              }`}>
                <DirIcon size={14} />
              </div>

              {/* Main content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                    {c.supplier_name || c.person_name || (
                      <span className="italic text-[var(--text-muted)] font-normal">Unknown caller</span>
                    )}
                  </span>
                  {isOrphan && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--warning)]/15 text-[var(--warning)]">
                      <AlertCircle size={9} />
                      Orphan
                    </span>
                  )}
                  {c.has_follow_up && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--info)]/15 text-[var(--info)]">
                      <Bell size={9} />
                      Follow-up
                    </span>
                  )}
                  {c.email_account_name && (
                    <span
                      className="inline-flex items-center gap-1 text-[9px] font-semibold px-1.5 py-0.5 rounded"
                      style={{
                        background: `color-mix(in srgb, ${c.email_account_color || "var(--text-muted)"} 14%, transparent)`,
                        color: c.email_account_color || "var(--text-secondary)",
                      }}
                      title={c.line_display_name || ""}
                    >
                      {c.email_account_icon && <span>{c.email_account_icon}</span>}
                      {c.email_account_name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)]">
                  {c.person_name && c.supplier_name && (
                    <>
                      <span className="truncate">{c.person_name}</span>
                      <span className="text-[var(--text-muted)]">·</span>
                    </>
                  )}
                  <span className="font-mono">{c.participant_phone || "—"}</span>
                  <span className="text-[var(--text-muted)]">·</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${badge.cls}`}>
                    {badge.label}
                  </span>
                  {c.duration_seconds !== null && (
                    <>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span>{formatDuration(c.duration_seconds)}</span>
                    </>
                  )}
                  {(c.voicemail_url || c.recording_url) && (
                    <>
                      <span className="text-[var(--text-muted)]">·</span>
                      <VmIcon size={10} className="text-[var(--warning)]" />
                    </>
                  )}
                </div>
                {c.ai_summary && (
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5 line-clamp-1 italic">
                    {c.ai_summary}
                  </div>
                )}
              </div>

              {/* Right side: attribution + time */}
              <div className="flex flex-col items-end gap-1 shrink-0 text-right">
                <span className="text-[10px] text-[var(--text-muted)] font-mono whitespace-nowrap">
                  {formatTimestamp(c.started_at)}
                </span>
                {attributedName && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-[var(--text-secondary)]">{attributedName}</span>
                    <span
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-[var(--bg)]"
                      style={{ background: attributedColor || "var(--text-muted)" }}
                    >
                      {attributedInitials}
                    </span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
