import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { runRulesForEvent } from "@/lib/rule-engine";
import { notifyWatchers } from "@/lib/notifications";
import { swapStageByAddedLabel } from "@/lib/folder-labels";

// POST — Add label to conversation
export async function POST(req: NextRequest) {
  const { conversationId, labelId, actorId } = await req.json();
  if (!conversationId || !labelId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const supabase = createServerClient();
  const { error } = await supabase
    .from("conversation_labels")
    .upsert({ conversation_id: conversationId, label_id: labelId });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ─── Single-stage self-heal ──────────────────────────────────────────
  // Stage labels (top-level labels matching a folder) are mutually exclusive:
  // a conversation belongs to exactly one pipeline stage. Move/Close already
  // enforce this by swapping labels, but adding a stage label directly (label
  // picker, or an external agent) bypasses that and creates the "two stage
  // labels" corruption. Here we self-heal: if the just-added label is a stage
  // label that conflicts with the conversation's current stage, we move the
  // conversation to the new stage's folder and strip the old stage label +
  // its children (full parity with a drag/Move). This runs for EVERY caller —
  // UI or API — so the invariant can never be violated regardless of source.
  // The optional swapStage flag from the client only signals that the user
  // already confirmed the swap in a dialog; the server behavior is identical
  // with or without it. Best-effort — a swap failure never fails the add.
  let stageSwapped = false;
  try {
    const result = await swapStageByAddedLabel(conversationId, labelId);
    stageSwapped = result.swapped;
  } catch (swapErr: any) {
    console.error("[labels/POST] stage self-heal error:", swapErr?.message || swapErr);
  }

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

  // Notify watchers about the label change (best-effort)
  try {
    await notifyWatchers(conversationId, "label_change", {
      title: `Label added: ${label?.name || "label"}`,
      actorId: actorId || null,
    });
  } catch (_e) { /* best-effort */ }

  return NextResponse.json({ success: true, stageSwapped }, { status: 201 });
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

  // Notify watchers
  try {
    await notifyWatchers(conversationId, "label_change", {
      title: `Label removed: ${label?.name || "label"}`,
      actorId: actorId || null,
    });
  } catch (_e) { /* best-effort */ }

  return NextResponse.json({ success: true });
}