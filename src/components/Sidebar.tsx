"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import Link from "next/link";
import { Inbox, Send, CheckSquare, Settings, LogOut, RefreshCw, Plus } from "lucide-react";
import type { SidebarProps } from "@/types";

export default function Sidebar({
  activeMailbox, setActiveMailbox, activeView, setActiveView,
  mailboxes, conversations, currentUser,
}: SidebarProps) {
  const [syncing, setSyncing] = useState(false);
  const unreadCount = conversations.filter((c) => c.is_unread).length;

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
      // Conversations will auto-update via Supabase Realtime
      // or we can force a page reload
      window.location.reload();
    } catch (err) {
      console.error("Sync failed:", err);
    }
    setSyncing(false);
  };

  return (
    <div className="w-[240px] min-w-[240px] h-full bg-[#0B0E11] border-r border-[#1E242C] flex flex-col overflow-hidden">
      {/* Logo + Sync */}
      <div className="p-4 pb-3 border-b border-[#161B22] flex items-center gap-2.5">
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

      {/* Main nav */}
      <div className="px-2 pt-2 flex flex-col gap-0.5">
        {[
          { id: "inbox", label: "Inbox", icon: Inbox, count: unreadCount },
          { id: "tasks", label: "Tasks", icon: CheckSquare, count: 0 },
          { id: "sent", label: "Sent", icon: Send, count: 0 },
        ].map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id && !activeMailbox;
          return (
            <button
              key={item.id}
              onClick={() => { setActiveView(item.id); setActiveMailbox(null); }}
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

      {/* Email Accounts */}
      <div className="px-2 pt-3 flex-1 overflow-y-auto">
        <div className="flex items-center justify-between px-2.5 pb-1.5">
          <span className="text-[10px] font-bold text-[#484F58] uppercase tracking-widest">
            Email Accounts
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
          const unread = mbConvos.filter((c) => c.is_unread).length;
          const isActive = activeMailbox === mb.id;
          return (
            <button
              key={mb.id}
              onClick={() => { setActiveMailbox(mb.id); setActiveView("inbox"); }}
              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[13px] font-medium transition-all w-full text-left ${
                isActive ? "bg-[#1E242C] text-[#E6EDF3]" : "text-[#7D8590] hover:bg-[#12161B]"
              }`}
            >
              <span className="text-[15px]">{mb.icon || "📬"}</span>
              <span className="flex-1 truncate">{mb.name}</span>
              {unread > 0 && (
                <span
                  className="min-w-[18px] h-[18px] rounded-full px-1 text-[#0B0E11] text-[11px] font-bold flex items-center justify-center"
                  style={{ background: mb.color || "#4ADE80" }}
                >
                  {unread}
                </span>
              )}
            </button>
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
