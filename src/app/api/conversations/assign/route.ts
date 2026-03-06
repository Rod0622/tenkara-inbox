import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// PATCH /api/conversations/assign — assign or unassign a conversation
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_id, assignee_id } = body;

  if (!conversation_id) {
    return NextResponse.json(
      { error: "conversation_id is required" },
      { status: 400 }
    );
  }

  // assignee_id can be null to unassign
  const { data, error } = await supabase
    .from("conversations")
    .update({ assignee_id: assignee_id || null })
    .eq("id", conversation_id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log the assignment in activity log
  if (assignee_id) {
    await supabase.from("activity_log").insert({
      conversation_id,
      actor_id: assignee_id,
      action: "assigned",
      details: { assignee_id },
    });
  }

  return NextResponse.json({ conversation: data });
}