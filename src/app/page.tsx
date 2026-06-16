"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase";
import {
  useActions,
  useConversations,
  useEmailAccounts,
  useFolders,
  useTasks,
  useTeamMembers,
  useSupplierAccountStatuses,
} from "@/lib/hooks";
import Sidebar from "@/components/Sidebar";
import ConversationList from "@/components/ConversationList";
import ConversationDetail from "@/components/ConversationDetail";
import ComposeEmail from "@/components/ComposeEmail";
import TaskBoard from "@/components/TaskBoard";
import DraftsPanel from "@/components/DraftsPanel";
import PendingOutreachPanel from "@/components/PendingOutreachPanel";
import CreateConversation from "@/components/CreateConversation";
import QuickCallModal from "@/components/QuickCallModal";
import TranscriptsSlideOver from "@/components/TranscriptsSlideOver";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type { Conversation, TaskStatus } from "@/types";

function parseHashParams() {
  if (typeof window === "undefined") {
    return {
      conversation: null as string | null,
      mailbox: null as string | null,
      folder: null as string | null,
      fullscreen: null as string | null,
    };
  }

  const raw = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(raw);

  return {
    conversation: params.get("conversation"),
    mailbox: params.get("mailbox"),
    folder: params.get("folder"),
    fullscreen: params.get("fullscreen"),
  };
}

