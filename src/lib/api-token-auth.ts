// ── API token authentication ─────────────────────────────────────────────
//
// Verifies a Bearer token from an incoming request against the inbox.api_tokens
// table. Returns the token's identity + scopes on success, or null on any
// failure (missing header, malformed, unknown hash, revoked).
//
// Tokens are stored as SHA-256 hashes only. The raw token is returned to the
// admin ONCE on creation and never retrievable thereafter — so even a DB read
// can't disclose a live secret.
//
// Scope strings used so far:
//   - "drafts:write"          create new drafts
//   - "drafts:read"           list / read own drafts
//   - "drafts:update"         update existing drafts
//   - "conversations:read"    (Phase 2) read inbound message history
//   - "conversations:write"   (Phase 3) create new conversations for cold
//                             outreach via POST /api/external/conversations
//
// Each route checks both authentication AND scope. A token without
// "drafts:write" can't POST to /api/drafts even if the auth header is valid.
import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase";

export interface AuthenticatedToken {
  id: string;
  name: string;
  scopes: string[];
}

/**
 * Hash a raw token value with SHA-256, producing the storage representation.
 * Exported so the admin endpoint can use the same hash function on insert.
 */
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Try to authenticate a request via the Authorization: Bearer header.
 * Returns the token record (id + name + scopes) on success, or null otherwise.
 *
 * Best-effort: on success we asynchronously update last_used_at (don't await,
 * don't fail the request if the update errors).
 */
export async function authenticateBearer(req: NextRequest): Promise<AuthenticatedToken | null> {
  const auth = req.headers.get("authorization") || "";
  // Header must start with "Bearer " (case-insensitive). The actual token
  // follows the space. Strip and check for emptiness.
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const raw = auth.slice("bearer ".length).trim();
  if (!raw) return null;

  const hash = hashToken(raw);

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("api_tokens")
    .select("id, name, scopes")
    .eq("token_hash", hash)
    .is("revoked_at", null)
    .maybeSingle();

  if (error || !data) return null;

  // Touch last_used_at asynchronously. Fire-and-forget so it doesn't block
  // the actual request. If it errors (rare), we log but don't fail.
  supabase
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(({ error: updateErr }) => {
      if (updateErr) console.error("[api-token-auth] last_used_at update failed:", updateErr.message);
    });

  return {
    id: data.id,
    name: data.name,
    scopes: Array.isArray(data.scopes) ? data.scopes : [],
  };
}

/**
 * Check whether the authenticated token has the given scope. Safe to call
 * with a null token (returns false).
 */
export function hasScope(token: AuthenticatedToken | null, scope: string): boolean {
  return token?.scopes.includes(scope) ?? false;
}

/**
 * Valid scope strings. Centralized here so the admin endpoint can validate
 * input against the same list every route checks against.
 */
export const VALID_SCOPES = [
  "drafts:write",
  "drafts:read",
  "drafts:update",
  "conversations:read",
  "conversations:write",
] as const;

export type ScopeName = typeof VALID_SCOPES[number];