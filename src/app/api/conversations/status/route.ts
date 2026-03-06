import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/conversations/activity?conversation_id=xxx
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  const { data: activities, error } = await supabase
    .from("activity_log")
    .select("*, actor:team_members(id, name, initials, color)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ activities: activities || [] });
}

// POST /api/conversations/activity — log an activity event
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_id, actor_id, action, details } = body;

  if (!conversation_id || !action) {
    return NextResponse.json(
      { error: "conversation_id and action are required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("activity_log")
    .insert({
      conversation_id,
      actor_id: actor_id || null,
      action,
      details: details || {},
    })
    .select("*, actor:team_members(id, name, initials, color)")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ activity: data });
}