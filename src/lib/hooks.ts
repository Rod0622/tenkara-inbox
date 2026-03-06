"use client";

import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase";
import type { Conversation, TeamMember, Label, Note, Task } from "@/types";

const supabase = createBrowserClient();

// ── Team Members ─────────────────────────────────────
export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  useEffect(() => {
    supabase.from("team_members").select("*").eq("is_active", true)
      .then(({ data }) => setMembers(data || []));
  }, []);
  return members;
}

// ── Email Accounts (replaces old "mailboxes") ────────
export function useEmailAccounts() {
  const [accounts, setAccounts] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("email_accounts").select("*").eq("is_active", true)
      .order("created_at")
      .then(({ data }) => setAccounts(data || []));
  }, []);
  return accounts;
}

// Keep old name for compatibility
export function useMailboxes() {
  return useEmailAccounts();
}

// ── Labels ───────────────────────────────────────────
export function useLabels() {
  const [labels, setLabels] = useState<Label[]>([]);
  useEffect(() => {
    supabase.from("labels").select("*").order("sort_order")
      .then(({ data }) => setLabels(data || []));
  }, []);
  return labels;
}

// ── Conversations with Realtime ──────────────────────
export function useConversations(accountId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    let query = supabase
      .from("conversations")
      .select(`
        *,
        assignee:team_members(*),
        labels:conversation_labels(
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
    setConversations(data || []);
    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    fetchConversations();

    // Realtime subscription
    const channel = supabase
      .channel("conversations-realtime")
      .on("postgres_changes", { event: "*", schema: "inbox", table: "conversations" }, () => fetchConversations())
      .on("postgres_changes", { event: "*", schema: "inbox", table: "messages" }, () => fetchConversations())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchConversations]);

  return { conversations, loading, refetch: fetchConversations };
}

// ── Conversation Detail ──────────────────────────────
export function useConversationDetail(conversationId: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<any[]>([]);

  const fetchDetail = useCallback(async () => {
    if (!conversationId) {
      setNotes([]);
      setTasks([]);
      setMessages([]);
      return;
    }

    const [notesRes, tasksRes, msgsRes] = await Promise.all([
      supabase.from("notes").select("*, author:team_members(*)")
        .eq("conversation_id", conversationId).order("created_at"),
      supabase.from("tasks").select("*, assignee:team_members(*)")
        .eq("conversation_id", conversationId).order("created_at"),
      supabase.from("messages").select("*")
        .eq("conversation_id", conversationId).order("sent_at"),
    ]);

    if (notesRes.error) console.error("Notes fetch error:", notesRes.error);
    if (tasksRes.error) console.error("Tasks fetch error:", tasksRes.error);
    if (msgsRes.error) console.error("Messages fetch error:", msgsRes.error);

    setNotes(notesRes.data || []);
    setTasks(tasksRes.data || []);
    setMessages(msgsRes.data || []);
  }, [conversationId]);

  useEffect(() => {
    fetchDetail();
    if (!conversationId) return;

    const channel = supabase
      .channel(`detail-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "inbox", table: "notes", filter: `conversation_id=eq.${conversationId}` }, () => fetchDetail())
      .on("postgres_changes", { event: "*", schema: "inbox", table: "tasks", filter: `conversation_id=eq.${conversationId}` }, () => fetchDetail())
      .on("postgres_changes", { event: "*", schema: "inbox", table: "messages", filter: `conversation_id=eq.${conversationId}` }, () => fetchDetail())
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [conversationId, fetchDetail]);

  return { notes, tasks, messages, refetch: fetchDetail };
}

// ── Actions ──────────────────────────────────────────
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

  const addTask = async (conversationId: string, text: string, assigneeId?: string, dueDate?: string) => {
    const res = await fetch("/api/conversations/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        text,
        assignee_id: assigneeId,
        due_date: dueDate,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Add task failed:", err);
    }
  };

  const toggleTask = async (taskId: string, isDone: boolean) => {
    const res = await fetch("/api/conversations/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task_id: taskId, is_done: isDone }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Toggle task failed:", err);
    }
  };

  const assignConversation = async (conversationId: string, assigneeId: string | null) => {
    // The ConversationDetail component already calls the API directly,
    // so this just needs to trigger a refetch via realtime.
    // But if called directly, it should work too:
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

  return { addNote, addTask, toggleTask, assignConversation, sendReply, sendEmail, syncEmails, askAi };
}