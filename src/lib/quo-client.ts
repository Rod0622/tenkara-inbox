// src/lib/quo-client.ts
//
// Minimal Quo (formerly OpenPhone) API client.
//
// Docs: https://www.quo.com/docs/mdx/api-reference/introduction
// Base: https://api.openphone.com/v1
// Auth: Authorization: <API_KEY>   (NO "Bearer " prefix — Quo is unusual here)
//
// Starter plan limitations:
//   - /v1/call-transcripts/{callId}  → 403/404 for non-Sona calls
//   - /v1/call-summaries/{callId}    → 403/404 for non-Sona calls
//   - /v1/call-voicemails/{callId}   → ✅ works on Starter
//   - /v1/calls/{callId}             → ✅ works on Starter
//   - Webhooks                       → ✅ works on Starter (beta)
//
// All "AI" fetchers below return null on 403/404 without logging an error,
// so missing data on Starter is silent. Real network errors are logged.

import { createServerClient } from "@/lib/supabase";
import { decryptSecret } from "@/lib/crypto";

const BASE = "https://api.openphone.com/v1";

export interface QuoConfig {
  apiKey: string | null;
  webhookSecret: string | null;
  phoneNumberId: string | null;
  isActive: boolean;
}

export async function getQuoConfig(): Promise<QuoConfig> {
  const supabase = createServerClient();
  const { data } = await supabase
    .from("integration_configs")
    .select("api_key_encrypted, webhook_secret, is_active, config")
    .eq("provider", "quo")
    .maybeSingle();

  if (!data) {
    return { apiKey: null, webhookSecret: null, phoneNumberId: null, isActive: false };
  }
  const row: any = data;
  return {
    apiKey: decryptSecret(row.api_key_encrypted),
    webhookSecret: row.webhook_secret || null,
    phoneNumberId: row.config?.phoneNumberId || null,
    isActive: !!row.is_active,
  };
}

async function quoFetch(
  apiKey: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });
}

// Validate an API key by hitting GET /v1/phone-numbers.
// Returns the list of phone numbers on success, throws on failure.
export async function quoListPhoneNumbers(apiKey: string): Promise<any[]> {
  const res = await quoFetch(apiKey, "/phone-numbers");
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Quo /phone-numbers ${res.status}: ${body.slice(0, 200)}`);
  }
  const json: any = await res.json();
  return json.data || [];
}

// Fetch a call by ID. Works on all plans.
export async function quoGetCall(apiKey: string, callId: string): Promise<any | null> {
  const res = await quoFetch(apiKey, `/calls/${encodeURIComponent(callId)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error(`[quo] GET /calls/${callId} ${res.status}`);
    return null;
  }
  const json: any = await res.json();
  return json.data || null;
}

// Voicemail fetcher — works on Starter.
export async function quoGetVoicemail(apiKey: string, callId: string): Promise<any | null> {
  const res = await quoFetch(apiKey, `/call-voicemails/${encodeURIComponent(callId)}`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) {
    console.error(`[quo] GET /call-voicemails/${callId} ${res.status}`);
    return null;
  }
  const json: any = await res.json();
  return json.data || null;
}

// AI summary — Starter only returns this for Sona-handled calls. We swallow 403/404.
export async function quoGetSummary(apiKey: string, callId: string): Promise<any | null> {
  const res = await quoFetch(apiKey, `/call-summaries/${encodeURIComponent(callId)}`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) {
    console.error(`[quo] GET /call-summaries/${callId} ${res.status}`);
    return null;
  }
  const json: any = await res.json();
  return json.data || null;
}

// Transcript — same Starter caveat as summaries.
export async function quoGetTranscript(apiKey: string, callId: string): Promise<any | null> {
  const res = await quoFetch(apiKey, `/call-transcripts/${encodeURIComponent(callId)}`);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) {
    console.error(`[quo] GET /call-transcripts/${callId} ${res.status}`);
    return null;
  }
  const json: any = await res.json();
  return json.data || null;
}
