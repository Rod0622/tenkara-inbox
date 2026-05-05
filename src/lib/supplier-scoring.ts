// ═══════════════════════════════════════════════════════════════
// Supplier Responsiveness Scoring (Batch 10)
// Pure functions — no DB, no I/O. Easy to unit test.
//
// Spec recap (Q-locked answers from design phase, then re-locked
// after first production deployment in light of real data):
//   Q8-C  : score uses calendar minutes (raw response_minutes)
//   Q9-A  : last 90d records counted 2x via duplicate-record weighting
//   Q9-i  : suppliers with only >90d records still get scored (1x weights)
//   Q11-A : tier color/label mapping — single source of truth here
//
// Q10 RE-LOCKED to spec-literal (i) + sanity guard B:
//   Threshold uses TOTAL messages (supplier_replies + team_replies):
//     <3 total messages       → no badge / no score
//     3-4 total messages      → forced "fair" (score 2)
//     5+ total messages       → real score, BUT with sanity guard:
//       if <2 supplier_replies, force "fair" anyway
//       (avoids confidently tiering "Excellent" or "Low" off a single reply)
//
// Median is always computed over supplier_reply records only —
// "supplier response time" only makes sense for actual replies.
// ═══════════════════════════════════════════════════════════════

export type Tier = "excellent" | "good" | "fair" | "low" | "no_response";
export type Direction = "supplier_reply" | "team_reply";

export interface RtRecord {
  response_minutes: number;
  response_sent_at: string; // ISO timestamp
  direction: Direction;     // 'supplier_reply' = supplier responded to us
                            // 'team_reply' = we responded to supplier
}

export interface ScoreResult {
  score: number; // 0-4
  tier: Tier;
  recentMedianMinutes: number | null;   // median of last-90d supplier_reply records (null if none)
  allTimeMedianMinutes: number | null;  // median of all supplier_reply records (null if none)
  weightedMedianMinutes: number | null; // median used to derive the score (null if forced/below)
  qualifyingExchanges: number;          // TOTAL record count (both directions)
  supplierReplyCount: number;           // count of records where direction='supplier_reply'
  lastExchangeAt: string | null;        // most recent response_sent_at across all records
  /** True when the supplier was forced to "fair" — either by message count (3-4) or sanity guard (<2 supplier replies). */
  forcedFair: boolean;
  /** True when the supplier has fewer than 3 total messages (no badge should be shown). */
  belowThreshold: boolean;
}

const MIN_BADGE_EXCHANGES = 3;       // <3 total messages → no badge
const MIN_REAL_SCORE_EXCHANGES = 5;  // 5+ total messages → eligible for real score
const MIN_SUPPLIER_REPLIES_FOR_REAL_SCORE = 2; // sanity guard B: <2 supplier replies → force fair
const RECENCY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

// Threshold values in minutes
const HOUR = 60;
const T_24H = 24 * HOUR;
const T_48H = 48 * HOUR;
const T_96H = 96 * HOUR;

/**
 * Maps a median (in minutes) to a tier and score.
 * Calendar minutes per Q8-C.
 */
export function tierFromMedianMinutes(medianMinutes: number | null): { score: number; tier: Tier } {
  if (medianMinutes === null || medianMinutes === undefined) {
    return { score: 0, tier: "no_response" };
  }
  if (medianMinutes < T_24H) return { score: 4, tier: "excellent" };
  if (medianMinutes < T_48H) return { score: 3, tier: "good" };
  if (medianMinutes < T_96H) return { score: 2, tier: "fair" };
  return { score: 1, tier: "low" };
}

/** Median of an array of numbers, rounded to integer (matches schema column type).
 *  Returns null for empty arrays. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Even-length arrays: return the lower-mid (matches existing behavior in /api/response-times).
  // Round to integer because response_minutes is stored as decimal but our score columns are integer.
  return Math.round(sorted[mid]);
}

/**
 * Compute the supplier responsiveness score.
 *
 * @param records  ALL response_times rows for this supplier (both directions).
 * @param now      Reference time (for recency window). Pass new Date() in production.
 */
