// src/lib/quo-webhook.ts
//
// Quo (OpenPhone) webhook signature verification + event handlers.
//
// Signature header: "openphone-signature"
// Format: "hmac;<version>;<timestamp>;<base64-hmac>"
// HMAC-SHA256 over: "<timestamp>.<rawBodyString>"
// Secret is the webhook signing key set when creating the webhook in Quo.
//
// We accept any version and tolerate ±5 min timestamp skew.
//
// Reference: https://www.quo.com/docs/mdx/guides/webhooks
//            (Verifying webhook signatures section)

import { createHmac, timingSafeEqual } from "crypto";
import { createServerClient } from "@/lib/supabase";
import {
  matchPhoneToSupplier,
  matchQuoUserToTeamMember,
  normalizeE164,
} from "@/lib/phone";
import { quoGetCall, quoGetVoicemail, quoGetSummary, quoGetTranscript } from "@/lib/quo-client";

const MAX_SKEW_MS = 5 * 60 * 1000;

export function verifyQuoSignature(
  signatureHeader: string | null,
  rawBody: string,
  secret: string | null
): { ok: boolean; reason?: string } {
  if (!signatureHeader) return { ok: false, reason: "missing signature header" };
  if (!secret) return { ok: false, reason: "no webhook secret configured" };

  // Header looks like: "hmac;1;1718000000000;BASE64SIGNATURE"
  const parts = signatureHeader.split(";");
  if (parts.length < 4) return { ok: false, reason: "malformed signature header" };

  const algorithm = parts[0];
  const timestamp = parts[2];
  const sigB64 = parts[3];

  if (algorithm !== "hmac") return { ok: false, reason: "unsupported algorithm" };

  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
    return { ok: false, reason: "timestamp out of tolerance" };
  }

  // Quo's signing secret is documented as base64-encoded. Try the decoded
  // bytes first, then fall back to the raw string (in case the secret was
  // pasted verbatim without decoding awareness).
  const decoded = Buffer.from(secret, "base64");
  const payload = timestamp + "." + rawBody;

  const primaryB64 = createHmac("sha256", decoded).update(payload).digest("base64");
  if (constantEq(primaryB64, sigB64)) return { ok: true };

  const fallbackB64 = createHmac("sha256", secret).update(payload).digest("base64");
  if (constantEq(fallbackB64, sigB64)) return { ok: true };

  return { ok: false, reason: "signature mismatch" };
}

