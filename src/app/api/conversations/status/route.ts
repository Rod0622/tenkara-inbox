import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// PATCH /api/conversations/status — update read/star/flag status
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const conversationId = body.conversation_id || body.conversationId;

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  // Build update object from provided fields
  const update: any = {};
  if (body.is_unread !== undefined) update.is_unread = body.is_unread;
  if (body.is_starred !== undefined) update.is_starred = body.is_starred;
  if (body.status !== undefined) update.status = body.status;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("conversations")
    .update(update)
    .eq("id", conversationId)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ conversation: data });
}