export function computeSupplierScore(records: RtRecord[], now: Date = new Date()): ScoreResult {
  const total = records.length;
  const supplierReplies = records.filter(r => r.direction === "supplier_reply");
  const supplierReplyCount = supplierReplies.length;

  const lastExchangeAt = total === 0
    ? null
    : records.reduce((latest, r) => (r.response_sent_at > latest ? r.response_sent_at : latest), records[0].response_sent_at);

  // --- Below-threshold: <3 total messages → no badge ---
  if (total < MIN_BADGE_EXCHANGES) {
    return {
      score: 0,
      tier: "no_response",
      recentMedianMinutes: null,
      allTimeMedianMinutes: supplierReplyCount > 0 ? median(supplierReplies.map(r => r.response_minutes)) : null,
      weightedMedianMinutes: null,
      qualifyingExchanges: total,
      supplierReplyCount,
      lastExchangeAt,
      forcedFair: false,
      belowThreshold: true,
    };
  }

  // Compute medians from supplier_replies (regardless of forced/real path)
  const cutoff = now.getTime() - RECENCY_WINDOW_MS;
  const recentSupplierReplies = supplierReplies.filter(r => new Date(r.response_sent_at).getTime() >= cutoff);
  const recentMins = recentSupplierReplies.map(r => r.response_minutes);
  const allMins = supplierReplies.map(r => r.response_minutes);

  const recentMedianMinutes = median(recentMins);
  const allTimeMedianMinutes = median(allMins);

  // --- Forced "fair" tier: 3-4 total messages OR sanity guard for thin supplier-reply data ---
  const sanityGuardTriggers = total >= MIN_REAL_SCORE_EXCHANGES && supplierReplyCount < MIN_SUPPLIER_REPLIES_FOR_REAL_SCORE;
  if (total < MIN_REAL_SCORE_EXCHANGES || sanityGuardTriggers) {
    return {
      score: 2,
      tier: "fair",
      recentMedianMinutes,
      allTimeMedianMinutes,
      weightedMedianMinutes: null,
      qualifyingExchanges: total,
      supplierReplyCount,
      lastExchangeAt,
      forcedFair: true,
      belowThreshold: false,
    };
  }

  // --- Real score path: 5+ total messages AND ≥2 supplier replies ---
  // Q9-A: duplicate-record weighting. Each <90d supplier_reply appears twice.
  // Q9-i: stale-only suppliers (no recent supplier_replies) still get scored using all-time median.
  let weighted: number[];
  if (recentMins.length === 0) {
    weighted = allMins.slice();
  } else {
    weighted = allMins.slice();
    for (const r of recentSupplierReplies) weighted.push(r.response_minutes);
  }

  // Edge case: if we got here with zero supplier replies, all medians are null
  // (means: 5+ team_replies, 0 supplier_replies — supplier never replied at all).
  // The sanity guard above catches <2 replies, so this would only hit if MIN_SUPPLIER_REPLIES_FOR_REAL_SCORE was 0.
  // Defensive null check anyway.
  const weightedMedianMinutes = median(weighted);
  const { score, tier } = tierFromMedianMinutes(weightedMedianMinutes);

  return {
    score,
    tier,
    recentMedianMinutes,
    allTimeMedianMinutes,
    weightedMedianMinutes,
    qualifyingExchanges: total,
    supplierReplyCount,
    lastExchangeAt,
    forcedFair: false,
    belowThreshold: false,
  };
}

// ─── Tier presentation (single source of truth for UI) ──────────
// Q11-A color tokens — match existing dashboard palette so chips look native.
export const TIER_COLORS: Record<Tier, string> = {
  excellent: "#4ADE80", // green
  good:      "#58A6FF", // blue
  fair:      "#F0883E", // orange
  low:       "#F85149", // red
  no_response:"#484F58", // gray
};

export const TIER_LABELS: Record<Tier, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  low: "Low",
  no_response: "No response",
};

/** Subtle background tint for the same tier (e.g. for chip backgrounds). */
export const TIER_BG: Record<Tier, string> = {
  excellent: "rgba(74,222,128,0.10)",
  good:      "rgba(88,166,255,0.10)",
  fair:      "rgba(240,136,62,0.10)",
  low:       "rgba(248,81,73,0.10)",
  no_response:"rgba(72,79,88,0.10)",
};

/** Format minutes as "8h", "2.5d" etc. — matches existing helper across codebase. */
export function fmtMinutes(m: number | null | undefined): string {
  if (m === null || m === undefined) return "—";
  if (m < 60) return Math.round(m) + "m";
  if (m < 1440) return Math.round(m / 60 * 10) / 10 + "h";
  return Math.round(m / 1440 * 10) / 10 + "d";
}