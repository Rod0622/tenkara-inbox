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
    if (!conversationId) return;

    const [notesRes, tasksRes, msgsRes] = await Promise.all([
      supabase.from("notes").select("*, author:team_members(*)")
        .eq("conversation_id", conversationId).order("created_at"),
      supabase.from("tasks").select("*, assignee:team_members(*)")
        .eq("conversation_id", conversationId).order("created_at"),
      supabase.from("messages").select("*")
        .eq("conversation_id", conversationId).order("sent_at"),
    ]);

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
    await fetch("/api/conversations/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, text }),
    });
  };

  const addTask = async (conversationId: string, text: string, assigneeId?: string, dueDate?: string) => {
    await fetch("/api/conversations/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, text, assigneeId, dueDate }),
    });
  };

  const toggleTask = async (taskId: string, isDone: boolean) => {
    await fetch("/api/conversations/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId, isDone }),
    });
  };

  const assignConversation = async (conversationId: string, assigneeId: string | null) => {
    await fetch("/api/conversations/assign", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, assigneeId }),
    });
  };

  const sendReply = async (conversationId: string, body: string) => {
    await fetch("/api/gmail/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, body }),
    });
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

  return { addNote, addTask, toggleTask, assignConversation, sendReply, syncEmails, askAi };
}
