// src/components/ConversationDetail/CallTimelineEntry.tsx
//
// Renders one Quo call as an entry in the conversation Messages timeline,
// interleaved chronologically with email messages.
//
// Shows: direction badge (in/out), status pill, participant phone, duration,
// timestamp, optional voicemail/AI summary expandable blocks, and action
// buttons (Call back, Draft follow-up email, Toggle follow-up tracking).

"use client";

import { useState } from "react";
import {
  Phone, PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail,
  Sparkles, ChevronDown, ChevronUp, Mail, BellRing, BellOff,
  PlayCircle, Loader2, Check,
} from "lucide-react";
import QuoCallButton from "@/components/QuoCallButton";

type CallEntry = {
  id: string;
  quo_call_id: string;
  direction: "inbound" | "outbound";
  status: string;
  outcome: string | null;
  participant_phone: string | null;
  workspace_phone: string | null;
  duration_seconds: number | null;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  recording_url: string | null;
  voicemail_url: string | null;
  voicemail_transcript: string | null;
  ai_summary: string | null;
  ai_next_steps: string[] | null;
  supplier_contact_id: string | null;
  supplier_contact_person_id: string | null;
  team_member_id: string | null;
  attributed_team_member_id?: string | null;
  line_type?: "private" | "shared" | "unknown" | null;
  is_stub?: boolean;
  created_at?: string | null;
  // Optional hydrated lookups (computed at fetch time in ConversationDetail)
  supplier_name?: string | null;
  person_name?: string | null;
  team_member_name?: string | null;
  attributed_team_member_name?: string | null;
  line_display_name?: string | null;
  email_account_name?: string | null;
  email_account_icon?: string | null;
  email_account_color?: string | null;
};

