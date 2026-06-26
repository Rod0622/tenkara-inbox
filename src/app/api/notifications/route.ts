import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

// Notifications API.
//
// SECURITY: the current user is derived from the authenticated NextAuth
// session — NEVER from a `user_id` request parameter. Trusting a caller-
// supplied user_id allowed anyone to read or modify another user's
// notifications by changing the value (IDOR). All read/modify operations are
// now scoped to session.user.id.
//
// (Note: this app authenticates via NextAuth and accesses the DB with the
// service-role key, which bypasses Postgres RLS — so authorization must be
// enforced here in the route, using the session, rather than via RLS.)

// GET /api/notifications — notifications for the AUTHENTICATED user
export async function GET(_req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("*, actor:team_members!notifications_actor_id_fkey(name, initials, color), conversation:conversations(subject)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ notifications: data || [] });
}

// POST /api/notifications — create notification(s) for OTHER users.
// This legitimately writes notifications targeted at teammates (e.g. "you were
// assigned a conversation"), so the target user_id comes from the body — but
// the caller must be an authenticated user.
export async function POST(req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

// PATCH /api/notifications — mark the AUTHENTICATED user's notifications read.
// Scoped to session.user.id so a caller can't mark another user's
// notifications as read.
export async function PATCH(req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const body = await req.json();
  const { notification_ids, mark_all } = body;

  if (mark_all) {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .eq("is_read", false);
  } else if (notification_ids?.length) {
    // Constrain to the caller's own notifications — can't mark others' read.
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", userId)
      .in("id", notification_ids);
  }

  return NextResponse.json({ success: true });
}