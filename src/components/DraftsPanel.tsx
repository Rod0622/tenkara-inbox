"use client";

import { useState, useEffect } from "react";
import { FileEdit, Loader2, Trash2, ExternalLink, Send, Clock } from "lucide-react";
import type { TeamMember } from "@/types";

export default function DraftsPanel({
  currentUser,
  onOpenConversation,
  onOpenCompose,
}: {
  currentUser: TeamMember | null;
  onOpenConversation?: (conversationId: string) => void;
  onOpenCompose?: () => void;
}) {
  const [drafts, setDrafts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchDrafts = async () => {
    if (!currentUser?.id) return;
    try {
      const res = await fetch(`/api/drafts?author_id=${currentUser.id}`);
      if (res.ok) {
        const data = await res.json();
        setDrafts(data.drafts || []);
      }
    } catch { /* silent */ }
    setLoading(false);
  };

  useEffect(() => { fetchDrafts(); }, [currentUser?.id]);

  const handleDelete = async (id: string) => {
    setDeleting(id);
    try {
      await fetch(`/api/drafts?id=${id}`, { method: "DELETE" });
      setDrafts((prev) => prev.filter((d) => d.id !== id));
    } catch { /* silent */ }
    setDeleting(null);
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-[var(--accent)]" size={24} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <FileEdit size={22} className="text-[var(--info)]" />
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">Drafts</h1>
            <p className="text-xs text-[var(--text-secondary)]">{drafts.length} draft{drafts.length !== 1 ? "s" : ""}</p>
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
                    </div>

                    {/* To + account */}
                    <div className="text-[11px] text-[var(--text-secondary)] mb-1.5">
                      To: {draft.to_addresses || draft.conversation?.from_email || "—"}
                      {draft.account && (
                        <span className="text-[var(--text-muted)]"> · via {draft.account.name || draft.account.email}</span>
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