import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

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
    .select("*, assignee:team_members!tasks_assignee_id_fkey(*)")
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
  } else if (previousAssigneeId) {
    await supabase.from("activity_log").insert({
      conversation_id,
      actor_id: logActorId,
      action: "unassigned",
      details: { previous_assignee_id: previousAssigneeId },
    });
  }

  return NextResponse.json({ conversation: data });
}