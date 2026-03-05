import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createServerClient } from "@/lib/supabase";
import { notifyNote } from "@/lib/slack";

// GET — Fetch notes for a conversation
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("notes")
    .select("*, author:inbox.team_members(*)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — Create a new note
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId, text } = await req.json();
  if (!conversationId || !text) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const supabase = createServerClient();

  // Get author
  const { data: author } = await supabase
    .from("team_members")
    .select("id, name")
    .eq("email", session.user.email)
    .single();

  if (!author) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Insert note
  const { data: note, error } = await supabase
    .from("notes")
    .insert({
      conversation_id: conversationId,
      author_id: author.id,
      text,
    })
    .select("*, author:inbox.team_members(*)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get conversation for Slack notification
  const { data: convo } = await supabase
    .from("conversations")
    .select("subject, mailbox_id")
    .eq("id", conversationId)
    .single();

  // Log activity
  await supabase.from("activity_log").insert({
    conversation_id: conversationId,
    actor_id: author.id,
    action: "noted",
    details: { preview: text.slice(0, 100) },
  });

  // Slack notification (fire and forget)
  if (convo) {
    notifyNote(author.name, text, convo.subject, convo.mailbox_id).catch(console.error);
  }

  return NextResponse.json(note, { status: 201 });
}
