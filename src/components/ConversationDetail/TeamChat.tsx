"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Send, AtSign, Users, X, MoreVertical, Edit2, Trash2, SmilePlus, Check, Paperclip, FileText, Download, Loader2, Image as ImageIcon } from "lucide-react";
import type { TeamMember } from "@/types";
import Avatar from "./Avatar";

// Token used to mention everyone — the API expands this to all active member IDs.
const EVERYONE_TOKEN = "@everyone";

// Prefix used to mark group mentions in the wire payload. The API uses this
// to distinguish a group reference from a user id. e.g. "group:abc-123"
// resolves to all active members of user_group abc-123.
const GROUP_PREFIX = "group:";

// Quick-reaction emoji set offered when the user clicks the smiley button.
// Kept small and universally-supported (no skin-tone modifiers, no compound
// ZWJ sequences). Order matches common Slack/Linear conventions.
const QUICK_REACTIONS = ["👍", "❤️", "😄", "🎉", "👀", "🙏"];

// Format a byte count as a friendly size string (KB / MB)
function fmtFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface MentionEntry {
  // For "user":     team_member.id (UUID)
  // For "group":    "group:<user_group_id>" — prefixed so the API can tell
  //                 it apart from a user id
  // For "everyone": EVERYONE_TOKEN string literal
  id: string;
  // The token text that appears after "@" in the input (e.g. "everyone",
  // "Ops", "Jane Doe"). Used both for display in the picker AND for the
  // recompute pass that drops a mention if the user has deleted its text
  // from the input.
  display: string;
  kind: "user" | "group" | "everyone";
  // Member count is shown next to group entries in the picker so the user
  // sees "Ops · 4 members" — sets expectations on how many notifications
  // will fire.
  memberCount?: number;
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

  // ── Attachments (Batch 8) ──────────────────────────────────────────
  // Files uploaded into a pending tray while composing. Each has been
  // POSTed to Storage already; comment_id is null until the parent
  // comment is sent. The `signed_url` here is a short-lived URL for
  // preview rendering.
  type PendingAttachment = {
    id: string;
    filename: string;
    mime_type: string | null;
    size_bytes: number;
    signed_url: string | null;
  };
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Upload one or more files. Each kicks off a fetch in parallel and the
  // pending tray populates as uploads complete. Failures show a banner
  // but other files in the same batch can still succeed.
  const uploadFiles = async (files: File[]) => {
    if (!currentUser) return;
    if (files.length === 0) return;
    setUploadError(null);
    setUploadingCount(c => c + files.length);
    await Promise.all(files.map(async (file) => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("author_id", currentUser.id);
        const res = await fetch("/api/comments/attachments", { method: "POST", body: fd });
        const j = await res.json();
        if (!res.ok || !j.attachment) {
          setUploadError(j.error || `Upload failed (HTTP ${res.status})`);
          return;
        }
        setPendingAttachments(prev => [...prev, {
          id: j.attachment.id,
          filename: j.attachment.filename,
          mime_type: j.attachment.mime_type,
          size_bytes: j.attachment.size_bytes,
          signed_url: j.attachment.signed_url,
        }]);
      } catch (e: any) {
        setUploadError(e?.message || "Upload failed");
      } finally {
        setUploadingCount(c => c - 1);
      }
    }));
  };

  // Unattach a pending file before sending. Calls the DELETE endpoint
  // which removes both the storage object and the DB row.
  const removePendingAttachment = async (attachmentId: string) => {
    if (!currentUser) return;
    setPendingAttachments(prev => prev.filter(a => a.id !== attachmentId));
    try {
      await fetch(`/api/comments/attachments?id=${attachmentId}&author_id=${currentUser.id}`, {
        method: "DELETE",
      });
    } catch (_e) { /* best-effort */ }
  };

  // Paste handler — grabs any file/image off the clipboard. Used on the
  // textarea. Works for paste-screenshot-from-clipboard on every major OS.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items || items.length === 0) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file") {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      uploadFiles(files);
    }
    // Otherwise let the default paste happen (text into the textarea)
  };

  // Drag-and-drop handlers on the input wrapper
  const handleDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    setIsDragOver(true);
  };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) uploadFiles(files);
  };
  const [isTeamChatOpen, setIsTeamChatOpen] = useState(false);

  // Per-message UI state — track which message is being edited, which one has
  // its action menu open, and which one has the reaction picker open. Only one
  // of each can be active at a time, keyed by comment id.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [reactionPickerId, setReactionPickerId] = useState<string | null>(null);
  const editingTextareaRef = useRef<HTMLTextAreaElement>(null);

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

  // User groups available for @group mentions. Loaded once when the chat opens.
  // We only need name + active member IDs for filtering/picker display.
  const [userGroups, setUserGroups] = useState<Array<{
    id: string;
    name: string;
    icon?: string;
    color?: string;
    activeMemberIds: string[];
  }>>([]);

  // Fetch user groups + their members. Filters group members to active users
  // only so the mention count + downstream notification list is accurate.
  useEffect(() => {
    if (!isTeamChatOpen) return; // lazy — don't load until the user opens chat
    if (userGroups.length > 0) return; // cache for session
    (async () => {
      try {
        const sb = (await import("@/lib/supabase")).createBrowserClient();
        const [groupsRes, membersRes] = await Promise.all([
          sb.from("user_groups")
            .select("id, name, icon, color, user_group_members(team_member_id)")
            .eq("is_active", true)
            .order("name"),
          sb.from("team_members").select("id, is_active"),
        ]);
        const activeMemberIdSet = new Set(
          (membersRes.data || [])
            .filter((m: any) => m.is_active !== false)
            .map((m: any) => m.id)
        );
        const groups = (groupsRes.data || []).map((g: any) => ({
          id: g.id,
          name: g.name,
          icon: g.icon,
          color: g.color,
          activeMemberIds: (g.user_group_members || [])
            .map((mm: any) => mm.team_member_id)
            .filter((id: string) => activeMemberIdSet.has(id)),
        }))
        // Hide groups with zero active members — mentioning them would notify
        // nobody. Keeps the picker clean.
        .filter((g: any) => g.activeMemberIds.length > 0);
        setUserGroups(groups);
      } catch (e) {
        console.error("Failed to load user groups:", e);
      }
    })();
  }, [isTeamChatOpen, userGroups.length]);

  const inputRef = useRef<HTMLTextAreaElement>(null);

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
    const id = setInterval(fetchComments, 20000);
    return () => clearInterval(id);
  }, [conversationId]);

  // Close any open action menu / reaction picker when clicking outside.
  // Uses ref-based detection — the menu container has a data attribute we
  // check against the click target's ancestors.
  useEffect(() => {
    if (!actionMenuId && !reactionPickerId) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // If the click was inside any element marked with [data-msg-menu],
      // don't close — let the inner buttons handle their own behavior.
      if (target?.closest?.("[data-msg-menu]")) return;
      setActionMenuId(null);
      setReactionPickerId(null);
    };
    const t = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  }, [actionMenuId, reactionPickerId]);

  // Build the list of pickable mentions based on filter. Ordering:
  //   1. @everyone (when filter is empty or matches "everyone")
  //   2. User groups matching the filter (with member counts)
  //   3. Individual team members matching the filter
  // Groups appear before users because they're typically what someone
  // types "@" for when filtering by department/team.
  const pickerCandidates: MentionEntry[] = useMemo(() => {
    const f = pickerFilter.toLowerCase();
    const everyone: MentionEntry = {
      id: EVERYONE_TOKEN,
      display: "everyone",
      kind: "everyone",
    };

    // Group entries — filter by name match. Each entry's id is prefixed with
    // GROUP_PREFIX so the API can distinguish it from a user id when the
    // comment is submitted.
    const matchedGroups: MentionEntry[] = userGroups
      .filter((g) => !f || (g.name || "").toLowerCase().includes(f))
      .map((g) => ({
        id: `${GROUP_PREFIX}${g.id}`,
        display: g.name,
        kind: "group" as const,
        memberCount: g.activeMemberIds.length,
      }));

    // Individual member entries — filter by name OR email match.
    const matchedUsers: MentionEntry[] = teamMembers
      .filter((m) => {
        if (m.is_active === false) return false; // hide deactivated
        if (!f) return true;
        const name = (m.name || "").toLowerCase();
        const email = ((m as any).email || "").toLowerCase();
        return name.includes(f) || email.includes(f);
      })
      .map((m) => ({
        id: m.id,
        display: m.name || (m as any).email || "Unknown",
        kind: "user" as const,
      }));

    // @everyone only shown when filter is empty or substring of "everyone"
    const showEveryone = !f || "everyone".includes(f);
    return [
      ...(showEveryone ? [everyone] : []),
      ...matchedGroups,
      ...matchedUsers,
    ];
  }, [pickerFilter, teamMembers, userGroups]);

  // When input changes, decide whether to open/update/close the picker
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    // Allow sending when there's text OR at least one attachment
    const hasText = input.trim().length > 0;
    const hasAttachments = pendingAttachments.length > 0;
    if ((!hasText && !hasAttachments) || !currentUser) return;
    if (uploadingCount > 0) return; // wait for in-flight uploads
    setSending(true);
    try {
      // Recompute mentions from final input — drop any that no longer appear in the text
      // (handles: user mentioned, then deleted the @name from the input)
      const finalMentions: string[] = mentions
        .filter((m) => {
          if (m.kind === "everyone") return input.includes("@everyone");
          // For users AND groups, match against the display name token
          // ("@Ops", "@Jane Doe"). The id payload distinguishes them
          // (group ids carry the GROUP_PREFIX).
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
          attachment_ids: pendingAttachments.map(a => a.id),
        }),
      });
      setInput("");
      setMentions([]);
      setPickerOpen(false);
      setPickerStart(null);
      setPendingAttachments([]);
      setUploadError(null);
      fetchComments();
    } catch (error) {
      console.error("Failed to send comment:", error);
    } finally {
      setSending(false);
    }
  };

  // ─── Edit ─────────────────────────────────────────────────────────────
  const startEdit = (comment: any) => {
    setEditingId(comment.id);
    setEditingText(comment.body || "");
    setActionMenuId(null);
    // Focus the textarea on next tick (after it's rendered)
    setTimeout(() => editingTextareaRef.current?.focus(), 0);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingText("");
  };

  const saveEdit = async (commentId: string) => {
    if (!editingText.trim() || !currentUser) return;
    // Optimistic local update so the UI feels instant
    setComments((prev) =>
      prev.map((c) =>
        c.id === commentId
          ? { ...c, body: editingText.trim(), edited_at: new Date().toISOString() }
          : c
      )
    );
    setEditingId(null);
    try {
      await fetch("/api/comments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: commentId,
          author_id: currentUser.id,
          body: editingText.trim(),
        }),
      });
      fetchComments(); // re-sync from server (gets authoritative edited_at)
    } catch (error) {
      console.error("Failed to edit comment:", error);
      fetchComments(); // re-sync to revert optimistic update on failure
    }
  };

  // ─── Delete ───────────────────────────────────────────────────────────
  const deleteComment = async (commentId: string) => {
    if (!currentUser) return;
    if (!confirm("Delete this message? This cannot be undone.")) return;
    setActionMenuId(null);
    // Optimistic local removal
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    try {
      await fetch(
        `/api/comments?id=${commentId}&author_id=${currentUser.id}`,
        { method: "DELETE" }
      );
    } catch (error) {
      console.error("Failed to delete comment:", error);
      fetchComments(); // re-sync to restore on failure
    }
  };

  // ─── Reactions ────────────────────────────────────────────────────────
  // Toggle a reaction on a comment. Optimistic update so the count changes
  // instantly. Server is the source of truth — fetchComments() re-syncs in
  // the next poll regardless.
  const toggleReaction = async (commentId: string, emoji: string) => {
    if (!currentUser) return;
    setReactionPickerId(null);
    // Optimistic update
    setComments((prev) =>
      prev.map((c) => {
        if (c.id !== commentId) return c;
        const reactions: Record<string, string[]> = { ...(c.reactions || {}) };
        const current: string[] = Array.isArray(reactions[emoji]) ? reactions[emoji] : [];
        if (current.includes(currentUser.id)) {
          const next = current.filter((id) => id !== currentUser.id);
          if (next.length === 0) delete reactions[emoji];
          else reactions[emoji] = next;
        } else {
          reactions[emoji] = [...current, currentUser.id];
        }
        return { ...c, reactions };
      })
    );
    try {
      await fetch(`/api/comments/${commentId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: currentUser.id, emoji }),
      });
    } catch (error) {
      console.error("Failed to toggle reaction:", error);
      fetchComments();
    }
  };

  // Render comment body with mention highlights AND clickable links.
  // We tokenize into four kinds of nodes: plain text, URLs, and mentions
  // (which themselves come in three flavors: everyone, group, user).
  //
  // The order of detection matters — we want URLs that happen to contain "@"
  // (e.g. "https://example.com/u/@bob") to be treated as URLs, not as an URL
  // plus a partial mention. To do that we match URLs first, then mentions on
  // what's left.
  //
  // Links open in a new tab with rel="noopener noreferrer" for safety. We use
  // a React <a> element — never dangerouslySetInnerHTML — so the body text is
  // always treated as plain text by React's escaping.
  //
  // Group name matching is done by comparing the @<token> against the names
  // of loaded user groups (case-insensitive). A token that matches a group
  // gets the group color; otherwise it's treated as a user mention.
  const renderCommentBody = (body: string) => {
    type Token =
      | { kind: "text"; value: string }
      | { kind: "url"; value: string }
      | { kind: "mention"; value: string; mentionKind: "user" | "group" | "everyone" };

    // Matches http(s)://... and www.... up to whitespace, with a permissive
    // body of URL-safe characters. Trailing punctuation (.,!?;:) is trimmed
    // back off so "Check this https://example.com." doesn't include the period.
    const urlRegex = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/g;

    // First pass — extract URLs
    const urlTokens: Token[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = urlRegex.exec(body)) !== null) {
      let url = m[0];
      // Trim trailing punctuation off the URL
      const trimMatch = url.match(/[.,!?;:)\]}>"']+$/);
      let trailing = "";
      if (trimMatch) {
        trailing = trimMatch[0];
        url = url.slice(0, url.length - trailing.length);
      }
      if (m.index > last) urlTokens.push({ kind: "text", value: body.slice(last, m.index) });
      urlTokens.push({ kind: "url", value: url });
      if (trailing) urlTokens.push({ kind: "text", value: trailing });
      last = m.index + m[0].length;
    }
    if (last < body.length) urlTokens.push({ kind: "text", value: body.slice(last) });

    // Build a known-names index for the trim pass. Each entry is lowercased
    // for case-insensitive matching against captured text. The map value
    // gives us the mention kind so we can apply the right color without a
    // second lookup.
    //
    // Includes:
    //   - "everyone" (special)
    //   - all user_group names (kind: "group")
    //   - all team_member display names (kind: "user")
    //
    // Multi-word names like "Vita Organica" or "Jane Doe" are stored as-is
    // (with their internal spaces) — the matching algorithm below splits
    // captured tokens by whitespace and tries successively shorter prefixes,
    // so multi-word names work without special-casing.
    const knownNames = new Map<string, "user" | "group" | "everyone">();
    knownNames.set("everyone", "everyone");
    for (const g of userGroups) {
      if (g.name) knownNames.set(g.name.toLowerCase(), "group");
    }
    for (const tm of teamMembers) {
      if (tm.name) knownNames.set(tm.name.toLowerCase(), "user");
    }

    // Mention regex: capture @ followed by up to ~6 space-separated word-like
    // tokens. The cap prevents pathological greedy matches (e.g. consuming
    // an entire paragraph) but is generous enough for compound names like
    // "Sales and Marketing Team". Word tokens allow alphanumerics, dot,
    // hyphen, underscore — same as before, plus an apostrophe so names like
    // "O'Brien" don't break the token.
    const mentionRegex = /@([a-zA-Z0-9_.'-]+(?:\s+[a-zA-Z0-9_.'-]+){0,5})/g;
    const tokens: Token[] = [];
    for (const tok of urlTokens) {
      if (tok.kind !== "text") {
        tokens.push(tok);
        continue;
      }
      const source = tok.value;
      let lastM = 0;
      let mm: RegExpExecArray | null;
      mentionRegex.lastIndex = 0;
      while ((mm = mentionRegex.exec(source)) !== null) {
        const atIndex = mm.index;

        // Skip @s preceded by an alphanumeric — those are email addresses
        // (e.g. "jeff@example.com"), not mentions. Mentions are expected to
        // come at the start of the text or after whitespace/punctuation.
        if (atIndex > 0) {
          const prevChar = source[atIndex - 1];
          if (/[a-zA-Z0-9]/.test(prevChar)) {
            // Don't treat as mention. Advance past this @ so the regex
            // engine keeps searching, but don't emit a token for it.
            mentionRegex.lastIndex = atIndex + 1;
            continue;
          }
        }

        // The captured value may include trailing words that aren't part of
        // any known name (e.g. "@Mildred I asked Carvey..." captures the
        // whole phrase). Trim back word-by-word until we hit a known group/
        // user name, or fall back to the single first word as an unknown
        // user mention.
        const capturedFull = mm[1];
        const words = capturedFull.split(/\s+/);
        let chosenWords = 1; // default: just the first word
        let chosenKind: "user" | "group" | "everyone" = "user";
        for (let len = words.length; len >= 1; len--) {
          const candidate = words.slice(0, len).join(" ").toLowerCase();
          const kind = knownNames.get(candidate);
          if (kind) {
            chosenWords = len;
            chosenKind = kind;
            break;
          }
        }
        const chosenText = "@" + words.slice(0, chosenWords).join(" ");

        // Emit any plain text between the previous match and this one.
        if (atIndex > lastM) {
          tokens.push({ kind: "text", value: source.slice(lastM, atIndex) });
        }
        tokens.push({ kind: "mention", value: chosenText, mentionKind: chosenKind });

        // Advance position past the chosen mention. The regex's match may
        // have spanned more text than chosenText (we trimmed back), so
        // recompute lastIndex carefully — anything we didn't claim as part
        // of the mention should be available for the next iteration.
        const consumedLen = chosenText.length;
        lastM = atIndex + consumedLen;
        mentionRegex.lastIndex = lastM;
      }
      if (lastM < source.length) tokens.push({ kind: "text", value: source.slice(lastM) });
    }

    return tokens.map((tok, i) => {
      if (tok.kind === "text") return <span key={i}>{tok.value}</span>;
      if (tok.kind === "url") {
        const href = tok.value.startsWith("http") ? tok.value : `https://${tok.value}`;
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--info,#60A5FA)] underline hover:opacity-80 break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {tok.value}
          </a>
        );
      }
      // mention — different background/text colors per kind so they're
      // immediately distinguishable:
      //   everyone → red-ish (high attention, all users)
      //   group    → amber-ish (mid attention, group of users)
      //   user     → blue-ish (low attention, single user)
      let cls = "bg-[#1E3A5F] text-[#93C5FD]"; // default: user
      if (tok.mentionKind === "everyone") cls = "bg-[#5C2828] text-[#FCA5A5]";
      else if (tok.mentionKind === "group") cls = "bg-[#5C4A1F] text-[#FCD34D]";
      return (
        <span
          key={i}
          className={`px-1 rounded ${cls} font-medium`}
        >
          {tok.value}
        </span>
      );
    });
  };

  // Trigger button (always rendered at the bottom of the conversation pane).
  // Clicking opens the right-side drawer below — no inline expansion anymore,
  // because the previous 90px-tall inline panel forced too much scrolling.
  const triggerButton = (
    <div className="border-t border-[var(--surface-2)] shrink-0">
      <button
        onClick={() => setIsTeamChatOpen(true)}
        className="w-full px-4 py-2 flex items-center gap-2 text-[11px] text-[var(--text-secondary)] uppercase tracking-wider hover:bg-[var(--surface)] transition-colors"
      >
        <MessageSquare size={12} />
        <span>Team Chat</span>
        <span className="text-[var(--text-muted)] normal-case">(internal — not visible to sender)</span>
        {myMentionCount > 0 && (
          <span className="ml-1 inline-flex items-center gap-1 bg-[#5C2828] text-[#FCA5A5] text-[10px] px-1.5 py-0.5 rounded-full font-bold">
            <AtSign size={10} />
            {myMentionCount}
          </span>
        )}
        {comments.length > 0 && (
          <span className={`${myMentionCount > 0 ? "" : "ml-auto"} bg-[var(--border)] text-[var(--text-secondary)] text-[10px] px-1.5 py-0.5 rounded-full font-bold`}>
            {comments.length}
          </span>
        )}
      </button>
    </div>
  );

  return (
    <>
      {triggerButton}

      {/* Right-side slide-out drawer. fixed-positioned so it overlays the
          right portion of the conversation detail without affecting the
          inline layout. Clicking outside (the backdrop) closes the drawer. */}
      {isTeamChatOpen && (
        <>
          {/* Backdrop — semi-transparent click-catcher behind the drawer.
              Pointer-events-auto so clicks register; visually subtle so we
              don't darken the whole UI like a modal would. */}
          <div
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setIsTeamChatOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer panel. Anchored to the right edge of the viewport, full
              viewport height. Width caps at 420px on wide screens; on narrow
              screens it shrinks to nearly the full pane via max-width. */}
          <aside
            className="fixed top-0 right-0 bottom-0 z-50 w-full max-w-[420px] bg-[var(--bg)] border-l border-[var(--border)] shadow-2xl shadow-black/40 flex flex-col animate-fade-in"
            role="dialog"
            aria-label="Team Chat"
          >
            {/* Drawer header — title + close. Sticky-feeling because it's
                inside a flex column with the message list as flex-1. */}
            <div className="shrink-0 px-4 py-3 border-b border-[var(--border)] flex items-center gap-2 bg-[var(--surface)]">
              <MessageSquare size={14} className="text-[var(--text-secondary)]" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-[var(--text-primary)]">Team Chat</div>
                <div className="text-[10px] text-[var(--text-muted)] truncate">
                  Internal — not visible to sender
                </div>
              </div>
              {comments.length > 0 && (
                <span className="bg-[var(--border)] text-[var(--text-secondary)] text-[10px] px-2 py-0.5 rounded-full font-bold">
                  {comments.length}
                </span>
              )}
              <button
                onClick={() => setIsTeamChatOpen(false)}
                className="w-8 h-8 rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-2)] flex items-center justify-center"
                aria-label="Close Team Chat"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Scrollable message list. flex-1 means it takes all available
                vertical space between the header and the input footer. */}
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {comments.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-[12px] text-[var(--text-muted)] px-6">
                  No team discussion yet. Start a conversation about this thread.
                </div>
              ) : (
                <div className="space-y-3">
                  {comments.map((comment, idx) => {
                    const author =
                      comment.author ||
                      teamMembers.find((member) => member.id === comment.author_id) ||
                      null;
                    const isOwn = currentUser?.id === comment.author_id;
                    const isEditing = editingId === comment.id;
                    const reactions: Record<string, string[]> = comment.reactions || {};
                    // Visual divider between consecutive messages.
                    return (
                      <div key={comment.id} className="group/msg relative">
                        {idx > 0 && (
                          <div className="border-t border-[var(--border)]/40 my-3" />
                        )}
                        <div className="flex items-start gap-2">
                          {author ? (
                            <Avatar initials={author.initials} color={author.color} size={24} />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-[#30363D]" />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span
                                className="text-[12px] font-semibold"
                                style={{ color: author?.color || "var(--text-primary)" }}
                              >
                                {author?.name || "Unknown"}
                              </span>
                              <span className="text-[10px] text-[var(--text-muted)]">
                                {comment.created_at
                                  ? new Date(comment.created_at).toLocaleString()
                                  : ""}
                              </span>
                              {comment.edited_at && (
                                <span
                                  className="text-[10px] text-[var(--text-muted)] italic"
                                  title={`Edited ${new Date(comment.edited_at).toLocaleString()}`}
                                >
                                  (edited)
                                </span>
                              )}
                            </div>

                            {/* Body — edit mode shows a textarea + save/cancel,
                                read mode shows the rendered body with link &
                                mention parsing. */}
                            {isEditing ? (
                              <div className="space-y-1.5">
                                <textarea
                                  ref={editingTextareaRef}
                                  value={editingText}
                                  onChange={(e) => setEditingText(e.target.value)}
                                  onKeyDown={(e) => {
                                    // Enter saves, Shift+Enter newline, Esc cancels
                                    if (e.key === "Enter" && !e.shiftKey) {
                                      e.preventDefault();
                                      saveEdit(comment.id);
                                    } else if (e.key === "Escape") {
                                      e.preventDefault();
                                      cancelEdit();
                                    }
                                  }}
                                  rows={2}
                                  className="w-full rounded-md bg-[var(--bg)] border border-[var(--border)] px-2 py-1.5 text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] resize-none leading-snug"
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => saveEdit(comment.id)}
                                    disabled={!editingText.trim()}
                                    className="px-2 py-1 rounded text-[10px] font-semibold bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    className="px-2 py-1 rounded text-[10px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                                  >
                                    Cancel
                                  </button>
                                  <span className="text-[9px] text-[var(--text-muted)]">
                                    Enter to save · Esc to cancel
                                  </span>
                                </div>
                              </div>
                            ) : (
                              <div className="text-[13px] text-[var(--text-primary)] whitespace-pre-wrap break-words leading-relaxed">
                                {renderCommentBody(comment.body || "")}
                              </div>
                            )}

                            {/* Attachments (Batch 8) — inline thumbnails for
                                images, file pills for everything else. */}
                            {!isEditing && Array.isArray(comment.attachments) && comment.attachments.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-2">
                                {comment.attachments.map((att: any) => {
                                  const isImage = att.mime_type?.startsWith("image/");
                                  if (isImage && att.signed_url) {
                                    return (
                                      <button
                                        key={att.id}
                                        onClick={() => setLightboxUrl(att.signed_url)}
                                        className="block rounded-md overflow-hidden border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
                                        title={att.filename}
                                      >
                                        <img
                                          src={att.signed_url}
                                          alt={att.filename}
                                          className="max-w-[240px] max-h-[180px] object-cover block"
                                        />
                                      </button>
                                    );
                                  }
                                  return (
                                    <a
                                      key={att.id}
                                      href={att.signed_url || "#"}
                                      target="_blank"
                                      rel="noreferrer"
                                      download={att.filename}
                                      className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--text-muted)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors max-w-[240px]"
                                      title={att.filename}
                                    >
                                      <FileText size={14} className="shrink-0" />
                                      <span className="flex-1 truncate text-[11px]">{att.filename}</span>
                                      <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                                        {fmtFileSize(att.size_bytes)}
                                      </span>
                                    </a>
                                  );
                                })}
                              </div>
                            )}

                            {/* Reactions row — shows aggregated counts per
                                emoji. Clicking an existing reaction toggles
                                the current user's participation. */}
                            {!isEditing && Object.keys(reactions).length > 0 && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                {Object.entries(reactions).map(([emoji, userIds]) => {
                                  const ids = Array.isArray(userIds) ? userIds : [];
                                  if (ids.length === 0) return null;
                                  const reactedByMe = currentUser?.id ? ids.includes(currentUser.id) : false;
                                  // Build tooltip: names of users who reacted
                                  const names = ids
                                    .map((id) => teamMembers.find((m) => m.id === id)?.name || "Unknown")
                                    .join(", ");
                                  return (
                                    <button
                                      key={emoji}
                                      onClick={() => toggleReaction(comment.id, emoji)}
                                      title={`${names} reacted with ${emoji}`}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[11px] border transition-colors ${
                                        reactedByMe
                                          ? "bg-[var(--accent)]/15 border-[var(--accent)]/40 text-[var(--text-primary)]"
                                          : "bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                                      }`}
                                    >
                                      <span>{emoji}</span>
                                      <span className="text-[10px] font-semibold">{ids.length}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* Action buttons — hidden until the message is
                              hovered. Reaction button is always available;
                              edit/delete only for the author. */}
                          {!isEditing && (
                            <div data-msg-menu className="shrink-0 flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
                              {/* Reaction picker trigger */}
                              <div className="relative">
                                <button
                                  onClick={() =>
                                    setReactionPickerId(
                                      reactionPickerId === comment.id ? null : comment.id
                                    )
                                  }
                                  className="w-6 h-6 rounded text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] flex items-center justify-center"
                                  title="Add reaction"
                                >
                                  <SmilePlus size={13} />
                                </button>
                                {reactionPickerId === comment.id && (
                                  <div className="absolute right-0 top-7 z-20 flex items-center gap-0.5 px-1.5 py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-lg">
                                    {QUICK_REACTIONS.map((emoji) => (
                                      <button
                                        key={emoji}
                                        onClick={() => toggleReaction(comment.id, emoji)}
                                        className="w-7 h-7 rounded hover:bg-[var(--surface-2)] flex items-center justify-center text-[15px]"
                                      >
                                        {emoji}
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Own-message action menu (edit / delete) */}
                              {isOwn && (
                                <div className="relative">
                                  <button
                                    onClick={() =>
                                      setActionMenuId(
                                        actionMenuId === comment.id ? null : comment.id
                                      )
                                    }
                                    className="w-6 h-6 rounded text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] flex items-center justify-center"
                                    title="More"
                                  >
                                    <MoreVertical size={13} />
                                  </button>
                                  {actionMenuId === comment.id && (
                                    <div className="absolute right-0 top-7 z-20 min-w-[120px] py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-lg">
                                      <button
                                        onClick={() => startEdit(comment)}
                                        className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-2)] flex items-center gap-2"
                                      >
                                        <Edit2 size={11} /> Edit
                                      </button>
                                      <button
                                        onClick={() => deleteComment(comment.id)}
                                        className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--danger,#F87171)] hover:bg-[var(--surface-2)] flex items-center gap-2"
                                      >
                                        <Trash2 size={11} /> Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Input footer — pinned to the bottom of the drawer. */}
            <div className="shrink-0 px-4 py-3 border-t border-[var(--border)] relative bg-[var(--surface)]">
              {pickerOpen && pickerCandidates.length > 0 && (
                <div className="absolute bottom-full left-4 right-4 mb-1 max-h-48 overflow-y-auto rounded-lg bg-[var(--bg)] border border-[var(--border)] shadow-lg z-10">
                  {pickerCandidates.map((entry, idx) => (
                    <button
                      key={entry.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertMention(entry);
                      }}
                      onMouseEnter={() => setPickerIndex(idx)}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[12px] ${
                        idx === pickerIndex
                          ? "bg-[#1F2937] text-[var(--text-primary)]"
                          : "text-[#9CA3AF] hover:bg-[var(--surface)]"
                      }`}
                    >
                      {entry.kind === "everyone" ? (
                        <Users size={14} className="text-[#FCA5A5]" />
                      ) : entry.kind === "group" ? (
                        <Users size={14} className="text-[#FCD34D]" />
                      ) : (
                        <AtSign size={14} className="text-[var(--text-secondary)]" />
                      )}
                      <span className={
                        entry.kind === "everyone" ? "font-semibold text-[#FCA5A5]"
                        : entry.kind === "group" ? "font-semibold text-[#FCD34D]"
                        : ""
                      }>
                        {entry.kind === "everyone" ? "@everyone" : `@${entry.display}`}
                      </span>
                      {entry.kind === "everyone" && (
                        <span className="ml-auto text-[10px] text-[var(--text-secondary)]">
                          notify all team members
                        </span>
                      )}
                      {entry.kind === "group" && (
                        <span className="ml-auto text-[10px] text-[var(--text-secondary)]">
                          {entry.memberCount} member{entry.memberCount === 1 ? "" : "s"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* ── Pending attachments tray (Batch 8) ──────────────
                  Shows uploaded-but-not-yet-sent files. Each has a
                  remove button. Below: any upload error + uploading
                  spinner. */}
              {(pendingAttachments.length > 0 || uploadingCount > 0 || uploadError) && (
                <div className="mb-2 px-1">
                  <div className="flex flex-wrap gap-2">
                    {pendingAttachments.map(att => {
                      const isImage = att.mime_type?.startsWith("image/");
                      return (
                        <div
                          key={att.id}
                          className="relative flex items-center gap-2 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)]"
                          title={att.filename}
                        >
                          {isImage && att.signed_url ? (
                            <img src={att.signed_url} alt="" className="w-8 h-8 object-cover rounded" />
                          ) : (
                            <FileText size={14} className="text-[var(--text-muted)]" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] text-[var(--text-primary)] truncate max-w-[140px]">{att.filename}</div>
                            <div className="text-[9px] text-[var(--text-muted)]">{fmtFileSize(att.size_bytes)}</div>
                          </div>
                          <button
                            onClick={() => removePendingAttachment(att.id)}
                            className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                            title="Remove"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      );
                    })}
                    {uploadingCount > 0 && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[10px] text-[var(--text-muted)]">
                        <Loader2 size={11} className="animate-spin" />
                        Uploading {uploadingCount}…
                      </div>
                    )}
                  </div>
                  {uploadError && (
                    <div className="text-[10px] text-[var(--danger)] mt-1">{uploadError}</div>
                  )}
                </div>
              )}

              {/* Hidden file input — triggered by paperclip button. */}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={(e) => {
                  const files = Array.from(e.target.files || []);
                  uploadFiles(files);
                  e.target.value = ""; // allow re-selecting same file
                }}
                className="hidden"
              />

              <div
                className={`flex items-end gap-2 ${isDragOver ? "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--bg)] rounded-lg" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {/* Paperclip — opens file picker (Batch 8) */}
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-10 h-10 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] flex items-center justify-center shrink-0"
                  title="Attach file"
                >
                  <Paperclip size={14} />
                </button>
                {/* Textarea (not input) — Enter sends, Shift+Enter inserts a
                    newline. Single-line <input> elements can't render line
                    breaks at all, so multi-line drafts were impossible. */}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  placeholder={isDragOver ? "Drop files to attach…" : "@ Chat with your team... (type @ to mention, paste/drop files, Shift+Enter for new line)"}
                  rows={1}
                  className="flex-1 max-h-32 min-h-[40px] rounded-lg bg-[var(--bg)] border border-[var(--border)] px-3 py-2 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[#30363D] resize-none leading-snug"
                />
                <button
                  onClick={sendComment}
                  disabled={sending || (!input.trim() && pendingAttachments.length === 0) || uploadingCount > 0}
                  className="w-10 h-10 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] disabled:opacity-50 flex items-center justify-center shrink-0"
                  title={uploadingCount > 0 ? "Waiting for uploads to finish…" : "Send"}
                >
                  <Send size={14} />
                </button>
              </div>
            </div>
          </aside>

          {/* Image lightbox (Batch 8) — clicking an inline image in a
              comment bubble opens it full-size with a backdrop. Esc or
              backdrop-click closes. */}
          {lightboxUrl && (
            <div
              className="fixed inset-0 z-[1000] bg-black/80 flex items-center justify-center p-4"
              onClick={() => setLightboxUrl(null)}
              onKeyDown={(e) => { if (e.key === "Escape") setLightboxUrl(null); }}
            >
              <img
                src={lightboxUrl}
                alt="Attachment"
                className="max-w-full max-h-full object-contain rounded-md shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => setLightboxUrl(null)}
                className="absolute top-4 right-4 text-white/80 hover:text-white"
                title="Close (Esc)"
              >
                <X size={24} />
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}