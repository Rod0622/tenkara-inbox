export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { logSupplierStatusChange } from "@/lib/supplier-status-activity";

// ── GET /api/supplier-account-status ───────────────────────────────────
//
// Two modes:
//
// Mode 1 — Single status (existing): both supplier_contact_id and
//   email_account_id provided → returns one status object for the pair.
//   Used by SupplierStatusBadge in the conversation header.
//   Response: { status: {...} | null }
//
// Mode 2 — All statuses for a supplier (new in Batch 6, Feature 1):
//   only supplier_contact_id provided → returns an array of statuses,
//   one per account that has a status set for this supplier. Accounts
//   with no status row don't appear. Used by SupplierStatusCard on the
//   supplier command-center page.
//   Response: { statuses: [{ email_account_id, status: {...} }, ...] }
//
// Query params:
//   supplier_contact_id   required
//   email_account_id      optional (forces Mode 1 if present)
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const supplierId = url.searchParams.get("supplier_contact_id");
  const accountId  = url.searchParams.get("email_account_id");
  if (!supplierId) {
    return NextResponse.json(
      { error: "supplier_contact_id is required" },
      { status: 400 }
    );
  }
  const supabase = createServerClient();

  // ── Mode 2: supplier-only → return per-account statuses array ────────
  if (!accountId) {
    const { data: rows, error: lookupErr } = await supabase
      .from("supplier_account_statuses")
      .select("email_account_id, status_id")
      .eq("supplier_contact_id", supplierId);
    if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
    const statusIds = Array.from(new Set((rows || []).map((r: any) => r.status_id).filter(Boolean)));
    let statusById = new Map<string, any>();
    if (statusIds.length > 0) {
      const { data: statuses, error: stErr } = await supabase
        .from("supplier_statuses")
        .select("id, name, color, background_color")
        .in("id", statusIds);
      if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
      statusById = new Map((statuses || []).map((s: any) => [s.id, s]));
    }
    const out = (rows || [])
      .filter((r: any) => r.status_id)
      .map((r: any) => ({
        email_account_id: r.email_account_id,
        status: statusById.get(r.status_id) || null,
      }));
    return NextResponse.json({ statuses: out });
  }

  // ── Mode 1: single (supplier, account) pair ──────────────────────────
  // Look up the assignment row (if any), then JOIN to the status lookup.
  // maybeSingle so it returns null cleanly when there's no row yet.
  const { data: row, error } = await supabase
    .from("supplier_account_statuses")
    .select("status_id")
    .eq("supplier_contact_id", supplierId)
    .eq("email_account_id", accountId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!row || !row.status_id) {
    return NextResponse.json({ status: null });
  }
  const { data: status, error: stErr } = await supabase
    .from("supplier_statuses")
    .select("id, name, color, background_color")
    .eq("id", row.status_id)
    .maybeSingle();
  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 });
  return NextResponse.json({ status: status || null });
}

// ── /api/supplier-account-status ───────────────────────────────────────
//
// PATCH body: { supplier_contact_id, email_account_id, status_id | null, actor_id?, notes? }
//
// Upserts the (supplier_contact_id, email_account_id) row in
// supplier_account_statuses with the given status_id. Passing status_id=null
// clears the assignment (the row stays but with no status, treated as "no
// status" everywhere).
//
// Any signed-in operator can change a supplier's status — this isn't an
// admin-only action. Status is a workflow signal, not a permission.
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { supplier_contact_id, email_account_id, status_id, actor_id, notes } = body || {};

  if (!supplier_contact_id || !email_account_id) {
    return NextResponse.json(
      { error: "supplier_contact_id and email_account_id are required" },
      { status: 400 }
    );
  }
  // status_id may be null (= clear); otherwise must be a string. Validate
  // type explicitly so undefined doesn't silently land in the DB.
  if (status_id !== null && typeof status_id !== "string") {
    return NextResponse.json({ error: "status_id must be a uuid string or null" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Capture previous status_id before mutating — needed by the activity
  // logger (Batch 6, Feature 4) so the activity entry can describe
  // "from X → to Y". Selecting id + status_id so we can branch update vs
  // insert below.
  const { data: existing, error: lookupErr } = await supabase
    .from("supplier_account_statuses")
    .select("id, status_id")
    .eq("supplier_contact_id", supplier_contact_id)
    .eq("email_account_id", email_account_id)
    .maybeSingle();

  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });

  const previousStatusId: string | null = (existing as any)?.status_id || null;
  const newStatusId: string | null = status_id || null;

  const payload: any = {
    status_id: newStatusId,
    updated_by: actor_id || null,
    updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) payload.notes = notes || null;

  let assignmentRow: any = null;
  if (existing) {
    const { data, error } = await supabase
      .from("supplier_account_statuses")
      .update(payload)
      .eq("id", existing.id)
      .select("id, supplier_contact_id, email_account_id, status_id, notes, updated_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    assignmentRow = data;
  } else {
    const insertPayload = {
      supplier_contact_id,
      email_account_id,
      ...payload,
    };
    const { data, error } = await supabase
      .from("supplier_account_statuses")
      .insert(insertPayload)
      .select("id, supplier_contact_id, email_account_id, status_id, notes, updated_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    assignmentRow = data;
  }

  // Best-effort activity logging — Feature 4. Errors don't propagate;
  // the assignment write is the primary operation.
  await logSupplierStatusChange(
    supabase,
    {
      supplier_contact_id,
      email_account_id,
      previous_status_id: previousStatusId,
      new_status_id: newStatusId,
    },
    actor_id || null
  );

  return NextResponse.json({ assignment: assignmentRow });
}