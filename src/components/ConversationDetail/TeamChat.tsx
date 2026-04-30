"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, MessageSquare, Send, AtSign, Users } from "lucide-react";
import type { TeamMember } from "@/types";
import Avatar from "./Avatar";

// Token used to mention everyone — the API expands this to all active member IDs.
const EVERYONE_TOKEN = "@everyone";

interface MentionEntry {
  // Either a team_member.id (UUID) OR the special "@everyone" string
  id: string;
  display: string;
  isEveryone?: boolean;
}

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
  const [isTeamChatOpen, setIsTeamChatOpen] = useState(false);

  // If user arrived here via a mention notification, auto-open team chat.
  // The Sidebar sets `&open_team_chat=1` in the URL hash.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const checkHash = () => {
      const hash = window.location.hash || "";
      if (hash.includes("open_team_chat=1")) {
        setIsTeamChatOpen(true);
        // Clean up hash so it doesn't re-trigger on remount
        const cleaned = hash.replace(/&?open_team_chat=1/, "");
        if (cleaned !== hash) {
          window.history.replaceState(null, "", window.location.pathname + window.location.search + cleaned);
        }
      }
    };
    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, [conversationId]);

  // Count comments where the current user was mentioned (for the badge)
  const myMentionCount = useMemo(() => {
    if (!currentUser?.id) return 0;
    return comments.filter((c: any) => {
      const m = c.mentions || [];
      if (!Array.isArray(m)) return false;
      return m.includes(currentUser.id) || m.includes(EVERYONE_TOKEN);
    }).length;
  }, [comments, currentUser?.id]);

  // Mention picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerIndex, setPickerIndex] = useState(0);
  // Tracks the position of the active "@" in the input so we know what range to replace
  const [pickerStart, setPickerStart] = useState<number | null>(null);

  // Mentions that have been confirmed (selected from the picker) for this in-progress comment
  const [mentions, setMentions] = useState<MentionEntry[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

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

  // Build the list of pickable members based on filter, with @everyone always at top
  const pickerCandidates: MentionEntry[] = useMemo(() => {
    const f = pickerFilter.toLowerCase();
    const everyone: MentionEntry = {
      id: EVERYONE_TOKEN,
      display: "everyone",
      isEveryone: true,
    };
    const matched = teamMembers
      .filter((m) => {
        if (!f) return true;
        const name = (m.name || "").toLowerCase();
        const email = ((m as any).email || "").toLowerCase();
        return name.includes(f) || email.includes(f);
      })
      .map((m) => ({
        id: m.id,
        display: m.name || (m as any).email || "Unknown",
      }));

    // Show "everyone" only when it matches the filter (or filter is empty)
    const showEveryone = !f || "everyone".includes(f);
    return showEveryone ? [everyone, ...matched] : matched;
  }, [pickerFilter, teamMembers]);

  // When input changes, decide whether to open/update/close the picker
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    // Look back from cursor to find an active "@" not preceded by alphanumeric
    const cursor = e.target.selectionStart ?? value.length;
    let atPos = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === "@") {
        // Make sure the @ is at start or preceded by whitespace/punctuation
        if (i === 0 || /\s/.test(value[i - 1])) {
          atPos = i;
        }
        break;
      }
      // If we hit a space, stop searching (no active @)
      if (/\s/.test(ch)) break;
    }

    if (atPos >= 0) {
      const filterText = value.slice(atPos + 1, cursor);
      // Only open if the filter is short and reasonable (no spaces)
      if (!/\s/.test(filterText)) {
        setPickerOpen(true);
        setPickerFilter(filterText);
        setPickerStart(atPos);
        setPickerIndex(0);
        return;
      }
    }

    // Otherwise close
    setPickerOpen(false);
    setPickerStart(null);
  };

  const insertMention = (entry: MentionEntry) => {
    if (pickerStart === null || !inputRef.current) return;
    const cursor = inputRef.current.selectionStart ?? input.length;
    // Replace text from "@" to current cursor with "@<display> "
    const before = input.slice(0, pickerStart);
    const after = input.slice(cursor);
    const inserted = `@${entry.display} `;
    const newValue = before + inserted + after;
    setInput(newValue);

    // Add to mentions list (de-duped)
    setMentions((prev) => {
      if (prev.find((m) => m.id === entry.id)) return prev;
      return [...prev, entry];
    });

    // Close picker
    setPickerOpen(false);
    setPickerStart(null);
    setPickerFilter("");

    // Restore focus and cursor to after the inserted mention
    setTimeout(() => {
      if (inputRef.current) {
        const newCursor = before.length + inserted.length;
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursor, newCursor);
      }
    }, 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (pickerOpen && pickerCandidates.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setPickerIndex((i) => Math.min(i + 1, pickerCandidates.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setPickerIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const entry = pickerCandidates[pickerIndex];
        if (entry) insertMention(entry);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPickerOpen(false);
        return;
      }
    }

    // Normal Enter sends the message
    if (e.key === "Enter" && !e.shiftKey && !pickerOpen) {
      e.preventDefault();
      sendComment();
    }
  };

  const sendComment = async () => {
    if (!input.trim() || !currentUser) return;
    setSending(true);
    try {
      // Recompute mentions from final input — drop any that no longer appear in the text
      // (handles: user mentioned, then deleted the @name from the input)
      const finalMentions: string[] = mentions
        .filter((m) => {
          if (m.isEveryone) return input.includes("@everyone");
          // Match against display name token
          return input.includes(`@${m.display}`);
        })
        .map((m) => m.id);

      await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          author_id: currentUser.id,
          body: input.trim(),
          mentions: finalMentions,
        }),
      });
      setInput("");
      setMentions([]);
      setPickerOpen(false);
      setPickerStart(null);
      fetchComments();
    } catch (error) {
      console.error("Failed to send comment:", error);
    } finally {
      setSending(false);
    }
  };

  // Render comment body with mention highlights
  const renderCommentBody = (body: string) => {
    // Highlight @everyone (in red) and any @word (in orange/blue)
    const parts: (string | { type: "mention"; text: string; isEveryone: boolean })[] = [];
    const regex = /@(everyone|[a-zA-Z0-9_.-]+(?:\s[a-zA-Z]+)?)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(body)) !== null) {
      if (m.index > lastIndex) parts.push(body.slice(lastIndex, m.index));
      const isEveryone = m[1].toLowerCase() === "everyone";
      parts.push({ type: "mention", text: m[0], isEveryone });
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < body.length) parts.push(body.slice(lastIndex));

    return parts.map((p, i) => {
      if (typeof p === "string") return <span key={i}>{p}</span>;
      return (
        <span
          key={i}
          className={`px-1 rounded ${p.isEveryone ? "bg-[#5C2828] text-[#FCA5A5]" : "bg-[#1E3A5F] text-[#93C5FD]"} font-medium`}
        >
          {p.text}
        </span>
      );
    });
  };

  return (
    <div className="border-t border-[#161B22] shrink-0">
      <button
        onClick={() => setIsTeamChatOpen(!isTeamChatOpen)}
        className="w-full px-4 py-2 flex items-center gap-2 text-[11px] text-[#7D8590] uppercase tracking-wider hover:bg-[#12161B] transition-colors"
      >
        <MessageSquare size={12} />
        <span>Team Chat</span>
        <span className="text-[#484F58] normal-case">(internal — not visible to sender)</span>
        {myMentionCount > 0 && (
          <span className="ml-1 inline-flex items-center gap-1 bg-[#5C2828] text-[#FCA5A5] text-[10px] px-1.5 py-0.5 rounded-full font-bold">
            <AtSign size={10} />
            {myMentionCount}
          </span>
        )}
        {comments.length > 0 && (
          <span className={`${myMentionCount > 0 ? "" : "ml-auto"} bg-[#1E242C] text-[#7D8590] text-[10px] px-1.5 py-0.5 rounded-full font-bold`}>
            {comments.length}
          </span>
        )}
        <ChevronDown size={12} className={`${myMentionCount > 0 || comments.length > 0 ? "" : "ml-auto"} transition-transform ${isTeamChatOpen ? "rotate-180" : ""}`} />
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
                          {renderCommentBody(comment.body || "")}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="px-4 py-3 border-t border-[#161B22] relative">
            {/* Mention picker */}
            {pickerOpen && pickerCandidates.length > 0 && (
              <div className="absolute bottom-full left-4 right-4 mb-1 max-h-48 overflow-y-auto rounded-lg bg-[#0B0E11] border border-[#1E242C] shadow-lg z-10">
                {pickerCandidates.map((entry, idx) => (
                  <button
                    key={entry.id}
                    type="button"
                    onMouseDown={(e) => {
                      // Use mouseDown so we don't lose input focus before the click handler
                      e.preventDefault();
                      insertMention(entry);
                    }}
                    onMouseEnter={() => setPickerIndex(idx)}
                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] ${
                      idx === pickerIndex
                        ? "bg-[#1F2937] text-[#E6EDF3]"
                        : "text-[#9CA3AF] hover:bg-[#12161B]"
                    }`}
                  >
                    {entry.isEveryone ? (
                      <Users size={14} className="text-[#FCA5A5]" />
                    ) : (
                      <AtSign size={14} className="text-[#7D8590]" />
                    )}
                    <span className={entry.isEveryone ? "font-semibold text-[#FCA5A5]" : ""}>
                      {entry.isEveryone ? "@everyone" : entry.display}
                    </span>
                    {entry.isEveryone && (
                      <span className="ml-auto text-[10px] text-[#7D8590]">notify all team members</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder="@ Chat with your team... (type @ to mention)"
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