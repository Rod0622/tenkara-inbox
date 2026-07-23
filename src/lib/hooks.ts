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
      // Explicit non-secret columns only — NEVER select("*") on team_members
      // from the browser: it exposes password_hash and reset/invite tokens.
      // Those columns are also revoked at the DB level, so "*" would error.
      .select("id, email, name, initials, color, avatar_url, role, department, is_active, has_call_skillset, accepted_at, created_at, updated_at, preferred_quo_phone_number_id")
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
      // Explicit columns only — NEVER select("*") on email_accounts from the
      // BROWSER: it ships every mailbox's OAuth refresh tokens and SMTP/IMAP
      // passwords to the client (and, with the anon key public, to anyone).
      // Credential columns are also revoked at the database level, so a
      // select("*") here would fail outright.
      const { data: allAccounts, error } = await supabase
        .from("email_accounts")
        .select("id, email, name, provider, icon, color, is_active, signature, signature_enabled, last_sync_at, created_at")
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

const CONVERSATION_SELECT_FIELDS = `
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
        supplier_contact:supplier_contacts(id, name, company),
        primary_contact_name,
        primary_contact_email,
        primary_contact_is_manual,
        assignee:team_members!conversations_assignee_id_fkey(id, name, email, initials, color, avatar_url, role),
        labels:conversation_labels(
          label_id,
          label:labels(*)
        )
      `;

export function useConversations(accountId: string | null, currentUserId: string | null = null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);


  const fetchConversations = useCallback(async () => {
    setLoading(true);

    if (accountId) {
      // Specific account: fetch all for that account.
      // Note: we DO include status='merged' here so the Archive folder view
      // can render merged shells. The page-level filter excludes merged from
      // non-Archive views via the isArchiveFolder check.
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT_FIELDS)
        .eq("email_account_id", accountId)
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
          .select(CONVERSATION_SELECT_FIELDS)
          .neq("status", "merged")
          .order("last_message_at", { ascending: false })
          .limit(300),
        // Scope the "assigned" query to the CURRENT USER, not all assignees.
        // Previously this fetched every user's assigned conversations capped at
        // 200 system-wide, then filtered client-side — so on a busy system a
        // user's own (older) assigned threads fell outside the 200-window and
        // the debounced refetch made them vanish from the personal inbox.
        // Scoping to the user guarantees ALL of their assigned threads load.
        // When currentUserId is null (auth not resolved yet), skip this query.
        currentUserId
          ? supabase
              .from("conversations")
              .select(CONVERSATION_SELECT_FIELDS)
              .eq("assignee_id", currentUserId)
              .neq("status", "merged")
              .order("last_message_at", { ascending: false })
              .limit(500)
          : Promise.resolve({ data: [], error: null } as any),
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
  }, [accountId, currentUserId]);

  // Membership test: does a freshly-fetched conversation row belong in the
  // CURRENT view? Mirrors the filters in fetchConversations so a delta'd row
  // is inserted/kept/removed correctly.
  //   - Account-scoped view: row.email_account_id must match (merged included,
  //     so the Archive view still renders shells).
  //   - Personal view: exclude merged; otherwise keep (assigned or recent).
  //     Slightly more inclusive than the paginated fetch, but it only ever
  //     KEEPS rows that a full refetch would also show — never hides.
  const rowBelongsInView = useCallback((row: any): boolean => {
    if (!row) return false;
    if (accountId) return row.email_account_id === accountId;
    return row.status !== "merged";
  }, [accountId]);

  // Batched delta application. Given a set of changed conversation ids (and a
  // set known to be deleted), fetch ONLY those rows (with joins) and splice
  // them into the current list — instead of re-downloading the whole 300/500
  // list on every realtime event. This is the main egress win: a sync that
  // touches N conversations costs one N-row query, not one ~800-row query per
  // event. Falls back to a full refetch on any error or on deletes (a deleted
  // row can't be refetched, and removing by id from a stale array is safe but
  // we prefer correctness). Best-effort throughout.
  const applyConversationDeltas = useCallback(async (
    changedIds: string[],
    hadDelete: boolean
  ) => {
    // Deletes (or nothing to do) → safest path is a full refetch.
    if (hadDelete) { fetchConversations(); return; }
    const ids = Array.from(new Set(changedIds)).filter(Boolean);
    if (ids.length === 0) return;

    try {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT_FIELDS)
        .in("id", ids);
      if (error) { fetchConversations(); return; } // fallback

      const fetched = (data || []) as unknown as Conversation[];
      const fetchedById = new Map(fetched.map((c) => [c.id, c]));

      setConversations((prev) => {
        const next: Conversation[] = [];
        const handled = new Set<string>();

        // Walk existing list: replace changed rows (if still in view) or drop
        // them (if they no longer belong); keep untouched rows as-is.
        for (const existing of prev) {
          if (fetchedById.has(existing.id)) {
            const updated = fetchedById.get(existing.id)! as any;
            handled.add(existing.id);
            if (rowBelongsInView(updated)) next.push(updated as Conversation);
            // else: row left the view (e.g. merged / moved account) → drop it
          } else {
            next.push(existing);
          }
        }

        // Insert brand-new rows that weren't already in the list.
        for (const c of fetched) {
          if (!handled.has(c.id) && rowBelongsInView(c as any)) {
            next.push(c);
          }
        }

        // Re-sort by last_message_at desc (same as fetchConversations).
        next.sort((a, b) => {
          const aTime = (a as any).last_message_at || (a as any).created_at || "";
          const bTime = (b as any).last_message_at || (b as any).created_at || "";
          return bTime.localeCompare(aTime);
        });
        return next;
      });
    } catch (_e) {
      fetchConversations(); // fallback on any unexpected error
    }
  }, [accountId, currentUserId, fetchConversations, rowBelongsInView]);

  useEffect(() => {
    fetchConversations();

    // Debounced BATCHED DELTA: a sync (or any burst) fires many realtime events
    // in a short window. We coalesce them, then fetch ONLY the changed rows and
    // splice them in — instead of re-downloading the whole ~800-row list per
    // event (the previous behavior, a major egress driver). We collect the set
    // of changed conversation ids during the debounce window; on flush we batch
    // them into one .in("id",[...]) fetch via applyConversationDeltas. Deletes
    // fall back to a full refetch (a deleted row can't be refetched).
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingIds = new Set<string>();
    let pendingDelete = false;
    const scheduleFlush = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const ids = Array.from(pendingIds);
        const hadDelete = pendingDelete;
        pendingIds = new Set<string>();
        pendingDelete = false;
        applyConversationDeltas(ids, hadDelete);
      }, 1500);
    };
    // source: "conversations" → id is on the row itself; DELETE means a
    // conversation was removed (full refetch). "labels" → the change is on
    // conversation_labels; we need its conversation_id to know which row to
    // refetch. If a label event doesn't carry a conversation_id (Realtime
    // DELETE payloads may include only the PK depending on replica identity),
    // fall back to a full refetch so a removed label can't linger on a chip.
    const noteChange = (payload: any, source: "conversations" | "labels") => {
      const evt = payload?.eventType || payload?.type;
      if (source === "conversations") {
        if (evt === "DELETE") pendingDelete = true;
        const id = payload?.new?.id || payload?.old?.id;
        if (id) pendingIds.add(id);
      } else {
        const convId =
          payload?.new?.conversation_id || payload?.old?.conversation_id;
        if (convId) pendingIds.add(convId);
        else pendingDelete = true; // unresolved label change → full refetch
      }
      scheduleFlush();
    };

    const channel = supabase
      .channel("conversations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "conversations" },
        (payload: any) => noteChange(payload, "conversations")
      )
      // NOTE: the unfiltered `messages` subscription was removed here. The list
      // only shows message-derived fields (last_message_at, preview,
      // has_attachments), and the sync already updates those ON the conversations
      // row — so a `conversations` change already triggers the refetch. The old
      // `messages` subscription fired a full 500-row refetch for EVERY message
      // inserted anywhere (hundreds during a backfill) and broadcast full message
      // rows to every client — the main egress/CPU storm. Live message bodies for
      // the OPEN conversation come from the detail channel below, which is
      // correctly scoped by conversation_id.
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "conversation_labels" },
        (payload: any) => noteChange(payload, "labels")
      )
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
    };
  }, [fetchConversations, applyConversationDeltas]);

  return { conversations, loading, refetch: fetchConversations };
}

