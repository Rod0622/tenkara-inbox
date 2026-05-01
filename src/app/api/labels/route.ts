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
// Body: { name, color, parent_label_id? }
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { name, color, parent_label_id } = body;
  if (!name?.trim() || !color) {
    return NextResponse.json({ error: "name and color are required" }, { status: 400 });
  }

  // If a parent is specified, verify it exists AND is itself top-level
  // (the DB trigger will also enforce this, but we give a friendlier error here)
  if (parent_label_id) {
    const { data: parent } = await supabase
      .from("labels")
      .select("id, parent_label_id, name")
      .eq("id", parent_label_id)
      .maybeSingle();
    if (!parent) {
      return NextResponse.json({ error: "Parent label not found" }, { status: 400 });
    }
    if (parent.parent_label_id) {
      return NextResponse.json(
        { error: `Cannot nest under "${parent.name}": it is already a child label (two-level hierarchy only)` },
        { status: 400 }
      );
    }
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
      parent_label_id: parent_label_id || null,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: parent_label_id
          ? "A label with that name already exists under this parent"
          : "A top-level label with that name already exists"
        },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ label: data });
}

// PATCH /api/labels — update a label
// Body: { id, name?, color?, sort_order?, parent_label_id? }
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { id, name, color, sort_order, parent_label_id } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const update: any = {};
  if (name !== undefined) update.name = name.trim();
  if (color !== undefined) {
    update.color = color;
    update.bg_color = hexToBgColor(color);
  }
  if (sort_order !== undefined) update.sort_order = sort_order;
  if (parent_label_id !== undefined) {
    // Allow clearing the parent (set to null) or setting it to a top-level label.
    // The DB trigger enforces two-level, but check up-front for friendlier errors.
    if (parent_label_id !== null) {
      // Self-parenting check
      if (parent_label_id === id) {
        return NextResponse.json({ error: "A label cannot be its own parent" }, { status: 400 });
      }
      // Verify parent is top-level
      const { data: parent } = await supabase
        .from("labels")
        .select("id, parent_label_id, name")
        .eq("id", parent_label_id)
        .maybeSingle();
      if (!parent) {
        return NextResponse.json({ error: "Parent label not found" }, { status: 400 });
      }
      if (parent.parent_label_id) {
        return NextResponse.json(
          { error: `Cannot nest under "${parent.name}": it is already a child label` },
          { status: 400 }
        );
      }
      // Verify the label being moved doesn't already have children
      const { count: childCount } = await supabase
        .from("labels")
        .select("id", { count: "exact", head: true })
        .eq("parent_label_id", id);
      if ((childCount || 0) > 0) {
        return NextResponse.json(
          { error: "This label has children — it cannot itself become a child label" },
          { status: 400 }
        );
      }
    }
    update.parent_label_id = parent_label_id;
  }

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
      return NextResponse.json({ error: "A label with that name already exists in this scope" }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ label: data });
}

// DELETE /api/labels?id=xxx — delete a label
//
// Q4 (a): when a parent is deleted, its children are PROMOTED to top-level
// (parent_label_id set to NULL) rather than being deleted. The frontend should
// confirm with the user before calling DELETE on a parent.
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Promote children to top-level FIRST so the parent delete doesn't orphan them.
  // (The DB has ON DELETE SET NULL, so this would happen automatically, but explicit
  // is clearer and matches user expectations.)
  await supabase
    .from("labels")
    .update({ parent_label_id: null })
    .eq("parent_label_id", id);

  // Remove from conversation_labels first (CASCADE should handle this, but explicit)
  await supabase.from("conversation_labels").delete().eq("label_id", id);

  // Remove from any rules referencing this label
  await supabase.from("rules").delete().eq("action_value", id);

  const { error } = await supabase.from("labels").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}