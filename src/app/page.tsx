"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useTeamMembers, useEmailAccounts, useConversations, useActions } from "@/lib/hooks";
import Sidebar from "@/components/Sidebar";
import ConversationList from "@/components/ConversationList";
import ConversationDetail from "@/components/ConversationDetail";
import AISidebar from "@/components/AISidebar";
import type { Conversation } from "@/types";

export default function InboxPage() {
  const { data: session, status } = useSession();
  const teamMembers = useTeamMembers();
  const emailAccounts = useEmailAccounts();
  const actions = useActions();

  const [activeMailbox, setActiveMailbox] = useState<string | null>(null);
  const [activeView, setActiveView] = useState("inbox");
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAI, setShowAI] = useState(true);

  const { conversations, loading } = useConversations(activeMailbox);

  const filteredConvos = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.subject?.toLowerCase().includes(q) ||
        c.from_name?.toLowerCase().includes(q) ||
        c.preview?.toLowerCase().includes(q)
    );
  }, [conversations, searchQuery]);

  if (status === "loading") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="w-8 h-8 rounded-full border-2 border-[#1E242C] border-t-[#4ADE80] animate-spin" />
      </div>
    );
  }

  if (!session) redirect("/login");

  const currentUser = teamMembers.find((m) => m.email === session.user?.email) || null;

  return (
    <div className="h-screen w-screen flex overflow-hidden bg-[#0B0E11] text-[#E6EDF3]">
      <Sidebar
        activeMailbox={activeMailbox}
        setActiveMailbox={setActiveMailbox}
        activeView={activeView}
        setActiveView={setActiveView}
        mailboxes={emailAccounts}
        conversations={conversations}
        currentUser={currentUser}
      />

      <ConversationList
        conversations={filteredConvos}
        activeConvo={activeConvo}
        setActiveConvo={setActiveConvo}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        teamMembers={teamMembers}
      />

      <ConversationDetail
        conversation={activeConvo}
        currentUser={currentUser}
        teamMembers={teamMembers}
        onAddNote={actions.addNote}
        onToggleTask={actions.toggleTask}
        onAddTask={actions.addTask}
        onAssign={actions.assignConversation}
        onSendReply={actions.sendReply}
      />

      <button
        onClick={() => setShowAI(!showAI)}
        className="fixed bottom-4 z-10 w-9 h-9 rounded-xl border border-[#1E242C] bg-[#12161B] text-[#4ADE80] flex items-center justify-center cursor-pointer shadow-lg hover:bg-[#181D24] transition-all"
        style={{ right: showAI ? 292 : 16 }}
        title="Toggle Kara AI"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2L14.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
        </svg>
      </button>

      {showAI && <AISidebar conversation={activeConvo} />}
    </div>
  );
}
