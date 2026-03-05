import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createServerClient } from "@/lib/supabase";
import { notifyAssignment } from "@/lib/slack";

export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId, assigneeId } = await req.json();
  if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });

  const supabase = createServerClient();

  // Update assignment
  const { data: convo, error } = await supabase
    .from("conversations")
    .update({ assignee_id: assigneeId || null })
    .eq("id", conversationId)
    .select("*, assignee:inbox.team_members(*)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get assigner name
  const { data: assigner } = await supabase
    .from("team_members")
    .select("id, name")
    .eq("email", session.user.email)
    .single();

  // Log activity
  if (assigner) {
    await supabase.from("activity_log").insert({
      conversation_id: conversationId,
      actor_id: assigner.id,
      action: "assigned",
      details: { assignee_id: assigneeId },
    });
  }

  // Slack notification for assignment
  if (convo?.assignee && assigner) {
    // TODO: DM the assignee or post to their inbox channel
    console.log(`${assigner.name} assigned ${convo.subject} to ${convo.assignee.name}`);
  }

  return NextResponse.json(convo);
}
