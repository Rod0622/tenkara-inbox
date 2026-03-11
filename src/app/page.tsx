"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import { useActions, useConversations, useEmailAccounts, useTasks, useTeamMembers } from "@/lib/hooks";
import Sidebar from "@/components/Sidebar";
import ConversationList from "@/components/ConversationList";
import ConversationDetail from "@/components/ConversationDetail";
import ComposeEmail from "@/components/ComposeEmail";
import AISidebar from "@/components/AISidebar";
import TaskBoard from "@/components/TaskBoard";
import type { Conversation, TaskStatus } from "@/types";

export default function InboxPage() {
  const { data: session, status } = useSession();
  const teamMembers = useTeamMembers();
  const emailAccounts = useEmailAccounts();
  const actions = useActions();

  const [activeMailbox, setActiveMailbox] = useState<string | null>(null);
  const [activeView, setActiveView] = useState("inbox");
  const [activeConvo, setActiveConvo] = useState<Conversation | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const { conversations, refetch } = useConversations(activeMailbox);

  const currentUser = useMemo(
    () => teamMembers.find((m) => m.email === session?.user?.email) || null,
    [teamMembers, session]
  );

  const { tasks: personalTasks, refetch: refetchTasks } = useTasks(currentUser?.id || null, "mine");

  const accountEmails = useMemo(
    () => new Set(emailAccounts.map((a) => a.email?.toLowerCase())),
    [emailAccounts]
  );

  const isOutboundConvo = (c: Conversation) => accountEmails.has(c.from_email?.toLowerCase());
  const isTaskView = (activeView === "tasks" || activeView === "new-task") && !activeMailbox && !activeFolder;

  const displayConversations = useMemo(() => {
    let filtered = conversations;

    if (activeFolder) {
      filtered = conversations.filter((c) => c.folder_id === activeFolder);
    } else if (!activeMailbox && currentUser) {
      if (activeView === "sent") {
        filtered = conversations.filter((c) => isOutboundConvo(c) && !c.folder_id);
      } else if (activeView === "inbox") {
        filtered = conversations.filter(
          (c) => c.assignee_id === currentUser.id && !c.folder_id && !isOutboundConvo(c)
        );
      } else {
        filtered = conversations.filter((c) => c.assignee_id === currentUser.id && !c.folder_id);
      }
        } else if (activeMailbox) {
      filtered = conversations.filter(
        (c) =>
          c.email_account_id === activeMailbox &&
          !c.folder_id &&
          !isOutboundConvo(c)
      );
    }

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
  }, [conversations, activeMailbox, activeFolder, activeView, currentUser, searchQuery, accountEmails]);

  const handleAssign = async (conversationId: string, assigneeId: string | null, updatedConversation?: any) => {
    if (activeConvo && activeConvo.id === conversationId) {
      const newAssignee = assigneeId ? teamMembers.find((m) => m.id === assigneeId) : null;
      setActiveConvo({
        ...activeConvo,
        assignee_id: assigneeId,
        folder_id: assigneeId ? null : activeConvo.folder_id,
        assignee: updatedConversation?.assignee || newAssignee || undefined,
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
          setActiveConvo({ ...activeConvo, folder_id: folderId, assignee_id: null } as Conversation);
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
          if (action === "archive" || action === "delete") setActiveConvo(null);
        }
      }
    } catch (err) {
      console.error("Bulk action failed:", err);
    }
  };

  const handleAddTask = async (conversationId: string, text: string, assigneeIds?: string[], dueDate?: string) => {
    await actions.addTask(conversationId, text, assigneeIds, dueDate);
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

  const openConversationFromTask = (conversationId: string) => {
    const match = conversations.find((conversation) => conversation.id === conversationId);
    if (!match) return;
    setActiveConvo(match);
    setActiveView("inbox");
    setActiveMailbox(null);
    setActiveFolder(null);
    setSearchQuery("");
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
        activeFolder={activeFolder}
        setActiveFolder={setActiveFolder}
        mailboxes={emailAccounts}
        conversations={conversations}
        currentUser={currentUser}
        taskCount={personalTasks.filter((task) => task.status !== "completed").length}
        onMoveToFolder={handleMoveToFolder}
      />

      {isComposing ? (
        <ComposeEmail
          onClose={() => setActiveView("inbox")}
          onSent={() => {
            refetch();
            setActiveView("inbox");
          }}
        />
      ) : isTaskView ? (
        <TaskBoard
          currentUser={currentUser}
          teamMembers={teamMembers}
          onTasksChanged={refetchTasks}
          autoOpenComposer={activeView === "new-task"}
          onOpenConversation={openConversationFromTask}
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
            onToggleTask={handleToggleTask}
            onAddTask={handleAddTask}
            onUpdateTask={handleUpdateTask}
            onAssign={handleAssign}
            onSendReply={actions.sendReply}
            onMoveToFolder={handleMoveToFolder}
          />
        </>
      )}

      {!isComposing && !isTaskView && <AISidebar conversation={activeConvo} />}
    </div>
  );
}