export function useConversationDetail(conversationId: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  // Slice fetchers — each realtime event refreshes ONLY its own slice.
  // Previously a single fetchDetail() re-downloaded EVERYTHING (including
  // every message body in the thread) on ANY change — so a teammate merely
  // viewing the conversation (which writes an activity_log row) made every
  // open client re-download the full thread. That was the steady-state
  // egress floor. Messages are the heavy slice; notes/tasks/activity are
  // tiny and now refresh independently.
  const fetchNotes = useCallback(async () => {
    if (!conversationId) { setNotes([]); return; }
    const { data, error } = await supabase
      .from("notes")
      .select("*, author:team_members(id, name, email, initials, color, avatar_url, role)")
      .eq("conversation_id", conversationId)
      .order("created_at");
    if (error) { console.error("Notes fetch error:", error); setNotes([]); }
    else setNotes(data || []);
  }, [conversationId]);

  const fetchTasks = useCallback(async () => {
    if (!conversationId) { setTasks([]); return; }
    try {
      const tasks = await fetchConversationTasks(conversationId);
      setTasks(tasks || []);
    } catch (e) {
      console.error("Tasks fetch crashed:", e);
      setTasks([]);
    }
  }, [conversationId]);

  const fetchMessages = useCallback(async () => {
    if (!conversationId) { setMessages([]); return; }
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("sent_at");
    if (error) { console.error("Messages fetch error:", error); setMessages([]); }
    else setMessages(data || []);
  }, [conversationId]);

  const fetchActivities = useCallback(async () => {
    if (!conversationId) { setActivities([]); return; }
    const { data, error } = await supabase
      .from("activity_log")
      .select("*, actor:team_members(id, name, initials, color)")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) { console.error("Activity fetch error:", error); setActivities([]); }
    else setActivities(data || []);
  }, [conversationId]);

  // Full load (conversation open / manual refresh) — all four slices.
  const fetchDetail = useCallback(async () => {
    if (!conversationId) {
      setNotes([]);
      setTasks([]);
      setMessages([]);
      setActivities([]);
      return;
    }
    await Promise.allSettled([
      fetchNotes(),
      fetchTasks(),
      fetchMessages(),
      fetchActivities(),
    ]);
  }, [conversationId, fetchNotes, fetchTasks, fetchMessages, fetchActivities]);

  useEffect(() => {
    fetchDetail().catch((error) => console.error("Conversation detail fetch error:", error));
    if (!conversationId) return;

    const channel = supabase
      .channel(`detail-${conversationId}`)
      // Each event refreshes only its slice — a "Viewed" activity row no
      // longer re-downloads every message body for every open client.
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "notes", filter: `conversation_id=eq.${conversationId}` },
        () => fetchNotes()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "tasks", filter: `conversation_id=eq.${conversationId}` },
        () => fetchTasks()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "task_assignees" },
        () => fetchTasks()
      )
      // messages is deliberately NOT subscribed: it was removed from the
      // realtime publication (full rows — including body_html — streamed to
      // every subscriber, a cross-brand exposure and the largest egress
      // source). The sync updates the conversation row (preview,
      // last_message_at) on every new message, so the thread refreshes off
      // that row's UPDATE instead — tiny payloads, same liveness.
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "inbox", table: "conversations", filter: `id=eq.${conversationId}` },
        () => fetchMessages()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "inbox", table: "activity_log", filter: `conversation_id=eq.${conversationId}` },
        () => fetchActivities()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, fetchDetail, fetchNotes, fetchTasks, fetchMessages, fetchActivities]);

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

  const addNote = async (conversationId: string, text: string, title?: string, messageId?: string | null) => {
    const res = await fetch("/api/conversations/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        text,
        title: title || "",
        author_id: currentUserId,
        message_id: messageId || null,
      }),
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

  const sendReply = async (
    conversationId: string,
    body: string,
    attachments?: { name: string; type: string; data: string }[],
    cc?: string,
    bcc?: string,
    to?: string,
    subject?: string,
  ) => {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: conversationId,
        body,
        attachments: attachments || undefined,
        cc: cc || undefined,
        bcc: bcc || undefined,
        // Override To/Subject if the caller edited them in the inline
        // reply header. /api/send respects body.to and body.subject when
        // conversation_id is present; otherwise it auto-picks.
        to: to || undefined,
        subject: subject || undefined,
        actor_id: currentUserId,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("Send reply failed:", err);
      // Throw so the caller (compose UI) can surface a failed-send indicator
      // and preserve the user's draft instead of silently clearing it.
      throw new Error(err?.error || "Failed to send reply");
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

  return {
    addNote,
    addTask,
    updateTask,
    toggleTask,
    assignConversation,
    sendReply,
    sendEmail,
    syncEmails,
  };
}
// ── useSupplierAccountStatuses (Batch 6, Feature 3) ───────────────────
//
// Fetches all supplier_account_statuses + their resolved status definitions
// via /api/supplier-status-overview (server-side, bypasses RLS on these
// internal workflow tables). Returns:
//   - statusMap: lookup keyed by `${supplier_contact_id}::${email_account_id}`
//   - allStatuses: list of available status options for filter UI
//   - loading: initial load state
//   - refetch: manual re-fetch trigger
//
// Refetches every 30 seconds in the background so that recent status
// changes from other team members surface in the inbox filter without
// requiring a page reload.
export type SupplierStatusOption = {
  id: string;
  name: string;
  color: string;
  background_color: string;
};
export function useSupplierAccountStatuses() {
  const [statusMap, setStatusMap] = useState<Map<string, SupplierStatusOption>>(new Map());
  const [allStatuses, setAllStatuses] = useState<SupplierStatusOption[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (typeof document !== "undefined" && document.hidden) return;
    try {
      const res = await fetch("/api/supplier-status-overview");
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.error("[useSupplierAccountStatuses] fetch failed:", res.status, errText);
        return;
      }
      const data = await res.json();
      const statuses = (data.statuses || []) as SupplierStatusOption[];
      const statusById = new Map<string, SupplierStatusOption>(
        statuses.map(s => [s.id, s])
      );
      const map = new Map<string, SupplierStatusOption>();
      for (const r of (data.assignments || []) as any[]) {
        if (!r.status_id) continue;
        const s = statusById.get(r.status_id);
        if (!s) continue;
        const key = `${r.supplier_contact_id}::${r.email_account_id}`;
        map.set(key, s);
      }
      setStatusMap(map);
      setAllStatuses(statuses);
    } catch (e) {
      console.error("[useSupplierAccountStatuses] fetch failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const id = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchAll();
    }, 120000);
    return () => clearInterval(id);
  }, [fetchAll]);

  return { statusMap, allStatuses, loading, refetch: fetchAll };
}