export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ── /api/admin/supplier-statuses — admin CRUD for supplier statuses ────
//
// POST   — create a new status (name + colors + optional sort_order)
// PATCH  — update an existing status (name, colors, sort_order, is_active)
// DELETE — soft-delete (sets is_active=false). Never hard-deletes, because
//          that would break existing assignments. If a status was assigned
//          to suppliers and you want it gone, soft-delete and the assignments
//          stay valid but the status is hidden from new pickers.
//
// All operations require actor_role === "admin" — same gate as other
// admin endpoints (API tokens, etc.).
//
// Reads go through the public /api/supplier-statuses endpoint so any
// operator can populate a status dropdown. Only writes are gated here.

function isAdminRequest(actorRole: string | undefined | null): boolean {
  return actorRole === "admin";
}

// Validate a hex color: 3 or 6 hex chars, no leading #. Normalize to upper.
function normalizeColor(c: any): string | null {
  if (typeof c !== "string") return null;
  const trimmed = c.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(trimmed)) return null;
  return trimmed.toUpperCase();
}

// POST — create a new status
export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, color, background_color, sort_order, actor_role } = body || {};

  if (!isAdminRequest(actor_role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!name || typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const c = normalizeColor(color);
  const bg = normalizeColor(background_color);
  if (!c || !bg) {
    return NextResponse.json({ error: "color and background_color must be valid hex (3 or 6 chars)" }, { status: 400 });
  }

  const supabase = createServerClient();
  const insert: any = {
    name: name.trim(),
    color: c,
    background_color: bg,
  };
  if (typeof sort_order === "number" && Number.isFinite(sort_order)) {
    insert.sort_order = Math.floor(sort_order);
  }

  const { data, error } = await supabase
    .from("supplier_statuses")
    .insert(insert)
    .select("id, name, color, background_color, sort_order, is_active")
    .single();

  if (error) {
    // 23505 = unique violation (duplicate name)
    if ((error as any).code === "23505") {
      return NextResponse.json({ error: "A status with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: data });
}

// PATCH — update an existing status. Body: { id, name?, color?, background_color?, sort_order?, is_active?, actor_role }
export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const { id, name, color, background_color, sort_order, is_active, actor_role } = body || {};

  if (!isAdminRequest(actor_role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const update: any = { updated_at: new Date().toISOString() };
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      return NextResponse.json({ error: "name cannot be empty" }, { status: 400 });
    }
    update.name = name.trim();
  }
  if (color !== undefined) {
    const c = normalizeColor(color);
    if (!c) return NextResponse.json({ error: "color must be valid hex" }, { status: 400 });
    update.color = c;
  }
  if (background_color !== undefined) {
    const bg = normalizeColor(background_color);
    if (!bg) return NextResponse.json({ error: "background_color must be valid hex" }, { status: 400 });
    update.background_color = bg;
  }
  if (sort_order !== undefined) {
    if (typeof sort_order !== "number" || !Number.isFinite(sort_order)) {
      return NextResponse.json({ error: "sort_order must be a number" }, { status: 400 });
    }
    update.sort_order = Math.floor(sort_order);
  }
  if (is_active !== undefined) {
    update.is_active = !!is_active;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("supplier_statuses")
    .update(update)
    .eq("id", id)
    .select("id, name, color, background_color, sort_order, is_active")
    .single();

  if (error) {
    if ((error as any).code === "23505") {
      return NextResponse.json({ error: "A status with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ status: data });
}

// DELETE — soft-delete by setting is_active=false. Body: { id, actor_role }
// Never hard-deletes; existing references on supplier_account_statuses
// would otherwise become dangling. Admins can hard-delete via SQL if
// they're certain no assignments reference the status.
export async function DELETE(req: NextRequest) {
  const body = await req.json();
  const { id, actor_role } = body || {};

  if (!isAdminRequest(actor_role)) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const supabase = createServerClient();
  const { error } = await supabase
    .from("supplier_statuses")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