function formatDuration(sec: number | null): string {
  if (!sec || sec < 0) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function statusColor(status: string, outcome: string | null): { color: string; label: string; Icon: any } {
  // Voicemail wins regardless of status
  if (outcome === "voicemail" || status === "voicemail") {
    return { color: "var(--warning)", label: "Voicemail", Icon: Voicemail };
  }
  if (outcome === "no_answer" || status === "no_answer" || status === "missed") {
    return { color: "var(--danger)", label: "No answer", Icon: PhoneMissed };
  }
  if (outcome === "declined" || status === "busy") {
    return { color: "var(--danger)", label: "Declined", Icon: PhoneMissed };
  }
  if (status === "ringing" || status === "in_progress") {
    return { color: "var(--highlight)", label: "Ringing", Icon: Phone };
  }
  // Default: completed / answered
  return { color: "var(--accent)", label: "Answered", Icon: Phone };
}

export default function CallTimelineEntry({
  call,
  onDraft,
  onToggleFollowUp,
  hasFollowUp,
}: {
  call: CallEntry;
  onDraft?: (callId: string) => Promise<void> | void;
  onToggleFollowUp?: (callId: string, enable: boolean) => Promise<void> | void;
  hasFollowUp?: boolean;
}) {
  const [expandedVoicemail, setExpandedVoicemail] = useState(false);
  const [expandedSummary, setExpandedSummary] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [toggling, setToggling] = useState(false);

  const { color, label, Icon } = statusColor(call.status, call.outcome);
  const isInbound = call.direction === "inbound";
  const DirIcon = isInbound ? PhoneIncoming : PhoneOutgoing;

  const handleDraft = async () => {
    if (!onDraft) return;
    setDrafting(true);
    try {
      await onDraft(call.id);
    } finally {
      setDrafting(false);
    }
  };

  const handleToggleFollowUp = async () => {
    if (!onToggleFollowUp) return;
    setToggling(true);
    try {
      await onToggleFollowUp(call.id, !hasFollowUp);
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="my-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
          style={{
            background: `color-mix(in srgb, ${color} 14%, transparent)`,
            color,
          }}
        >
          <Icon size={16} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-semibold" style={{ color }}>
              {label}
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
              <DirIcon size={11} />
              {isInbound ? "Inbound" : "Outbound"} call
            </span>
            {call.duration_seconds !== null && call.duration_seconds > 0 && (
              <span className="text-[11px] text-[var(--text-secondary)]">· {formatDuration(call.duration_seconds)}</span>
            )}
          </div>

          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-[var(--text-secondary)] flex-wrap">
            {call.person_name && (
              <span className="text-[var(--text-primary)] font-medium">{call.person_name}</span>
            )}
            {call.person_name && call.supplier_name && (
              <span className="text-[var(--text-muted)]">·</span>
            )}
            {call.supplier_name && !call.person_name && (
              <span className="text-[var(--text-primary)] font-medium">{call.supplier_name}</span>
            )}
            {call.participant_phone && (
              <>
                <span className="font-mono">{call.participant_phone}</span>
                <QuoCallButton phone={call.participant_phone} name={call.person_name || undefined} size={10} />
              </>
            )}
            <span className="text-[var(--text-muted)]">·</span>
            <span title={call.started_at || undefined} className="font-mono text-[10px]">
              {formatTimestamp(call.started_at)}
            </span>
            {(call.attributed_team_member_name || call.team_member_name) && (
              <>
                <span className="text-[var(--text-muted)]">·</span>
                <span className="text-[10px]">
                  by {call.attributed_team_member_name || call.team_member_name}
                  {call.attributed_team_member_name &&
                    call.team_member_name &&
                    call.attributed_team_member_name !== call.team_member_name && (
                      <span className="text-[var(--text-muted)]"> (ans. {call.team_member_name})</span>
                    )}
                </span>
              </>
            )}
            {/* Email-account / line-group chip — for shared lines linked to a brand */}
            {call.email_account_name && (
              <>
                <span className="text-[var(--text-muted)]">·</span>
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                  style={{
                    background: `color-mix(in srgb, ${call.email_account_color || "var(--text-muted)"} 14%, transparent)`,
                    color: call.email_account_color || "var(--text-secondary)",
                  }}
                  title={`Line: ${call.line_display_name || ""}`}
                >
                  {call.email_account_icon && <span>{call.email_account_icon}</span>}
                  {call.email_account_name}
                </span>
              </>
            )}
            {/* Private-line indicator (no email account but classified as private) */}
            {!call.email_account_name && call.line_type === "private" && call.line_display_name && (
              <>
                <span className="text-[var(--text-muted)]">·</span>
                <span
                  className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-muted)]"
                  title={`Private line: ${call.line_display_name}`}
                >
                  Direct
                </span>
              </>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 shrink-0">
          {onToggleFollowUp && (
            <button
              onClick={handleToggleFollowUp}
              disabled={toggling}
              title={hasFollowUp ? "Cancel follow-up reminder" : "Track follow-up (redial reminder)"}
              className={`p-1.5 rounded-md transition-colors ${
                hasFollowUp
                  ? "text-[var(--highlight)] bg-[var(--highlight)]/10"
                  : "text-[var(--text-muted)] hover:text-[var(--highlight)] hover:bg-[var(--border)]"
              } disabled:opacity-50`}
            >
              {toggling ? (
                <Loader2 size={13} className="animate-spin" />
              ) : hasFollowUp ? (
                <BellRing size={13} />
              ) : (
                <BellOff size={13} />
              )}
            </button>
          )}
          {onDraft && (
            <button
              onClick={handleDraft}
              disabled={drafting}
              title="Draft a follow-up email from this call"
              className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--info)] hover:bg-[var(--border)] transition-colors disabled:opacity-50"
            >
              {drafting ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* Expandable blocks */}
      {call.voicemail_transcript && (
        <div className="border-t border-[var(--border)] bg-[var(--bg)]">
          <button
            onClick={() => setExpandedVoicemail(!expandedVoicemail)}
            className="w-full flex items-center justify-between gap-2 px-4 py-2 text-[11px] font-semibold text-[var(--warning)] hover:bg-[var(--surface)]"
          >
            <span className="flex items-center gap-2">
              <Voicemail size={12} />
              Voicemail transcript
            </span>
            {expandedVoicemail ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {expandedVoicemail && (
            <div className="px-4 pb-3 text-[12px] text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
              {call.voicemail_transcript}
              {call.voicemail_url && (
                <a
                  href={call.voicemail_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--info)] hover:underline"
                >
                  <PlayCircle size={12} /> Listen
                </a>
              )}
            </div>
          )}
        </div>
      )}

      {call.ai_summary && (
        <div className="border-t border-[var(--border)] bg-[var(--bg)]">
          <button
            onClick={() => setExpandedSummary(!expandedSummary)}
            className="w-full flex items-center justify-between gap-2 px-4 py-2 text-[11px] font-semibold text-[var(--accent)] hover:bg-[var(--surface)]"
          >
            <span className="flex items-center gap-2">
              <Sparkles size={12} />
              AI summary
              {call.ai_next_steps && call.ai_next_steps.length > 0 && (
                <span className="text-[10px] font-normal text-[var(--text-muted)]">
                  ({call.ai_next_steps.length} next step{call.ai_next_steps.length === 1 ? "" : "s"})
                </span>
              )}
            </span>
            {expandedSummary ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {expandedSummary && (
            <div className="px-4 pb-3 space-y-2">
              <div className="text-[12px] text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
                {call.ai_summary}
              </div>
              {call.ai_next_steps && call.ai_next_steps.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                    Next steps
                  </div>
                  <ul className="text-[12px] text-[var(--text-secondary)] space-y-0.5 list-disc list-inside">
                    {call.ai_next_steps.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Recording link without transcript */}
      {call.recording_url && !call.voicemail_transcript && (
        <div className="border-t border-[var(--border)] bg-[var(--bg)] px-4 py-2">
          <a
            href={call.recording_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[11px] text-[var(--info)] hover:underline"
          >
            <PlayCircle size={12} /> Listen to recording
          </a>
        </div>
      )}
    </div>
  );
}

export type { CallEntry };