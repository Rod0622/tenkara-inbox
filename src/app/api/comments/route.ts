import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { notifyMention, notifyWatchers } from "@/lib/notifications";
import { runRulesForEvent } from "@/lib/rule-engine";

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
// Body shape:
//   { conversation_id, author_id, body, mentions?: string[] }
// `mentions` is an array of team_member IDs and/or the special token "@everyone".
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

  // Normalize and de-duplicate mentions array
  const rawMentions: string[] = Array.isArray(mentions) ? mentions : [];
  const cleanedMentions = Array.from(new Set(
    rawMentions
      .filter((m) => typeof m === "string" && m.length > 0)
  ));

  const { data: comment, error } = await supabase
    .from("comments")
    .insert({
      conversation_id,
      author_id,
      body: commentBody.trim(),
      mentions: cleanedMentions,
    })
    .select(`
      *,
      author:team_members!author_id (id, name, initials, color)
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Resolve @everyone -> all active member IDs (excluding the author).
  // This produces the actual list of users to notify.
  let notifyUserIds: string[] = [];
  const hasEveryone = cleanedMentions.includes("@everyone");

  if (hasEveryone) {
    const { data: allActive } = await supabase
      .from("team_members")
      .select("id")
      .eq("is_active", true);
    notifyUserIds = (allActive || []).map((m: any) => m.id);
  }

  // Add specific user IDs (non-everyone tokens)
  for (const m of cleanedMentions) {
    if (m === "@everyone") continue;
    if (!notifyUserIds.includes(m)) notifyUserIds.push(m);
  }

  // Don't notify the author of their own message
  notifyUserIds = notifyUserIds.filter((id) => id !== author_id);

  // Fire mention notifications (best-effort).
  // Fetch actor name + conversation subject so the notification has useful context.
  if (notifyUserIds.length > 0) {
    try {
      const [{ data: actor }, { data: convo }] = await Promise.all([
        supabase.from("team_members").select("name").eq("id", author_id).maybeSingle(),
        supabase.from("conversations").select("subject").eq("id", conversation_id).maybeSingle(),
      ]);
      await notifyMention(notifyUserIds, author_id, commentBody.trim(), conversation_id, {
        actorName: actor?.name || undefined,
        mentionType: hasEveryone ? "everyone" : "direct",
        conversationSubject: convo?.subject || undefined,
      });
    } catch (notifyErr: any) {
      console.error("[comments/POST] notify error:", notifyErr?.message || notifyErr);
    }
  }

  // Fire event-based rules (new_comment trigger, comment_type: comment)
  try {
    await runRulesForEvent({
      event_type: "new_comment",
      conversation_id,
      initiator_user_id: author_id || null,
      event_key: `new_comment:comment:${comment?.id}`,
      comment_id: comment?.id,
      comment_type: "comment",
      comment_text: commentBody.trim(),
      mentioned_user_ids: cleanedMentions,
    });
  } catch (ruleErr: any) {
    console.error("[comments/POST] rule processing error:", ruleErr?.message || ruleErr);
  }

  // Notify watchers about the new comment (best-effort)
  // Exclude users already notified via @mention to avoid duplicate notifications
  try {
    await notifyWatchers(conversation_id, "comment", {
      title: "New comment in conversation",
      body: commentBody.trim().slice(0, 140),
      actorId: author_id || null,
      excludeUserIds: notifyUserIds,
    });
  } catch (_e) { /* best-effort */ }

  return NextResponse.json({ comment });
}