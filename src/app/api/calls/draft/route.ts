// src/app/api/calls/draft/route.ts
//
// POST /api/calls/draft
//   body: { call_id: string, tone?: "professional" | "casual" | "brief" }
//
// Generates a follow-up email draft for a call. Returns the draft text
// (subject + body); does NOT send. Caller decides what to do with it.
//
// Strategy:
//   - If the call has ai_summary (Sona-handled), use it as the body anchor
//   - Else fall back to a metadata-only template ("Following up on our call
//     today at X")
//   - Subject: "Follow-up: <supplier name>" or "Follow-up: our call"

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

type Tone = "professional" | "casual" | "brief";

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "earlier";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "earlier";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return "today at " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return "on " + d.toLocaleDateString(undefined, {
    weekday: "long", month: "short", day: "numeric",
  });
}

function buildBody(opts: {
  greeting: string;
  whenPhrase: string;
  summary: string | null;
  nextSteps: string[] | null;
  isVoicemail: boolean;
  isNoAnswer: boolean;
  tone: Tone;
}): string {
  const { greeting, whenPhrase, summary, nextSteps, isVoicemail, isNoAnswer, tone } = opts;

  const lines: string[] = [greeting + ","];
  lines.push("");

  // Opening sentence varies by call outcome
  if (isVoicemail) {
    lines.push(`I left you a voicemail ${whenPhrase}, and wanted to follow up here as well.`);
  } else if (isNoAnswer) {
    lines.push(`I tried reaching you by phone ${whenPhrase} and missed you. Following up here in case email is easier.`);
  } else {
    if (tone === "casual") {
      lines.push(`Thanks for the call ${whenPhrase}!`);
    } else if (tone === "brief") {
      lines.push(`Following up on our call ${whenPhrase}.`);
    } else {
      lines.push(`Thank you for taking the time to speak with me ${whenPhrase}.`);
    }
  }

  if (summary && tone !== "brief") {
    lines.push("");
    lines.push("To recap the key points:");
    lines.push(summary);
  }

  if (nextSteps && nextSteps.length > 0) {
    lines.push("");
    lines.push("Next steps:");
    for (const step of nextSteps) {
      lines.push(`• ${step}`);
    }
  }

  lines.push("");
  if (tone === "brief") {
    lines.push("Let me know if I missed anything.");
  } else if (tone === "casual") {
    lines.push("Let me know if you have any questions or want to talk through anything else.");
  } else {
    lines.push("Please let me know if you have any questions, or if there's anything I missed.");
  }

  lines.push("");
  lines.push("Best regards,");

  return lines.join("\n");
}

export async function POST(req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const callId: string = body.call_id;
  const tone: Tone = ["professional", "casual", "brief"].includes(body.tone) ? body.tone : "professional";

  if (!callId) return NextResponse.json({ error: "Missing call_id" }, { status: 400 });

  const supabase = createServerClient();

  const { data: call, error } = await supabase
    .from("quo_call_logs")
    .select("*")
    .eq("id", callId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });
  const c: any = call;

  // Hydrate names
  const [supplierRes, personRes] = await Promise.all([
    c.supplier_contact_id
      ? supabase.from("supplier_contacts").select("name").eq("id", c.supplier_contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    c.supplier_contact_person_id
      ? supabase.from("supplier_contact_persons").select("name").eq("id", c.supplier_contact_person_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const supplierName = (supplierRes.data as any)?.name || null;
  const personName = (personRes.data as any)?.name || null;
  const firstName = personName ? personName.split(/\s+/)[0] : null;

  const greeting = firstName ? `Hi ${firstName}` : (personName ? `Hi ${personName}` : "Hi there");
  const subject = supplierName ? `Follow-up: ${supplierName}` : "Follow-up on our call";

  const draftBody = buildBody({
    greeting,
    whenPhrase: formatWhen(c.started_at),
    summary: c.ai_summary,
    nextSteps: Array.isArray(c.ai_next_steps) ? c.ai_next_steps : null,
    isVoicemail: c.outcome === "voicemail" || c.status === "voicemail",
    isNoAnswer: c.outcome === "no_answer" || c.status === "no_answer" || c.status === "missed",
    tone,
  });

  return NextResponse.json({
    subject,
    body: draftBody,
    conversation_id: c.conversation_id,
    has_ai_summary: !!c.ai_summary,
  });
}
