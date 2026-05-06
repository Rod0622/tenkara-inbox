"use client";

import { useState, useEffect, useRef } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  Inbox,
  Send,
  CheckSquare,
  Settings,
  LogOut,
  RefreshCw,
  Plus,
  ChevronRight,
  FolderPlus,
  MoreHorizontal,
  Trash2,
  PenSquare,
  ChevronDown,
  MailPlus,
  BarChart3,
  Bell,
  MessageSquare,
  FileEdit,
  Eye,
  Sun,
  Moon,
} from "lucide-react";
import type { SidebarProps, Folder } from "@/types";
import UserOOOPopover from "./UserOOOPopover";
import SidebarTeamList from "./SidebarTeamList";
import { useTheme } from "@/lib/theme";

function QuickCreateMenu({
  onCompose,
  onNewTask,
  onNewConversation,
}: {
  onCompose: () => void;
  onNewTask: () => void;
  onNewConversation: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    if (open) {
      document.addEventListener("mousedown", handleClick);
    }

    return () => {
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  return (
    <div className="flex items-center gap-1.5" ref={ref}>
      <button
        onClick={onCompose}
        className="w-7 h-7 rounded-md flex items-center justify-center bg-[var(--accent)] text-[var(--bg)] hover:bg-[var(--accent)] active:scale-[0.98] transition-all"
        title="Compose email"
      >
        <Plus size={14} />
      </button>

      <div className="relative">
        <button
          onClick={() => setOpen((value) => !value)}
          className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-all"
          title="More quick actions"
        >
          <ChevronDown size={14} />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-48 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl shadow-black/40 py-1 z-50">
            <button
              onClick={() => {
                onCompose();
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center gap-2"
            >
              <PenSquare size={14} className="text-[var(--accent)]" />
              Compose email
            </button>

            <button
              onClick={() => {
                onNewTask();
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center gap-2"
            >
              <CheckSquare size={14} className="text-[var(--info)]" />
              New task
            </button>

            <button
              onClick={() => {
                onNewConversation();
                setOpen(false);
              }}
              className="w-full px-3 py-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center gap-2"
            >
              <MessageSquare size={14} className="text-[var(--warning)]" />
              Create conversation
            </button>

            <Link
              href="/settings"
              className="w-full px-3 py-2 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center gap-2"
              onClick={() => setOpen(false)}
            >
              <MailPlus size={14} className="text-[var(--highlight)]" />
              Add shared account
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Sidebar({
  activeMailbox,
  setActiveMailbox,
  activeView,
  setActiveView,
  activeFolder,
  setActiveFolder,
  mailboxes,
  conversations,
  currentUser,
  taskCount = 0,
  mySentCount: mySentCountProp,
  onMoveToFolder,
}: SidebarProps) {
  const [syncing, setSyncing] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [addingFolder, setAddingFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [draftsCount, setDraftsCount] = useState(0);
  const [notifCount, setNotifCount] = useState(0);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [watchingCount, setWatchingCount] = useState(0);
  // Own OOO popover (anchored to user-name button at bottom of sidebar)
  const [showOwnOOO, setShowOwnOOO] = useState(false);
  const [ownOOOAnchor, setOwnOOOAnchor] = useState<{ top: number; left: number } | null>(null);
  // Track current user's OOO status to show indicator on the user-name button
  const [meIsOOO, setMeIsOOO] = useState(false);
  const userBtnRef = useRef<HTMLButtonElement>(null);

  // Batch 14 / Phase 1: theme toggle (dark / light)
  const { theme, toggle: toggleTheme } = useTheme();

  // Fetch notifications and check due reminders
  useEffect(() => {
    if (!currentUser?.id) return;
    const fetchNotifs = async () => {
      try {
        const res = await fetch("/api/notifications?user_id=" + currentUser.id);
        const data = await res.json();
        const notifs = data.notifications || [];
        setNotifications(notifs);
        setNotifCount(notifs.filter((n: any) => !n.is_read).length);

        // Fetch drafts count
        const draftsRes = await fetch(`/api/drafts?author_id=${currentUser.id}`);
        if (draftsRes.ok) { const d = await draftsRes.json(); setDraftsCount((d.drafts || []).length); }

        // Check for due follow-up reminders
        await fetch("/api/reminders?user_id=" + currentUser.id + "&check_due=true");
      } catch (_e) {}
    };
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 15000);
    return () => clearInterval(interval);
  }, [currentUser?.id]);

  // Fetch own OOO status separately (lighter query than full team list)
  useEffect(() => {
    if (!currentUser?.id) return;
    const fetchOwnOOO = async () => {
      try {
        const res = await fetch(`/api/team/ooo?user_id=${currentUser.id}`);
        if (!res.ok) return;
        const data = await res.json();
        setMeIsOOO(!!data.is_currently_ooo);
      } catch (_e) {}
    };
    fetchOwnOOO();
    const id = setInterval(fetchOwnOOO, 60000);
    return () => clearInterval(id);
  }, [currentUser?.id]);

  // Fetch count of conversations the user is watching
  useEffect(() => {
    if (!currentUser?.id) return;
    const fetchWatching = async () => {
      try {
        const res = await fetch(`/api/conversations/watchers?user_id=${currentUser.id}`);
        if (!res.ok) return;
        const data = await res.json();
        setWatchingCount((data.watching || []).length);
      } catch (_e) {}
    };
    fetchWatching();
    const id = setInterval(fetchWatching, 30000);
    return () => clearInterval(id);
  }, [currentUser?.id]);

  const markAllRead = async () => {
    if (!currentUser?.id) return;
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: currentUser.id, mark_all: true }),
    });
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setNotifCount(0);
  };

  const handleNotifClick = (notif: any) => {
    // Mark as read
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notification_ids: [notif.id] }),
    });
    setNotifications((prev) => prev.map((n) => n.id === notif.id ? { ...n, is_read: true } : n));
    setNotifCount((prev) => Math.max(0, prev - (notif.is_read ? 0 : 1)));
    setShowNotifications(false);

    // Navigate based on type — include highlight param
    if (notif.type === "task_assigned" && notif.task_id) {
      // Go to tasks view with highlight
      setActiveView("tasks");
      setActiveMailbox(null);
      setActiveFolder(null);
      window.location.hash = "highlight_task=" + notif.task_id;
    } else if (notif.type === "mention" && notif.conversation_id) {
      // Go to conversation AND auto-open team chat (where the mention was made)
      window.location.hash = "conversation=" + notif.conversation_id + "&highlight=true&open_team_chat=1";
    } else if (notif.conversation_id) {
      // Go to conversation with highlight
      window.location.hash = "conversation=" + notif.conversation_id + "&highlight=true";
    }
  };

  const accountEmails = new Set(mailboxes.map((a: any) => a.email?.toLowerCase()));
  const isOutbound = (c: any) => accountEmails.has(c.from_email?.toLowerCase());

  const myConvos = conversations.filter(
    (c) => c.assignee_id === currentUser?.id
  );
  const myTotalCount = myConvos.length;
  const myUnreadCount = myConvos.filter((c) => c.is_unread).length;
  const mySentCount = mySentCountProp ?? conversations.filter((c) => isOutbound(c)).length;

  useEffect(() => {
    fetchFolders();
  }, []);

  const fetchFolders = async () => {
    try {
      const res = await fetch("/api/folders");
      if (res.ok) {
        const data = await res.json();
        setFolders(data.folders || []);
      }
    } catch (err) {
      console.error("Failed to fetch folders:", err);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      console.log("Sync result:", data);
      window.location.reload();
    } catch (err) {
      console.error("Sync failed:", err);
    }
    setSyncing(false);
  };

  const toggleAccount = (accountId: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  const handleCreateFolder = async (accountId: string) => {
    if (!newFolderName.trim()) return;
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email_account_id: accountId, name: newFolderName.trim() }),
      });
      if (res.ok) {
        setNewFolderName("");
        setAddingFolder(null);
        fetchFolders();
      }
    } catch (err) {
      console.error("Failed to create folder:", err);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    try {
      const res = await fetch(`/api/folders?id=${folderId}`, { method: "DELETE" });
      if (res.ok) {
        setFolderMenuOpen(null);
        fetchFolders();
        if (activeFolder === folderId) setActiveFolder(null);
      }
    } catch (err) {
      console.error("Failed to delete folder:", err);
    }
  };

  const getFoldersForAccount = (accountId: string) =>
    folders
      .filter((f) => f.email_account_id === accountId)
      .sort((a, b) => a.sort_order - b.sort_order);

  const handleDragOver = (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverFolder(folderId);
  };

  const handleDragLeave = () => {
    setDragOverFolder(null);
  };

  const handleDrop = async (e: React.DragEvent, folderId: string) => {
    e.preventDefault();
    setDragOverFolder(null);
    const conversationIds = e.dataTransfer.getData("text/conversation-ids");
    if (conversationIds && onMoveToFolder) {
      const ids = JSON.parse(conversationIds);
      await onMoveToFolder(ids, folderId);
    }
  };

  return (
    <div className="w-[240px] min-w-[240px] h-full bg-[var(--bg)] border-r border-[var(--border)] flex flex-col overflow-hidden">
      <div className="p-4 pb-3 border-b border-[var(--surface-2)]">
  <div className="flex items-center gap-2.5">
    <button
      onClick={() => setShowNotifications(!showNotifications)}
      className="relative w-8 h-8 rounded-lg bg-[var(--accent)] flex items-center justify-center hover:bg-[var(--accent-strong)] transition-colors"
    >
      {/* Tenkara loop icon — white version sits on the gold/green button regardless of theme. */}
      <img
        src="/logo-icon-white.png"
        alt="Tenkara"
        className="w-5 h-5"
        draggable={false}
      />
      {notifCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[var(--danger)] text-[9px] font-bold text-white flex items-center justify-center">
          {notifCount > 99 ? "99+" : notifCount}
        </span>
      )}
    </button>

    <div className="flex-1 min-w-0">
      {/* Wordmark — two lines: "Tenkara" on top, "Shared Inbox" italic below.
          Both in Instrument Serif (same as page headlines). */}
      <div className="text-base font-normal font-serif text-[var(--text-primary)] tracking-tight leading-none truncate">
        Tenkara
      </div>
      <div className="text-[12px] font-normal font-serif italic text-[var(--text-secondary)] tracking-tight leading-tight mt-0.5 truncate">
        Shared Inbox
      </div>
    </div>

    <button
      onClick={handleSync}
      disabled={syncing}
      className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${
        syncing ? "text-[var(--accent)]" : "text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--surface)]"
      }`}
      title="Sync emails"
    >
      <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
    </button>

    <QuickCreateMenu
      onCompose={() => setActiveView("compose")}
      onNewTask={() => {
        setActiveView("new-task");
        setActiveMailbox(null);
        setActiveFolder(null);
      }}
      onNewConversation={() => {
        setActiveView("new-conversation");
        setActiveMailbox(null);
        setActiveFolder(null);
      }}
    />
  </div>
</div>

      {/* Notification Panel */}
      {showNotifications && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
          <div className="absolute left-0 top-14 z-50 w-[300px] max-h-[400px] bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden flex flex-col ml-2">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
              <span className="text-xs font-bold text-[var(--text-primary)]">Notifications</span>
              {notifCount > 0 && (
                <button onClick={markAllRead} className="text-[10px] text-[var(--info)] hover:text-[var(--info)]">Mark all read</button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="text-center py-8 text-[var(--text-muted)] text-xs">No notifications</div>
              ) : (
                notifications.slice(0, 30).map((notif) => (
                  <button
                    key={notif.id}
                    onClick={() => handleNotifClick(notif)}
                    className={"w-full text-left px-3 py-2.5 border-b border-[var(--border)]/50 hover:bg-[var(--surface)] transition-colors " + (notif.is_read ? "opacity-60" : "")}
                  >
                    <div className="flex items-start gap-2">
                      {notif.actor && (
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-[var(--bg)] flex-shrink-0 mt-0.5"
                          style={{ background: notif.actor.color || "var(--accent)" }}>
                          {notif.actor.initials || "?"}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-semibold text-[var(--text-primary)]">{notif.title}</div>
                        {notif.body && <div className="text-[10px] text-[var(--text-secondary)] truncate">{notif.body}</div>}
                        {notif.conversation?.subject && <div className="text-[10px] text-[var(--text-muted)] truncate">{notif.conversation.subject}</div>}
                        <div className="text-[9px] text-[var(--text-muted)] mt-0.5">{new Date(notif.created_at).toLocaleString()}</div>
                      </div>
                      {!notif.is_read && <div className="w-2 h-2 rounded-full bg-[var(--info)] flex-shrink-0 mt-1" />}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}

      <div className="px-2 pt-2 flex flex-col gap-0.5">
        <div className="px-2.5 pb-1">
          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
            My Workspace
          </span>
        </div>

        {[
          { id: "inbox", label: "Inbox", icon: Inbox, count: myTotalCount, unread: myUnreadCount },
          { id: "tasks", label: "Tasks", icon: CheckSquare, count: taskCount, unread: 0 },
          { id: "drafts", label: "Drafts", icon: FileEdit, count: draftsCount, unread: 0 },
          { id: "sent", label: "Sent", icon: Send, count: mySentCount, unread: 0 },
          { id: "watching", label: "Watching", icon: Eye, count: watchingCount, unread: 0 },
        ].map((item) => {
          const Icon = item.icon;
          const isActive =
            (activeView === item.id || (item.id === "tasks" && activeView === "new-task")) &&
            !activeMailbox &&
            !activeFolder;

          return (
            <button
              key={item.id}
              onClick={() => {
                window.location.hash = "";
                setActiveView(item.id);
                setActiveMailbox(null);
                setActiveFolder(null);
              }}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-all w-full text-left ${
                isActive ? "bg-[var(--border)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--surface)]"
              }`}
            >
              <Icon size={18} />
              <span className="flex-1">{item.label}</span>
              <span className="flex items-center gap-1.5">
                {item.unread > 0 && (
                  <span className="min-w-[18px] h-[18px] rounded-full px-1 bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold flex items-center justify-center">
                    {item.unread > 99 ? "99+" : item.unread}
                  </span>
                )}
                {item.count > 0 && (
                  <span className="text-[11px] text-[var(--text-muted)]">
                    {item.count}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="px-2 pt-3 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-2.5 pb-1.5">
          <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">
            Team Spaces
          </span>
          <Link href="/settings" className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
            <Plus size={12} />
          </Link>
        </div>

        {mailboxes.length === 0 && (
          <Link
            href="/settings"
            className="flex items-center gap-2 px-2.5 py-2 mx-1 rounded-md border border-dashed border-[var(--border)] text-[11px] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-all"
          >
            <Plus size={12} /> Connect an email account
          </Link>
        )}

        {mailboxes.map((mb: any) => {
          const mbConvos = conversations.filter((c) => c.email_account_id === mb.id);
          // Inbox/unassigned counts must exclude spam and trash conversations
          const unassignedConvos = mbConvos.filter((c) => !c.assignee_id && !isOutbound(c) && c.status !== "spam" && c.status !== "trash");
          const totalInbox = unassignedConvos.filter((c) => !c.folder_id).length;
          const unread = unassignedConvos.filter((c) => c.is_unread).length;
          const isExpanded = expandedAccounts.has(mb.id);
          const accountFolders = getFoldersForAccount(mb.id);

          return (
            <div key={mb.id} className="mb-0.5">
              <button
                onClick={() => toggleAccount(mb.id)}
                className="flex items-center gap-1 px-1 py-1.5 rounded-md text-[13px] font-medium transition-all w-full text-left text-[var(--text-secondary)] hover:bg-[var(--surface)] group"
              >
                <ChevronRight
                  size={12}
                  className={`transition-transform text-[var(--text-muted)] shrink-0 ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
                <span className="text-[15px] shrink-0">{mb.icon || "📬"}</span>
                <span className="flex-1 truncate ml-1">{mb.name}</span>
                <span className="flex items-center gap-1.5 shrink-0">
                  {unread > 0 && (
                    <span
                      className="min-w-[18px] h-[18px] rounded-full px-1 bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold flex items-center justify-center"
                    >
                      {unread}
                    </span>
                  )}
                  <span className="text-[11px] text-[var(--text-muted)]">{totalInbox}</span>
                </span>
              </button>

              {isExpanded && (
                <div className="ml-5 pl-2 border-l border-[var(--border)] mt-0.5 mb-1">
                  {accountFolders.map((folder) => {
                    const folderNameLower = String(folder.name || "").toLowerCase();
                    const isSystemInbox = folder.is_system && folder.name === "Inbox";
                    const isSystemTrash = folder.is_system && folderNameLower === "trash";
                    const isSystemSpam = folder.is_system && folderNameLower === "spam";

                    const isFolderActive = isSystemInbox
                      ? activeMailbox === mb.id && !activeFolder
                      : activeFolder === folder.id;

                    let folderConvos;
                    if (isSystemInbox) {
                      folderConvos = unassignedConvos.filter((c) => !c.folder_id);
                    } else if (isSystemTrash) {
                      // Trash counts conversations with status="trash"
                      folderConvos = mbConvos.filter((c: any) => c.status === "trash");
                    } else if (isSystemSpam) {
                      // Spam counts conversations with status="spam"
                      folderConvos = mbConvos.filter((c: any) => c.status === "spam");
                    } else {
                      // Regular folder — exclude spam/trash from the count
                      folderConvos = mbConvos.filter((c) => c.folder_id === folder.id && c.status !== "spam" && c.status !== "trash");
                    }

                    const folderTotal = folderConvos.length;
                    const folderUnread = folderConvos.filter((c) => c.is_unread).length;

                    return (
                      <div key={folder.id} className="flex items-center group/folder">
                        <button
                          onClick={() => {
                          window.location.hash = "";
                          setActiveFolder(folder.id);
                          setActiveMailbox(mb.id);
                          setActiveView("inbox");
                        }}
                          onDragOver={(e) => handleDragOver(e, folder.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, folder.id)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium transition-all flex-1 min-w-0 text-left ${
                            dragOverFolder === folder.id
                              ? "bg-[rgba(74,222,128,0.15)] border border-[var(--accent)] border-dashed"
                              : isFolderActive
                                ? "bg-[var(--border)] text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--surface)]"
                          }`}
                        >
                          {/* Folder icon removed per user request — too informal */}
                          <span className="flex-1 truncate">{folder.name}</span>
                          <span className="flex items-center gap-1 shrink-0">
                            {folderUnread > 0 && (
                              <span
                                className="min-w-[16px] h-[16px] rounded-full px-1 bg-[var(--accent)] text-[var(--bg)] text-[10px] font-bold flex items-center justify-center"
                              >
                                {folderUnread}
                              </span>
                            )}
                            {folderTotal > 0 && (
                              <span className="text-[10px] text-[var(--text-muted)]">{folderTotal}</span>
                            )}
                          </span>
                        </button>

                        {!folder.is_system && (
                          <div className="relative">
                            <button
                              onClick={() =>
                                setFolderMenuOpen(folderMenuOpen === folder.id ? null : folder.id)
                              }
                              className="w-5 h-5 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] opacity-0 group-hover/folder:opacity-100 transition-opacity"
                            >
                              <MoreHorizontal size={12} />
                            </button>

                            {folderMenuOpen === folder.id && (
                              <>
                                <div
                                  className="fixed inset-0 z-40"
                                  onClick={() => setFolderMenuOpen(null)}
                                />
                                <div className="absolute right-0 top-5 z-50 w-32 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg shadow-xl py-1">
                                  <button
                                    onClick={() => handleDeleteFolder(folder.id)}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-[var(--danger)] hover:bg-[var(--border)] transition-colors"
                                  >
                                    <Trash2 size={11} />
                                    Delete folder
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {addingFolder === mb.id ? (
                    <div className="flex items-center gap-1 px-1.5 py-1 mt-0.5">
                      <input
                        autoFocus
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateFolder(mb.id);
                          if (e.key === "Escape") {
                            setAddingFolder(null);
                            setNewFolderName("");
                          }
                        }}
                        onBlur={() => {
                          if (!newFolderName.trim()) {
                            setAddingFolder(null);
                            setNewFolderName("");
                          }
                        }}
                        placeholder="Folder name..."
                        className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]/40 min-w-0"
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingFolder(mb.id)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors w-full text-left mt-0.5"
                    >
                      <FolderPlus size={11} />
                      <span>New folder</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {currentUser && (
        <div className="px-2 pb-1 space-y-0.5">
          <Link
            href="/my-performance"
            className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-all w-full"
          >
            <BarChart3 size={16} />
            <span>My Performance</span>
          </Link>
          {currentUser.role === "admin" && (
            <>
              <Link
                href="/dashboard"
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-all w-full"
              >
                <BarChart3 size={16} />
                <span>Dashboard</span>
              </Link>
              <Link
                href="/settings"
                className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-all w-full"
              >
                <Settings size={16} />
                <span>Settings</span>
              </Link>
            </>
          )}
        </div>
      )}

      {/* Team list — collapsible, shows all users with OOO status */}
      {currentUser && <SidebarTeamList currentUser={currentUser} />}

      <div className="p-2 border-t border-[var(--surface-2)] mt-auto">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md">
          {currentUser && (
            <>
              <button
                ref={userBtnRef}
                onClick={() => {
                  if (userBtnRef.current) {
                    const rect = userBtnRef.current.getBoundingClientRect();
                    setOwnOOOAnchor({ top: rect.top, left: rect.right + 8 });
                  }
                  setShowOwnOOO(!showOwnOOO);
                }}
                className="flex items-center gap-2 flex-1 min-w-0 text-left hover:bg-[var(--surface)] rounded-md px-1 py-1 transition-colors"
                title="Click to manage your OOO status"
              >
                <div className="relative shrink-0">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-[var(--bg)]"
                    style={{ background: currentUser.color }}
                  >
                    {currentUser.initials}
                  </div>
                  <span
                    className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-[var(--bg)] ${
                      meIsOOO ? "bg-[#FCA5A5]" : "bg-[var(--accent)]"
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[var(--text-primary)] truncate">{currentUser.name}</div>
                  <div className={`text-[10px] truncate ${meIsOOO ? "text-[#FCA5A5]" : "text-[var(--text-muted)]"}`}>
                    {meIsOOO ? "🌴 OOO" : currentUser.department}
                  </div>
                </div>
              </button>
            </>
          )}
          <button
            onClick={toggleTheme}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={14} /> : <Moon size={14} />}
          </button>
          <button
            onClick={() => signOut()}
            className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
            title="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>

      {/* Own OOO popover */}
      {showOwnOOO && currentUser && (
        <UserOOOPopover
          targetUserId={currentUser.id}
          targetUserName={currentUser.name}
          actorId={currentUser.id}
          canEdit={true}
          anchorTop={ownOOOAnchor?.top}
          anchorLeft={ownOOOAnchor?.left}
          onClose={() => {
            setShowOwnOOO(false);
            setOwnOOOAnchor(null);
          }}
          onChange={() => {
            // Refetch own OOO status
            fetch(`/api/team/ooo?user_id=${currentUser.id}`)
              .then((r) => r.json())
              .then((d) => setMeIsOOO(!!d.is_currently_ooo))
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}