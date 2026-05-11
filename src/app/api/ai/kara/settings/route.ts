import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// ── /api/ai/kara/settings ──────────────────────────────────────────────────
// GET  → return current admin system-prompt override
// PATCH → update it
//
// Single-row pattern: kara_settings has at most one row keyed by singleton_key='kara'.
// The row is pre-seeded by the migration, so GET always succeeds with at least defaults.
//
// Access: there's no server-side role check here because Kara settings are surfaced
// only inside /settings, which the page-level redirect at line 77-80 of settings/page.tsx
// already gates to admin. If you ever expose this endpoint elsewhere, add an admin check.

export async function GET() {
  try {
    const supabase = createServerClient();
    const { data, error } = await supabase
      .from("kara_settings")
      .select("system_prompt_override, updated_at, updated_by")
      .eq("singleton_key", "kara")
      .maybeSingle();

    if (error) {
      console.error("[api/ai/kara/settings] GET failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      system_prompt_override: data?.system_prompt_override || "",
      updated_at: data?.updated_at || null,
      updated_by: data?.updated_by || null,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const overrideText = typeof body?.system_prompt_override === "string"
    ? body.system_prompt_override
    : null;

  if (overrideText === null) {
    return NextResponse.json(
      { error: "system_prompt_override (string) is required" },
      { status: 400 }
    );
  }

  // Optional: who made the change. Caller may pass actor_id; if not, we leave it null.
  const actorId = body?.actor_id || null;

  try {
    const supabase = createServerClient();

    // Use upsert in case the seed row was somehow lost. Conflict on singleton_key.
    const { data, error } = await supabase
      .from("kara_settings")
      .upsert(
        {
          singleton_key: "kara",
          system_prompt_override: overrideText,
          updated_at: new Date().toISOString(),
          updated_by: actorId,
        },
        { onConflict: "singleton_key" }
      )
      .select()
      .single();

    if (error) {
      console.error("[api/ai/kara/settings] PATCH failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      system_prompt_override: data.system_prompt_override,
      updated_at: data.updated_at,
      updated_by: data.updated_by,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unknown error" }, { status: 500 });
  }
}
