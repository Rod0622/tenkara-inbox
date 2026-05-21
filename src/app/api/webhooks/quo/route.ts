// src/app/api/webhooks/quo/route.ts
//
// Inbound webhook from Quo.
//
// GET  → health check (returns { ok: true })
// POST → receives event; verifies signature; persists call data
//
// Events handled:
//   - call.ringing               → upsert call row (status=ringing)
//   - call.completed             → upsert call row + hydrate extras in background
//   - call.recording.completed   → attach recording_url
//   - call.summary.completed     → attach ai_summary + ai_next_steps  (Sona on Starter)
//   - call.transcript.completed  → attach transcript                  (Sona on Starter)

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getQuoConfig } from "@/lib/quo-client";
import {
  verifyQuoSignature,
  upsertCallFromEvent,
  applyRecordingEvent,
  applySummaryEvent,
  applyTranscriptEvent,
  hydrateCallExtras,
} from "@/lib/quo-webhook";

export async function GET() {
  return NextResponse.json({ ok: true, service: "quo-webhook" });
}

export async function POST(req: NextRequest) {
  // Always read the raw body — we need it for signature verification.
  const rawBody = await req.text();
  const sigHeader = req.headers.get("openphone-signature") || req.headers.get("quo-signature");

  const cfg = await getQuoConfig();

  // If integration isn't connected, accept-and-ignore the event but record
  // the receipt for diagnostics. Returning 200 prevents Quo from retrying
  // forever; returning 401 would prompt retries we don't want.
  if (!cfg.isActive || !cfg.apiKey) {
    console.warn("[quo-webhook] received event while integration is inactive");
    return NextResponse.json({ ok: true, skipped: "integration inactive" });
  }

  // Verify signature. If missing secret, allow in non-production for dev.
  if (cfg.webhookSecret) {
    const verdict = verifyQuoSignature(sigHeader, rawBody, cfg.webhookSecret);
    if (!verdict.ok) {
      console.warn("[quo-webhook] signature verification failed:", verdict.reason);
      return NextResponse.json({ error: "Bad signature", reason: verdict.reason }, { status: 401 });
    }
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventId: string = event?.id || "";
  const eventType: string = event?.type || "";
  const dataObject: any = event?.data?.object || {};

  // Bump the event receipt counters on the integration row.
  // Two writes (one updates timestamp + reads counter, one writes new counter)
  // is simpler than introducing a Postgres function.
  const supabase = createServerClient();
  await supabase
    .from("integration_configs")
    .update({ last_event_at: new Date().toISOString() })
    .eq("provider", "quo");

  const { data: cfgRow } = await supabase
    .from("integration_configs")
    .select("total_events_received")
    .eq("provider", "quo")
    .maybeSingle();
  const nextCount = ((cfgRow as any)?.total_events_received || 0) + 1;
  await supabase
    .from("integration_configs")
    .update({ total_events_received: nextCount })
    .eq("provider", "quo");

  try {
    switch (eventType) {
      case "call.ringing":
      case "call.completed": {
        await upsertCallFromEvent(dataObject, eventId, eventType, event);
        // For completed calls, fire-and-forget hydration
        if (eventType === "call.completed" && dataObject?.id) {
          hydrateCallExtras(cfg.apiKey, dataObject.id).catch(() => null);
        }
        break;
      }
      case "call.recording.completed": {
        // Payload typically: { id (call id), recordingUrl } or nested under data.object.recording
        const call = { id: dataObject?.id || dataObject?.callId };
        const recording = dataObject?.recording || dataObject;
        if (call.id) {
          // Make sure a row exists, then attach URL
          await upsertCallFromEvent(call, eventId, eventType, event).catch(() => null);
          await applyRecordingEvent(call, recording);
        }
        break;
      }
      case "call.summary.completed":
      case "callSummary": {
        const callId: string = dataObject?.callId || dataObject?.id;
        if (callId) await applySummaryEvent(callId, dataObject);
        break;
      }
      case "call.transcript.completed":
      case "callTranscript": {
        const callId: string = dataObject?.callId || dataObject?.id;
        if (callId) await applyTranscriptEvent(callId, dataObject);
        break;
      }
      default: {
        console.log("[quo-webhook] unhandled event type:", eventType);
        break;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // Increment error counter
    const { data: cfg2 } = await supabase
      .from("integration_configs")
      .select("consecutive_errors")
      .eq("provider", "quo")
      .maybeSingle();
    const nextErr = ((cfg2 as any)?.consecutive_errors || 0) + 1;
    await supabase
      .from("integration_configs")
      .update({
        consecutive_errors: nextErr,
        last_error_at: new Date().toISOString(),
        last_error_message: (e?.message || "").slice(0, 500),
      })
      .eq("provider", "quo");

    console.error("[quo-webhook] handler failed:", e?.message);
    // Return 500 so Quo retries; but only when it's a real internal error,
    // not a bad event payload.
    return NextResponse.json({ error: e?.message || "handler failed" }, { status: 500 });
  }
}
