"use client";

import { useState, useEffect, useRef } from "react";
import { FileEdit, Loader2, Trash2, ExternalLink, Send, Clock } from "lucide-react";
import type { TeamMember } from "@/types";

export default function DraftsPanel({
  currentUser,
  emailAccountId,
  emailAccountName,
  onOpenConversation,
  onOpenCompose,
}: {
  currentUser: TeamMember | null;
  // When set, the panel shows ALL drafts on that email account (regardless of
  // author) — i.e., the team-shared per-account Drafts folder.
  // When unset, it shows the current user's PERSONAL drafts.
  emailAccountId?: string | null;
  emailAccountName?: string | null;
  onOpenConversation?: (conversationId: string) => void;
  onOpenCompose?: () => void;
}) {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Mode is determined by which prop is set. Per-account view trumps personal.
  const isAccountView = !!emailAccountId;

  const fetchDrafts = async () => {
    // Personal view needs currentUser; account view needs emailAccountId.
    if (!isAccountView && !currentUser?.id) return;
    if (isAccountView && !emailAccountId) return;
    try {
      const url = isAccountView
        ? `/api/drafts?email_account_id=${emailAccountId}`
        : `/api/drafts?author_id=${currentUser!.id}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDrafts(data.drafts || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  };

  // Initial fetch + keep the list fresh:
  //   - Refetch every 15s while the panel is mounted (mirrors Sidebar counter cadence)
  //   - Refetch on window focus (covers tab-switch flow)
  //   Skip refetches while a delete is in flight to avoid optimistic-update flicker.
  const deletingRef = useRef<string | null>(null);
  useEffect(() => { deletingRef.current = deleting; }, [deleting]);

  useEffect(() => {
    setLoading(true);
    fetchDrafts();
    const interval = setInterval(() => {
      if (!deletingRef.current) fetchDrafts();
    }, 60000);
    const onFocus = () => {
      if (!deletingRef.current) fetchDrafts();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, emailAccountId]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`/api/drafts?id=${id}`, { method: "DELETE" });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch { /* silent */ }
    setDeleting(null);
  };

  if (loading && drafts.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-[var(--accent)]" size={24} />
      </div>
    );
  }

  return (
    // h-full (not flex-1) — DraftsPanel sits inside a <Panel>, see TaskBoard
    // comment for explanation. Without this the panel doesn't scroll.
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <FileEdit size={22} className="text-[var(--info)]" />
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">
              {isAccountView ? (emailAccountName ? `${emailAccountName} · Drafts` : "Drafts") : "Drafts"}
            </h1>
            <p className="text-xs text-[var(--text-secondary)]">
              {drafts.length} draft{drafts.length !== 1 ? "s" : ""}
              {isAccountView && " · team-shared"}
            </p>
          </div>
        </div>

        {drafts.length === 0 ? (
          <div className="text-center py-16">
            <FileEdit size={40} className="mx-auto mb-3 text-[var(--text-muted)] opacity-50" />
            <div className="text-sm text-[var(--text-muted)]">No drafts</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Drafts will appear here when created automatically or saved manually</div>
          </div>
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div key={draft.id} className="group p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border)]/80 transition-all">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Subject + account */}
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                        {draft.subject || draft.conversation?.subject || (draft.conversation_id ? "No subject" : "New email (draft)")}
                      </div>
                      {draft.source === "auto_follow_up" && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#F0883E]/10 text-[#F0883E] border border-[#F0883E]/20 shrink-0">
                          Auto follow-up
                        </span>
                      )}
                      {/* Agent-created draft badge. Distinct purple chip so
                          operators can tell at a glance which drafts came
                          from an external integration (e.g. Sammy's bot)
                          vs their own work or auto follow-ups. */}
                      {draft.created_by_agent && (
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#A855F7]/10 text-[#A855F7] border border-[#A855F7]/20 shrink-0 flex items-center gap-1"
                          title={`Drafted by ${draft.created_by_agent}`}
                        >
                          <span>🤖</span>
                          <span>{draft.created_by_agent}</span>
                        </span>
                      )}
                      {/* Sender-required warning — operator needs to pick an
                          account before this draft can be sent. */}
                      {draft.requires_sender_selection && (
                        <span
                          className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--warning)]/10 text-[var(--warning)] border border-[var(--warning)]/30 shrink-0"
                          title="Pick a sending account before this draft can be sent"
                        >
                          Pick sender
                        </span>
                      )}
                    </div>

                    {/* To + account + author */}
                    <div className="text-[11px] text-[var(--text-secondary)] mb-1.5 flex items-center gap-1.5 flex-wrap">
                      <span>To: {draft.to_addresses || draft.conversation?.from_email || "—"}</span>
                      {draft.account && (
                        <span className="text-[var(--text-muted)]"> · via {draft.account.name || draft.account.email}</span>
                      )}
                      {isAccountView && draft.author && (
                        <span
                          className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold"
                          style={{
                            background: (draft.author.color || "#666") + "22",
                            color: draft.author.color || "var(--text-secondary)",
                          }}
                          title={`Drafted by ${draft.author.name}`}
                        >
                          <span>{draft.author.initials || draft.author.name?.[0]}</span>
                          <span>{draft.author.name}</span>
                        </span>
                      )}
                    </div>

                    {/* Body preview */}
                    <div className="text-xs text-[var(--text-muted)] line-clamp-2">
                      {draft.body_text?.slice(0, 200) || "(empty)"}
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-1 mt-2 text-[10px] text-[var(--text-muted)]">
                      <Clock size={10} />
                      <span>Last edited {new Date(draft.updated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        if (draft.conversation_id) {
                          onOpenConversation?.(draft.conversation_id);
                        } else {
                          onOpenCompose?.();
                        }
                      }}
                      className="p-1.5 rounded-md hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--info)]"
                      title={draft.conversation_id ? "Open conversation & edit draft" : "Open compose & edit draft"}
                    >
                      <ExternalLink size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(draft.id)}
                      disabled={deleting === draft.id}
                      className="p-1.5 rounded-md hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--danger)] disabled:opacity-50"
                      title="Delete draft"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}