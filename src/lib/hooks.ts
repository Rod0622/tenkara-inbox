"use client";

import { useState, useEffect, useCallback } from "react";
import { createBrowserClient } from "@/lib/supabase";
import type { Conversation, TeamMember, Label, Note, Task, TaskStatus } from "@/types";

const supabase = createBrowserClient();

function normalizeTask(task: any): Task {
  const assignees =
    task?.task_assignees?.map((entry: any) => entry.team_member).filter(Boolean) ||
    (task?.assignee ? [task.assignee] : []);

  return {
    ...task,
    status: task?.status || (task?.is_done ? "completed" : "todo"),
    assignees,
  } as Task;
}

function taskMatchesAssignee(task: Task, assigneeId: string) {
  const assigneeIds = task.assignees?.map((member) => member.id) || [];
  return assigneeIds.includes(assigneeId) || task.assignee_id === assigneeId;
}

async function fetchTasksFromApi(params: Record<string, string | null | undefined>) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });

  const res = await fetch(`/api/tasks?${search.toString()}`, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data?.error || "Failed to fetch tasks");
  }

  return (data.tasks || []) as Task[];
}

async function fetchConversationTasks(conversationId: string) {
  // Server-backed fetch avoids browser-side RLS / relationship issues.
  const tasks = await fetchTasksFromApi({ scope: "all" });
  return tasks.filter((task) => task.conversation_id === conversationId);
}

export function useTeamMembers() {
  const [members, setMembers] = useState<TeamMember[]>([]);

  useEffect(() => {
    supabase
      .from("team_members")
      .select("*")
      .order("created_at")
      .then(({ data, error }) => {
        if (error) {
          console.error("Fetch team members error:", error);
          setMembers([]);
          return;
        }

        const activeMembers = (data || []).filter((member: any) => member.is_active !== false);
        setMembers(activeMembers);
      });
  }, []);

  return members;
}

export function useEmailAccounts(currentUserEmail?: string | null) {
  const [accounts, setAccounts] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      // Fetch all active accounts
      const { data: allAccounts, error } = await supabase
        .from("email_accounts")
        .select("*")
        .eq("is_active", true)
        .order("created_at");

      if (error) {
        console.error("Fetch email accounts error:", error);
        setAccounts([]);
        return;
      }

      // Fetch access control entries
      const { data: accessData } = await supabase
        .from("account_access")
        .select("email_account_id, team_member_id");

      // Find current user
      let currentUserId: string | null = null;
      let currentUserRole: string | null = null;
      if (currentUserEmail) {
        const { data: member } = await supabase
          .from("team_members")
          .select("id, role")
          .eq("email", currentUserEmail)
          .single();
        currentUserId = member?.id || null;
        currentUserRole = member?.role || null;
      }

      // If no access entries exist for an account, everyone can see it (backward compatible)
      // If access entries exist, only listed members can see it
      // Admins can always see everything
      const accessByAccount: Record<string, string[]> = {};
      for (const row of (accessData || [])) {
        if (!accessByAccount[row.email_account_id]) accessByAccount[row.email_account_id] = [];
        accessByAccount[row.email_account_id].push(row.team_member_id);
      }

      const filtered = (allAccounts || []).filter((account: any) => {
        // If no user email provided, skip access check (return all)
        if (!currentUserId) return true;
        // Admin sees everything
        if (currentUserRole === "admin") return true;
        // No access restrictions for this account = everyone sees it
        const restrictedTo = accessByAccount[account.id];
        if (!restrictedTo || restrictedTo.length === 0) return true;
        // User must be in the access list
        return restrictedTo.includes(currentUserId);
      });

      setAccounts(filtered);
    };

    load();
  }, [currentUserEmail]);

  return accounts;
}

export function useMailboxes(currentUserEmail?: string | null) {
  return useEmailAccounts(currentUserEmail);
}

export function useLabels() {
  const [labels, setLabels] = useState<Label[]>([]);

  useEffect(() => {
    supabase
      .from("labels")
      .select("*")
      .order("sort_order")
      .then(({ data, error }) => {
        if (error) {
          console.error("Fetch labels error:", error);
          setLabels([]);
          return;
        }
        setLabels(data || []);
      });
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
      .then(({ data, error }) => {
        if (error) {
          console.error("Fetch folders error:", error);
          setFolders([]);
          return;
        }
        setFolders(data || []);
      });
  }, []);

  return folders;
}

