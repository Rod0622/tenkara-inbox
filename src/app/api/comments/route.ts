import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/comments?conversation_id=xxx
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  const { data: comments, error } = await supabase
    .from("comments")
    .select(`
      *,
      author:team_members!author_id (id, name, initials, color)
    `)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ comments: comments || [] });
}

// POST /api/comments — create a new comment
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_id, author_id, body: commentBody, mentions } = body;

  if (!conversation_id || !author_id || !commentBody?.trim()) {
    return NextResponse.json(
      { error: "conversation_id, author_id, and body are required" },
      { status: 400 }
    );
  }

  const { data: comment, error } = await supabase
    .from("comments")
    .insert({
      conversation_id,
      author_id,
      body: commentBody.trim(),
      mentions: mentions || [],
    })
    .select(`
      *,
      author:team_members!author_id (id, name, initials, color)
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ comment });
}