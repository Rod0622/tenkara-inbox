import Anthropic from "@anthropic-ai/sdk";
import type { Conversation, ClassificationResult } from "@/types";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Kara, the AI assistant for Tenkara Labs' shared inbox platform.
You help the operations team at Bobber Labs (a chemical and specialty ingredient supplier) with:
- Email triage and classification
- Drafting professional replies to suppliers and customers
- Summarizing email threads
- Extracting action items from conversations
- Identifying priority levels and routing suggestions

Team context:
- Bobber Labs / Tenkara Labs is a chemical ingredient supplier
- Products include: calcium carbonate, caprylic/capric triglyceride, guar hydroxypropyl, acacia gum, sodium olefin sulfonate, Mirustyle™, and more
- Team members: Rod (Operations), David Zamarin (Management), Ben Stern (Admin), Mary Grace (Support), CJ Munko (Operations), Ryan Walsh (Sales)
- Mailboxes: Bobber Labs, General Inquiries, Order Confirmations, Purchase Orders, Shipment Tracking

Be concise, professional, and actionable. When drafting replies, write in a warm but professional tone appropriate for B2B chemical supply communications.`;

// ── Chat with Kara (streaming) ───────────────────────
export async function askKara(
  conversation: Conversation,
  query: string
): Promise<string> {
  const conversationContext = buildContext(conversation);

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${conversationContext}\n\nUser question: ${query}`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  return textBlock?.text || "Sorry, I couldn't process that request.";
}

// ── Auto-classify incoming email ─────────────────────
export async function classifyEmail(
  subject: string,
  body: string,
  fromEmail: string,
  fromName: string
): Promise<ClassificationResult> {
  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    system: `You are an email classifier for Bobber Labs (a chemical/ingredient supplier).
Classify the email and return ONLY valid JSON with these fields:
- labels: array from ["Inquiry", "Call Skillset", "Security Cleared", "Urgent", "Junk Email", "Follow Up", "New"]
- department: one of ["Operations", "Sales", "Finance", "Logistics", "Support"]
- priority: one of ["low", "normal", "high", "urgent"]
- suggested_assignee: one of ["Rod", "David Z", "Ben S", "Mary Grace", "CJ Munko", "Ryan Walsh"] or null
- summary: one-sentence summary

Return ONLY the JSON object. No markdown, no backticks.`,
    messages: [
      {
        role: "user",
        content: `From: ${fromName} <${fromEmail}>\nSubject: ${subject}\n\n${body.slice(0, 2000)}`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  try {
    return JSON.parse(textBlock?.text || "{}");
  } catch {
    return {
      labels: ["New"],
      department: "Operations",
      priority: "normal",
      suggested_assignee: null,
      summary: subject,
    };
  }
}

// ── Build conversation context for Kara ──────────────
function buildContext(convo: Conversation): string {
  const parts: string[] = [
    `Conversation context:`,
    `- From: ${convo.from_name} (${convo.from_email})`,
    `- Subject: ${convo.subject}`,
    `- Status: ${convo.status}`,
    `- Starred: ${convo.is_starred}`,
  ];

  if (convo.labels?.length) {
    parts.push(`- Labels: ${convo.labels.map((l) => l.label?.name || "").join(", ")}`);
  }

  if (convo.messages?.length) {
    parts.push(`\nMessages:`);
    convo.messages.forEach((m) => {
      parts.push(`[${m.from_name} - ${m.date}]\n${m.body}\n`);
    });
  }

  if (convo.notes?.length) {
    parts.push(`\nInternal Team Notes:`);
    convo.notes.forEach((n) => {
      parts.push(`[${n.author?.name || "Team"} - ${n.created_at}]: ${n.text}`);
    });
  }

  if (convo.tasks?.length) {
    parts.push(`\nTasks:`);
    convo.tasks.forEach((t) => {
      const assignees = t.assignees?.length
        ? t.assignees.map((member) => member.name).join(", ")
        : t.assignee?.name || "unassigned";
      parts.push(`- [${t.is_done ? "✓" : "○"}] ${t.text} (assigned: ${assignees}, due: ${t.due_date || "no date"})`);
    });
  }

  return parts.join("\n");
}

