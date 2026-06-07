/**
 * POST /api/admin/repair-conversation-labels
 *
 * Repairs conversations that exist in the DB but are missing the
 * `[account, Inbox]` auto-labels and the `folder_id` linkage. These end
 * up "invisible" to the UI — the sidebar count badge sees them (it counts
 * by email_account_id), but the conversation-list view filters by
 * folder_id so they don't render.
 *
 * Origin of the orphans:
 *   An earlier version of /api/admin/backfill-account inserted
 *   conversations without calling `onNewConversationFromSync`. The sync
 *   does call it; the spam backfill didn't need to (those go to a
 *   different surface). The fix on the backfill endpoint is in place
 *   for future runs — this endpoint cleans up the existing damage.
 *
 * Behavior:
 *   1. Find all open conversations for the given account where folder_id
 *      IS NULL (the most reliable orphan signal — anything that went
 *      through onNewConversationFromSync got folder_id set).
 *   2. For each, fetch the first message to determine isOutbound (matches
 *      the sync's behavior: the FIRST message's direction determines
 *      whether Inbox label gets applied).
 *   3. Call onNewConversationFromSync(conv.id, accountId, isOutbound)
 *      which applies labels + sets folder_id. Idempotent.
 *   4. Return the count of conversations repaired.
 *
 * Admin-only (passes actor_id; verified against team_members.role).
 *
 * Request:
 *   POST /api/admin/repair-conversation-labels
 *   { actor_id: string, account_id: string }
 *
 * Response 200:
 *   {
 *     ok: true,
 *     found: number,         // orphan conversations identified
 *     repaired: number,      // successful onNewConversationFromSync calls
 *     errors: number,
 *   }
 */
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { onNewConversationFromSync } from "@/lib/folder-labels";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient();
    const body = await req.json().catch(() => ({}));

    const actorId:   string | undefined = body.actor_id   || body.actorId;
    const accountId: string | undefined = body.account_id || body.accountId;

    if (!actorId)   return NextResponse.json({ error: "actor_id is required"   }, { status: 400 });
    if (!accountId) return NextResponse.json({ error: "account_id is required" }, { status: 400 });

    // ── Admin gate ─────────────────────────────────────────────────
    const { data: actor } = await supabase
      .from("team_members")
      .select("role")
      .eq("id", actorId)
      .maybeSingle();
    if (!actor || actor.role !== "admin") {
      return NextResponse.json({ error: "Admin only" }, { status: 403 });
    }

    // ── Confirm the account exists ─────────────────────────────────
    const { data: account, error: aErr } = await supabase
      .from("email_accounts")
      .select("id, email")
      .eq("id", accountId)
      .maybeSingle();
    if (aErr || !account) {
      return NextResponse.json({ error: aErr?.message || "Account not found" }, { status: 404 });
    }

    // ── Find orphaned conversations ──────────────────────────────
    // Criterion: folder_id IS NULL. Anything that went through the proper
    // sync path got its folder_id populated by onNewConversationFromSync;
    // anything that didn't, didn't. We also exclude trash/spam since those
    // intentionally don't get inbox labeling.
    const { data: orphans, error: oErr } = await supabase
      .from("conversations")
      .select("id")
      .eq("email_account_id", accountId)
      .is("folder_id", null)
      .not("status", "in", "(trash,spam)");

    if (oErr) {
      return NextResponse.json({ error: oErr.message }, { status: 500 });
    }
    const orphanIds = (orphans || []).map((c: any) => c.id);

    if (orphanIds.length === 0) {
      return NextResponse.json({ ok: true, found: 0, repaired: 0, errors: 0 });
    }

    // ── For each orphan, determine direction from the first message ─
    // We need this because onNewConversationFromSync only applies the
    // Inbox label + sets folder_id when isOutbound is false. Using the
    // FIRST message matches sync semantics. For conversations that have
    // no messages at all (shouldn't happen, but defensive), we treat
    // them as inbound so they at least land in Inbox.
    const { data: messages, error: mErr } = await supabase
      .from("messages")
      .select("conversation_id, is_outbound, sent_at")
      .in("conversation_id", orphanIds)
      .order("sent_at", { ascending: true });

    if (mErr) {
      return NextResponse.json({ error: mErr.message }, { status: 500 });
    }

    // First message per conversation wins (table is ordered ASC by sent_at).
    const firstDirection = new Map<string, boolean>();   // convId → isOutbound
    for (const m of (messages || []) as any[]) {
      if (!firstDirection.has(m.conversation_id)) {
        firstDirection.set(m.conversation_id, !!m.is_outbound);
      }
    }

    // ── Apply labels + folder_id (idempotent) ────────────────────
    // Bounded concurrency so we don't slam the DB with hundreds of
    // simultaneous label upserts.
    let repaired = 0;
    let errors = 0;
    const concurrency = 5;

    const repairOne = async (convId: string) => {
      try {
        const isOutbound = firstDirection.get(convId) ?? false; // default to inbound
        await onNewConversationFromSync(convId, accountId, isOutbound);
        repaired++;
      } catch (e: any) {
        console.error("[repair-conversation-labels]", convId, e?.message || e);
        errors++;
      }
    };

    for (let i = 0; i < orphanIds.length; i += concurrency) {
      const batch = orphanIds.slice(i, i + concurrency);
      await Promise.all(batch.map(repairOne));
    }

    return NextResponse.json({
      ok: true,
      found: orphanIds.length,
      repaired,
      errors,
    });
  } catch (err: any) {
    console.error("POST /api/admin/repair-conversation-labels failed:", err);
    return NextResponse.json(
      { error: err?.message || "Internal error" },
      { status: 500 }
    );
  }
}
