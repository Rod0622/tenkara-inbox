// src/components/ConversationDetail/RelatedTranscripts.tsx
//
// Inline section showing Granola transcripts that match the current
// conversation's supplier. Rendered in the conversation detail view.
//
// Matching done server-side via /api/transcripts/related which uses
// the supplier_contact link OR from_name/from_email fallback.

"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, ChevronDown, ChevronUp, ExternalLink, Users } from "lucide-react";

interface RelatedTranscript {
  id: number;
  supplier_name: string;
  call_date: string;
  call_type: string | null;
  department: string | null;
  participants: string | null;
  summary: string | null;
  transcript_link: string | null;
}

interface Props {
  conversationId: string;
  currentUserEmail: string | null;
  onOpenTranscript?: (transcriptId: number) => void;
}

export default function RelatedTranscripts({ conversationId, currentUserEmail, onOpenTranscript }: Props) {
  const [matches, setMatches] = useState<RelatedTranscript[]>([]);
  const [loading, setLoading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [matchedOn, setMatchedOn] = useState<string>("");

  useEffect(() => {
    if (!conversationId || !currentUserEmail) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/transcripts/related?conversation_id=${conversationId}&user_email=${encodeURIComponent(currentUserEmail)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setMatches(data?.matches || []);
        setMatchedOn(data?.matched_on || "");
      })
      .catch(() => { if (!cancelled) setMatches([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [conversationId, currentUserEmail]);

  // Hide the section entirely if no matches and not loading.
  if (!loading && matches.length === 0) return null;

  return (
    <div className="border border-[var(--border)] rounded-lg bg-[var(--bg)] overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full px-3 py-2 flex items-center justify-between hover:bg-[var(--surface)] transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <FileText size={12} className="text-[var(--accent)] shrink-0" />
          <span className="text-[11px] font-bold text-[var(--text-primary)]">
            Related Call Transcripts
          </span>
          {!loading && matches.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--accent)]/10 text-[var(--accent)]">
              {matches.length}
            </span>
          )}
          {matchedOn === "from_email_or_name" && (
            <span
              className="text-[9px] text-[var(--text-muted)]"
              title="Matched on sender name/email — supplier not formally linked"
            >
              (loose match)
            </span>
          )}
        </div>
        {collapsed ? <ChevronDown size={12} className="text-[var(--text-muted)]" /> : <ChevronUp size={12} className="text-[var(--text-muted)]" />}
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 pt-1 space-y-1.5">
          {loading && (
            <div className="text-[var(--text-muted)] text-[11px] flex items-center gap-1.5 py-2">
              <Loader2 size={11} className="animate-spin" /> Finding related calls…
            </div>
          )}
          {!loading && matches.map((m) => (
            <button
              key={m.id}
              onClick={() => onOpenTranscript?.(m.id)}
              className="w-full text-left p-2.5 rounded-md bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--accent)]/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="text-[11px] font-semibold text-[var(--text-primary)] flex-1 min-w-0 truncate">
                  {m.supplier_name || "(Untitled)"}
                </div>
                <div className="text-[9px] text-[var(--text-muted)] shrink-0">
                  {formatDate(m.call_date)}
                </div>
              </div>
              {(m.department || m.call_type) && (
                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                  {m.department && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-[var(--accent)]/10 text-[var(--accent)]">
                      {m.department}
                    </span>
                  )}
                  {m.call_type && (
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-semibold bg-[var(--info)]/10 text-[var(--info)]">
                      {m.call_type}
                    </span>
                  )}
                </div>
              )}
              {m.participants && (
                <div className="text-[9px] text-[var(--text-muted)] flex items-center gap-1 mb-0.5 truncate">
                  <Users size={8} className="shrink-0" />
                  <span className="truncate">{m.participants}</span>
                </div>
              )}
              {m.summary && (
                <div className="text-[10px] text-[var(--text-secondary)] line-clamp-2 leading-snug">
                  {m.summary.slice(0, 150)}{m.summary.length > 150 ? "…" : ""}
                </div>
              )}
              {m.transcript_link && (
                <div className="mt-1 flex justify-end">
                  <a
                    href={m.transcript_link}
                    target="_blank"
                    rel="noopener"
                    onClick={(e) => e.stopPropagation()}
                    className="text-[9px] text-[var(--info)] hover:underline inline-flex items-center gap-0.5"
                  >
                    <ExternalLink size={8} /> Granola
                  </a>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDate(s: string | null): string {
  if (!s) return "";
  try {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return s;
  }
}
