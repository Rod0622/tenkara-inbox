import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/rules — list all rules
export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("rules")
    .select("*")
    .order("sort_order");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data || [] });
}

// POST /api/rules — create a rule
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { name, is_active, condition_field, condition_operator, condition_value, action_type, action_value } = body;

  if (!name?.trim() || !condition_field || !condition_operator || !action_type) {
    return NextResponse.json({ error: "name, condition, and action are required" }, { status: 400 });
  }

  // Get next sort_order
  const { data: last } = await supabase
    .from("rules")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("rules")
    .insert({
      name: name.trim(),
      is_active: is_active !== false,
      condition_field,
      condition_operator,
      condition_value: condition_value || "",
      action_type,
      action_value: action_value || "",
      sort_order: nextOrder,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

// PATCH /api/rules — update a rule
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const allowed = ["name", "is_active", "condition_field", "condition_operator", "condition_value", "action_type", "action_value", "sort_order"];
  const update: any = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) update[key] = fields[key];
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("rules")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

// DELETE /api/rules?id=xxx — delete a rule
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}