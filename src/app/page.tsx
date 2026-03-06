"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useTeamMembers, useEmailAccounts, useConversations, useActions } from "@/lib/hooks";
import Sidebar from "@/components/Sidebar";
import ConversationList from "@/components/ConversationList";
import ConversationDetail from "@/components/ConversationDetail";
import ComposeEmail from "@/components/ComposeEmail";
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

  const { conversations, loading, refetch } = useConversations(activeMailbox);

  const currentUser = useMemo(
    () => teamMembers.find((m) => m.email === session?.user?.email) || null,
    [teamMembers, session]
  );

  // Build a set of connected account emails for outbound detection
  const accountEmails = useMemo(
    () => new Set(emailAccounts.map((a) => a.email?.toLowerCase())),
    [emailAccounts]
  );

  const isOutboundConvo = (c: Conversation) =>
    accountEmails.has(c.from_email?.toLowerCase());

  // Filter conversations based on context
  const displayConversations = useMemo(() => {
    let filtered = conversations;

    if (!activeMailbox && currentUser) {
      if (activeView === "sent") {
        // Personal Sent: outbound conversations from any account
        filtered = conversations.filter((c) => isOutboundConvo(c));
      } else if (activeView === "inbox") {
        // Personal Inbox: assigned to me, excluding outbound-only threads
        filtered = conversations.filter(
          (c) => c.assignee_id === currentUser.id && !isOutboundConvo(c)
        );
      } else {
        // Tasks or other personal views
        filtered = conversations.filter((c) => c.assignee_id === currentUser.id);
      }
    }

    if (activeMailbox) {
      // Team Space: unassigned inbound conversations only
      filtered = conversations.filter(
        (c) =>
          c.email_account_id === activeMailbox &&
          !c.assignee_id &&
          !isOutboundConvo(c)
      );
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
  }, [conversations, activeMailbox, activeView, currentUser, searchQuery, accountEmails]);

  // Wrap assignConversation to update local state optimistically
  const handleAssign = async (conversationId: string, assigneeId: string | null, updatedConversation?: any) => {
    // Optimistically update the active conversation
    if (activeConvo && activeConvo.id === conversationId) {
      const newAssignee = assigneeId ? teamMembers.find((m) => m.id === assigneeId) : null;
      setActiveConvo({
        ...activeConvo,
        assignee_id: assigneeId,
        assignee: updatedConversation?.assignee || newAssignee || undefined,
      } as Conversation);
    }
    // Refetch the full list to stay in sync
    refetch();
  };

  // Bulk action handler
  const handleBulkAction = async (ids: string[], action: string, payload?: any) => {
    try {
      const res = await fetch("/api/conversations/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids,
          action,
          actor_id: currentUser?.id,
          ...payload,
        }),
      });
      if (res.ok) {
        refetch();
        // If active conversation was in the bulk action, clear it
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

  const isComposing = activeView === "compose";

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

      {isComposing ? (
        // Compose view replaces the list + detail
        <ComposeEmail
          onClose={() => setActiveView("inbox")}
          onSent={() => {
            refetch();
            setActiveView("inbox");
          }}
        />
      ) : (
        <>
          <ConversationList
            conversations={displayConversations}
            activeConvo={activeConvo}
            setActiveConvo={setActiveConvo}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            teamMembers={teamMembers}
            onBulkAction={handleBulkAction}
          />

          <ConversationDetail
            conversation={activeConvo}
            currentUser={currentUser}
            teamMembers={teamMembers}
            onAddNote={actions.addNote}
            onToggleTask={actions.toggleTask}
            onAddTask={actions.addTask}
            onAssign={handleAssign}
            onSendReply={actions.sendReply}
          />
        </>
      )}

      {/* Kara AI — self-contained floating button + slide-out panel */}
      <AISidebar conversation={activeConvo} />
    </div>
  );
}