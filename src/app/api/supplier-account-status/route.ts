export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── /api/supplier-account-status — set / clear a supplier's status for one account ──
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
