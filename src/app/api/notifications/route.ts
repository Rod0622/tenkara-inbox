import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/notifications — fetch unread notifications for current user
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) return NextResponse.json({ error: "Missing userId" }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// PATCH /api/notifications — mark notifications as read
export async function PATCH(req: NextRequest) {
  const { notificationIds } = await req.json();
  if (!notificationIds?.length) return NextResponse.json({ error: "Missing IDs" }, { status: 400 });

  const supabase = createServerClient();
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .in("id", notificationIds);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

// ── Helper: Create notification (called from other routes) ───
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string | null,
  conversationId: string | null
) {
  const supabase = createServerClient();
  await supabase.from("notifications").insert({
    user_id: userId,
    type,
    title,
    body,
    conversation_id: conversationId,
  });
}
