import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { notifyEmailAssigned, notifyWatchers } from "@/lib/notifications";
import { runRulesForEvent } from "@/lib/rule-engine";

// PATCH /api/conversations/assign — assign or unassign a conversation
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_id, assignee_id, actor_id } = body;

  if (!conversation_id) {
    return NextResponse.json(
      { error: "conversation_id is required" },
      { status: 400 }
    );
  }

  // Get current assignee before updating (for activity log)
  const { data: current } = await supabase
    .from("conversations")
    .select("assignee_id")
    .eq("id", conversation_id)
    .single();

  const previousAssigneeId = current?.assignee_id;

  // assignee_id can be null to unassign
  const { data, error } = await supabase
    .from("conversations")
    .update({
      assignee_id: assignee_id || null,
      // When assigning: clear folder (goes to personal inbox)
      // When unassigning: keep folder_id as-is (stays where it was)
      ...(assignee_id ? { folder_id: null } : {}),
    })
    .eq("id", conversation_id)
    .select("*, assignee:team_members!conversations_assignee_id_fkey(*)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log assign or unassign in activity log
  const logActorId = actor_id || assignee_id || previousAssigneeId;
  if (assignee_id) {
    await supabase.from("activity_log").insert({
      conversation_id,
      actor_id: logActorId,
      action: "assigned",
      details: { assignee_id },
    });

    // Notify the assigned user
    try {
      const subject = data?.subject || "Conversation";
      await notifyEmailAssigned(conversation_id, assignee_id, logActorId || assignee_id, subject);
    } catch (_e) { /* notifications are best-effort */ }
  } else if (previousAssigneeId) {
    await supabase.from("activity_log").insert({
      conversation_id,
      actor_id: logActorId,
      action: "unassigned",
      details: { previous_assignee_id: previousAssigneeId },
    });
  }

  // Fire event-based rules (assignee_changed trigger)
  // Only fire if the assignee actually changed (skip if same value re-applied)
  const newId = assignee_id || null;
  const oldId = previousAssigneeId || null;
  if (newId !== oldId) {
    // Notify watchers about the assignee change (best-effort)
    try {
      // Resolve the new assignee's name for a friendlier title
      let assigneeName = "Unassigned";
      if (newId) {
        const { data: m } = await supabase.from("team_members").select("name").eq("id", newId).maybeSingle();
        assigneeName = m?.name || "Unknown";
      }
      await notifyWatchers(conversation_id, "assignee_change", {
        title: newId ? `Assigned to ${assigneeName}` : "Assignee removed",
        body: data?.subject || undefined,
        actorId: actor_id || null,
        // Don't double-notify the new assignee — notifyEmailAssigned already did
        excludeUserIds: newId ? [newId] : [],
      });
    } catch (_e) { /* best-effort */ }

    try {
      await runRulesForEvent({
        event_type: "assignee_changed",
        conversation_id,
        initiator_user_id: actor_id || null,
        event_key: `assignee_changed:${conversation_id}:${oldId || "null"}:${newId || "null"}:${Date.now()}`,
        new_assignee_id: newId,
        old_assignee_id: oldId,
        // added_assignee = the user who is now assigned (null on pure unassign)
        added_assignee_id: newId,
        // removed_assignee = the user who was previously assigned (null on assign-from-empty)
        removed_assignee_id: oldId,
      });
    } catch (ruleErr: any) {
      console.error("[assign/PATCH] rule processing error:", ruleErr?.message || ruleErr);
    }
  }

  return NextResponse.json({ conversation: data });
}