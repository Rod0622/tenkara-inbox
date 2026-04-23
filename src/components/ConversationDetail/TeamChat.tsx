"use client";

import { useEffect, useState } from "react";
import { ChevronDown, MessageSquare, Send } from "lucide-react";
import type { TeamMember } from "@/types";
import Avatar from "./Avatar";

export default function TeamChat({
  conversationId,
  currentUser,
  teamMembers,
}: {
  conversationId: string;
  currentUser: TeamMember | null;
  teamMembers: TeamMember[];
}) {
  const [comments, setComments] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/comments?conversation_id=${conversationId}`);
      if (!res.ok) return;
      const data = await res.json();
      setComments(data.comments || []);
    } catch (error) {
      console.error("Failed to fetch comments:", error);
    }
  };

  useEffect(() => {
    if (!conversationId) return;
    fetchComments();
    const id = setInterval(fetchComments, 5000);
    return () => clearInterval(id);
  }, [conversationId]);

  const sendComment = async () => {
    if (!input.trim() || !currentUser) return;
    setSending(true);
    try {
      await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          author_id: currentUser.id,
          body: input.trim(),
          mentions: [],
        }),
      });
      setInput("");
      fetchComments();
    } catch (error) {
      console.error("Failed to send comment:", error);
    } finally {
      setSending(false);
    }
  };

  const [isTeamChatOpen, setIsTeamChatOpen] = useState(false);

  return (
    <div className="border-t border-[#161B22] shrink-0">
      <button
        onClick={() => setIsTeamChatOpen(!isTeamChatOpen)}
        className="w-full px-4 py-2 flex items-center gap-2 text-[11px] text-[#7D8590] uppercase tracking-wider hover:bg-[#12161B] transition-colors"
      >
        <MessageSquare size={12} />
        <span>Team Chat</span>
        <span className="text-[#484F58] normal-case">(internal — not visible to sender)</span>
        {comments.length > 0 && (
          <span className="ml-auto bg-[#1E242C] text-[#7D8590] text-[10px] px-1.5 py-0.5 rounded-full font-bold">{comments.length}</span>
        )}
        <ChevronDown size={12} className={`ml-1 transition-transform ${isTeamChatOpen ? "rotate-180" : ""}`} />
      </button>

      {isTeamChatOpen && (
        <>
      <div className="h-[90px] overflow-y-auto px-4 py-2">
        {comments.length === 0 ? (
          <div className="text-center text-[12px] text-[#484F58] pt-6">
            No team discussion yet. Start a conversation about this thread.
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map((comment) => {
              const author =
                comment.author ||
                teamMembers.find((member) => member.id === comment.author_id) ||
                null;

              return (
                <div key={comment.id} className="flex items-start gap-2">
                  {author ? (
                    <Avatar initials={author.initials} color={author.color} size={20} />
                  ) : (
                    <div className="w-5 h-5 rounded-full bg-[#30363D]" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className="text-[11px] font-semibold"
                        style={{ color: author?.color || "#E6EDF3" }}
                      >
                        {author?.name || "Unknown"}
                      </span>
                      <span className="text-[10px] text-[#484F58]">
                        {comment.created_at
                          ? new Date(comment.created_at).toLocaleString()
                          : ""}
                      </span>
                    </div>
                    <div className="text-[12px] text-[#E6EDF3] whitespace-pre-wrap">
                      {comment.body}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="px-4 py-3 border-t border-[#161B22]">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendComment();
              }
            }}
            placeholder="@ Chat with your team..."
            className="flex-1 h-10 rounded-lg bg-[#0B0E11] border border-[#1E242C] px-3 text-[13px] text-[#E6EDF3] placeholder:text-[#484F58] outline-none focus:border-[#30363D]"
          />
          <button
            onClick={sendComment}
            disabled={sending || !input.trim()}
            className="w-10 h-10 rounded-lg bg-[#12161B] border border-[#1E242C] text-[#7D8590] hover:bg-[#181D24] disabled:opacity-50 flex items-center justify-center"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

