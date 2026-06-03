// ── src/lib/supplier-status-activity.ts ────────────────────────────────
//
// Helper for logging supplier-status changes into the activity_log.
//
// Called from both the PATCH endpoint (single change) and the bulk POST
// endpoint (batch). Per Rod's design (Batch 6, Feature 4):
//   Q1-A: Log one activity_log row per conversation that involves the
//         changed (supplier_contact_id × email_account_id) pair. This
//         way every related conversation surfaces the status change
//         in its Activity tab.
//   Q2-B: Include account name in `details` so the rendered entry
//         can say "Rosie changed supplier status (Bobber Labs) ..."
//   Q3-A: No backfill — function does nothing if called on a no-op
//         change (prev_status_id === new_status_id).
//   Q4-A: Centralized here so PATCH + bulk POST both call it; no
//         drift between callers.
//
// Action string: "supplier_status_changed" (distinct from the existing
// conversation-level "status_changed" action which covers open/closed).
//
// Failure mode: logging is best-effort. Errors are logged to console
// but don't propagate to the caller — the status change itself is the
// primary operation, audit trail is bonus.

import type { SupabaseClient } from "@supabase/supabase-js";

// Permissive client type to avoid the recurring "public" vs "inbox"
// schema generic conflict. Same trick used in supplier-contact-resolver.
type AnySupabase = SupabaseClient<any, any, any, any, any>;

export interface StatusChange {
  supplier_contact_id: string;
  email_account_id: string;
  // null = the assignment had no status set (e.g. fresh row or cleared)
  previous_status_id: string | null;
  new_status_id: string | null;
}

// Single change — used by PATCH endpoint
export async function logSupplierStatusChange(
  supabase: AnySupabase,
  change: StatusChange,
  actorId: string | null
): Promise<void> {
  await logSupplierStatusChanges(supabase, [change], actorId);
}

// Batched — used by bulk POST endpoint. More efficient because it
// resolves status + account lookups once and bulk-inserts rows.
export async function logSupplierStatusChanges(
  supabase: AnySupabase,
  changes: StatusChange[],
  actorId: string | null
): Promise<void> {
  // Skip no-ops — same status_id before and after
  const effective = changes.filter(c => c.previous_status_id !== c.new_status_id);
  if (effective.length === 0) return;

  try {
    // ── Collect all status_ids + account_ids we need to look up ──────
    const statusIdsNeeded = new Set<string>();
    const accountIdsNeeded = new Set<string>();
    const supplierIdsNeeded = new Set<string>();
    for (const c of effective) {
      if (c.previous_status_id) statusIdsNeeded.add(c.previous_status_id);
      if (c.new_status_id) statusIdsNeeded.add(c.new_status_id);
      accountIdsNeeded.add(c.email_account_id);
      supplierIdsNeeded.add(c.supplier_contact_id);
    }

    // ── Look up status names, account names, affected conversations ──
    const [statusRes, accountRes, conversationsRes] = await Promise.all([
      statusIdsNeeded.size > 0
        ? supabase
            .from("supplier_statuses")
            .select("id, name")
            .in("id", Array.from(statusIdsNeeded))
        : Promise.resolve({ data: [] as any[], error: null }),
      supabase
        .from("email_accounts")
        .select("id, name")
        .in("id", Array.from(accountIdsNeeded)),
      // Conversations affected: any with matching supplier_contact_id +
      // email_account_id pair. Pulling all matching rows for all changes
      // in one query, then filtering per-pair below.
      supabase
        .from("conversations")
        .select("id, supplier_contact_id, email_account_id")
        .in("supplier_contact_id", Array.from(supplierIdsNeeded))
        .in("email_account_id", Array.from(accountIdsNeeded)),
    ]);

    if (statusRes.error) {
      console.error("[supplier-status-activity] status lookup failed:", statusRes.error.message);
      return;
    }
    if (accountRes.error) {
      console.error("[supplier-status-activity] account lookup failed:", accountRes.error.message);
      return;
    }
    if (conversationsRes.error) {
      console.error("[supplier-status-activity] conversations lookup failed:", conversationsRes.error.message);
      return;
    }

    const statusNameById = new Map<string, string>(
      ((statusRes.data || []) as any[]).map(s => [s.id, s.name])
    );
    const accountNameById = new Map<string, string>(
      ((accountRes.data || []) as any[]).map(a => [a.id, a.name])
    );

    // Index conversations by (supplier × account) pair for fast lookup
    const convosByPair = new Map<string, string[]>();
    for (const c of ((conversationsRes.data || []) as any[])) {
      const key = `${c.supplier_contact_id}::${c.email_account_id}`;
      const arr = convosByPair.get(key) || [];
      arr.push(c.id);
      convosByPair.set(key, arr);
    }

    // ── Build all activity_log rows ──────────────────────────────────
    const now = new Date().toISOString();
    const activityRows: any[] = [];
    for (const change of effective) {
      const pairKey = `${change.supplier_contact_id}::${change.email_account_id}`;
      const affectedConvIds = convosByPair.get(pairKey) || [];
      if (affectedConvIds.length === 0) continue;

      const details = {
        supplier_contact_id: change.supplier_contact_id,
        email_account_id: change.email_account_id,
        account_name: accountNameById.get(change.email_account_id) || null,
        previous_status_id: change.previous_status_id,
        previous_status_name: change.previous_status_id
          ? (statusNameById.get(change.previous_status_id) || null)
          : null,
        new_status_id: change.new_status_id,
        new_status_name: change.new_status_id
          ? (statusNameById.get(change.new_status_id) || null)
          : null,
      };

      for (const conversationId of affectedConvIds) {
        activityRows.push({
          conversation_id: conversationId,
          actor_id: actorId,
          action: "supplier_status_changed",
          details,
          created_at: now,
        });
      }
    }

    if (activityRows.length === 0) return;

    // ── Bulk insert. Split into chunks to stay under any payload limits ──
    const CHUNK = 200;
    for (let i = 0; i < activityRows.length; i += CHUNK) {
      const slice = activityRows.slice(i, i + CHUNK);
      const { error: insErr } = await supabase
        .from("activity_log")
        .insert(slice);
      if (insErr) {
        console.error("[supplier-status-activity] insert failed:", insErr.message);
        // Continue to the next chunk — best-effort logging
      }
    }
  } catch (e: any) {
    console.error("[supplier-status-activity] uncaught:", e?.message || String(e));
  }
}
