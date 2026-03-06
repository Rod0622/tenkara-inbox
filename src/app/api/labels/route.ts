import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// Helper: generate bg_color from hex color
function hexToBgColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},0.12)`;
}

// GET /api/labels — list all labels
export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("labels")
    .select("*")
    .order("sort_order");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ labels: data || [] });
}

// POST /api/labels — create a label
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { name, color } = body;
  if (!name?.trim() || !color) {
    return NextResponse.json({ error: "name and color are required" }, { status: 400 });
  }

  // Get next sort_order
  const { data: last } = await supabase
    .from("labels")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (last?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("labels")
    .insert({
      name: name.trim(),
      color,
      bg_color: hexToBgColor(color),
      sort_order: nextOrder,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A label with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ label: data });
}

// PATCH /api/labels — update a label
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { id, name, color, sort_order } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const update: any = {};
  if (name !== undefined) update.name = name.trim();
  if (color !== undefined) {
    update.color = color;
    update.bg_color = hexToBgColor(color);
  }
  if (sort_order !== undefined) update.sort_order = sort_order;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("labels")
    .update(update)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "A label with that name already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ label: data });
}

// DELETE /api/labels?id=xxx — delete a label
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Remove from conversation_labels first (CASCADE should handle this, but explicit)
  await supabase.from("conversation_labels").delete().eq("label_id", id);

  // Remove from any rules referencing this label
  await supabase.from("rules").delete().eq("action_value", id);

  const { error } = await supabase.from("labels").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}