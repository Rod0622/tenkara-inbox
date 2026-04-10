import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/rules
export async function GET() {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("rules")
    .select("*")
    .order("sort_order");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rules: data || [] });
}

// POST /api/rules
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { name, trigger_type, match_mode, conditions, actions: ruleActions } = body;

  if (!name?.trim() || !conditions?.length || !ruleActions?.length) {
    return NextResponse.json({ error: "name, conditions, and actions are required" }, { status: 400 });
  }

  const { data: last } = await supabase
    .from("rules")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextOrder = (last?.sort_order ?? -1) + 1;

  // Store in both new JSONB fields AND legacy single fields for backward compatibility
  const firstCondition = conditions[0] || {};
  const firstAction = ruleActions[0] || {};

  const { data, error } = await supabase
    .from("rules")
    .insert({
      name: name.trim(),
      is_active: true,
      trigger_type: trigger_type || "incoming",
      match_mode: match_mode || "all",
      conditions,
      actions: ruleActions,
      account_ids: body.account_ids || null,
      // Legacy fields for backward compat
      condition_field: firstCondition.field || "subject",
      condition_operator: firstCondition.operator || "contains",
      condition_value: firstCondition.value || "",
      action_type: firstAction.type || "add_label",
      action_value: firstAction.value || "",
      sort_order: nextOrder,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

// PATCH /api/rules
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const allowed = [
    "name", "is_active", "trigger_type", "match_mode",
    "conditions", "actions", "account_ids",
    "condition_field", "condition_operator", "condition_value",
    "action_type", "action_value", "sort_order",
  ];
  const update: any = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) update[key] = fields[key];
  }

  // Sync legacy fields when JSONB fields are updated
  if (update.conditions?.length) {
    update.condition_field = update.conditions[0].field;
    update.condition_operator = update.conditions[0].operator;
    update.condition_value = update.conditions[0].value;
  }
  if (update.actions?.length) {
    update.action_type = update.actions[0].type;
    update.action_value = update.actions[0].value;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase.from("rules").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rule: data });
}

// DELETE /api/rules?id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const { error } = await supabase.from("rules").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}