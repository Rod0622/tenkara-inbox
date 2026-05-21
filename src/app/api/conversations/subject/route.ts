import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * PATCH /api/conversations/subject — rename a conversation's subject.
 *
 * The new subject becomes the canonical thread title:
 *   • Displayed in the conversation list and detail header
 *   • Used as the base when composing replies/forwards ("Re: <new>")
 *   • Visible in search results
 *
 * Note: this does NOT alter individual message rows' subject fields (those
 * preserve the original sender's wording for audit/legal accuracy). It also
 * does not retroactively change sync threading — incoming messages with the
 * old subject will still match this conversation via RFC822 Message-ID and
 * thread_id, which sync prefers over subject matching.
 */
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const conversationId = body.conversation_id || body.conversationId;
  const newSubject = (body.subject || "").trim();
  const actorId = body.actor_id;

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }
  if (!newSubject) {
    return NextResponse.json({ error: "subject cannot be empty" }, { status: 400 });
  }
  if (newSubject.length > 500) {
    return NextResponse.json({ error: "subject too long (max 500 chars)" }, { status: 400 });
  }

  // Fetch current subject so we can record the change in activity_log.
  const { data: pre } = await supabase
    .from("conversations")
    .select("subject")
    .eq("id", conversationId)
    .single();
  const oldSubject = pre?.subject || "";

  if (oldSubject === newSubject) {
    // No-op — return success but skip the write + activity log.
    return NextResponse.json({ conversation: pre, unchanged: true });
  }

  const { data, error } = await supabase
    .from("conversations")
    .update({ subject: newSubject })
    .eq("id", conversationId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Audit the rename for transparency. Anyone reviewing the conversation
  // history can see what the subject used to be.
  await supabase.from("activity_log").insert({
    conversation_id: conversationId,
    actor_id: actorId || null,
    action: "subject_renamed",
    details: { old_subject: oldSubject, new_subject: newSubject },
  });

  return NextResponse.json({ conversation: data });
}
