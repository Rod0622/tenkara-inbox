// src/components/calls/OrphanCallPanel.tsx
//
// Right-side panel that opens when a user clicks an orphan call (one without
// a conversation_id). Shows: phone, line, who answered, duration, voicemail
// transcript, AI summary, recording link, and a hint that they can manually
// link it to a supplier from the existing call's link endpoint (not exposed
// in this panel for v1 — left for a future batch).

"use client";

import { X, Phone, PhoneIncoming, PhoneOutgoing, Voicemail, Sparkles, ExternalLink } from "lucide-react";

interface OrphanCall {
  id: string;
  direction: "inbound" | "outbound";
  outcome: string | null;
  status: string;
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
  team_member_name: string | null;
  team_member_color: string | null;
  attributed_team_member_name: string | null;
  attributed_team_member_color: string | null;
  line_display_name: string | null;
  email_account_name: string | null;
  email_account_icon: string | null;
  email_account_color: string | null;
}

interface Props {
  call: OrphanCall | null;
  onClose: () => void;
}

function formatDuration(sec: number | null): string {
  if (!sec || sec < 0) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

function formatFullTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString();
}

export default function OrphanCallPanel({ call, onClose }: Props) {
  if (!call) return null;
  const DirIcon = call.direction === "inbound" ? PhoneIncoming : PhoneOutgoing;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-md h-full bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[var(--surface)] border-b border-[var(--border)] px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone size={14} className="text-[var(--accent)]" />
            <h2 className="text-[13px] font-bold text-[var(--text-primary)]">Orphan call</h2>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-5">
          {/* Top summary */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center shrink-0">
              <DirIcon size={16} className={call.direction === "inbound" ? "text-[var(--info)]" : "text-[var(--accent)]"} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[14px] font-bold text-[var(--text-primary)] font-mono">
                {call.participant_phone || "(unknown number)"}
              </div>
              <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                {call.direction === "inbound" ? "Inbound" : "Outbound"} · {call.outcome || "—"} · {formatDuration(call.duration_seconds)}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                {formatFullTimestamp(call.started_at)}
              </div>
            </div>
          </div>

          <div className="px-3 py-2 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/30 text-[11px] text-[var(--warning)]">
            This call isn't linked to any conversation. The caller's number doesn't match any saved supplier contact. Add the phone to a contact in <strong>Settings → Data Tools</strong> to auto-link future calls from this number.
          </div>

          {/* Line info */}
          {(call.email_account_name || call.line_display_name) && (
            <Section title="Line">
              {call.email_account_name && (
                <div className="flex items-center gap-2 text-[12px] mb-1">
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold"
                    style={{
                      background: `color-mix(in srgb, ${call.email_account_color || "var(--text-muted)"} 14%, transparent)`,
                      color: call.email_account_color || "var(--text-secondary)",
                    }}
                  >
                    {call.email_account_icon && <span>{call.email_account_icon}</span>}
                    {call.email_account_name}
                  </span>
                </div>
              )}
              {call.line_display_name && (
                <div className="text-[11px] text-[var(--text-secondary)] font-mono">{call.line_display_name}</div>
              )}
              {call.workspace_phone && (
                <div className="text-[10px] text-[var(--text-muted)] font-mono mt-0.5">via {call.workspace_phone}</div>
              )}
            </Section>
          )}

          {/* Attribution */}
          {(call.attributed_team_member_name || call.team_member_name) && (
            <Section title="Handled by">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[var(--text-primary)]">
                  {call.attributed_team_member_name || call.team_member_name}
                </span>
                {call.attributed_team_member_name && call.team_member_name &&
                  call.attributed_team_member_name !== call.team_member_name && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      (answered by {call.team_member_name})
                    </span>
                  )}
              </div>
            </Section>
          )}

          {/* AI summary */}
          {call.ai_summary && (
            <Section title="AI summary" icon={<Sparkles size={11} className="text-[var(--highlight)]" />}>
              <div className="text-[12px] text-[var(--text-primary)] leading-relaxed">{call.ai_summary}</div>
              {call.ai_next_steps && call.ai_next_steps.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {call.ai_next_steps.map((step, i) => (
                    <li key={i} className="text-[11px] text-[var(--text-secondary)] flex items-start gap-1.5">
                      <span className="text-[var(--accent)] shrink-0">→</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          {/* Voicemail */}
          {call.voicemail_transcript && (
            <Section title="Voicemail transcript" icon={<Voicemail size={11} className="text-[var(--warning)]" />}>
              <div className="text-[12px] text-[var(--text-primary)] italic leading-relaxed">"{call.voicemail_transcript}"</div>
              {call.voicemail_url && (
                <a
                  href={call.voicemail_url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-[11px] text-[var(--info)] hover:underline mt-1"
                >
                  Open voicemail audio
                  <ExternalLink size={10} />
                </a>
              )}
            </Section>
          )}

          {/* Recording */}
          {call.recording_url && (
            <Section title="Recording">
              <a
                href={call.recording_url}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 text-[12px] text-[var(--info)] hover:underline"
              >
                Open in Quo
                <ExternalLink size={11} />
              </a>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5 flex items-center gap-1">
        {icon}
        {title}
      </h3>
      <div>{children}</div>
    </div>
  );
}
