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
//
// PAYLOAD SHAPE (v3+, observed live):
//   data.object = {
//     id: "AC...",
//     to:   "+1...",          // E.164 destination
//     from: "+1...",          // E.164 source
//     direction: "outgoing" | "incoming",
//     status: "completed" | "no-answer" | "ringing" | "voicemail" | ...,
//     userId: "US...",
//     phoneNumberId: "PN...",
//     createdAt: ISO8601,
//     answeredAt: ISO8601 | null,
//     completedAt: ISO8601 | null,
//     voicemail: { url, transcript } | null,
//     conversationId: "CN..." (Quo's internal grouping, not our DB),
//     media: [],
//   }

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
  const s = (quoStatus || "").toLowerCase().replace(/-/g, "_");
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
    default:
      return "completed";
  }
}

function mapOutcome(call: any, durationSeconds: number | null): string {
  const status = (call?.status || "").toLowerCase().replace(/-/g, "_");
  if (call?.voicemail) return "voicemail";
  if (status === "voicemail") return "voicemail";
  if (status === "missed" || status === "no_answer") return "no_answer";
  if (status === "busy" || status === "declined") return "declined";
  if (status === "completed" && durationSeconds !== null && durationSeconds > 0 && call?.answeredAt) {
    return "answered";
  }
  // Completed but unanswered (answeredAt is null and duration is 0/null) = no_answer
  if (status === "completed" && !call?.answeredAt) return "no_answer";
  return "unknown";
}

// Map a Quo `direction` value. Quo uses "incoming" / "outgoing".
function mapDirection(d: string | null | undefined): "inbound" | "outbound" {
  const s = (d || "").toLowerCase();
  if (s === "incoming" || s === "inbound") return "inbound";
  return "outbound";
}

// Extract the external (participant) phone number from a Quo call object.
//
// Quo's call event payload has `from` and `to` E.164 strings. For:
//   - outgoing calls: workspace number is `from`, external is `to`
//   - incoming calls: workspace number is `to`,   external is `from`
//
// Returns { participant, workspace } in E.164 form. Either can be null if Quo
// omitted the field for any reason.
function extractPhones(call: any): { participant: string | null; workspace: string | null } {
  const from = normalizeE164(call?.from);
  const to = normalizeE164(call?.to);
  const dir = mapDirection(call?.direction);

  if (dir === "outbound") {
    return { participant: to, workspace: from };
  } else {
    return { participant: from, workspace: to };
  }
}

// Compute call duration in seconds from the call object's timestamps.
// Priority:
//   1. call.duration (if present and numeric — used by older payloads)
//   2. completedAt - answeredAt (true talk time)
//   3. completedAt - createdAt (total elapsed including ringing) — fallback
// Returns null if not computable.
function extractDuration(call: any): number | null {
  if (typeof call?.duration === "number" && call.duration >= 0) {
    return Math.round(call.duration);
  }
  const completedAt = call?.completedAt ? new Date(call.completedAt).getTime() : NaN;
  if (!Number.isFinite(completedAt)) return null;

  const answeredAt = call?.answeredAt ? new Date(call.answeredAt).getTime() : NaN;
  if (Number.isFinite(answeredAt) && answeredAt <= completedAt) {
    return Math.max(0, Math.round((completedAt - answeredAt) / 1000));
  }

  const createdAt = call?.createdAt ? new Date(call.createdAt).getTime() : NaN;
  if (Number.isFinite(createdAt) && createdAt <= completedAt) {
    return Math.max(0, Math.round((completedAt - createdAt) / 1000));
  }
  return null;
}

// Look up the saved quo_phone_lines row for a given phoneNumberId. Returns
// null if no row exists (e.g. admin hasn't classified lines yet). Also
// returns null if phoneNumberId is missing.
async function lookupQuoPhoneLine(phoneNumberId: string | null | undefined): Promise<{
  id: string;
  line_type: "private" | "shared" | "unknown";
  email_account_id: string | null;
  primary_owner_team_member_id: string | null;
} | null> {
  if (!phoneNumberId) return null;
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("quo_phone_lines")
    .select("id, line_type, email_account_id, primary_owner_team_member_id")
    .eq("quo_phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) {
    console.warn("[quo-webhook] line lookup failed:", error.message);
    return null;
  }
  return (data as any) || null;
}

