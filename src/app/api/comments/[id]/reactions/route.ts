export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── Comment Reactions API ──────────────────────────────────────────────────
//
// Toggle a user's reaction on a comment. The reactions column is jsonb shaped
// like { "👍": ["user_id_1", "user_id_2"], "❤️": [...] }.
//
// POST /api/comments/[id]/reactions
// Body: { user_id, emoji }
//
// Behavior: if user_id is already in the emoji's array → remove it (unreact).
//           if not → add it (react). If removing leaves an empty array, the
//           emoji key is deleted entirely (keeps the jsonb clean).
//
// We do a read-modify-write because Postgres jsonb doesn't have a clean
// "toggle-array-element" primitive. Concurrent reactions are last-write-wins
// at this scale (fine — worst case one reaction is briefly stale).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerClient();
  const commentId = params.id;
  const body = await req.json();
  const { user_id, emoji } = body || {};

  if (!commentId || !user_id || !emoji) {
    return NextResponse.json({ error: "comment id, user_id, and emoji required" }, { status: 400 });
  }

  // Sanity check the emoji — keep it short (8 chars max) to prevent abuse.
  // 8 chars covers compound emoji with skin-tone modifiers and ZWJ sequences.
  const cleanEmoji = String(emoji).slice(0, 8);

  // Fetch current reactions + conversation_id (needed for the audit entry)
  const { data: existing, error: lookupErr } = await supabase
    .from("comments")
    .select("reactions, conversation_id")
    .eq("id", commentId)
    .maybeSingle();

  if (lookupErr || !existing) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  const reactions: Record<string, string[]> = (existing.reactions as any) || {};
  const current: string[] = Array.isArray(reactions[cleanEmoji]) ? reactions[cleanEmoji] : [];

  // Toggle
  const alreadyReacted = current.includes(user_id);
  if (alreadyReacted) {
    const next = current.filter((id) => id !== user_id);
    if (next.length === 0) {
      delete reactions[cleanEmoji];
    } else {
      reactions[cleanEmoji] = next;
    }
  } else {
    reactions[cleanEmoji] = [...current, user_id];
  }

  const { data: updated, error } = await supabase
    .from("comments")
    .update({ reactions })
    .eq("id", commentId)
    .select(`
      *,
      author:team_members!author_id (id, name, initials, color)
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ─── Footprint: reaction_added / reaction_removed ─────────────────
  if (existing.conversation_id) {
    await supabase.from("activity_log").insert({
      conversation_id: existing.conversation_id,
      actor_id: user_id,
      action: alreadyReacted ? "reaction_removed" : "reaction_added",
      details: {
        comment_id: commentId,
        emoji: cleanEmoji,
      },
    });
  }

  return NextResponse.json({ comment: updated });
}