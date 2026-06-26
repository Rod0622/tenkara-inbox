export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

// ─── Conversation Pins (per-user) ───────────────────────────────────────────
//
// Each user can pin conversations for quick personal access. Pinning is
// strictly personal — no other team member sees your pins.
//
// SECURITY: the user is taken from the authenticated NextAuth session, never
// from a client-supplied user_id (which previously allowed reading/modifying
// another user's pins — IDOR). The app uses NextAuth + service-role DB access
// (bypasses RLS), so authorization is enforced here.
//
// Endpoints:
//   GET    ?conversation_id=Y   → check if (Y) is pinned by the current user
//   GET                         → list current user's pinned conversation IDs
//   POST   body { conversation_id } → pin
//   DELETE body { conversation_id } → unpin

async function sessionUserId(): Promise<string | null> {
  const session: any = await getServerSession(authOptions);
  return session?.user?.id || null;
}

export async function GET(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  if (conversationId) {
    const { data, error } = await supabase
      .from("conversation_pins")
      .select("conversation_id")
      .eq("user_id", userId)
      .eq("conversation_id", conversationId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ pinned: !!data });
  }

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
  const userId = await sessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const body = await req.json();
  const { conversation_id } = body || {};

  if (!conversation_id) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("conversation_pins")
    .upsert({ user_id: userId, conversation_id }, { onConflict: "user_id,conversation_id" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("activity_log").insert({
    conversation_id,
    actor_id: userId,
    action: "pin_added",
    details: { user_id: userId },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const body = await req.json().catch(() => ({}));
  const conversationId = body.conversation_id || req.nextUrl.searchParams.get("conversation_id");

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("conversation_pins")
    .delete()
    .eq("user_id", userId)
    .eq("conversation_id", conversationId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("activity_log").insert({
    conversation_id: conversationId,
    actor_id: userId,
    action: "pin_removed",
    details: { user_id: userId },
  });

  return NextResponse.json({ ok: true });
}