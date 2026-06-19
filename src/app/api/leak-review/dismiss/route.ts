import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * /api/leak-review/dismiss
 *
 * POST   — mark a conversation as reviewed & NOT a leak (hides it from scans)
 *          Body: { conversation_id, actor_id?, note? }
 * DELETE  ?conversation_id=xxx — un-dismiss (bring it back into scans)
 *
 * Backed by the leak_review_dismissed table (see migration).
 */

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const conversationId = body?.conversation_id;
  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }
  try {
    const { error } = await supabase
      .from("leak_review_dismissed")
      .upsert(
        {
          conversation_id: conversationId,
          dismissed_by: body?.actor_id || null,
          note: body?.note || null,
          dismissed_at: new Date().toISOString(),
        },
        { onConflict: "conversation_id" }
      );
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get("conversation_id");
  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }
  try {
    const { error } = await supabase
      .from("leak_review_dismissed")
      .delete()
      .eq("conversation_id", conversationId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 });
  }
}
