import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/notifications — Fetch notifications for current user
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const userId = req.nextUrl.searchParams.get("user_id");

  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("notifications")
    .select("*, actor:team_members!notifications_actor_id_fkey(name, initials, color), conversation:conversations(subject)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ notifications: data || [] });
}

// POST /api/notifications — Create notification(s)
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  // Support single or bulk creation
  const notifications = Array.isArray(body) ? body : [body];

  const rows = notifications.map((n: any) => ({
    user_id: n.user_id,
    type: n.type,
    title: n.title,
    body: n.body || null,
    conversation_id: n.conversation_id || null,
    task_id: n.task_id || null,
    actor_id: n.actor_id || null,
  }));

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, count: rows.length });
}

// PATCH /api/notifications — Mark as read
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { notification_ids, user_id, mark_all } = body;

  if (mark_all && user_id) {
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user_id).eq("is_read", false);
  } else if (notification_ids?.length) {
    await supabase.from("notifications").update({ is_read: true }).in("id", notification_ids);
  }

  return NextResponse.json({ success: true });
}