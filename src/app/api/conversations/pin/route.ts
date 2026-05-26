export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── Conversation Pins (per-user) ───────────────────────────────────────────
//
// Each user can pin conversations for quick personal access. Pinning is
// strictly personal — no other team member sees your pins. Stored in
// inbox.conversation_pins with composite PK (user_id, conversation_id).
//
// Endpoints:
//   GET    ?user_id=X                       → list user's pinned conversation IDs
//   GET    ?user_id=X&conversation_id=Y     → check if (Y) is pinned by (X)
//   POST   body { user_id, conversation_id } → pin
//   DELETE body { user_id, conversation_id } → unpin

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const userId = req.nextUrl.searchParams.get("user_id");
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  if (conversationId) {
    // Single-pin check
    const { data, error } = await supabase
      .from("conversation_pins")
      .select("conversation_id")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ pinned: !!data });
  }

  // List of all the user's pinned conversation IDs, newest-pinned first
  const { data, error } = await supabase
    .from("conversation_pins")
    .select("conversation_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    pinned: (data || []).map((row: any) => row.conversation_id),
  });
}

export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { user_id, conversation_id } = body || {};

  if (!user_id || !conversation_id) {
    return NextResponse.json({ error: "user_id and conversation_id required" }, { status: 400 });
  }

  // Upsert so re-pinning the same convo is idempotent (no error on duplicate PK)
  const { error } = await supabase
    .from("conversation_pins")
    .upsert({ user_id, conversation_id }, { onConflict: "user_id,conversation_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json().catch(() => ({}));
  const userId = body.user_id || req.nextUrl.searchParams.get("user_id");
  const conversationId = body.conversation_id || req.nextUrl.searchParams.get("conversation_id");

  if (!userId || !conversationId) {
    return NextResponse.json({ error: "user_id and conversation_id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("conversation_pins")
    .delete()
    .eq("user_id", userId)
    .eq("conversation_id", conversationId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
