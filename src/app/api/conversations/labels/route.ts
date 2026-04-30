import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { runRulesForEvent } from "@/lib/rule-engine";

// POST — Add label to conversation
export async function POST(req: NextRequest) {
  const { conversationId, labelId, actorId } = await req.json();
  if (!conversationId || !labelId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const supabase = createServerClient();
  const { error } = await supabase
    .from("conversation_labels")
    .upsert({ conversation_id: conversationId, label_id: labelId });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get label name for activity log
  const { data: label } = await supabase.from("labels").select("name").eq("id", labelId).single();

  await supabase.from("activity_log").insert({
    conversation_id: conversationId,
    actor_id: actorId || null,
    action: "label_added",
    details: { label_id: labelId, label_name: label?.name || "Unknown" },
  });

  // Fire event-based rules (label_added trigger)
  // Best-effort — don't fail the request if rule processing has trouble
  try {
    await runRulesForEvent({
      event_type: "label_added",
      conversation_id: conversationId,
      initiator_user_id: actorId || null,
      event_key: `label_added:${conversationId}:${labelId}:${Date.now()}`,
      label_id: labelId,
      label_name: label?.name || undefined,
    });
  } catch (ruleErr: any) {
    console.error("[labels/POST] rule processing error:", ruleErr?.message || ruleErr);
  }

  return NextResponse.json({ success: true }, { status: 201 });
}

// DELETE — Remove label from conversation
export async function DELETE(req: NextRequest) {
  const { conversationId, labelId, actorId } = await req.json();
  if (!conversationId || !labelId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const supabase = createServerClient();

  // Get label name before deleting
  const { data: label } = await supabase.from("labels").select("name").eq("id", labelId).single();

  const { error } = await supabase
    .from("conversation_labels")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("label_id", labelId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("activity_log").insert({
    conversation_id: conversationId,
    actor_id: actorId || null,
    action: "label_removed",
    details: { label_id: labelId, label_name: label?.name || "Unknown" },
  });

  // Fire event-based rules (label_removed trigger)
  try {
    await runRulesForEvent({
      event_type: "label_removed",
      conversation_id: conversationId,
      initiator_user_id: actorId || null,
      event_key: `label_removed:${conversationId}:${labelId}:${Date.now()}`,
      label_id: labelId,
      label_name: label?.name || undefined,
    });
  } catch (ruleErr: any) {
    console.error("[labels/DELETE] rule processing error:", ruleErr?.message || ruleErr);
  }

  return NextResponse.json({ success: true });
}