// src/app/api/integrations/quo/route.ts
//
// GET    /api/integrations/quo  → status (no decrypted keys returned)
// POST   /api/integrations/quo  → save/replace config { apiKey, phoneNumberId, webhookSecret }
// DELETE /api/integrations/quo  → disconnect (clear key, set is_active=false)
//
// Requires admin role.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";
import { encryptSecret, maskSecret } from "@/lib/crypto";
import { quoListPhoneNumbers, getQuoConfig } from "@/lib/quo-client";

async function requireAdmin(): Promise<{ ok: boolean; userId?: string; resp?: NextResponse }> {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return { ok: false, resp: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.teamMember.role !== "admin") {
    return { ok: false, resp: NextResponse.json({ error: "Admin only" }, { status: 403 }) };
  }
  return { ok: true, userId: session.teamMember.id };
}

export async function GET(_req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("integration_configs")
    .select(
      "provider, is_active, last_sync_at, consecutive_errors, last_error_at, last_error_message, total_events_received, last_event_at, config, api_key_encrypted, created_at, updated_at"
    )
    .eq("provider", "quo")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Count calls
  const { count: callCount } = await supabase
    .from("quo_call_logs")
    .select("*", { count: "exact", head: true });

  if (!data) {
    return NextResponse.json({
      connected: false,
      is_active: false,
      callCount: callCount || 0,
    });
  }

  const row: any = data;
  return NextResponse.json({
    connected: !!row.api_key_encrypted,
    is_active: row.is_active,
    apiKeyMask: row.api_key_encrypted ? maskSecret("present_key", 4) : null,
    webhookSecretMask: row.webhook_secret ? "•••••••••" : null,
    phoneNumberId: row.config?.phoneNumberId || null,
    last_event_at: row.last_event_at,
    total_events_received: row.total_events_received || 0,
    consecutive_errors: row.consecutive_errors || 0,
    last_error_at: row.last_error_at,
    last_error_message: row.last_error_message,
    callCount: callCount || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const apiKey: string | null = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : null;
  const phoneNumberId: string | null = typeof body.phoneNumberId === "string" && body.phoneNumberId.trim()
    ? body.phoneNumberId.trim() : null;
  const webhookSecret: string | null = typeof body.webhookSecret === "string" && body.webhookSecret.trim()
    ? body.webhookSecret.trim() : null;

  if (!apiKey && !phoneNumberId && !webhookSecret) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // If apiKey provided, validate it by listing phone numbers
  let validatedNumbers: any[] | null = null;
  if (apiKey) {
    try {
      validatedNumbers = await quoListPhoneNumbers(apiKey);
    } catch (e: any) {
      return NextResponse.json(
        { error: "Quo rejected the API key: " + (e?.message || "unknown") },
        { status: 400 }
      );
    }
  }

  const supabase = createServerClient();

  // Load existing config (if any) so we can preserve fields not in this PATCH
  const { data: existing } = await supabase
    .from("integration_configs")
    .select("config, api_key_encrypted, webhook_secret")
    .eq("provider", "quo")
    .maybeSingle();
  const existingRow: any = existing;

  const newConfig: Record<string, any> = { ...(existingRow?.config || {}) };
  if (phoneNumberId) newConfig.phoneNumberId = phoneNumberId;
  if (validatedNumbers) newConfig.knownPhoneNumbers = validatedNumbers;

  const upsert: Record<string, any> = {
    provider: "quo",
    is_active: true,
    config: newConfig,
  };
  if (apiKey) {
    try {
      upsert.api_key_encrypted = encryptSecret(apiKey);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "encryption failed" }, { status: 500 });
    }
  }
  if (webhookSecret) upsert.webhook_secret = webhookSecret;

  const { error: upsertErr } = await supabase
    .from("integration_configs")
    .upsert(upsert, { onConflict: "provider" });

  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    validatedNumbers: validatedNumbers
      ? validatedNumbers.map((n: any) => ({
          id: n.id,
          number: n.number || n.phoneNumber,
          name: n.name,
        }))
      : undefined,
  });
}

export async function DELETE(_req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  const supabase = createServerClient();
  const { error } = await supabase
    .from("integration_configs")
    .update({
      is_active: false,
      api_key_encrypted: null,
      webhook_secret: null,
    })
    .eq("provider", "quo");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// Allow forcing a quick reachability check from the UI
export async function PATCH(_req: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.resp!;

  const cfg = await getQuoConfig();
  if (!cfg.apiKey) {
    return NextResponse.json({ ok: false, error: "Not connected" }, { status: 400 });
  }
  try {
    const numbers = await quoListPhoneNumbers(cfg.apiKey);
    return NextResponse.json({
      ok: true,
      numbers: numbers.map((n: any) => ({
        id: n.id,
        number: n.number || n.phoneNumber,
        name: n.name,
      })),
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 400 });
  }
}
