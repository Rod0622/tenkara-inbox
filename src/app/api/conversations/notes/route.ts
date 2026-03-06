import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getServerSession } from "next-auth";

// POST /api/conversations/notes — create a note
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  // Accept both camelCase and snake_case
  const conversationId = body.conversation_id || body.conversationId;
  const text = body.text;

  if (!conversationId || !text?.trim()) {
    return NextResponse.json(
      { error: "conversation_id and text are required" },
      { status: 400 }
    );
  }

  // Get the current user to set as author
  // Try to find the team member from session
  let authorId = body.author_id;

  if (!authorId) {
    // Get first admin as fallback — ideally you'd get this from session
    const { data: members } = await supabase
      .from("team_members")
      .select("id")
      .eq("is_active", true)
      .limit(1);

    authorId = members?.[0]?.id;
  }

  if (!authorId) {
    return NextResponse.json({ error: "Could not determine author" }, { status: 400 });
  }

  const { data: note, error } = await supabase
    .from("notes")
    .insert({
      conversation_id: conversationId,
      author_id: authorId,
      text: text.trim(),
    })
    .select("*, author:team_members(*)")
    .single();

  if (error) {
    console.error("Create note error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ note });
}

// GET /api/conversations/notes?conversation_id=xxx
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  const { data: notes, error } = await supabase
    .from("notes")
    .select("*, author:team_members(*)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: notes || [] });
}