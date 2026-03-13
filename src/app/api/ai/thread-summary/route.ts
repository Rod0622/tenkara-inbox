import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

type SummaryMessage = {
  from_name?: string | null;
  from_email?: string | null;
  to_addresses?: string | null;
  body_text?: string | null;
  body_html?: string | null;
  snippet?: string | null;
  sent_at?: string | null;
};

type SummaryNote = {
  text?: string | null;
};

type SummaryTask = {
  text?: string | null;
  status?: string | null;
  is_done?: boolean | null;
};

function cleanText(value?: string | null) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripHtml(html?: string | null) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function getMessageContent(msg: SummaryMessage) {
  const textBody = cleanText(msg.body_text || "");
  if (textBody) return textBody;

  const htmlBody = stripHtml(msg.body_html || "");
  if (htmlBody) return htmlBody;

  return cleanText(msg.snippet || "");
}

function truncate(value: string, max = 4000) {
  if (value.length <= max) return value;
  return value.slice(0, max) + "\n...[truncated]";
}

function buildPrompt(params: {
  subject: string;
  fromName?: string | null;
  fromEmail?: string | null;
  messages: SummaryMessage[];
  notes: SummaryNote[];
  tasks: SummaryTask[];
}) {
  const messagesText = params.messages
    .slice(-12)
    .map((msg, idx) => {
      const content = getMessageContent(msg);
      return [
        `Message ${idx + 1}`,
        `From: ${msg.from_name || ""} <${msg.from_email || ""}>`,
        `To: ${msg.to_addresses || ""}`,
        `Sent: ${msg.sent_at || ""}`,
        `Content:\n${truncate(content, 2500)}`,
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
  "intent": "one of: rfq, sample_request, pricing_negotiation, logistics, technical_question, order_followup, complaint_issue, general_inquiry",
  "confidence": "one of: high, medium, low",
  "secondary_intents": ["optional additional intents"],
  "open_action_items": ["item 1", "item 2"],
  "completed_items": ["item 1", "item 2"],
  "next_step": "single best next step",
  "suggested_tasks": ["actionable task 1", "actionable task 2"]
}

Rules:
- Be concise and operational.
- Use only facts supported by the thread, notes, and tasks.
- Do not invent facts.
- If something is uncertain, leave it out.
- "intent" must be the single best-fit thread category.
- "secondary_intents" should only include categories clearly supported by the thread.
- "confidence" should reflect how certain the classification is.
- Open action items should be things still needing action.
- Completed items should be clearly done.
- "suggested_tasks" should contain only concrete, actionable follow-up tasks that a teammate could create immediately.
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

function extractJsonObject(text: string) {
  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      // continue
    }
  }

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch?.[0]) {
    return JSON.parse(jsonMatch[0]);
  }

  throw new Error("Model returned invalid JSON");
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
      .maybeSingle();

    if (error) {
      console.error("GET /api/ai/thread-summary select failed:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ summary: data || null });
  } catch (error: any) {
    console.error("GET /api/ai/thread-summary failed:", {
      message: error?.message,
      stack: error?.stack,
      error,
    });

    return NextResponse.json(
      { error: error?.message || "Failed to fetch summary" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    console.log("THREAD SUMMARY INIT", {
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    });

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
      console.error("Conversation lookup failed:", convoError);
      return NextResponse.json(
        { error: convoError?.message || "Conversation not found" },
        { status: 404 }
      );
    }

    const { data: messages, error: messagesError } = await supabase
      .from("messages")
      .select("from_name, from_email, to_addresses, body_text, body_html, snippet, sent_at")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });

    if (messagesError) {
      console.error("Messages lookup failed:", messagesError);
      return NextResponse.json({ error: messagesError.message }, { status: 500 });
    }

    const { data: notes, error: notesError } = await supabase
      .from("notes")
      .select("text")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (notesError) {
      console.error("Notes lookup failed:", notesError);
      return NextResponse.json({ error: notesError.message }, { status: 500 });
    }

    const { data: tasks, error: tasksError } = await supabase
      .from("tasks")
      .select("text, status, is_done")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (tasksError) {
      console.error("Tasks lookup failed:", tasksError);
      return NextResponse.json({ error: tasksError.message }, { status: 500 });
    }

    const messageCount = (messages || []).length;

    console.log("Generating thread summary", {
      conversationId,
      messageCount,
      noteCount: (notes || []).length,
      taskCount: (tasks || []).length,
      forceRefresh,
    });

    if (!forceRefresh) {
      const { data: existing, error: existingError } = await supabase
        .from("thread_summaries")
        .select("*")
        .eq("conversation_id", conversationId)
        .maybeSingle();

      if (existingError) {
        console.error("Existing summary lookup failed:", existingError);
      } else if (
        existing &&
        existing.source_message_count === messageCount &&
        String(existing.last_message_at || "") === String(conversation.last_message_at || "")
      ) {
        console.log("Returning cached summary");
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

    console.log("Calling Anthropic for thread summary...");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 700,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    });

    console.log("Anthropic response received");

    const text = response.content
      .filter((item: any) => item.type === "text")
      .map((item: any) => item.text)
      .join("\n")
      .trim();

    console.log("Raw model text:", text);

    let parsed: any;
    try {
      parsed = extractJsonObject(text);
    } catch (parseError: any) {
      console.error("Failed to parse model JSON:", {
        rawText: text,
        parseError: parseError?.message,
      });

      return NextResponse.json(
        { error: "Model returned invalid JSON" },
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
              next_step: typeof parsed.next_step === "string" ? parsed.next_step : "",
              suggested_tasks: Array.isArray(parsed.suggested_tasks)
                ? parsed.suggested_tasks
                : [],
            },
      source_message_count: messageCount,
      last_message_at: conversation.last_message_at || null,
      generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    console.log("Saving summary payload to Supabase", {
      conversationId,
      source_message_count: messageCount,
      last_message_at: conversation.last_message_at || null,
    });

    const { data: saved, error: saveError } = await supabase
      .from("thread_summaries")
      .upsert(payload, { onConflict: "conversation_id" })
      .select("*")
      .single();

    if (saveError) {
      console.error("Saving summary failed:", saveError);
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }

    return NextResponse.json({ summary: saved, cached: false });
  } catch (error: any) {
    console.error("POST /api/ai/thread-summary failed:", {
      message: error?.message,
      name: error?.name,
      stack: error?.stack,
      error,
    });

    return NextResponse.json(
      { error: error?.message || "Failed to generate summary" },
      { status: 500 }
    );
  }
}