export function useConversations(accountId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    setLoading(true);

    const selectFields = `
        id,
        email_account_id,
        folder_id,
        thread_id,
        subject,
        from_name,
        from_email,
        preview,
        is_unread,
        is_starred,
        assignee_id,
        status,
        has_attachments,
        last_message_at,
        created_at,
        updated_at,
        supplier_contact_id,
        assignee:team_members!conversations_assignee_id_fkey(*),
        labels:conversation_labels(
          label_id,
          label:labels(*)
        )
      `;

    if (accountId) {
      // Specific account: fetch all for that account
      const { data, error } = await supabase
        .from("conversations")
        .select(selectFields)
        .eq("email_account_id", accountId)
        .neq("status", "merged")
        .order("last_message_at", { ascending: false })
        .limit(500);

      if (error) {
        console.error("Fetch conversations error:", error);
        setConversations([]);
      } else {
        setConversations((data || []) as unknown as Conversation[]);
      }
    } else {
      // Personal inbox / all accounts: fetch recent + ALL assigned conversations
      const [recentResult, assignedResult] = await Promise.all([
        supabase
          .from("conversations")
          .select(selectFields)
          .neq("status", "merged")
          .order("last_message_at", { ascending: false })
          .limit(300),
        supabase
          .from("conversations")
          .select(selectFields)
          .not("assignee_id", "is", null)
          .neq("status", "merged")
          .order("last_message_at", { ascending: false })
          .limit(200),
      ]);

      if (recentResult.error) {
        console.error("Fetch conversations error:", recentResult.error);
        setConversations([]);
      } else {
        // Merge: all assigned + recent, deduplicated
        const assignedData = (assignedResult.data || []) as unknown as Conversation[];
        const recentData = (recentResult.data || []) as unknown as Conversation[];
        const seen = new Set<string>();
        const merged: Conversation[] = [];
        
        // Add assigned first (priority)
        for (const c of assignedData) {
          if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); }
        }
        // Add recent
        for (const c of recentData) {
          if (!seen.has(c.id)) { seen.add(c.id); merged.push(c); }
        }
        
        // Sort by last_message_at desc
        merged.sort((a, b) => {
          const aTime = a.last_message_at || a.created_at || "";
          const bTime = b.last_message_at || b.created_at || "";
          return bTime.localeCompare(aTime);
        });

        setConversations(merged);
      }
    }

    setLoading(false);
  }, [accountId]);

  useEffect(() => {
    fetchConversations();

    const channel = supabase
      .channel("conversations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "conversations" },
        () => fetchConversations()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "messages" },
        () => fetchConversations()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "conversation_labels" },
        () => fetchConversations()
      )
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

    const results = await Promise.allSettled([
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

    const [notesResult, tasksResult, messagesResult, activitiesResult] = results;

    if (notesResult.status === "fulfilled") {
      if (notesResult.value.error) {
        console.error("Notes fetch error:", notesResult.value.error);
        setNotes([]);
      } else {
        setNotes(notesResult.value.data || []);
      }
    } else {
      console.error("Notes fetch crashed:", notesResult.reason);
      setNotes([]);
    }

    if (tasksResult.status === "fulfilled") {
      setTasks(tasksResult.value || []);
    } else {
      console.error("Tasks fetch crashed:", tasksResult.reason);
      setTasks([]);
    }

    if (messagesResult.status === "fulfilled") {
      if (messagesResult.value.error) {
        console.error("Messages fetch error:", messagesResult.value.error);
        setMessages([]);
      } else {
        setMessages(messagesResult.value.data || []);
      }
    } else {
      console.error("Messages fetch crashed:", messagesResult.reason);
      setMessages([]);
    }

    if (activitiesResult.status === "fulfilled") {
      if (activitiesResult.value.error) {
        console.error("Activity fetch error:", activitiesResult.value.error);
        setActivities([]);
      } else {
        setActivities(activitiesResult.value.data || []);
      }
    } else {
      console.error("Activity fetch crashed:", activitiesResult.reason);
      setActivities([]);
    }
  }, [conversationId]);

  useEffect(() => {
    fetchDetail().catch((error) => console.error("Conversation detail fetch error:", error));
    if (!conversationId) return;

    const channel = supabase
      .channel(`detail-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "notes", filter: `conversation_id=eq.${conversationId}` },
        () => fetchDetail()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "tasks", filter: `conversation_id=eq.${conversationId}` },
        () => fetchDetail()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "task_assignees" },
        () => fetchDetail()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => fetchDetail()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "activity_log", filter: `conversation_id=eq.${conversationId}` },
        () => fetchDetail()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, fetchDetail]);

  return { notes, tasks, messages, activities, refetch: fetchDetail };
}
export function useRelatedThreads(conversationId: string | null) {
  const [threads, setThreads] = useState<any[]>([]);
const [externalEmail, setExternalEmail] = useState<string | null>(null);
const [sharedEmail, setSharedEmail] = useState<string | null>(null);
const [summary, setSummary] = useState<any>(null);
const [loading, setLoading] = useState(false);

  const fetchThreads = useCallback(async () => {
    if (!conversationId) {
      setThreads([]);
      setExternalEmail(null);
      setSharedEmail(null);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        `/api/conversations/by-contact?conversation_id=${conversationId}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error("Fetch related threads failed:", data);
        setThreads([]);
        setExternalEmail(null);
        setSharedEmail(null);
        return;
      }

      setThreads(data.threads || []);
      setExternalEmail(data.external_email || null);
      setSharedEmail(data.shared_email || null);
      setSummary(data.summary || null);
    } catch (error) {
      console.error("Fetch related threads crashed:", error);
      setThreads([]);
      setExternalEmail(null);
      setSharedEmail(null);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  return {
  threads,
  externalEmail,
  sharedEmail,
  summary,
  loading,
  refetch: fetchThreads,
};
}

export function useThreadSummary(conversationId: string | null) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchSummary = useCallback(async () => {
    if (!conversationId) {
      setSummary(null);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(
        `/api/ai/thread-summary?conversation_id=${conversationId}`,
        { cache: "no-store" }
      );
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error("Fetch thread summary failed:", data);
        setSummary(null);
        return;
      }

      setSummary(data.summary || null);
    } catch (error) {
      console.error("Fetch thread summary crashed:", error);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const generateSummary = useCallback(
    async (forceRefresh = false) => {
      if (!conversationId) return null;

      setGenerating(true);
      try {
        const res = await fetch("/api/ai/thread-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversationId,
            force_refresh: forceRefresh,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          console.error("Generate thread summary failed:", data);
          return null;
        }

        setSummary(data.summary || null);
        return data.summary || null;
      } catch (error) {
        console.error("Generate thread summary crashed:", error);
        return null;
      } finally {
        setGenerating(false);
      }
    },
    [conversationId]
  );

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return {
    summary,
    loading,
    generating,
    fetchSummary,
    generateSummary,
  };
}

export function useTasks(assigneeId: string | null, scope: "mine" | "all" = "mine") {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    setLoading(true);

    try {
      // First try the normal API route.
      const primary = await fetchTasksFromApi({
        scope,
        assignee_id: scope === "mine" ? assigneeId : undefined,
      });

      if (scope === "mine" && assigneeId) {
        // Extra client-side safeguard for legacy rows / mixed assignee formats.
        const filtered = primary.filter((task) => taskMatchesAssignee(task, assigneeId));
        setTasks(filtered);
      } else {
        setTasks(primary);
      }
    } catch (error) {
      console.error("Fetch tasks failed:", error);

      // Last-resort fallback: fetch all and filter locally.
      try {
        const fallback = await fetchTasksFromApi({ scope: "all" });
        if (scope === "mine" && assigneeId) {
          setTasks(fallback.filter((task) => taskMatchesAssignee(task, assigneeId)));
        } else {
          setTasks(fallback);
        }
      } catch (fallbackError) {
        console.error("Fallback fetch tasks failed:", fallbackError);
        setTasks([]);
      }
    } finally {
      setLoading(false);
    }
  }, [assigneeId, scope]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  return { tasks, loading, refetch: fetchTasks };
}

export function useActions() {
  // Get current user ID for actor_id tracking
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => {
    // Get session email, then look up team member ID
    fetch("/api/auth/session").then(r => r.json()).then(async (s) => {
      const email = s?.user?.email;
      if (email) {
        const sb = createBrowserClient();
        const { data: member } = await sb
          .from("team_members")
          .select("id")
          .eq("email", email.toLowerCase())
          .single();
        if (member) setCurrentUserId(member.id);
      }
    }).catch(() => {});
  }, []);

  const addNote = async (conversationId: string, text: string, title?: string) => {
    const res = await fetch("/api/conversations/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, text, title: title || "", author_id: currentUserId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Add note failed:", err);
    }
  };

  const addTask = async (conversationId: string, text: string, assigneeIds?: string[], dueDate?: string, categoryId?: string, dueTime?: string) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        text,
        assignee_ids: assigneeIds || [],
        due_date: dueDate,
        category_id: categoryId || null,
        due_time: dueTime || null,
        status: "todo",
        actor_id: currentUserId,
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

  const sendReply = async (conversationId: string, body: string, attachments?: { name: string; type: string; data: string }[]) => {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id: conversationId, body, attachments: attachments || undefined, actor_id: currentUserId }),
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
    bcc?: string;
    subject: string;
    body: string;
    attachments?: { name: string; type: string; data: string }[];
  }) => {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...params, actor_id: currentUserId }),
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

  return {
    addNote,
    addTask,
    updateTask,
    toggleTask,
    assignConversation,
    sendReply,
    sendEmail,
    syncEmails,
    askAi,
  };
}