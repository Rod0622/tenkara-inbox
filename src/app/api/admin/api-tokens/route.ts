export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createServerClient } from "@/lib/supabase";
import { hashToken, VALID_SCOPES } from "@/lib/api-token-auth";

// ── /api/admin/api-tokens ────────────────────────────────────────────────
//
// Manage external API tokens (for partners like Sammy's drafting agent).
//
// GET   — list all tokens (without raw values; only hash metadata)
// POST  — create a new token. Returns the raw token ONCE — admins must save
//         it immediately. The hash is what's stored; the raw value isn't
//         retrievable afterward.
// PATCH — update name, scopes, notes, or set revoked_at to revoke a token.
//
// Auth: admin-only via NextAuth session. The endpoint trusts the session's
// teamMember.role claim. (Phase 1: simple admin gate. Phase 2 might add
// scoped admin sub-permissions.)

function isAdminRequest(actorRole: string | undefined | null): boolean {
  return actorRole === "admin";
}

// Generate a fresh raw token. Format: `tki_` + 64 hex chars (32 random bytes).
// The `tki_` prefix makes it easy to spot in logs/configs and distinguish
// from other secret strings. 32 random bytes = 256 bits of entropy.
function generateRawToken(): string {
  return "tki_" + randomBytes(32).toString("hex");
}

// GET — list tokens (no raw values, just hash metadata)
export async function GET(req: NextRequest) {
  const supabase = createServerClient();

  // List all tokens — exposes id, name, scopes, timestamps, created_by name.
  // Doesn't expose token_hash to clients (no value in surfacing the hash).
  const { data, error } = await supabase
    .from("api_tokens")
    .select(`
      id, name, scopes, created_at, last_used_at, revoked_at, notes,
      created_by:team_members!created_by(name, initials, color)
    `)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tokens: data || [] });
}

// POST — mint a new token. Body: { name, scopes: string[], notes?, actor_id }
//
// actor_id is the admin team_member.id, recorded as created_by. The endpoint
// returns the raw token in `raw_token` — admins must copy it immediately
// since the hash-only storage means we can never recover the raw value.
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, scopes, notes, actor_id, actor_role } = body || {};

  if (!isAdminRequest(actor_role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Validate scopes against the central whitelist. Unknown scopes are
  // rejected outright — would otherwise produce silently-broken tokens.
  const scopeArr: string[] = Array.isArray(scopes) ? scopes.filter((s) => typeof s === "string") : [];
  const invalid = scopeArr.filter((s) => !(VALID_SCOPES as readonly string[]).includes(s));
  if (invalid.length > 0) {
    return NextResponse.json(
      { error: `Invalid scopes: ${invalid.join(", ")}. Valid: ${VALID_SCOPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (scopeArr.length === 0) {
    return NextResponse.json({ error: "At least one scope is required" }, { status: 400 });
  }

  const raw = generateRawToken();
  const hash = hashToken(raw);

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .insert({
      name: name.trim(),
      token_hash: hash,
      scopes: scopeArr,
      created_by: actor_id || null,
      notes: notes ? String(notes).slice(0, 1000) : null,
    })
    .select("id, name, scopes, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ...data,
    raw_token: raw,
    warning: "This is the ONLY time the raw token will be shown. Store it securely now.",
  });
}

// PATCH — update an existing token. Body: { id, name?, scopes?, notes?, revoked?, actor_role }
//
// `revoked: true` sets revoked_at to now (immediately invalidates the token).
// `revoked: false` clears revoked_at (un-revokes; useful if you revoked by accident).
// scopes/name/notes updates are partial.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, name, scopes, notes, revoked, actor_role } = body || {};

  if (!isAdminRequest(actor_role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const update: any = {};
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    update.name = name.trim();
  }
  if (scopes !== undefined) {
    const arr: string[] = Array.isArray(scopes) ? scopes.filter((s) => typeof s === "string") : [];
    const invalid = arr.filter((s) => !(VALID_SCOPES as readonly string[]).includes(s));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Invalid scopes: ${invalid.join(", ")}` }, { status: 400 });
    }
    update.scopes = arr;
  }
  if (notes !== undefined) update.notes = notes ? String(notes).slice(0, 1000) : null;
  if (revoked === true) update.revoked_at = new Date().toISOString();
  if (revoked === false) update.revoked_at = null;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase.from("api_tokens").update(update).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
