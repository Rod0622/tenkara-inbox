import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function cleanText(value?: string | null) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncate(value: string, max = 4000) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "\n...[truncated]";
}

function buildPrompt(params: {
  subject: string;
  fromName?: string | null;
  fromEmail?: string | null;
  messages: Array<{
    from_name?: string | null;
    from_email?: string | null;
    to_addresses?: string | null;
    body_text?: string | null;
    snippet?: string | null;
    sent_at?: string | null;
  }>;
  notes: Array<{ text?: string | null }>;
  tasks: Array<{ text?: string | null; status?: string | null; is_done?: boolean }>;
}) {
  const messagesText = params.messages
    .slice(-12)
    .map((msg, idx) => {
      const body = cleanText(msg.body_text || msg.snippet || "");
      return [
        `Message ${idx + 1}`,
        `From: ${msg.from_name || ""} <${msg.from_email || ""}>`,
        `To: ${msg.to_addresses || ""}`,
        `Sent: ${msg.sent_at || ""}`,
        `Content:\n${truncate(body, 2500)}`,
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const notesText =
    params.notes.length > 0
      ? params.notes.map((n, i) => `${i + 1}. ${cleanText(n.text || "")}`).join("\n")
      : "None";

  const tasksText =
    params.tasks.length > 0
      ? params.tasks
          .map((t, i) => {
            const done = t.status === "completed" || t.is_done;
            return `${i + 1}. [${done ? "completed" : "open"}] ${cleanText(t.text || "")}`;
          })
          .join("\n")
      : "None";

  return `
You are summarizing one operational email thread for a shared inbox.

Return ONLY valid JSON with this exact shape:
{
  "overview": "short paragraph",
  "status": "one short status label",
  "intent": "primary intent label",
  "confidence": "low | medium | high",
  "secondary_intents": ["intent 1", "intent 2"],
  "open_action_items": ["item 1", "item 2"],
  "completed_items": ["item 1", "item 2"],
  "suggested_tasks": ["task 1", "task 2"],
  "next_step": "single best next step"
}

Rules:
- Be concise and operational.
- Use only facts supported by the thread, notes, and tasks.
- If something is uncertain, keep it out.
- Open action items should be things still needing action.
- Completed items should be clearly done.
- Suggested tasks should be practical internal follow-up tasks, not duplicates of clearly completed work.
- "status" should be short, like:
  "waiting for supplier"
  "waiting for internal decision"
  "quote received"
  "ready to reply"
  "in progress"

Thread subject: ${params.subject}
Conversation from: ${params.fromName || ""} <${params.fromEmail || ""}>

Notes:
${notesText}

Tasks:
${tasksText}

Messages:
${messagesText}
`.trim();
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const conversationId = req.nextUrl.searchParams.get("conversation_id");

    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("thread_summaries")
      .select("*")
      .eq("conversation_id", conversationId)
      .single();

    if (error && error.code !== "PGRST116") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ summary: data || null });
  } catch (error: any) {
    console.error("GET /api/ai/thread-summary failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch summary" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!anthropic) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY is not configured" },
        { status: 500 }
      );
    }

    const supabase = createServerClient();
    const body = await req.json();
    const conversationId = body.conversation_id;
    const forceRefresh = Boolean(body.force_refresh);

    if (!conversationId) {
      return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
    }

    const { data: conversation, error: convoError } = await supabase
      .from("conversations")
      .select("id, subject, from_name, from_email, last_message_at")
      .eq("id", conversationId)
      .single();

    if (convoError || !conversation) {
      return NextResponse.json(
        { error: convoError?.message || "Conversation not found" },
        { status: 404 }
      );
    }

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("from_name, from_email, to_addresses, body_text, snippet, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });

    if (messagesError) {
      return NextResponse.json({ error: messagesError.message }, { status: 500 });
    }

    const { data: notes, error: notesError } = await supabase
      .from("notes")
      .select("text")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (notesError) {
      return NextResponse.json({ error: notesError.message }, { status: 500 });
    }

    const { data: tasks, error: tasksError } = await supabase
      .from("tasks")
      .select("text, status, is_done")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (tasksError) {
      return NextResponse.json({ error: tasksError.message }, { status: 500 });
    }

    const messageCount = (messages || []).length;
    const noteCount = (notes || []).length;
    const taskCount = (tasks || []).length;
    const completedTaskCount = (tasks || []).filter(
      (task) => task.status === "completed" || task.is_done
    ).length;

    if (!forceRefresh) {
      const { data: existing } = await supabase
        .from("thread_summaries")
        .select("*")
        .eq("conversation_id", conversationId)
        .single();

      if (
        existing &&
        existing.source_message_count === messageCount &&
        existing.source_note_count === noteCount &&
        existing.source_task_count === taskCount &&
        existing.source_completed_task_count === completedTaskCount &&
        String(existing.last_message_at || "") === String(conversation.last_message_at || "")
      ) {
        return NextResponse.json({ summary: existing, cached: true });
      }
    }

    const prompt = buildPrompt({
      subject: conversation.subject || "(No subject)",
      fromName: conversation.from_name,
      fromEmail: conversation.from_email,
      messages: messages || [],
      notes: notes || [],
      tasks: tasks || [],
    });

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 900,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = response.content
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.text)
      .join("\n")
      .trim();

    // Strip markdown code fences if present
    const text = rawText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "Model returned invalid JSON", raw: rawText },
        { status: 500 }
      );
    }

    const payload = {
      conversation_id: conversationId,
      summary: {
        overview: typeof parsed.overview === "string" ? parsed.overview : "",
        status: typeof parsed.status === "string" ? parsed.status : "",
        intent: typeof parsed.intent === "string" ? parsed.intent : "general_inquiry",
        confidence: typeof parsed.confidence === "string" ? parsed.confidence : "medium",
        secondary_intents: Array.isArray(parsed.secondary_intents)
          ? parsed.secondary_intents
          : [],
        open_action_items: Array.isArray(parsed.open_action_items)
          ? parsed.open_action_items
          : [],
        completed_items: Array.isArray(parsed.completed_items)
          ? parsed.completed_items
          : [],
        suggested_tasks: Array.isArray(parsed.suggested_tasks)
          ? parsed.suggested_tasks
          : [],
        next_step: typeof parsed.next_step === "string" ? parsed.next_step : "",
      },
      source_message_count: messageCount,
      source_note_count: noteCount,
      source_task_count: taskCount,
      source_completed_task_count: completedTaskCount,
      last_message_at: conversation.last_message_at || null,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: saveError } = await supabase
      .from("thread_summaries")
      .upsert(payload, { onConflict: "conversation_id" })
      .select("*")
      .single();

    if (saveError) {
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }

    return NextResponse.json({ summary: saved, cached: false });
  } catch (error: any) {
    console.error("POST /api/ai/thread-summary failed:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate summary" },
      { status: 500 }
    );
  }
}