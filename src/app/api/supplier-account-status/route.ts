export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── GET /api/supplier-account-status ───────────────────────────────────
//
// Returns the current status assignment for a (supplier, account) pair.
// Used by the SupplierStatusBadge in the conversation header to load
// the current status when a conversation opens.
//
// Query params:
//   supplier_contact_id   required
//   email_account_id      required
//
// Response: { status: { id, name, color, background_color } | null }
//   - null means no status set
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const supplierId = url.searchParams.get("supplier_contact_id");
  const accountId  = url.searchParams.get("email_account_id");
  if (!supplierId || !accountId) {
    return NextResponse.json(
      { error: "supplier_contact_id and email_account_id are required" },
      { status: 400 }
    );
  }
  const supabase = createServerClient();
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

  // Upsert on the unique (supplier_contact_id, email_account_id) pair.
  // We can't use Supabase's `.upsert()` directly because the conflict
  // target needs to match a constraint name and the helper is finicky —
  // simpler to do "try update; if no row, insert".
  const { data: existing, error: lookupErr } = await supabase
    .from("supplier_account_statuses")
    .select("id")
    .eq("supplier_contact_id", supplier_contact_id)
    .eq("email_account_id", email_account_id)
    .maybeSingle();

  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });

  const payload: any = {
    status_id: status_id || null,
    updated_by: actor_id || null,
    updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) payload.notes = notes || null;

  if (existing) {
    const { data, error } = await supabase
      .from("supplier_account_statuses")
      .update(payload)
      .eq("id", existing.id)
      .select("id, supplier_contact_id, email_account_id, status_id, notes, updated_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ assignment: data });
  }

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
  return NextResponse.json({ assignment: data });
}