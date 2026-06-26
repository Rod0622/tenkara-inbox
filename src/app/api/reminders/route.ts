import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

// Follow-up reminders API.
//
// SECURITY: the user is taken from the authenticated NextAuth session, never
// from a client-supplied user_id (which previously allowed reading/firing/
// dismissing another user's reminders — IDOR). All operations are scoped to
// session.user.id. The app uses NextAuth + service-role DB access (which
// bypasses RLS), so authorization is enforced here in the route.

async function sessionUserId(): Promise<string | null> {
  const session: any = await getServerSession(authOptions);
  return session?.user?.id || null;
}

// GET /api/reminders — fetch the authenticated user's reminders, or fire their
// own due reminders (check_due).
export async function GET(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const checkDue = req.nextUrl.searchParams.get("check_due");

  if (checkDue === "true") {
    const now = new Date().toISOString();

    const { data: dueReminders } = await supabase
      .from("follow_up_reminders")
      .select("*, conversation:conversations(id, subject, from_name, from_email)")
      .eq("user_id", userId)
      .eq("is_fired", false)
      .eq("is_dismissed", false)
      .lte("remind_at", now);

    if (dueReminders && dueReminders.length > 0) {
      const notifications = dueReminders.map((r: any) => ({
        user_id: r.user_id,
        type: "follow_up",
        title: "Follow-up reminder",
        body: r.note || r.conversation?.subject || "Time to follow up",
        conversation_id: r.conversation_id,
        actor_id: null,
      }));

      await supabase.from("notifications").insert(notifications);

      const ids = dueReminders.map((r: any) => r.id);
      await supabase
        .from("follow_up_reminders")
        .update({ is_fired: true })
        .in("id", ids);

      return NextResponse.json({ fired: dueReminders.length, reminders: dueReminders });
    }

    return NextResponse.json({ fired: 0, reminders: [] });
  }

  const { data, error } = await supabase
    .from("follow_up_reminders")
    .select("*, conversation:conversations(id, subject, from_name, from_email)")
    .eq("user_id", userId)
    .eq("is_dismissed", false)
    .order("remind_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reminders: data || [] });
}

// POST /api/reminders — create a reminder for the AUTHENTICATED user.
export async function POST(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const body = await req.json();
  const { conversation_id, remind_at, note } = body;

  if (!conversation_id || !remind_at) {
    return NextResponse.json({ error: "conversation_id, remind_at required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("follow_up_reminders")
    .insert({
      conversation_id,
      user_id: userId,
      remind_at,
      note: note || null,
    })
    .select("*, conversation:conversations(id, subject)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("activity_log").insert({
    conversation_id,
    actor_id: userId,
    action: "follow_up_set",
    details: { remind_at, note: note || null },
  });

  return NextResponse.json({ reminder: data });
}

// PATCH /api/reminders — dismiss/update one of the AUTHENTICATED user's reminders.
export async function PATCH(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const body = await req.json();
  const { id, dismiss, remind_at } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Scope to the caller's own reminders so one user can't modify another's.
  if (dismiss) {
    await supabase
      .from("follow_up_reminders")
      .update({ is_dismissed: true })
      .eq("id", id)
      .eq("user_id", userId);
  } else if (remind_at) {
    await supabase
      .from("follow_up_reminders")
      .update({ remind_at, is_fired: false })
      .eq("id", id)
      .eq("user_id", userId);
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/reminders — delete one of the AUTHENTICATED user's reminders.
export async function DELETE(req: NextRequest) {
  const userId = await sessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await supabase
    .from("follow_up_reminders")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  return NextResponse.json({ success: true });
}