export default function InboxPage() {
  const { data: session, status } = useSession();
  const teamMembers = useTeamMembers();
  const emailAccounts = useEmailAccounts(session?.user?.email);
  const folders = useFolders();
  const actions = useActions();
  // Batch 6, Feature 3: supplier status map for the conversation list filter.
  // Refetches in the background every 30s; safe to render the list before
  // it loads since the filter just shows no options until ready.
  const { statusMap: supplierStatusMap, allStatuses: allSupplierStatuses } = useSupplierAccountStatuses();

  const [activeMailbox, setActiveMailbox] = useState<string | null>(null);
  const [activeView, setActiveView] = useState("inbox");
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  // Fullscreen mode: when the URL hash includes `&fullscreen=1`, render
  // only the ConversationDetail pane (no sidebar, no list). Used by the
  // double-click-to-popout behavior on ConversationList rows.
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  // Phase 3: which sub-view of the active folder to show.
  //   • "unassigned" (default) — folder name itself: open + unassigned + in this folder
  //   • "all" — All sub-view: any conversation in this folder
  //   • "closed" — Closed sub-view: closures from this folder (separate data source)
  const [folderSubView, setFolderSubView] = useState<"unassigned" | "all" | "closed">("unassigned");
  const [searchQuery, setSearchQuery] = useState("");
  // Debounced version of searchQuery — lags real input by ~300ms. Used for:
  //   1. The /api/search fetch (avoids one fetch per keystroke)
  //   2. The globalSearchQuery passed to ConversationDetail (avoids re-firing
  //      the in-thread auto-activate effect on every keystroke, which steals
  //      focus from the main search bar)
  // The visible input is still controlled by `searchQuery` so typing feels
  // instant; only downstream effects use the debounced value.
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);
  const [searchScope, setSearchScope] = useState<"all" | "account" | "folder">("all");
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [searchSnippets, setSearchSnippets] = useState<Record<string, string>>({});
  const [searchTaskResults, setSearchTaskResults] = useState<any[]>([]);
  const searchTimerRef = useRef<any>(null);

  // QuickCallModal — opened from the sidebar QuickActions dropdown
  const [showCallModal, setShowCallModal] = useState(false);
  const [showTranscripts, setShowTranscripts] = useState(false);

  const { conversations, refetch } = useConversations(activeMailbox);

  const currentUser = useMemo(
    () => teamMembers.find((m) => m.email === session?.user?.email) || null,
    [teamMembers, session]
  );

  // Pinned conversation IDs for the current user. Refreshed on the global
  // "pins:changed" event so the Pinned view always reflects the latest set.
  const [pinnedIds, setPinnedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!currentUser?.id) {
      setPinnedIds(new Set());
      return;
    }
    let cancelled = false;
    const refresh = () => {
      fetch(`/api/conversations/pin?user_id=${currentUser.id}`)
        .then((r) => r.json())
        .then((data) => {
          if (cancelled) return;
          setPinnedIds(new Set(data?.pinned || []));
        })
        .catch(() => {});
    };
    refresh();
    const onChange = () => refresh();
    window.addEventListener("pins:changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("pins:changed", onChange);
    };
  }, [currentUser?.id]);

  // Full-text search across all messages. Uses the debounced query so we
  // don't fire one API call per keystroke. The inner setTimeout is kept
  // for backward compatibility but is now redundant — could be removed
  // since `debouncedSearchQuery` already lags by 300ms. Leaving it as a
  // tiny additional buffer; total perceived delay is still under half a
  // second.
  useEffect(() => {
    const q = debouncedSearchQuery.trim();
    if (!q || q.length < 2) {
      setSearchResults(null);
      setSearchSnippets({});
      setSearchTaskResults([]);
      return;
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(async () => {
      try {
        let url = "/api/search?q=" + encodeURIComponent(q);
        if (searchScope === "account" && activeMailbox) url += "&account_id=" + activeMailbox;
        if (searchScope === "folder" && activeFolder) url += "&folder_id=" + activeFolder;
        if (searchScope === "folder" && activeMailbox) url += "&account_id=" + activeMailbox;
        if (session?.user?.email) url += "&user_email=" + encodeURIComponent(session.user.email);
        const res = await fetch(url);
        const data = await res.json();
        setSearchResults((data.conversations || []) as Conversation[]);
        setSearchSnippets(data.match_snippets || {});
        setSearchTaskResults(data.tasks || []);
      } catch (_e) {
        setSearchResults(null);
        setSearchSnippets({});
      }
    }, 50);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [debouncedSearchQuery, searchScope, activeMailbox, activeFolder]);

  const { tasks: personalTasks, refetch: refetchTasks } = useTasks(currentUser?.id || null, "mine");

  // Fetch conversation IDs where current user sent a message
  const [mySentConvoIds, setMySentConvoIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!currentUser?.id) return;
    const sb = createBrowserClient();
    sb.from("messages")
      .select("conversation_id")
      .eq("is_outbound", true)
      .eq("sent_by_user_id", currentUser.id)
      .then(({ data }) => {
        setMySentConvoIds(new Set((data || []).map((m: any) => m.conversation_id)));
      });
  }, [currentUser?.id]);

  // Track which conversations the current user is watching (for the "Watching" view filter).
  // We track BOTH the set of IDs (for fast membership checks) AND a fallback map of
  // full conversation data for watched threads that aren't already in the local
  // `conversations` array. The local array only loads the top 300 recent + assigned;
  // an older watched thread would otherwise count in the sidebar but never render.
  const [watchingConvoIds, setWatchingConvoIds] = useState<Set<string>>(new Set());
  const [watchingExtraConvos, setWatchingExtraConvos] = useState<Conversation[]>([]);
  useEffect(() => {
    if (!currentUser?.id) return;
    const fetchWatching = async () => {
      try {
        const res = await fetch(`/api/conversations/watchers?user_id=${currentUser.id}`);
        if (!res.ok) return;
        const data = await res.json();
        const ids = new Set<string>((data.watching || []).map((w: any) => w.conversation_id));
        setWatchingConvoIds(ids);

        // Lazy-hydrate any watched conversations that aren't in the locally loaded
        // `conversations` array. Without this, an older watched thread shows in the
        // sidebar count but never appears in the Watching list (the cause of the
        // "count says 3, list shows 2" bug).
        if (ids.size === 0) {
          setWatchingExtraConvos([]);
          return;
        }
        const localIds = new Set(conversations.map((c) => c.id));
        const missing = Array.from(ids).filter((id) => !localIds.has(id));
        if (missing.length === 0) {
          setWatchingExtraConvos([]);
          return;
        }
        try {
          const sb = createBrowserClient();
          const { data: extra } = await sb
            .from("conversations")
            .select(`
              id,
              email_account_id,
              folder_id,
              thread_id,
              subject,
              from_name,
              from_email,
              preview,
              is_unread,
              is_starred,
              assignee_id,
              status,
              has_attachments,
              last_message_at,
              created_at,
              updated_at,
              supplier_contact_id,
              assignee:team_members!conversations_assignee_id_fkey(*),
              labels:conversation_labels(label_id, label:labels(*))
            `)
            .in("id", missing)
            .neq("status", "merged");
          setWatchingExtraConvos((extra || []) as unknown as Conversation[]);
        } catch (_e) {
          setWatchingExtraConvos([]);
        }
      } catch (_e) {}
    };
    fetchWatching();
    const id = setInterval(fetchWatching, 30000);
    return () => clearInterval(id);
  }, [currentUser?.id, conversations]);

  const accountEmails = useMemo(
    () => new Set(emailAccounts.map((a) => a.email?.toLowerCase()).filter(Boolean)),
    [emailAccounts]
  );

  const isOutboundConvo = (c: Conversation) =>
    accountEmails.has(c.from_email?.toLowerCase?.() || "");

  const isTaskView = (activeView === "tasks" || activeView === "new-task") && !activeMailbox && !activeFolder;
  const isDraftsView = activeView === "drafts" && !activeMailbox && !activeFolder;
  // Per-account "Drafts" virtual folder — selected when the user clicks the
  // Drafts row under an account in the sidebar. Shows ALL team members'
  // drafts on that account.
  const isAccountDraftsView = activeView === "account-drafts" && !!activeMailbox && !activeFolder;
  // Pending Outreach: agent-created drafts where requires_sender_selection
  // is TRUE. Sidebar entry between Drafts and Sent. Global scope (across all
  // accounts), so account/folder filters don't apply.
  const isPendingOutreachView = activeView === "pending-outreach" && !activeMailbox && !activeFolder;
  const isNewConversation = activeView === "new-conversation";

  const displayConversations = useMemo(() => {
    let filtered = conversations;

    const selectedFolder = activeFolder
      ? folders.find((folder: any) => folder.id === activeFolder)
      : null;

    // Check if we're viewing a Trash system folder
    const isTrashFolder = selectedFolder?.is_system && String(selectedFolder.name || "").toLowerCase() === "trash";
    // Check if we're viewing a Spam system folder
    const isSpamFolder = selectedFolder?.is_system && String(selectedFolder.name || "").toLowerCase() === "spam";
    // Check if we're viewing an Archive system folder
    const isArchiveFolder = selectedFolder?.is_system && String(selectedFolder.name || "").toLowerCase() === "archive";

    if (isTrashFolder) {
      // Show only trashed conversations for this account
      filtered = conversations.filter(
        (c) => c.status === "trash" && c.email_account_id === activeMailbox
      );
    } else if (isSpamFolder) {
      // Show only spam conversations for this account
      filtered = conversations.filter(
        (c) => c.status === "spam" && c.email_account_id === activeMailbox
      );
    } else if (isArchiveFolder) {
      // Show all conversations in this account's Archive folder.
      // INCLUDES status='merged' (the empty shells from merges) so users
      // can see/recover merged threads. Excludes trash/spam (those have
      // their own folders).
      filtered = conversations.filter(
        (c) =>
          c.email_account_id === activeMailbox &&
          c.folder_id === selectedFolder.id &&
          c.status !== "trash" &&
          c.status !== "spam"
      );
    } else if (activeMailbox && selectedFolder) {
      const folderName = String(selectedFolder.name || "").toLowerCase();
      const isSystemInbox = selectedFolder.is_system && folderName === "inbox";
      const isSystemSent = selectedFolder.is_system && folderName === "sent";

      // Phase 3: when on All / Closed sub-views, do NOT strip assigned convos at this stage.
      // ConversationList narrows further. Only the default "unassigned" sub-view stays strict.
      const includeAssigned = folderSubView !== "unassigned";

      if (isSystemInbox) {
        if (includeAssigned) {
          // All / Closed sub-views: include every conversation in this account's Inbox,
          // assigned or not. ConversationList narrows further.
          filtered = conversations.filter(
            (c) =>
              c.email_account_id === activeMailbox &&
              (c.folder_id === null || c.folder_id === selectedFolder.id)
          );
        } else {
          // Team inbox (default click): show unassigned conversations only
          filtered = conversations.filter(
            (c) =>
              c.email_account_id === activeMailbox &&
              !c.assignee_id &&
              (c.folder_id === null || c.folder_id === selectedFolder.id)
          );
        }
      } else if (isSystemSent) {
        filtered = conversations.filter(
          (c) =>
            c.email_account_id === activeMailbox &&
            c.folder_id === selectedFolder.id
        );
      } else {
        // Custom folder. Match by folder_id, but for All / Closed sub-views
        // ALSO match by the folder's label name — assigning a conversation
        // clears folder_id (so it leaves the unassigned view) but keeps the
        // folder label, which is the durable record of "this conversation
        // belongs to folder X." Without the label fallback, assigned
        // threads disappear from their folder's All view entirely.
        if (includeAssigned) {
          const folderLabelName = String(selectedFolder.name || "").toLowerCase();
          filtered = conversations.filter(
            (c) =>
              c.email_account_id === activeMailbox &&
              (c.folder_id === selectedFolder.id ||
                (c.labels || []).some(
                  (cl: any) =>
                    String(cl?.label?.name || "").toLowerCase() === folderLabelName
                ))
          );
        } else {
          // Default unassigned view: strict folder_id match. Correct for
          // "inbox-zero" workflow — assigned threads should disappear.
          filtered = conversations.filter(
            (c) =>
              c.email_account_id === activeMailbox &&
              c.folder_id === selectedFolder.id
          );
        }
      }
    } else if (activeMailbox) {
      filtered = conversations.filter((c) => c.email_account_id === activeMailbox);
    } else if (!activeMailbox && currentUser) {
      if (activeView === "sent") {
        // Personal sent: show conversations where I actually sent a message
        filtered = conversations.filter((c) => mySentConvoIds.has(c.id));
      } else if (activeView === "watching") {
        // Watching: show conversations the current user is watching.
        // Union: local convos that are watched + any watched convos hydrated
        // separately (older threads not in the recent-300 fetch).
        const fromLocal = conversations.filter((c) => watchingConvoIds.has(c.id));
        const localIds = new Set(fromLocal.map((c) => c.id));
        const extras = watchingExtraConvos.filter((c) => !localIds.has(c.id));
        filtered = [...fromLocal, ...extras];
      } else if (activeView === "pinned") {
        // Pinned: only conversations the user has personally pinned AND that
        // are still assigned to them (per the design — pin is for "stuff on
        // my plate I want quick access to"). If the conversation gets
        // reassigned or closed, it disappears from Pinned but the pin row
        // stays (soft-hide). Re-assigning back surfaces it again.
        filtered = conversations.filter(
          (c) =>
            pinnedIds.has(c.id) &&
            c.assignee_id === currentUser.id &&
            c.status !== "closed" &&
            c.status !== "trash" &&
            c.status !== "spam"
        );
      } else if (activeView === "inbox") {
        // Personal inbox: show ALL conversations assigned to me
        filtered = conversations.filter(
          (c) => c.assignee_id === currentUser.id
        );
      } else {
        filtered = conversations.filter((c) => c.assignee_id === currentUser.id);
      }
    }

    // Exclude trashed conversations from all views except Trash folder
    if (!isTrashFolder) {
      filtered = filtered.filter((c) => c.status !== "trash");
    }
    // Exclude spam conversations from all views except Spam folder
    if (!isSpamFolder) {
      filtered = filtered.filter((c) => c.status !== "spam");
    }
    // Exclude merged shells from all views except Archive folder. The Archive
    // is the resting place for merged conversations — they should be hidden
    // from Inbox/personal/folder views and ONLY surface in Archive (or via
    // direct conversation URL).
    if (!isArchiveFolder) {
      filtered = filtered.filter((c) => c.status !== "merged");
    }

    if (debouncedSearchQuery.trim() && debouncedSearchQuery.trim().length >= 2) {
      // When searching, show results from ALL accounts (returned by search API)
      if (searchResults) {
        return searchResults;
      } else {
        // Fallback: local search while API is loading. Uses the debounced
        // query so the filter doesn't recompute on every keystroke (which
        // was previously the case and added jank on large inboxes).
        const q = debouncedSearchQuery.toLowerCase();
        filtered = conversations.filter(
          (c) =>
            c.status !== "trash" && c.status !== "spam" && (
            c.subject?.toLowerCase().includes(q) ||
            c.from_name?.toLowerCase().includes(q) ||
            c.from_email?.toLowerCase().includes(q) ||
            c.preview?.toLowerCase().includes(q))
        );
      }
    }

    return filtered;
  }, [
    conversations,
    folders,
    activeMailbox,
    activeFolder,
    activeView,
    folderSubView,
    currentUser,
    debouncedSearchQuery,
    searchResults,
    accountEmails,
    mySentConvoIds,
    watchingConvoIds,
    watchingExtraConvos,
    pinnedIds,
  ]);

  // Handle hash-based navigation (notifications, task links, direct URLs)
  const processedHashRef = useRef<string | null>(null);

  useEffect(() => {
    const handleHashNav = async () => {
      if (activeView === "new-conversation" || activeView === "compose" || activeView === "new-task") return;

      const { conversation, mailbox, folder, fullscreen } = parseHashParams();
      // Sync fullscreen flag from the URL on every hashchange so popouts
      // toggle correctly when the user navigates the popup itself.
      setIsFullscreen(fullscreen === "1");
      if (!conversation) return;

      // Don't re-process the same hash
      const hashKey = conversation + (mailbox || "") + (folder || "");
      if (processedHashRef.current === hashKey) return;
      processedHashRef.current = hashKey;

      if (mailbox) {
        setActiveMailbox(mailbox);
        setActiveView("inbox");
      }
      if (folder) {
        setActiveFolder(folder);
      }

      let match = conversations.find((item) => item.id === conversation);

      if (!match) {
        // Conversation not in current list — fetch from Supabase
        try {
          const sb = createBrowserClient();
          const { data } = await sb
            .from("conversations")
            .select("id, thread_id, email_account_id, folder_id, subject, from_name, from_email, preview, is_unread, is_starred, assignee_id, status, last_message_at, created_at, supplier_contact_id")
            .eq("id", conversation)
            .maybeSingle();
          if (data) match = data as any;
        } catch (_e) {}
      }

      if (match) {
        setActiveConvo(match);
        setActiveView("inbox");

        if (match.email_account_id) {
          setActiveMailbox(match.email_account_id);
        }
        if (match.folder_id) {
          setActiveFolder(match.folder_id);
        }
      }
    };

    handleHashNav();
    const onHashChange = () => {
      processedHashRef.current = null;
      handleHashNav();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [conversations, activeView]);

  const handleAssign = async (
    conversationId: string,
    assigneeId: string | null,
    updatedConversation?: any
  ) => {
    if (activeConvo && activeConvo.id === conversationId) {
      // Batch 11: deterministically clear `assignee` on unassign so the header doesn't show stale data.
      // Previously: `updatedConversation?.assignee || newAssignee || undefined` could leave the
      // embedded object intact in some edge cases. Now we explicitly set `null` when unassigning.
      const isUnassigning = assigneeId === null;
      const newAssignee = isUnassigning
        ? null
        : (teamMembers.find((m) => m.id === assigneeId) || null);
      setActiveConvo({
        ...activeConvo,
        assignee_id: assigneeId,
        folder_id: assigneeId ? null : activeConvo.folder_id,
        assignee: isUnassigning ? null : (updatedConversation?.assignee || newAssignee),
      } as Conversation);
    }
    refetch();
  };

  const handleMoveToFolder = async (conversationIds: string[], folderId: string) => {
    try {
      const res = await fetch("/api/conversations/move", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_ids: conversationIds,
          folder_id: folderId,
          actor_id: currentUser?.id,
        }),
      });

      if (res.ok) {
        refetch();

        if (activeConvo && conversationIds.includes(activeConvo.id)) {
          setActiveConvo({
            ...activeConvo,
            folder_id: folderId,
            assignee_id: null,
          } as Conversation);
        }
      }
    } catch (err) {
      console.error("Move to folder failed:", err);
    }
  };

  const handleBulkAction = async (ids: string[], action: string, payload?: any) => {
    try {
      if (action === "move_folder" && payload?.folder_id) {
        await handleMoveToFolder(ids, payload.folder_id);
        return;
      }

      const res = await fetch("/api/conversations/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action, actor_id: currentUser?.id, ...payload }),
      });

      if (res.ok) {
        refetch();

        if (activeConvo && ids.includes(activeConvo.id)) {
          if (action === "archive" || action === "delete") {
            setActiveConvo(null);
          }
        }
      }
    } catch (err) {
      console.error("Bulk action failed:", err);
    }
  };

  const handleAddTask = async (
    conversationId: string,
    text: string,
    assigneeIds?: string[],
    dueDate?: string,
    categoryId?: string,
    dueTime?: string
  ) => {
    await actions.addTask(conversationId, text, assigneeIds, dueDate, categoryId, dueTime);
    await Promise.all([refetch(), refetchTasks()]);
  };

  const handleToggleTask = async (taskId: string, isDone: boolean) => {
    await actions.toggleTask(taskId, isDone);
    await Promise.all([refetch(), refetchTasks()]);
  };

  const handleUpdateTask = async (
    taskId: string,
    updates: { status?: TaskStatus; dueDate?: string | null; assigneeIds?: string[] }
  ) => {
    await actions.updateTask(taskId, updates);
    await Promise.all([refetch(), refetchTasks()]);
  };

  const openConversationFromTask = async (conversationId: string) => {
    let match = conversations.find((conversation) => conversation.id === conversationId);

    if (!match) {
      // Conversation not in current list (different mailbox/folder) — fetch it
      const sb = createBrowserClient();
      const { data } = await sb
        .from("conversations")
        .select("id, thread_id, email_account_id, folder_id, subject, from_name, from_email, preview, is_unread, is_starred, assignee_id, status, last_message_at, created_at, supplier_contact_id")
        .eq("id", conversationId)
        .maybeSingle();

      if (!data) return;
      match = data as any;

      // Switch to the correct mailbox/folder
      if (data.email_account_id) setActiveMailbox(data.email_account_id);
      if (data.folder_id) setActiveFolder(data.folder_id);
    }

    setActiveConvo(match!);
    setActiveView("inbox");
    if (match!.email_account_id) setActiveMailbox(match!.email_account_id);
    if (match!.folder_id) setActiveFolder(match!.folder_id);
    setSearchQuery("");
  };

  const isComposing = activeView === "compose";

  if (status === "loading") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg)]">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--border)] border-t-[var(--accent)] animate-spin" />
      </div>
    );
  }

  if (!session) {
    redirect("/login");
  }

  // ── Fullscreen / popout mode ───────────────────────────────────────────
  // When the URL hash carries `&fullscreen=1` (set by double-clicking a row
  // in ConversationList), render only the ConversationDetail pane in a
  // standalone full-window layout. This makes the popup browser window
  // feel like a dedicated Gmail-style conversation view. All callbacks and
  // state still come from this same page instance, so reply, notes, tasks,
  // status changes etc. work identically to the embedded view.
  if (isFullscreen) {
    return (
      <div className="h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]">
        <ConversationDetail
          conversation={activeConvo}
          currentUser={currentUser}
          teamMembers={teamMembers}
          emailAccounts={emailAccounts}
          onAddNote={actions.addNote}
          onToggleTask={handleToggleTask}
          onAddTask={handleAddTask}
          onUpdateTask={handleUpdateTask}
          onAssign={handleAssign}
          onSendReply={actions.sendReply}
          onMoveToFolder={handleMoveToFolder}
          globalSearchQuery=""
        />
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-hidden bg-[var(--bg)] text-[var(--text-primary)]">
      <PanelGroup direction="horizontal" autoSaveId="inbox-layout-v1" className="h-full w-full">
        {/* ── Panel 1: Sidebar ── */}
        <Panel defaultSize={14} minSize={10} maxSize={25} order={1} id="sidebar">
          <Sidebar
            activeMailbox={activeMailbox}
            setActiveMailbox={setActiveMailbox}
            activeView={activeView}
            setActiveView={setActiveView}
            activeFolder={activeFolder}
            setActiveFolder={setActiveFolder}
            folderSubView={folderSubView}
            setFolderSubView={setFolderSubView}
            mailboxes={emailAccounts}
            conversations={conversations}
            currentUser={currentUser}
            taskTodoCount={(() => {
              // Mirror TaskBoard.getMyStatus: for multi-assignee tasks, use the
              // current user's personal_status; for single-assignee, use task.status.
              // Dismissed always counts as dismissed.
              const myStatus = (task: any): string => {
                if (task.status === "dismissed") return "dismissed";
                const assignees = task.assignees || [];
                if (assignees.length > 1 && currentUser) {
                  const me = assignees.find((a: any) => a.id === currentUser.id);
                  if (me) return me.personal_status || (me.is_done ? "completed" : "todo");
                }
                return task.status;
              };
              return personalTasks.filter((t) => myStatus(t) === "todo").length;
            })()}
            taskInProgressCount={(() => {
              const myStatus = (task: any): string => {
                if (task.status === "dismissed") return "dismissed";
                const assignees = task.assignees || [];
                if (assignees.length > 1 && currentUser) {
                  const me = assignees.find((a: any) => a.id === currentUser.id);
                  if (me) return me.personal_status || (me.is_done ? "completed" : "todo");
                }
                return task.status;
              };
              return personalTasks.filter((t) => myStatus(t) === "in_progress").length;
            })()}
            mySentCount={mySentConvoIds.size}
            onMoveToFolder={handleMoveToFolder}
            onMakeCall={() => setShowCallModal(true)}
            onOpenTranscripts={() => setShowTranscripts(true)}
          />
        </Panel>

        <PanelResizeHandle className="resize-handle" />

        {isComposing ? (
          <Panel defaultSize={86} minSize={50} order={2} id="content-compose">
            <ComposeEmail
              currentUser={currentUser}
              onClose={() => setActiveView("inbox")}
              onSent={() => {
                refetch();
                setActiveView("inbox");
              }}
            />
          </Panel>
        ) : isNewConversation ? (
          <Panel defaultSize={86} minSize={50} order={2} id="content-new-conversation">
            <CreateConversation
              currentUser={currentUser}
              teamMembers={teamMembers}
              emailAccounts={emailAccounts}
              onCreated={(conversationId) => {
                // Clear hash first to prevent stale navigation
                window.location.hash = "";
                refetch();
                setActiveView("inbox");
                setActiveConvo(null);
                // Navigate to the new conversation after data refreshes
                setTimeout(() => {
                  window.location.hash = "conversation=" + conversationId + "&highlight=true";
                }, 800);
              }}
              onClose={() => {
                window.location.hash = "";
                setActiveView("inbox");
              }}
            />
          </Panel>
        ) : isTaskView ? (
          <Panel defaultSize={86} minSize={50} order={2} id="content-tasks">
            <TaskBoard
              currentUser={currentUser}
              teamMembers={teamMembers}
              onTasksChanged={refetchTasks}
              autoOpenComposer={activeView === "new-task"}
              onOpenConversation={openConversationFromTask}
            />
          </Panel>
        ) : isDraftsView ? (
          <Panel defaultSize={86} minSize={50} order={2} id="content-drafts">
            <DraftsPanel
              currentUser={currentUser}
              onOpenConversation={(conversationId) => {
                setActiveView("inbox");
                window.location.hash = `#conversation=${conversationId}`;
              }}
              onOpenCompose={() => setActiveView("compose")}
            />
          </Panel>
        ) : isPendingOutreachView ? (
          // Pending Outreach view — agent-created drafts awaiting an
          // operator's sender-account choice. Single full-width panel,
          // no sidebar/list (global scope across all email accounts).
          <Panel defaultSize={86} minSize={50} order={2} id="content-pending-outreach">
            <PendingOutreachPanel
              currentUser={currentUser}
              emailAccounts={emailAccounts}
              onOpenConversation={(conversationId) => {
                setActiveView("inbox");
                window.location.hash = `#conversation=${conversationId}`;
              }}
            />
          </Panel>
        ) : isAccountDraftsView ? (
          // Per-account Drafts view — same panel, scoped to one email account
          // and showing drafts from ALL team members.
          <Panel defaultSize={86} minSize={50} order={2} id="content-account-drafts">
            <DraftsPanel
              currentUser={currentUser}
              emailAccountId={activeMailbox}
              emailAccountName={emailAccounts.find((a: any) => a.id === activeMailbox)?.name || null}
              onOpenConversation={(conversationId) => {
                setActiveView("inbox");
                window.location.hash = `#conversation=${conversationId}`;
              }}
              onOpenCompose={() => setActiveView("compose")}
            />
          </Panel>
        ) : (
          <>
            {/* ── Panel 2: ConversationList ── */}
            <Panel defaultSize={22} minSize={15} maxSize={45} order={2} id="conversation-list">
              <ConversationList
                conversations={displayConversations}
                activeConvo={activeConvo}
                setActiveConvo={setActiveConvo}
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                searchScope={searchScope}
                setSearchScope={setSearchScope}
                activeMailbox={activeMailbox}
                activeFolder={activeFolder}
                folderSubView={folderSubView}
                emailAccounts={emailAccounts}
                folders={folders}
                teamMembers={teamMembers}
                onBulkAction={handleBulkAction}
                searchSnippets={searchSnippets}
                searchTaskResults={searchTaskResults}
                onOpenConversation={openConversationFromTask}
                currentUserId={currentUser?.id || null}
                supplierStatusMap={supplierStatusMap}
                allSupplierStatuses={allSupplierStatuses}
              />
            </Panel>

            <PanelResizeHandle className="resize-handle" />

            {/* ── Panel 3: ConversationDetail ── */}
            <Panel defaultSize={64} minSize={30} order={3} id="conversation-detail">
              <ConversationDetail
                conversation={activeConvo}
                currentUser={currentUser}
                teamMembers={teamMembers}
                emailAccounts={emailAccounts}
                onAddNote={actions.addNote}
                onToggleTask={handleToggleTask}
                onAddTask={handleAddTask}
                onUpdateTask={handleUpdateTask}
                onAssign={handleAssign}
                onSendReply={actions.sendReply}
                onMoveToFolder={handleMoveToFolder}
                globalSearchQuery={debouncedSearchQuery.trim().length >= 2 ? debouncedSearchQuery : ""}
              />
            </Panel>
          </>
        )}
      </PanelGroup>

      {/* Quick call modal — triggered from QuickActions dropdown in sidebar */}
      <QuickCallModal
        isOpen={showCallModal}
        onClose={() => setShowCallModal(false)}
        onCallPlaced={(stub) => {
          // If the stub was linked to a conversation, navigate there so the
          // stub call entry is immediately visible in the timeline.
          if (stub?.conversation_id) {
            const target = conversations.find((c) => c.id === stub.conversation_id);
            if (target) {
              setActiveConvo(target);
              setActiveView("inbox");
            }
          }
        }}
      />

      {/* Granola transcripts side panel — triggered from sidebar header button */}
      <TranscriptsSlideOver
        open={showTranscripts}
        onClose={() => setShowTranscripts(false)}
        currentUserEmail={currentUser?.email || session?.user?.email || null}
      />
    </div>
  );
}