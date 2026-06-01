// ── Per-token rate limiter ──────────────────────────────────────────────
//
// Sliding-window counter: counts rows in api_request_log within the past
// minute for a given token, compares against the token's rate_limit_per_minute.
// If over, returns a 429 envelope; otherwise records the request and lets
// the caller proceed.
//
// This is intentionally simple — no Redis, no token-bucket math. For Sam's
// 50–500/day volume (~21/hour peak) we're orders of magnitude below the
// default 60/min cap, and the DB read is cheap thanks to the index on
// (token_id, created_at DESC).
//
// Best-effort: if the count query fails, we ALLOW the request and log the
// error. A broken rate limiter shouldn't outage the API for partners.
import { NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export interface RateLimitResult {
  allowed: boolean;
  /** Number of requests already made in the current window. */
  current: number;
  /** Per-minute limit configured on the token. */
  limit: number;
  /** Seconds until the oldest counted request falls out of the window. */
  retryAfterSeconds?: number;
}

/**
 * Check (and record) a request against the token's rate limit.
 * Returns { allowed: true } if under the limit (and records the request).
 * Returns { allowed: false } if at/over (does NOT record — we don't want
 * a blocked request to extend its own block).
 */
export async function checkAndRecordRateLimit(
  tokenId: string,
  path?: string
): Promise<RateLimitResult> {
  const supabase = createServerClient();

  // Fetch the per-token limit. Defaults to 60 if missing (shouldn't happen
  // due to the NOT NULL DEFAULT on the column, but defensive).
  const { data: token, error: tokenErr } = await supabase
    .from("api_tokens")
    .select("rate_limit_per_minute")
    .eq("id", tokenId)
    .maybeSingle();

  if (tokenErr || !token) {
    // Token vanished mid-request. Fail open — the auth layer will catch
    // it on the next request.
    return { allowed: true, current: 0, limit: 60 };
  }

  const limit = token.rate_limit_per_minute ?? 60;
  const windowStart = new Date(Date.now() - 60_000).toISOString();

  // Count requests in the window. Using count: "exact" so we get the
  // actual row count, not an estimate.
  const { count, error: countErr } = await supabase
    .from("api_request_log")
    .select("id", { count: "exact", head: true })
    .eq("token_id", tokenId)
    .gte("created_at", windowStart);

  if (countErr) {
    console.error("[rate-limit] count error, failing open:", countErr.message);
    return { allowed: true, current: 0, limit };
  }

  const current = count || 0;

  if (current >= limit) {
    // At or over the limit. Don't record; client gets 429.
    return {
      allowed: false,
      current,
      limit,
      // Conservative retry: tell them to wait the full window. Sliding
      // windows mean this is usually pessimistic, but it's safe.
      retryAfterSeconds: 60,
    };
  }

  // Under the limit — record this request and allow.
  //
  // Best-effort: if the insert fails we still allow (we already know they're
  // under the limit). The next request will count correctly thanks to the
  // index lookup.
  supabase
    .from("api_request_log")
    .insert({ token_id: tokenId, path: path || null })
    .then(({ error }) => {
      if (error) console.error("[rate-limit] log insert failed:", error.message);
    });

  return { allowed: true, current: current + 1, limit };
}

/**
 * Convenience: produce a NextResponse 429 envelope from a rate limit result.
 * Includes the Retry-After header as RFC 6585 / 7231 recommend.
 */
export function rateLimitedResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    {
      error: "Rate limit exceeded",
      detail: `${result.current}/${result.limit} requests in the last minute. Retry after ${result.retryAfterSeconds || 60}s.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds || 60),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
      },
    }
  );
}