function constantEq(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ── Event handling ─────────────────────────────────────────

type CallEventType =
  | "call.ringing"
  | "call.completed"
  | "call.recording.completed"
  | "call.summary.completed"
  | "call.transcript.completed";

interface QuoCallEvent {
  id: string;
  type: string;
  data?: { object?: any };
}

// Map a raw Quo status string to our enum.
function mapStatus(quoStatus: string | null | undefined): string {
  const s = (quoStatus || "").toLowerCase();
  switch (s) {
    case "ringing":
    case "in_progress":
    case "completed":
    case "missed":
    case "no_answer":
    case "busy":
    case "failed":
    case "canceled":
    case "forwarded":
    case "voicemail":
      return s;
    case "no-answer":
      return "no_answer";
    case "in-progress":
      return "in_progress";
    default:
      return "completed";
  }
}

function mapOutcome(call: any): string {
  const status = (call?.status || "").toLowerCase();
  if (status === "completed" && (call?.duration || 0) > 0) return "answered";
  if (status === "missed") return "no_answer";
  if (status === "no_answer" || status === "no-answer") return "no_answer";
  if (status === "voicemail") return "voicemail";
  if (status === "busy" || status === "declined") return "declined";
  return "unknown";
}

// Pull the participant phone (the non-workspace number). Quo's "participants"
// array on a call event includes both workspace and external. We prefer the
// non-workspace one, falling back to participants[0].
function extractParticipantPhone(call: any, workspacePhone?: string | null): string | null {
  const parts: string[] = Array.isArray(call?.participants) ? call.participants : [];
  if (parts.length === 0) return null;
  const workspaceE164 = normalizeE164(workspacePhone);
  for (const p of parts) {
    const pn = normalizeE164(p);
    if (pn && pn !== workspaceE164) return pn;
  }
  return normalizeE164(parts[0]);
}

// Map a Quo `direction` value. Quo uses "incoming" / "outgoing".
function mapDirection(d: string | null | undefined): "inbound" | "outbound" {
  const s = (d || "").toLowerCase();
  if (s === "incoming" || s === "inbound") return "inbound";
  return "outbound";
}

// Insert or update a quo_call_logs row from a Quo event payload's `call` object.
// Returns the inserted/updated row.
export async function upsertCallFromEvent(
  call: any,
  eventId: string,
  eventType: string,
  rawEvent: any
): Promise<any> {
  const supabase = createServerClient();

  const quoCallId: string | null = call?.id || null;
  if (!quoCallId) {
    console.warn("[quo-webhook] event missing call.id, skipping");
    return null;
  }

  // Phone matching
  const participantPhone = extractParticipantPhone(call);
  const match = await matchPhoneToSupplier(participantPhone);
  const teamMemberId = await matchQuoUserToTeamMember(call?.userId || null);

  const row: Record<string, any> = {
    quo_call_id: quoCallId,
    conversation_id: match.conversation_id,
    supplier_contact_id: match.supplier_contact_id,
    supplier_contact_person_id: match.supplier_contact_person_id,
    team_member_id: teamMemberId,
    direction: mapDirection(call?.direction),
    status: mapStatus(call?.status),
    outcome: mapOutcome(call),
    participant_phone: participantPhone,
    quo_phone_number_id: call?.phoneNumberId || null,
    quo_user_id: call?.userId || null,
    duration_seconds: typeof call?.duration === "number" ? call.duration : null,
    started_at: call?.createdAt || null,
    answered_at: call?.answeredAt || null,
    ended_at: call?.completedAt || null,
    last_event_id: eventId,
    last_event_type: eventType,
    raw_event: rawEvent,
  };

  // Upsert by quo_call_id. ON CONFLICT updates everything *except* fields we've
  // already populated from later events (recording, voicemail, summary).
  const { data, error } = await supabase
    .from("quo_call_logs")
    .upsert(row, { onConflict: "quo_call_id" })
    .select("*")
    .single();

  if (error) {
    console.error("[quo-webhook] upsert failed:", error.message);
    throw new Error(error.message);
  }

  // Activity log: only on insert OR status transition to a final state.
  // We can't easily tell insert vs update from upsert; we log only when there's
  // a conversation_id and the call is in a "complete" state.
  const finalStates = new Set(["completed", "missed", "no_answer", "voicemail", "busy", "failed", "canceled"]);
  if (match.conversation_id && finalStates.has(row.status)) {
    await supabase.from("activity_log").insert({
      conversation_id: match.conversation_id,
      actor_id: teamMemberId,
      action: "quo_call_logged",
      details: {
        quo_call_id: quoCallId,
        direction: row.direction,
        status: row.status,
        outcome: row.outcome,
        duration_seconds: row.duration_seconds,
        participant_phone: participantPhone,
        supplier_name: match.supplier_name,
        person_name: match.person_name,
      },
    });
  }

  return data;
}

// Attach a recording URL to an existing call row.
export async function applyRecordingEvent(call: any, recording: any): Promise<void> {
  const callId = call?.id;
  if (!callId) return;
  const url = recording?.url || recording?.recordingUrl || null;
  if (!url) return;
  const supabase = createServerClient();
  await supabase
    .from("quo_call_logs")
    .update({ recording_url: url })
    .eq("quo_call_id", callId);
}

// Attach a summary + next-steps to an existing call row.
// Fired by call.summary.completed (Sona-handled calls on Starter).
export async function applySummaryEvent(callId: string, summary: any): Promise<void> {
  if (!callId) return;
  const text = Array.isArray(summary?.summary)
    ? summary.summary.join(" ")
    : (summary?.summary || null);
  const nextSteps = Array.isArray(summary?.nextSteps) ? summary.nextSteps : null;

  const supabase = createServerClient();
  await supabase
    .from("quo_call_logs")
    .update({
      ai_summary: text,
      ai_next_steps: nextSteps,
    })
    .eq("quo_call_id", callId);
}

// Attach a transcript to an existing call row.
// Fired by call.transcript.completed (Sona-handled calls on Starter).
export async function applyTranscriptEvent(callId: string, transcript: any): Promise<void> {
  if (!callId) return;
  const dialogue = Array.isArray(transcript?.dialogue) ? transcript.dialogue : transcript;
  const supabase = createServerClient();
  await supabase
    .from("quo_call_logs")
    .update({ transcript: dialogue || null })
    .eq("quo_call_id", callId);
}

// Background hydration: after a call.completed event for a call that *might*
// have voicemail or Sona data, poll the corresponding Quo endpoints. Errors
// are silent. Designed to be called fire-and-forget.
//
// On Starter for non-Sona calls, the summary/transcript fetchers return null
// quickly (Quo answers 403/404), so this is cheap.
export async function hydrateCallExtras(apiKey: string, callId: string): Promise<void> {
  try {
    const [voicemail, summary, transcript] = await Promise.all([
      quoGetVoicemail(apiKey, callId),
      quoGetSummary(apiKey, callId),
      quoGetTranscript(apiKey, callId),
    ]);

    const updates: Record<string, any> = {};
    if (voicemail?.url) updates.voicemail_url = voicemail.url;
    if (voicemail?.transcript) updates.voicemail_transcript = voicemail.transcript;

    if (summary) {
      const txt = Array.isArray(summary?.summary) ? summary.summary.join(" ") : summary?.summary;
      if (txt) updates.ai_summary = txt;
      if (Array.isArray(summary?.nextSteps)) updates.ai_next_steps = summary.nextSteps;
    }

    if (transcript) {
      const dialogue = Array.isArray(transcript?.dialogue) ? transcript.dialogue : transcript;
      if (dialogue) updates.transcript = dialogue;
    }

    if (Object.keys(updates).length === 0) return;

    const supabase = createServerClient();
    await supabase.from("quo_call_logs").update(updates).eq("quo_call_id", callId);
  } catch (e: any) {
    console.warn("[quo-webhook] hydrateCallExtras failed:", e?.message);
  }
}

export type { QuoCallEvent, CallEventType };
