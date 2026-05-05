export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { computeSupplierScore, type RtRecord, type ScoreResult } from "@/lib/supplier-scoring";

// ═══════════════════════════════════════════════════════════════
// Cron: /api/cron/score-suppliers — every 6 hours
//
// Reads inbox.response_times (direction='supplier_reply'),
// groups by supplier_email, computes score per Batch 10 spec,
// writes back to inbox.supplier_contacts.
//
// For supplier_emails with ≥3 qualifying exchanges that DON'T
// have a supplier_contacts row yet, we lazy-hydrate one (Q7b-A).
// This way every scoreable supplier has a stable home for
// timezone/work_hours later.
//
// Secured by CRON_SECRET header check (matches /api/cron/sync pattern).
// ═══════════════════════════════════════════════════════════════

export async function GET(req: NextRequest) {
  const startTime = Date.now();

  // Auth — same pattern as /api/cron/sync and /api/cron/unread-alerts
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "inbox" } }
  );

  const result = {
    success: false as boolean,
    scored: 0,
    hydrated: 0,
    skipped_below_threshold: 0,
    total_suppliers_seen: 0,
    duration_ms: 0,
    errors: [] as string[],
  };

  try {
    // ── 1. Load all response_times rows (both directions, paginated) ──
    // NOTE: Supabase/PostgREST caps responses at 1000 rows per query (max_rows config).
    // Requesting a wider .range() doesn't override the cap — it silently returns 1000.
    //
    // We load BOTH directions (supplier_reply + team_reply) because the threshold
    // counts total messages exchanged, not just supplier replies (spec-literal interpretation).
    let allRecords: { supplier_email: string; response_minutes: number; response_sent_at: string; direction: "supplier_reply" | "team_reply" }[] = [];
    let offset = 0;
    const PAGE = 1000;
    while (true) {
      const { data: batch, error: batchErr } = await supabase
        .from("response_times")
        .select("supplier_email, response_minutes, response_sent_at, direction")
        .not("supplier_email", "is", null)
        .range(offset, offset + PAGE - 1);

      if (batchErr) {
        result.errors.push("response_times query: " + batchErr.message);
        return NextResponse.json({ ...result, duration_ms: Date.now() - startTime }, { status: 500 });
      }
      if (!batch || batch.length === 0) break;
      allRecords = allRecords.concat(batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }

    // ── 2. Load all supplier_contacts (just id + email) ──
    let allContacts: { id: string; email: string }[] = [];
    let cOffset = 0;
    while (true) {
      const { data: cBatch, error: cErr } = await supabase
        .from("supplier_contacts")
        .select("id, email")
        .range(cOffset, cOffset + PAGE - 1);

      if (cErr) {
        result.errors.push("supplier_contacts query: " + cErr.message);
        return NextResponse.json({ ...result, duration_ms: Date.now() - startTime }, { status: 500 });
      }
      if (!cBatch || cBatch.length === 0) break;
      allContacts = allContacts.concat(cBatch);
      if (cBatch.length < PAGE) break;
      cOffset += PAGE;
    }

    const contactByEmail: Record<string, string> = {};
    for (const c of allContacts) {
      if (c.email) contactByEmail[c.email.toLowerCase()] = c.id;
    }

    // ── 3. Group records by supplier_email ──
    const bySupplier: Record<string, RtRecord[]> = {};
    for (const r of allRecords) {
      const email = (r.supplier_email || "").toLowerCase();
      if (!email) continue;
      if (!bySupplier[email]) bySupplier[email] = [];
      bySupplier[email].push({
        response_minutes: r.response_minutes,
        response_sent_at: r.response_sent_at,
        direction: r.direction,
      });
    }

    result.total_suppliers_seen = Object.keys(bySupplier).length;

    // ── 4. Score each supplier; lazy-hydrate supplier_contacts where needed ──
    const now = new Date();
    const toHydrate: { email: string; score: ScoreResult }[] = [];
    const toUpdate: { id: string; payload: any }[] = [];
    const nowIso = now.toISOString();

    const supplierEntries = Object.entries(bySupplier);
    for (let i = 0; i < supplierEntries.length; i++) {
      const email = supplierEntries[i][0];
      const records = supplierEntries[i][1];
      const score = computeSupplierScore(records, now);

      // Below-threshold (<3 exchanges): skip — don't pollute supplier_contacts with junk rows
      if (score.belowThreshold) {
        result.skipped_below_threshold++;
        continue;
      }

      const existingId = contactByEmail[email];
      const payload = {
        responsiveness_score: score.score,
        responsiveness_tier: score.tier,
        score_updated_at: nowIso,
        recent_median_minutes: score.recentMedianMinutes,
        all_time_median_minutes: score.allTimeMedianMinutes,
        weighted_median_minutes: score.weightedMedianMinutes,
        qualifying_exchanges: score.qualifyingExchanges,
        last_exchange_at: score.lastExchangeAt,
      };

      if (existingId) {
        toUpdate.push({ id: existingId, payload });
      } else {
        // Lazy-hydrate: create a supplier_contacts row (Q7b-A)
        toHydrate.push({ email, score });
      }
    }

    // ── 5. Insert hydrated rows in chunks ──
    if (toHydrate.length > 0) {
      const hydrateRows = toHydrate.map(h => {
        const domainPart = h.email.split("@")[1] || "";
        const localPart = h.email.split("@")[0] || h.email;
        // Defensive name: prefer local-part, falls back to domain
        const guessedName = localPart || domainPart || h.email;
        return {
          email: h.email,
          name: guessedName,
          responsiveness_score: h.score.score,
          responsiveness_tier: h.score.tier,
          score_updated_at: nowIso,
          recent_median_minutes: h.score.recentMedianMinutes,
          all_time_median_minutes: h.score.allTimeMedianMinutes,
          weighted_median_minutes: h.score.weightedMedianMinutes,
          qualifying_exchanges: h.score.qualifyingExchanges,
          last_exchange_at: h.score.lastExchangeAt,
        };
      });

      for (let k = 0; k < hydrateRows.length; k += 50) {
        const chunk = hydrateRows.slice(k, k + 50);
        const { error: insErr } = await supabase.from("supplier_contacts").insert(chunk);
        if (insErr) {
          result.errors.push("hydrate insert: " + insErr.message);
        } else {
          result.hydrated += chunk.length;
        }
      }
    }

    // ── 6. Update existing supplier_contacts rows ──
    // Supabase doesn't have a true bulk-update by id, so we issue updates in parallel chunks.
    if (toUpdate.length > 0) {
      const CONCURRENCY = 10;
      for (let k = 0; k < toUpdate.length; k += CONCURRENCY) {
        const chunk = toUpdate.slice(k, k + CONCURRENCY);
        const ops = chunk.map(u =>
          supabase.from("supplier_contacts").update(u.payload).eq("id", u.id)
            .then((r: any) => {
              if (r.error) {
                result.errors.push(`update ${u.id.slice(0, 8)}: ${r.error.message}`);
              } else {
                result.scored++;
              }
            }, (err: any) => {
              result.errors.push(`update ${u.id.slice(0, 8)}: ${err?.message || "unknown"}`);
            })
        );
        await Promise.all(ops);
      }
    }

    result.success = true;
    result.duration_ms = Date.now() - startTime;
    console.log(`[cron-score-suppliers] scored=${result.scored} hydrated=${result.hydrated} skipped=${result.skipped_below_threshold} total_seen=${result.total_suppliers_seen} errors=${result.errors.length} duration=${result.duration_ms}ms`);
    return NextResponse.json(result);

  } catch (err: any) {
    result.errors.push(err?.message || "Unknown error");
    result.duration_ms = Date.now() - startTime;
    console.error("[cron-score-suppliers] failed:", err?.message);
    return NextResponse.json(result, { status: 500 });
  }
}

// Allow manual trigger via POST as well (admin-only via CRON_SECRET).
export async function POST(req: NextRequest) {
  return GET(req);
}