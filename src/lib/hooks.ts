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