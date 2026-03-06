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

  const { conversations, loading } = useConversations(activeMailbox);

  const currentUser = useMemo(
    () => teamMembers.find((m) => m.email === session?.user?.email) || null,
    [teamMembers, session]
  );

  // Filter conversations based on context:
  // - Top-level Inbox/Tasks/Sent = personal (assigned to me only)
  // - Team Space (activeMailbox set) = all conversations for that account
  const displayConversations = useMemo(() => {
    let filtered = conversations;

    // Personal view: no mailbox selected = show only my assigned conversations
    if (!activeMailbox && currentUser) {
      filtered = conversations.filter((c) => c.assignee_id === currentUser.id);
    }

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (c) =>
          c.subject?.toLowerCase().includes(q) ||
          c.from_name?.toLowerCase().includes(q) ||
          c.preview?.toLowerCase().includes(q)
      );
    }

    return filtered;
  }, [conversations, activeMailbox, currentUser, searchQuery]);

  if (status === "loading") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="w-8 h-8 rounded-full border-2 border-[#1E242C] border-t-[#4ADE80] animate-spin" />
      </div>
    );
  }

  if (!session) redirect("/login");

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
        conversations={displayConversations}
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

      {/* Kara AI — self-contained floating button + slide-out panel */}
      <AISidebar conversation={activeConvo} />
    </div>
  );
}