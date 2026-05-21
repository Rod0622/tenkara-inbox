// src/app/api/cron/call-follow-ups/route.ts
//
// Runs every 30 minutes via Vercel Cron.
//
// Looks at inbox.call_follow_ups WHERE status IN ('pending','in_progress')
// AND next_attempt_after <= now(). For each:
//
//   IF attempt_count >= max_attempts AND distinct attempt-day count >= 2:
//     → status = 'escalated', escalated_at = now()
//     → notify the original assignee (and original creator)
//     → log activity_log entry on the linked conversation (if any)
//
//   ELSE:
//     → create a redial Task on the linked conversation (or standalone if none)
//     → mark attempt_count++, last_attempt_at = now(), last_attempt_date = today
//     → status = 'in_progress'
//     → set next_attempt_after = now() + ~4h (longer between attempts on 2nd try)
//     → notify the assignee that a redial task is due
//
// Idempotent: only acts on rows whose next_attempt_after has passed.
//
// Secured by CRON_SECRET (matches sync cron pattern).

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createNotifications } from "@/lib/notifications";

const NEXT_ATTEMPT_HOURS = [4, 24]; // hours from creation: 1st redial at +4h, 2nd at +24h

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "inbox" } }
  );

  const results = {
    processed: 0,
    redials_created: 0,
    escalated: 0,
    stubs_canceled: 0,
    errors: [] as string[],
  };

  try {
    const nowIso = new Date().toISOString();

    // Fetch due follow-ups
    const { data: dueRows, error: dueErr } = await supabase
      .from("call_follow_ups")
      .select("*")
      .in("status", ["pending", "in_progress"])
      .lte("next_attempt_after", nowIso)
      .order("next_attempt_after", { ascending: true })
      .limit(50); // safety cap per cron tick

    if (dueErr) {
      return NextResponse.json({ error: dueErr.message, duration_ms: Date.now() - startTime }, { status: 500 });
    }
    // (No early return on empty dueRows — we still want to run stub cleanup
    //  at the bottom of this try block.)

    for (const row of (dueRows || []) as any[]) {
      try {
        results.processed++;

        const nextAttemptNumber = (row.attempt_count || 0) + 1;
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
        const lastAttemptDate: string | null = row.last_attempt_date;

        // Distinct-day count for "across 2 separate days" rule
        const distinctDays = lastAttemptDate
          ? (lastAttemptDate === today ? 1 : 2)
          : (nextAttemptNumber > 1 ? 1 : 0);

        // Escalation gate: max_attempts reached AND we've been at this for ≥2 days
        const shouldEscalate =
          nextAttemptNumber > row.max_attempts &&
          distinctDays >= 2;

        if (shouldEscalate) {
          await supabase
            .from("call_follow_ups")
            .update({
              status: "escalated",
              escalated_at: new Date().toISOString(),
            })
            .eq("id", row.id);

          results.escalated++;

          // Notify the assignee (and creator if different)
          const notifies: any[] = [];
          if (row.assigned_to) {
            notifies.push({
              user_id: row.assigned_to,
              type: "call_followup_escalated",
              title: "Call follow-up escalated",
              body: row.notes || "Max redial attempts reached over 2+ days.",
              conversation_id: row.conversation_id || undefined,
              actor_id: null,
            });
          }
          if (row.created_by && row.created_by !== row.assigned_to) {
            notifies.push({
              user_id: row.created_by,
              type: "call_followup_escalated",
              title: "Call follow-up escalated",
              body: row.notes || "Max redial attempts reached over 2+ days.",
              conversation_id: row.conversation_id || undefined,
              actor_id: null,
            });
          }
          if (notifies.length) await createNotifications(notifies);

          if (row.conversation_id) {
            await supabase.from("activity_log").insert({
              conversation_id: row.conversation_id,
              actor_id: null,
              action: "quo_call_followup_escalated",
              details: {
                follow_up_id: row.id,
                attempt_count: row.attempt_count,
                max_attempts: row.max_attempts,
              },
            });
          }
          continue;
        }

        // Otherwise: create a redial task
        const taskRow: any = {
          conversation_id: row.conversation_id || null,
          text: `Redial: attempt ${nextAttemptNumber} of ${row.max_attempts}`,
          status: "todo",
          is_done: false,
          assignee_id: row.assigned_to || null,
        };

        const { data: createdTask, error: taskErr } = await supabase
          .from("tasks")
          .insert(taskRow)
          .select("id")
          .single();

        if (taskErr) {
          results.errors.push(`task insert failed for ${row.id}: ${taskErr.message}`);
          continue;
        }

        // Schedule next attempt
        const hoursOffset = NEXT_ATTEMPT_HOURS[Math.min(nextAttemptNumber, NEXT_ATTEMPT_HOURS.length - 1)];
        const nextAfter = new Date(Date.now() + hoursOffset * 60 * 60 * 1000).toISOString();

        await supabase
          .from("call_follow_ups")
          .update({
            status: "in_progress",
            attempt_count: nextAttemptNumber,
            last_attempt_at: new Date().toISOString(),
            last_attempt_date: today,
            next_attempt_after: nextAfter,
            task_id: (createdTask as any).id,
          })
          .eq("id", row.id);

        results.redials_created++;

        // Notify assignee
        if (row.assigned_to) {
          await createNotifications([{
            user_id: row.assigned_to,
            type: "call_followup_due",
            title: `Redial due — attempt ${nextAttemptNumber} of ${row.max_attempts}`,
            body: row.notes || "Call follow-up reminder",
            conversation_id: row.conversation_id || undefined,
            task_id: (createdTask as any).id,
            actor_id: null,
          }]);
        }

        if (row.conversation_id) {
          await supabase.from("activity_log").insert({
            conversation_id: row.conversation_id,
            actor_id: null,
            action: "quo_call_followup_redial",
            details: {
              follow_up_id: row.id,
              attempt: nextAttemptNumber,
              max_attempts: row.max_attempts,
              task_id: (createdTask as any).id,
            },
          });
        }
      } catch (rowErr: any) {
        results.errors.push(`row ${row.id}: ${rowErr?.message || String(rowErr)}`);
      }
    }

    // ── Stub cleanup pass ──────────────────────────────
    // Cancel any stub rows that have been "ringing" for >10 min with no
    // matching webhook arrival (user clicked Call but never dialed, or the
    // webhook failed to merge for some reason). Sets status='canceled' so
    // the timeline UI shows them as not-actually-placed.
    try {
      const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const { data: cleaned, error: cleanErr } = await supabase
        .from("quo_call_logs")
        .update({ status: "canceled", outcome: "no_answer" })
        .eq("is_stub", true)
        .eq("status", "ringing")
        .lte("started_at", tenMinAgo)
        .select("id");

      if (cleanErr) {
        results.errors.push(`stub cleanup: ${cleanErr.message}`);
      } else {
        results.stubs_canceled = (cleaned || []).length;
      }
    } catch (cleanErr: any) {
      results.errors.push(`stub cleanup crashed: ${cleanErr?.message || String(cleanErr)}`);
    }

    return NextResponse.json({ ...results, duration_ms: Date.now() - startTime });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Cron failed", duration_ms: Date.now() - startTime },
      { status: 500 }
    );
  }
}