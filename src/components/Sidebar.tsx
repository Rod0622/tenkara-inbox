"use client";

import { useState, useEffect } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import {
  Inbox, Send, CheckSquare, Settings, LogOut, RefreshCw, Plus,
  ChevronRight, FolderPlus, MoreHorizontal, Trash2, PenSquare,
} from "lucide-react";
import type { SidebarProps, Folder } from "@/types";

export default function Sidebar({
  activeMailbox, setActiveMailbox, activeView, setActiveView,
  activeFolder, setActiveFolder,
  mailboxes, conversations, currentUser, taskCount = 0, onMoveToFolder,
}: SidebarProps) {
  const [syncing, setSyncing] = useState(false);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [addingFolder, setAddingFolder] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [folderMenuOpen, setFolderMenuOpen] = useState<string | null>(null);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);

  // Personal counts: only conversations assigned to the current user
  const accountEmails = new Set(mailboxes.map((a: any) => a.email?.toLowerCase()));
  const isOutbound = (c: any) => accountEmails.has(c.from_email?.toLowerCase());

  const myConvos = conversations.filter(
    (c) => c.assignee_id === currentUser?.id && !isOutbound(c)
  );
  const myUnreadCount = myConvos.filter((c) => c.is_unread).length;
  const mySentCount = conversations.filter((c) => isOutbound(c)).length;

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
    folders.filter((f) => f.email_account_id === accountId).sort((a, b) => a.sort_order - b.sort_order);

  // Find the "Inbox" system folder for an account
  const getInboxFolder = (accountId: string) =>
    folders.find((f) => f.email_account_id === accountId && f.is_system && f.name === "Inbox");

  // Drag and drop handlers for folders
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
    <div className="w-[240px] min-w-[240px] h-full bg-[#0B0E11] border-r border-[#1E242C] flex flex-col overflow-hidden">
      {/* Logo + Compose + Sync */}
      <div className="p-4 pb-3 border-b border-[#161B22]">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center text-base font-extrabold text-[#0B0E11]">
            T
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold text-[#E6EDF3] tracking-tight">Tenkara</div>
            <div className="text-[10px] text-[#484F58] uppercase tracking-widest">Shared Inbox</div>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${
              syncing ? "text-[#4ADE80]" : "text-[#484F58] hover:text-[#4ADE80] hover:bg-[#12161B]"
            }`}
            title="Sync emails"
          >
            <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          </button>
        </div>

        {/* Compose button */}
        <button
          onClick={() => setActiveView("compose")}
          className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-[13px] font-bold hover:bg-[#3FCF73] active:scale-[0.98] transition-all"
        >
          <PenSquare size={14} />
          <span>Compose</span>
        </button>
        <button
          onClick={() => {
            setActiveView("new-task");
            setActiveMailbox(null);
            setActiveFolder(null);
          }}
          className="flex items-center justify-center gap-2 w-full py-2 mt-2 rounded-lg border border-[#1E242C] bg-[#12161B] text-[#E6EDF3] text-[13px] font-semibold hover:bg-[#181D24] transition-all"
        >
          <CheckSquare size={14} />
          <span>New Task</span>
        </button>
      </div>

      {/* Personal nav — shows only MY assigned items */}
      <div className="px-2 pt-2 flex flex-col gap-0.5">
        <div className="px-2.5 pb-1">
          <span className="text-[10px] font-bold text-[#484F58] uppercase tracking-widest">
            My Workspace
          </span>
        </div>
        {[
          { id: "inbox", label: "Inbox", icon: Inbox, count: myUnreadCount },
          { id: "tasks", label: "Tasks", icon: CheckSquare, count: taskCount },
          { id: "sent", label: "Sent", icon: Send, count: mySentCount },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = (activeView === item.id || (item.id === "tasks" && activeView === "new-task")) && !activeMailbox && !activeFolder;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveView(item.id);
                setActiveMailbox(null);
                setActiveFolder(null);
              }}
              className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-all w-full text-left ${
                isActive ? "bg-[#1E242C] text-[#E6EDF3]" : "text-[#7D8590] hover:bg-[#12161B]"
              }`}
            >
              <Icon size={18} />
              <span className="flex-1">{item.label}</span>
              {item.count > 0 && (
                <span className="min-w-[18px] h-[18px] rounded-full px-1 bg-[#4ADE80] text-[#0B0E11] text-[11px] font-bold flex items-center justify-center">
                  {item.count > 99 ? "99+" : item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Team Spaces (Email Accounts) with Folders */}
      <div className="px-2 pt-3 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-2.5 pb-1.5">
          <span className="text-[10px] font-bold text-[#484F58] uppercase tracking-widest">
            Team Spaces
          </span>
          <Link href="/settings" className="text-[#484F58] hover:text-[#4ADE80] transition-colors">
            <Plus size={12} />
          </Link>
        </div>

        {mailboxes.length === 0 && (
          <Link
            href="/settings"
            className="flex items-center gap-2 px-2.5 py-2 mx-1 rounded-md border border-dashed border-[#1E242C] text-[11px] text-[#484F58] hover:border-[#4ADE80] hover:text-[#4ADE80] transition-all"
          >
            <Plus size={12} /> Connect an email account
          </Link>
        )}

        {mailboxes.map((mb: any) => {
          const mbConvos = conversations.filter((c) => c.email_account_id === mb.id);
          // Team space only shows unassigned inbound
          const unassignedConvos = mbConvos.filter((c) => !c.assignee_id && !isOutbound(c));
          const unread = unassignedConvos.filter((c) => c.is_unread).length;
          const isExpanded = expandedAccounts.has(mb.id);
          const accountFolders = getFoldersForAccount(mb.id);
          const inboxFolder = getInboxFolder(mb.id);

          return (
            <div key={mb.id} className="mb-0.5">
              {/* Account row — clicking ONLY toggles expand/collapse */}
              <button
                onClick={() => toggleAccount(mb.id)}
                className="flex items-center gap-1 px-1 py-1.5 rounded-md text-[13px] font-medium transition-all w-full text-left text-[#7D8590] hover:bg-[#12161B] group"
              >
                <ChevronRight
                  size={12}
                  className={`transition-transform text-[#484F58] shrink-0 ${isExpanded ? "rotate-90" : ""}`}
                />
                <span className="text-[15px] shrink-0">{mb.icon || "📬"}</span>
                <span className="flex-1 truncate ml-1">{mb.name}</span>
                {unread > 0 && (
                  <span
                    className="min-w-[18px] h-[18px] rounded-full px-1 text-[#0B0E11] text-[11px] font-bold flex items-center justify-center shrink-0"
                    style={{ background: mb.color || "#4ADE80" }}
                  >
                    {unread}
                  </span>
                )}
              </button>

              {/* Folders (collapsible) */}
              {isExpanded && (
                <div className="ml-5 pl-2 border-l border-[#1E242C] mt-0.5 mb-1">
                  {accountFolders.map((folder) => {
                    const isFolderActive = (folder.is_system && folder.name === "Inbox")
                      ? (activeMailbox === mb.id && !activeFolder)
                      : activeFolder === folder.id;
                    // Count conversations: system Inbox = unassigned with no folder_id, custom = matching folder_id
                    const folderConvos = (folder.is_system && folder.name === "Inbox")
                      ? unassignedConvos.filter((c) => !c.folder_id)
                      : mbConvos.filter((c) => c.folder_id === folder.id);
                    const folderUnread = folderConvos.filter((c) => c.is_unread).length;

                    return (
                      <div key={folder.id} className="flex items-center group/folder">
                        <button
                          onClick={() => {
                            if (folder.is_system && folder.name === "Inbox") {
                              // System Inbox: show unassigned team emails (no folder_id filter)
                              setActiveFolder(null);
                              setActiveMailbox(mb.id);
                            } else {
                              // Custom folder: filter by folder_id
                              setActiveFolder(folder.id);
                              setActiveMailbox(mb.id);
                            }
                            setActiveView("inbox");
                          }}
                          onDragOver={(e) => handleDragOver(e, folder.id)}
                          onDragLeave={handleDragLeave}
                          onDrop={(e) => handleDrop(e, folder.id)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium transition-all flex-1 min-w-0 text-left ${
                            dragOverFolder === folder.id
                              ? "bg-[rgba(74,222,128,0.15)] border border-[#4ADE80] border-dashed"
                              : isFolderActive
                              ? "bg-[#1E242C] text-[#E6EDF3]"
                              : "text-[#7D8590] hover:bg-[#12161B]"
                          }`}
                        >
                          <span className="text-[13px] shrink-0">{folder.icon}</span>
                          <span className="flex-1 truncate">{folder.name}</span>
                          {folderUnread > 0 && (
                            <span
                              className="min-w-[16px] h-[16px] rounded-full px-1 text-[#0B0E11] text-[10px] font-bold flex items-center justify-center shrink-0"
                              style={{ background: mb.color || "#4ADE80" }}
                            >
                              {folderUnread}
                            </span>
                          )}
                        </button>

                        {/* Folder actions (only for non-system folders) */}
                        {!folder.is_system && (
                          <div className="relative">
                            <button
                              onClick={() => setFolderMenuOpen(folderMenuOpen === folder.id ? null : folder.id)}
                              className="w-5 h-5 flex items-center justify-center text-[#484F58] hover:text-[#7D8590] opacity-0 group-hover/folder:opacity-100 transition-opacity"
                            >
                              <MoreHorizontal size={12} />
                            </button>
                            {folderMenuOpen === folder.id && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setFolderMenuOpen(null)} />
                                <div className="absolute right-0 top-5 z-50 w-32 bg-[#161B22] border border-[#1E242C] rounded-lg shadow-xl py-1">
                                  <button
                                    onClick={() => handleDeleteFolder(folder.id)}
                                    className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-[#F85149] hover:bg-[#1E242C] transition-colors"
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

                  {/* Add folder input */}
                  {addingFolder === mb.id ? (
                    <div className="flex items-center gap-1 px-1.5 py-1 mt-0.5">
                      <input
                        autoFocus
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateFolder(mb.id);
                          if (e.key === "Escape") { setAddingFolder(null); setNewFolderName(""); }
                        }}
                        onBlur={() => { if (!newFolderName.trim()) { setAddingFolder(null); setNewFolderName(""); } }}
                        placeholder="Folder name..."
                        className="flex-1 bg-[#0B0E11] border border-[#1E242C] rounded px-1.5 py-0.5 text-[11px] text-[#E6EDF3] placeholder:text-[#484F58] outline-none focus:border-[#4ADE80]/40 min-w-0"
                      />
                    </div>
                  ) : (
                    <button
                      onClick={() => setAddingFolder(mb.id)}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] text-[#484F58] hover:text-[#4ADE80] transition-colors w-full text-left mt-0.5"
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

      {/* Settings */}
      <div className="px-2 pb-1">
        <Link
          href="/settings"
          className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[13px] font-medium text-[#7D8590] hover:bg-[#12161B] transition-all w-full"
        >
          <Settings size={16} />
          <span>Settings</span>
        </Link>
      </div>

      {/* User */}
      <div className="p-2 border-t border-[#161B22]">
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md">
          {currentUser && (
            <>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-[#0B0E11] flex-shrink-0"
                style={{ background: currentUser.color }}
              >
                {currentUser.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-[#E6EDF3]">{currentUser.name}</div>
                <div className="text-[10px] text-[#484F58]">{currentUser.department}</div>
              </div>
            </>
          )}
          <button
            onClick={() => signOut()}
            className="text-[#484F58] hover:text-[#F85149] transition-colors"
            title="Sign out"
          >
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

