export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── POST /api/supplier-account-status/bulk ─────────────────────────────
//
// Set status for many (supplier × account) pairs in one request. Used by
// the Team Coverage drill-in's bulk-edit mode (Batch 6, Feature 2).
//
// Body:
//   {
//     items: [
//       { supplier_contact_id, email_account_id, status_id: string | null },
//       ...
//     ],
//     actor_id?: string | null
//   }
//
// Response:
//   { applied: number, errors: [{ index, message }, ...] }
//
// Each item is processed individually (try update by unique pair, else
// insert). Per-item errors are collected but don't abort the batch — the
// frontend reads `errors` and reports them if non-empty.
//
// `status_id: null` clears the status (same semantics as PATCH).
//
// Capped at 200 items per request to bound execution time and prevent
// runaway updates.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body?.items) ? body.items : null;
  const actorId = body?.actor_id || null;

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }
  if (items.length > 200) {
    return NextResponse.json({ error: "Max 200 items per bulk request" }, { status: 400 });
  }

  // Validate each item up front. Better to reject the whole batch than
  // do half of it and surprise the caller.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it?.supplier_contact_id || !it?.email_account_id) {
      return NextResponse.json(
        { error: `Item ${i}: supplier_contact_id and email_account_id are required` },
        { status: 400 }
      );
    }
    if (it.status_id !== null && typeof it.status_id !== "string") {
      return NextResponse.json(
        { error: `Item ${i}: status_id must be a uuid string or null` },
        { status: 400 }
      );
    }
  }

  const supabase = createServerClient();
  const now = new Date().toISOString();
  let applied = 0;
  const errors: { index: number; message: string }[] = [];

  // Look up all existing rows in a single query to know which to update vs
  // insert. Builds a (supplier_contact_id, email_account_id) → id map.
  const supplierIds = Array.from(new Set(items.map((it: any) => it.supplier_contact_id)));
  const accountIds  = Array.from(new Set(items.map((it: any) => it.email_account_id)));
  const { data: existingRows, error: lookupErr } = await supabase
    .from("supplier_account_statuses")
    .select("id, supplier_contact_id, email_account_id")
    .in("supplier_contact_id", supplierIds)
    .in("email_account_id", accountIds);
  if (lookupErr) {
    return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  }
  const existingByKey = new Map<string, string>();
  for (const row of existingRows || []) {
    const r = row as any;
    existingByKey.set(`${r.supplier_contact_id}::${r.email_account_id}`, r.id);
  }

  // Process each item sequentially. Cheap on small batches (typical bulk
  // edit is <50 items). Easy to attribute per-item errors.
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const key = `${it.supplier_contact_id}::${it.email_account_id}`;
    const existingId = existingByKey.get(key);
    const payload = {
      status_id: it.status_id || null,
      updated_by: actorId,
      updated_at: now,
    };
    if (existingId) {
      const { error } = await supabase
        .from("supplier_account_statuses")
        .update(payload)
        .eq("id", existingId);
      if (error) { errors.push({ index: i, message: error.message }); continue; }
    } else {
      const { error } = await supabase
        .from("supplier_account_statuses")
        .insert({
          supplier_contact_id: it.supplier_contact_id,
          email_account_id: it.email_account_id,
          ...payload,
        });
      if (error) { errors.push({ index: i, message: error.message }); continue; }
    }
    applied++;
  }

  return NextResponse.json({ applied, errors });
}