// Resolve attributed_team_member_id based on the Q3 attribution rule:
//   - For SHARED lines with a matched conversation that has an assignee →
//     attribute to that assignee.
//   - For SHARED lines with no matched conversation OR no assignee → fall
//     back to who answered (team_member_id).
//   - For PRIVATE / UNKNOWN / NULL lines → always who answered.
//
// All inputs may be null. Returns null if nothing resolves.
async function resolveAttributedTeamMember(args: {
  lineType: "private" | "shared" | "unknown" | null;
  conversationId: string | null;
  whoAnsweredId: string | null;
}): Promise<string | null> {
  const { lineType, conversationId, whoAnsweredId } = args;

  // Private / unknown / null line → always who answered
  if (lineType !== "shared") return whoAnsweredId;

  // Shared line + a matched conversation → check its assignee
  if (conversationId) {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("conversations")
      .select("assignee_id")
      .eq("id", conversationId)
      .maybeSingle();
    if (error) {
      console.warn("[quo-webhook] conversation lookup failed:", error.message);
    }
    const assigneeId = (data as any)?.assignee_id || null;
    if (assigneeId) return assigneeId;
  }
  // Fallback: who answered
  return whoAnsweredId;
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

  // Extract phones using the real payload shape (from/to + direction)
  const { participant: participantPhone, workspace: workspacePhone } = extractPhones(call);
  const durationSeconds = extractDuration(call);

  // Phone matching — find supplier from the EXTERNAL phone number
  const match = await matchPhoneToSupplier(participantPhone);
  const teamMemberId = await matchQuoUserToTeamMember(call?.userId || null);

  // Line classification — find the quo_phone_lines row for this workspace line.
  // If admin hasn't classified yet, this is null and the call still logs fine.
  const phoneLine = await lookupQuoPhoneLine(call?.phoneNumberId || null);

  // Attribution per Q3 rule. teamMemberId = who answered; attributedTeamMemberId
  // = who the call should "count toward" (thread assignee for shared lines).
  const attributedTeamMemberId = await resolveAttributedTeamMember({
    lineType: phoneLine?.line_type || null,
    conversationId: match.conversation_id,
    whoAnsweredId: teamMemberId,
  });

  const row: Record<string, any> = {
    quo_call_id: quoCallId,
    conversation_id: match.conversation_id,
    supplier_contact_id: match.supplier_contact_id,
    supplier_contact_person_id: match.supplier_contact_person_id,
    team_member_id: teamMemberId,
    attributed_team_member_id: attributedTeamMemberId,
    direction: mapDirection(call?.direction),
    status: mapStatus(call?.status),
    outcome: mapOutcome(call, durationSeconds),
    participant_phone: participantPhone,
    workspace_phone: workspacePhone,
    quo_phone_number_id: call?.phoneNumberId || null,
    quo_phone_line_id: phoneLine?.id || null,
    line_type: phoneLine?.line_type || null,
    quo_user_id: call?.userId || null,
    duration_seconds: durationSeconds,
    started_at: call?.createdAt || null,
    answered_at: call?.answeredAt || null,
    ended_at: call?.completedAt || null,
    last_event_id: eventId,
    last_event_type: eventType,
    raw_event: rawEvent,
  };

  // ── Stub-merge check (Path A) ─────────────────────────
  // If this is an outbound call, look for a recent stub row that the user
  // created via the QuickCallModal. Match on (workspace_phone, participant_phone,
  // direction=outbound, is_stub=true, started within last 5 minutes). If found,
  // UPDATE the stub in place (preserving the pre-linked conversation_id +
  // supplier_contact_id that the user picked) instead of inserting a new row.
  //
  // We only attempt merge for outbound calls — inbound calls never have stubs.
  if (row.direction === "outbound" && workspacePhone && participantPhone) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: stubs } = await supabase
      .from("quo_call_logs")
      .select("id, conversation_id, supplier_contact_id, supplier_contact_person_id")
      .eq("is_stub", true)
      .eq("direction", "outbound")
      .eq("workspace_phone", workspacePhone)
      .eq("participant_phone", participantPhone)
      .gte("started_at", fiveMinAgo)
      .order("started_at", { ascending: true })  // earliest unmatched first
      .limit(1);

    const stub: any = stubs && stubs.length > 0 ? stubs[0] : null;
    if (stub) {
      // Merge: update the stub row with real-call data. Preserve any
      // pre-linked supplier/conversation that the user chose — don't let
      // re-running phone matching overwrite their manual selection unless
      // we'd otherwise have nothing.
      const mergeRow = {
        ...row,
        conversation_id: stub.conversation_id || row.conversation_id,
        supplier_contact_id: stub.supplier_contact_id || row.supplier_contact_id,
        supplier_contact_person_id: stub.supplier_contact_person_id || row.supplier_contact_person_id,
        is_stub: false,
      };
      const { data: updated, error: updErr } = await supabase
        .from("quo_call_logs")
        .update(mergeRow)
        .eq("id", stub.id)
        .select("*")
        .single();

      if (updErr) {
        console.error("[quo-webhook] stub merge failed:", updErr.message);
        // Fall through to normal upsert below
      } else {
        // Activity log for the now-completed call (similar to regular path)
        const finalStates = new Set(["completed", "missed", "no_answer", "voicemail", "busy", "failed", "canceled"]);
        const finalConvId = mergeRow.conversation_id;
        if (finalConvId && finalStates.has(row.status)) {
          await supabase.from("activity_log").insert({
            conversation_id: finalConvId,
            actor_id: teamMemberId,
            action: "quo_call_logged",
            details: {
              quo_call_id: quoCallId,
              direction: row.direction,
              status: row.status,
              outcome: row.outcome,
              duration_seconds: row.duration_seconds,
              participant_phone: participantPhone,
              merged_from_stub: true,
            },
          });
        }
        return updated;
      }
    }
  }
  // ── End stub-merge block ──────────────────────────────

  // Upsert by quo_call_id.
  const { data, error } = await supabase
    .from("quo_call_logs")
    .upsert(row, { onConflict: "quo_call_id" })
    .select("*")
    .single();

  if (error) {
    console.error("[quo-webhook] upsert failed:", error.message);
    throw new Error(error.message);
  }

  // Activity log: only when call is in a final state AND we matched a conversation.
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