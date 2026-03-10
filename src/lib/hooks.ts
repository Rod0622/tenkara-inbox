"use client";

import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase";
import type { Conversation, TeamMember, Label, Note, Task, TaskStatus } from "@/types";

const supabase = createBrowserClient();

function normalizeTask(task: any): Task {
  const assignees = task?.task_assignees?.map((entry: any) => entry.team_member).filter(Boolean)
    || (task?.assignee ? [task.assignee] : []);

  return {
    ...task,
    status: task?.status || (task?.is_done ? "completed" : "todo"),
    assignees,
  } as Task;
}

async function fetchConversationTasks(conversationId: string) {
  const primary = await supabase
    .from("tasks")
    .select("*, assignee:team_members(*), task_assignees(team_member_id, team_member:team_members(*))")
    .eq("conversation_id", conversationId)
    .order("created_at");

  if (!primary.error) {
    return (primary.data || []).map(normalizeTask);
  }

  console.warn("Task join fetch fell back to legacy query:", primary.error.message);

  const fallback = await supabase
    .from("tasks")
    .select("*, assignee:team_members(*)")
    .eq("conversation_id", conversationId)
    .order("created_at");

  if (fallback.error) {
    throw fallback.error;
  }

  return (fallback.data || []).map(normalizeTask);
}

export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    supabase
      .from("team_members")
      .select("*")
      .eq("is_active", true)
      .then(({ data }) => setMembers(data || []));
  }, []);

  return members;
}

export function useEmailAccounts() {
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    supabase
      .from("email_accounts")
      .select("*")
      .eq("is_active", true)
      .order("created_at")
      .then(({ data }) => setAccounts(data || []));
  }, []);

  return accounts;
}

export function useMailboxes() {
  return useEmailAccounts();
}

export function useLabels() {
  const [labels, setLabels] = useState<Label[]>([]);

  useEffect(() => {
    supabase
      .from("labels")
      .select("*")
      .order("sort_order")
      .then(({ data }) => setLabels(data || []));
  }, []);

  return labels;
}

export function useFolders() {
  const [folders, setFolders] = useState<any[]>([]);

  useEffect(() => {
    supabase
      .from("folders")
      .select("*")
      .order("sort_order")
      .then(({ data }) => setFolders(data || []));
  }, []);

  return folders;
}

export function useConversations(accountId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    let query = supabase
      .from("conversations")
      .select(`
        id, email_account_id, folder_id, thread_id, subject, from_name, from_email,
        preview, is_unread, is_starred, assignee_id, status, last_message_at, created_at, updated_at,
        assignee:team_members(*),
        labels:conversation_labels(
          label_id,
          label:labels(*)
        )
      `)
      .eq("status", "open")
      .order("last_message_at", { ascending: false })
      .limit(100);

    if (accountId) {
      query = query.eq("email_account_id", accountId);
    }

    const { data, error } = await query;
    if (error) console.error("Fetch conversations error:", error);
    setConversations((data || []) as unknown as Conversation[]);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    fetchConversations();

    const channel = supabase
      .channel("conversations-realtime")
      .on("postgres_changes", { event: "*", schema: "inbox", table: "conversations" }, () => fetchConversations())
      .on("postgres_changes", { event: "*", schema: "inbox", table: "messages" }, () => fetchConversations())
      .on("postgres_changes", { event: "*", schema: "inbox", table: "conversation_labels" }, () => fetchConversations())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchConversations]);

  return { conversations, loading, refetch: fetchConversations };
}

export function useConversationDetail(conversationId: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  const fetchDetail = useCallback(async () => {
    if (!conversationId) {
      setNotes([]);
      setTasks([]);
      setMessages([]);
      setActivities([]);
      return;
    }

    const [notesRes, tasksData, msgsRes, actRes] = await Promise.all([
      supabase
        .from("notes")
        .select("*, author:team_members(*)")
        .eq("conversation_id", conversationId)
        .order("created_at"),
      fetchConversationTasks(conversationId),
      supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("sent_at"),
      supabase
        .from("activity_log")
        .select("*, actor:team_members(id, name, initials, color)")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (notesRes.error) console.error("Notes fetch error:", notesRes.error);
    if (msgsRes.error) console.error("Messages fetch error:", msgsRes.error);
    if (actRes.error) console.error("Activity fetch error:", actRes.error);

    setNotes(notesRes.data || []);
    setTasks(tasksData);
    setMessages(msgsRes.data || []);
    setActivities(actRes.data || []);
  }, [conversationId]);

  useEffect(() => {
    fetchDetail().catch((error) => console.error("Conversation detail fetch error:", error));
    if (!conversationId) return;

    const channel = supabase
      .channel(`detail-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "inbox", table: "notes", filter: `conversation_id=eq.${conversationId}` }, () => fetchDetail())
      .on("postgres_changes", { event: "*", schema: "inbox", table: "tasks", filter: `conversation_id=eq.${conversationId}` }, () => fetchDetail())
      .on("postgres_changes", { event: "*", schema: "inbox", table: "task_assignees" }, () => fetchDetail())
      .on("postgres_changes", { event: "*", schema: "inbox", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => fetchDetail())
      .on("postgres_changes", { event: "*", schema: "inbox", table: "activity_log", filter: `conversation_id=eq.${conversationId}` }, () => fetchDetail())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, fetchDetail]);

  return { notes, tasks, messages, activities, refetch: fetchDetail };
}

export function useTasks(assigneeId: string | null, scope: "mine" | "all" = "mine") {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    if (scope === "mine" && !assigneeId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams({ scope });
    if (assigneeId) params.set("assignee_id", assigneeId);

    const res = await fetch(`/api/tasks?${params.toString()}`);
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error("Fetch tasks failed:", data);
      setTasks([]);
      setLoading(false);
      return;
    }

    setTasks(data.tasks || []);
    setLoading(false);
  }, [assigneeId, scope]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return { tasks, loading, refetch: fetchTasks };
}

export function useActions() {
  const addNote = async (conversationId: string, text: string) => {
    const res = await fetch("/api/conversations/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, text }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Add note failed:", err);
    }
  };

  const addTask = async (conversationId: string, text: string, assigneeIds?: string[], dueDate?: string) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        text,
        assignee_ids: assigneeIds || [],
        due_date: dueDate,
        status: "todo",
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Add task failed:", err);
    }
  };

  const updateTask = async (
    taskId: string,
    updates: { status?: TaskStatus; dueDate?: string | null; assigneeIds?: string[] }
  ) => {
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task_id: taskId,
        status: updates.status,
        due_date: updates.dueDate,
        assignee_ids: updates.assigneeIds,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Update task failed:", err);
    }
  };

  const toggleTask = async (taskId: string, isDone: boolean) => {
    await updateTask(taskId, { status: isDone ? "completed" : "todo" });
  };

  const assignConversation = async (conversationId: string, assigneeId: string | null) => {
    const res = await fetch("/api/conversations/assign", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        assignee_id: assigneeId,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Assign failed:", err);
    }
  };

  const sendReply = async (conversationId: string, body: string) => {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, body }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Send reply failed:", err);
    }
  };

  const sendEmail = async (params: {
    account_id: string;
    to: string;
    cc?: string;
    subject: string;
    body: string;
  }) => {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    return res.json();
  };

  const syncEmails = async (accountId?: string) => {
    const res = await fetch("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }),
    });
    return res.json();
  };

  const askAi = async (conversation: Conversation, query: string) => {
    const res = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation, query }),
    });
    return res.json();
  };

  return { addNote, addTask, updateTask, toggleTask, assignConversation, sendReply, sendEmail, syncEmails, askAi };
}
