"use client";

import { useState, useEffect } from "react";
import { FileEdit, Loader2, Trash2, ExternalLink, Send, Clock } from "lucide-react";
import type { TeamMember } from "@/types";

export default function DraftsPanel({
  currentUser,
  onOpenConversation,
}: {
  currentUser: TeamMember | null;
  onOpenConversation?: (conversationId: string) => void;
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
        <Loader2 className="animate-spin text-[#4ADE80]" size={24} />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#0B0E11]">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center gap-3 mb-6">
          <FileEdit size={22} className="text-[#58A6FF]" />
          <div>
            <h1 className="text-xl font-bold text-[#E6EDF3]">Drafts</h1>
            <p className="text-xs text-[#7D8590]">{drafts.length} draft{drafts.length !== 1 ? "s" : ""}</p>
          </div>
        </div>

        {drafts.length === 0 ? (
          <div className="text-center py-16">
            <FileEdit size={40} className="mx-auto mb-3 text-[#484F58] opacity-50" />
            <div className="text-sm text-[#484F58]">No drafts</div>
            <div className="text-xs text-[#484F58] mt-1">Drafts will appear here when created automatically or saved manually</div>
          </div>
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div key={draft.id} className="group p-4 rounded-xl bg-[#12161B] border border-[#1E242C] hover:border-[#1E242C]/80 transition-all">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    {/* Subject + account */}
                    <div className="flex items-center gap-2 mb-1">
                      <div className="text-sm font-medium text-[#E6EDF3] truncate">
                        {draft.subject || draft.conversation?.subject || "No subject"}
                      </div>
                      {draft.source === "auto_follow_up" && (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#F0883E]/10 text-[#F0883E] border border-[#F0883E]/20 shrink-0">
                          Auto follow-up
                        </span>
                      )}
                    </div>

                    {/* To + account */}
                    <div className="text-[11px] text-[#7D8590] mb-1.5">
                      To: {draft.to_addresses || draft.conversation?.from_email || "—"}
                      {draft.account && (
                        <span className="text-[#484F58]"> · via {draft.account.name || draft.account.email}</span>
                      )}
                    </div>

                    {/* Body preview */}
                    <div className="text-xs text-[#484F58] line-clamp-2">
                      {draft.body_text?.slice(0, 200) || "(empty)"}
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-1 mt-2 text-[10px] text-[#484F58]">
                      <Clock size={10} />
                      <span>Last edited {new Date(draft.updated_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => draft.conversation_id && onOpenConversation?.(draft.conversation_id)}
                      className="p-1.5 rounded-md hover:bg-[#1E242C] text-[#7D8590] hover:text-[#58A6FF]"
                      title="Open conversation & edit draft"
                    >
                      <ExternalLink size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(draft.id)}
                      disabled={deleting === draft.id}
                      className="p-1.5 rounded-md hover:bg-[#1E242C] text-[#7D8590] hover:text-[#F85149] disabled:opacity-50"
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
