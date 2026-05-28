// src/components/TranscriptsSlideOver.tsx
//
// Side-panel UI for searching and viewing Granola meeting transcripts.
// Triggered from the sidebar Transcripts button. Reads via
// /api/transcripts (Tenkara side, which proxies to prototype.call_transcripts).
//
// Two views inside the panel:
//   - List: search box, date range, department filter (admins), list of cards
//   - Detail: full transcript text + action items + link out to Granola
//
// Auth: passes currentUser.email so the API can enforce RBAC.

"use client";

import { useEffect, useState } from "react";
import { X, Search, Calendar, ExternalLink, Loader2, FileText, ArrowLeft, Users, Tag } from "lucide-react";

interface Transcript {
  id: number;
  supplier_name: string;
  call_date: string;
  call_type: string | null;
  category: string | null;
  department: string | null;
  participants: string | null;
  summary: string | null;
  action_items: string | null;
  transcript_link: string | null;
  transcript_status: string | null;
}

interface TranscriptDetail extends Transcript {
  transcript_text: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  currentUserEmail: string | null;
}

export default function TranscriptsSlideOver({ open, onClose, currentUserEmail }: Props) {
  const [list, setList] = useState<Transcript[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [department, setDepartment] = useState("");
  const [userRole, setUserRole] = useState<string>("member");
  const [userDepartment, setUserDepartment] = useState<string>("Operations");
  const [selected, setSelected] = useState<TranscriptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") {
      if (selected) setSelected(null); else onClose();
    }};
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, selected, onClose]);

  // Fetch list when panel opens or filters change
  useEffect(() => {
    if (!open || !currentUserEmail) return;
    const fetchList = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ user_email: currentUserEmail });
        if (q.trim()) params.set("q", q.trim());
        if (fromDate) params.set("from", fromDate);
        if (toDate) params.set("to", toDate);
        if (department) params.set("department", department);
        const res = await fetch(`/api/transcripts?${params.toString()}`);
        const data = await res.json();
        if (res.ok) {
          setList(data.transcripts || []);
          setUserRole(data.user_role || "member");
          setUserDepartment(data.user_department || "Operations");
        } else {
          setList([]);
        }
      } catch (_e) {
        setList([]);
      } finally {
        setLoading(false);
      }
    };
    // Debounce search input only — date/department changes fetch immediately
    const t = setTimeout(fetchList, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [open, currentUserEmail, q, fromDate, toDate, department]);

  const openDetail = async (transcriptId: number) => {
    if (!currentUserEmail) return;
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/transcripts?user_email=${encodeURIComponent(currentUserEmail)}&id=${transcriptId}`);
      const data = await res.json();
      if (res.ok && data.transcript) {
        setSelected(data.transcript);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  if (!open) return null;

  const isOpsRestricted = userRole !== "admin" && userDepartment === "Operations";
  const canFilterDept = !isOpsRestricted;

  return (
    <div className="fixed inset-0 z-[55] pointer-events-none">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] pointer-events-auto transition-opacity"
        onClick={onClose}
      />
      {/* Panel */}
      <aside className="absolute top-0 right-0 h-full w-full sm:w-[640px] max-w-full bg-[var(--surface)] border-l border-[var(--border)] shadow-2xl pointer-events-auto flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {selected && (
              <button
                onClick={() => setSelected(null)}
                className="w-7 h-7 rounded-md text-[var(--text-secondary)] hover:bg-[var(--border)] flex items-center justify-center"
                title="Back to list"
              >
                <ArrowLeft size={14} />
              </button>
            )}
            <FileText size={16} className="text-[var(--accent)] shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-[var(--text-primary)] truncate">
                {selected ? selected.supplier_name : "Call Transcripts"}
              </div>
              {!selected && (
                <div className="text-[10px] text-[var(--text-muted)]">
                  {isOpsRestricted
                    ? "Operations transcripts only"
                    : userRole === "admin"
                      ? "All transcripts"
                      : `${userDepartment} access`}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        {selected ? (
          <DetailView transcript={selected} query={q} />
        ) : (
          <>
            {/* Filters */}
            <div className="px-5 py-3 border-b border-[var(--border)] space-y-2 shrink-0">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search transcripts, participants, summaries..."
                  className="w-full pl-8 pr-3 py-2 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <div className="relative flex-1">
                  <Calendar size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="w-full pl-8 pr-2 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                <span className="text-[var(--text-muted)] text-[10px]">to</span>
                <div className="relative flex-1">
                  <Calendar size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="w-full pl-8 pr-2 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  />
                </div>
                {canFilterDept && (
                  <select
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="px-2 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                  >
                    <option value="">All depts</option>
                    <option value="Operations">Operations</option>
                    <option value="Sales">Sales</option>
                    <option value="Management">Management</option>
                    <option value="Dev">Dev</option>
                    <option value="Uncategorized">Uncategorized</option>
                  </select>
                )}
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-3 py-2">
              {loading && (
                <div className="flex items-center justify-center py-8 text-[var(--text-muted)] text-[12px]">
                  <Loader2 size={14} className="animate-spin mr-2" /> Loading…
                </div>
              )}
              {!loading && list.length === 0 && (
                <div className="text-center py-8 text-[var(--text-muted)] text-[12px]">
                  {q || fromDate || toDate ? "No transcripts match your filters" : "No transcripts available"}
                </div>
              )}
              {!loading && list.map((t) => (
                <button
                  key={t.id}
                  onClick={() => openDetail(t.id)}
                  disabled={detailLoading}
                  className="w-full text-left p-3 mb-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]/40 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="text-[12px] font-semibold text-[var(--text-primary)] flex-1 min-w-0">
                      <HighlightedText text={t.supplier_name || "(Untitled)"} query={q} />
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] shrink-0">
                      {formatDate(t.call_date)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    {t.department && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--accent)]/10 text-[var(--accent)]">
                        {t.department}
                      </span>
                    )}
                    {t.call_type && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--info)]/10 text-[var(--info)]">
                        {t.call_type}
                      </span>
                    )}
                    {t.transcript_status === "summary_only" && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--warning)]/10 text-[var(--warning)]">
                        Summary only
                      </span>
                    )}
                  </div>
                  {t.participants && (
                    <div className="text-[10px] text-[var(--text-secondary)] flex items-center gap-1 mb-1 truncate">
                      <Users size={9} className="shrink-0" />
                      <span className="truncate">
                        <HighlightedText text={t.participants} query={q} />
                      </span>
                    </div>
                  )}
                  {t.summary && (
                    <div className="text-[11px] text-[var(--text-secondary)] line-clamp-2 leading-snug">
                      <HighlightedText text={excerptAroundMatch(t.summary, q, 200)} query={q} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function DetailView({ transcript, query }: { transcript: TranscriptDetail; query: string }) {
  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
      {/* Metadata block */}
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 space-y-1.5">
        <MetaRow label="Date" value={formatDate(transcript.call_date)} query={query} />
        {transcript.department && <MetaRow label="Department" value={transcript.department} query={query} />}
        {transcript.call_type && <MetaRow label="Type" value={transcript.call_type} query={query} />}
        {transcript.category && <MetaRow label="Category" value={transcript.category} query={query} />}
        {transcript.participants && <MetaRow label="Participants" value={transcript.participants} query={query} />}
        {transcript.transcript_link && (
          <div className="flex items-center gap-1.5 pt-1">
            <a
              href={transcript.transcript_link}
              target="_blank"
              rel="noopener"
              className="text-[10px] text-[var(--info)] hover:underline inline-flex items-center gap-1"
            >
              <ExternalLink size={9} />
              Open in Granola
            </a>
          </div>
        )}
      </div>

      {transcript.action_items && (
        <div>
          <div className="text-[11px] font-bold text-[var(--text-secondary)] mb-1.5 uppercase tracking-wide flex items-center gap-1.5">
            <Tag size={10} /> Action Items
          </div>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-[12px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
            <HighlightedText text={transcript.action_items} query={query} />
          </div>
        </div>
      )}

      {transcript.summary && (
        <div>
          <div className="text-[11px] font-bold text-[var(--text-secondary)] mb-1.5 uppercase tracking-wide">Summary</div>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-[12px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap">
            <HighlightedText text={transcript.summary} query={query} />
          </div>
        </div>
      )}

      {transcript.transcript_text && (
        <div>
          <div className="text-[11px] font-bold text-[var(--text-secondary)] mb-1.5 uppercase tracking-wide">Full Transcript</div>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 text-[12px] text-[var(--text-primary)] leading-relaxed whitespace-pre-wrap font-mono">
            <HighlightedText text={transcript.transcript_text} query={query} />
          </div>
        </div>
      )}
    </div>
  );
}

function MetaRow({ label, value, query }: { label: string; value: string; query?: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2 text-[11px]">
      <div className="text-[var(--text-muted)] font-semibold">{label}</div>
      <div className="text-[var(--text-primary)] break-words">
        {query ? <HighlightedText text={value} query={query} /> : value}
      </div>
    </div>
  );
}

function formatDate(s: string | null): string {
  if (!s) return "";
  try {
    const d = new Date(s);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return s;
  }
}

// ─── Search-match highlighting ──────────────────────────────────────────────
// Wraps every occurrence of `query` inside `text` with a <mark> element so
// users can see where their search term hit. Case-insensitive, handles regex
// special chars via escaping, and degrades to plain text if query is empty
// or text is null.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, query, className }: { text: string | null | undefined; query: string; className?: string }) {
  if (!text) return null;
  const trimmed = query.trim();
  if (!trimmed) return <span className={className}>{text}</span>;
  // Build a global, case-insensitive regex from the (escaped) query.
  let re: RegExp;
  try {
    re = new RegExp(`(${escapeRegex(trimmed)})`, "gi");
  } catch {
    return <span className={className}>{text}</span>;
  }
  const parts = text.split(re);
  const lowerQuery = trimmed.toLowerCase();
  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.toLowerCase() === lowerQuery ? (
          <mark key={i} className="bg-[var(--accent)]/30 text-[var(--text-primary)] rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

// Pull a short excerpt from `text` centered around the first match of `query`.
// If `query` is empty or not found, returns text.slice(0, maxLen) like before.
// Useful for showing the *relevant* part of a long summary instead of just
// the first N chars.
function excerptAroundMatch(text: string, query: string, maxLen: number = 200): string {
  if (!text) return "";
  const trimmedQ = query.trim();
  if (!trimmedQ) {
    return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  }
  const idx = text.toLowerCase().indexOf(trimmedQ.toLowerCase());
  if (idx === -1) {
    return text.length > maxLen ? text.slice(0, maxLen) + "…" : text;
  }
  // Center the excerpt around the match
  const halfWindow = Math.floor((maxLen - trimmedQ.length) / 2);
  const start = Math.max(0, idx - halfWindow);
  const end = Math.min(text.length, idx + trimmedQ.length + halfWindow);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return prefix + text.slice(start, end) + suffix;
}