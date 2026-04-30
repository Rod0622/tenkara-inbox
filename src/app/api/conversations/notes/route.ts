import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { notifyMention } from "@/lib/notifications";
import { getServerSession } from "next-auth";
import { runRulesForEvent } from "@/lib/rule-engine";

// POST /api/conversations/notes — create a note
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  // Accept both camelCase and snake_case
  const conversationId = body.conversation_id || body.conversationId;
  const text = body.text;
  const title = body.title || "";

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
      title: title.trim(),
      text: text.trim(),
    })
    .select("*, author:team_members(*)")
    .single();

  if (error) {
    console.error("Create note error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log activity
  await supabase.from("activity_log").insert({
    conversation_id: conversationId,
    actor_id: authorId,
    action: "note_added",
    details: { note_id: note?.id, preview: text.trim().slice(0, 80) },
  });

  // Check for @mentions in note text and notify
  try {
    const mentionRegex = /@([a-zA-Z0-9_.]+)/g;
    const mentions = [...text.matchAll(mentionRegex)].map((m) => m[1].toLowerCase());
    if (mentions.length > 0) {
      const { data: allMembers } = await supabase.from("team_members").select("id, name, email").eq("is_active", true);
      const mentionedIds = (allMembers || [])
        .filter((m: any) => mentions.some((mention) =>
          m.name?.toLowerCase().includes(mention) || m.email?.toLowerCase().split("@")[0] === mention
        ))
        .map((m: any) => m.id);
      if (mentionedIds.length > 0) {
        await notifyMention(mentionedIds, authorId, text, conversationId);
      }
    }
  } catch (_e) { /* best-effort */ }

  // Fire event-based rules (new_comment trigger, comment_type: note)
  try {
    await runRulesForEvent({
      event_type: "new_comment",
      conversation_id: conversationId,
      initiator_user_id: authorId,
      event_key: `new_comment:note:${note?.id}`,
      comment_id: note?.id,
      comment_type: "note",
      comment_text: text.trim(),
    });
  } catch (ruleErr: any) {
    console.error("[notes/POST] rule processing error:", ruleErr?.message || ruleErr);
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