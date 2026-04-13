import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/forms — list all form templates with fields
export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("form_templates")
    .select("*, fields:form_fields(*), task_category:task_categories(id, name)")
    .order("sort_order")
    .order("sort_order", { referencedTable: "form_fields" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ forms: data || [] });
}

// POST /api/forms — create a form template with fields
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { name, description, task_category_id, fields } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  // Get next sort order
  const { data: last } = await supabase
    .from("form_templates")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: template, error: templateErr } = await supabase
    .from("form_templates")
    .insert({
      name: name.trim(),
      description: description?.trim() || null,
      task_category_id: task_category_id || null,
      sort_order: (last?.sort_order ?? -1) + 1,
    })
    .select()
    .single();

  if (templateErr) return NextResponse.json({ error: templateErr.message }, { status: 500 });

  // Insert fields
  if (fields?.length > 0) {
    const fieldRows = fields.map((f: any, i: number) => ({
      form_template_id: template.id,
      label: f.label?.trim() || `Field ${i + 1}`,
      field_type: f.field_type || "text",
      options: f.options || null,
      is_required: f.is_required ?? false,
      sort_order: i,
      placeholder: f.placeholder || null,
      default_value: f.default_value || null,
    }));
    const { error: fieldsErr } = await supabase.from("form_fields").insert(fieldRows);
    if (fieldsErr) console.error("Fields insert error:", fieldsErr.message);
  }

  // Re-fetch with fields
  const { data: full } = await supabase
    .from("form_templates")
    .select("*, fields:form_fields(*), task_category:task_categories(id, name)")
    .eq("id", template.id)
    .order("sort_order", { referencedTable: "form_fields" })
    .single();

  return NextResponse.json({ form: full });
}

// PATCH /api/forms — update a form template and its fields
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { id, name, description, task_category_id, is_active, fields } = body;

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const update: any = {};
  if (name !== undefined) update.name = name.trim();
  if (description !== undefined) update.description = description?.trim() || null;
  if (task_category_id !== undefined) update.task_category_id = task_category_id || null;
  if (is_active !== undefined) update.is_active = is_active;
  update.updated_at = new Date().toISOString();

  const { error: updateErr } = await supabase.from("form_templates").update(update).eq("id", id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  // Replace fields if provided
  if (fields !== undefined) {
    await supabase.from("form_fields").delete().eq("form_template_id", id);
    if (fields.length > 0) {
      const fieldRows = fields.map((f: any, i: number) => ({
        form_template_id: id,
        label: f.label?.trim() || `Field ${i + 1}`,
        field_type: f.field_type || "text",
        options: f.options || null,
        is_required: f.is_required ?? false,
        sort_order: i,
        placeholder: f.placeholder || null,
        default_value: f.default_value || null,
      }));
      await supabase.from("form_fields").insert(fieldRows);
    }
  }

  // Re-fetch
  const { data: full } = await supabase
    .from("form_templates")
    .select("*, fields:form_fields(*), task_category:task_categories(id, name)")
    .eq("id", id)
    .order("sort_order", { referencedTable: "form_fields" })
    .single();

  return NextResponse.json({ form: full });
}

// DELETE /api/forms?id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const { error } = await supabase.from("form_templates").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}