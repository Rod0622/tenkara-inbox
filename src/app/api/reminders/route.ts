import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/reminders — Fetch reminders for a user, or check for due reminders
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const userId = req.nextUrl.searchParams.get("user_id");
  const checkDue = req.nextUrl.searchParams.get("check_due");

  if (!userId) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }

  // Check for due reminders and fire them
  if (checkDue === "true") {
    const now = new Date().toISOString();

    // Find due reminders that haven't fired yet
    const { data: dueReminders } = await supabase
      .from("follow_up_reminders")
      .select("*, conversation:conversations(id, subject, from_name, from_email)")
      .eq("user_id", userId)
      .eq("is_fired", false)
      .eq("is_dismissed", false)
      .lte("remind_at", now);

    if (dueReminders && dueReminders.length > 0) {
      // Create notifications for each due reminder
      const notifications = dueReminders.map((r: any) => ({
        user_id: r.user_id,
        type: "follow_up",
        title: "Follow-up reminder",
        body: r.note || r.conversation?.subject || "Time to follow up",
        conversation_id: r.conversation_id,
        actor_id: null,
      }));

      await supabase.from("notifications").insert(notifications);

      // Mark as fired
      const ids = dueReminders.map((r: any) => r.id);
      await supabase
        .from("follow_up_reminders")
        .update({ is_fired: true })
        .in("id", ids);

      return NextResponse.json({ fired: dueReminders.length, reminders: dueReminders });
    }

    return NextResponse.json({ fired: 0, reminders: [] });
  }

  // Fetch all active reminders for this user
  const { data, error } = await supabase
    .from("follow_up_reminders")
    .select("*, conversation:conversations(id, subject, from_name, from_email)")
    .eq("user_id", userId)
    .eq("is_dismissed", false)
    .order("remind_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ reminders: data || [] });
}

// POST /api/reminders — Create a follow-up reminder
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_id, user_id, remind_at, note } = body;

  if (!conversation_id || !user_id || !remind_at) {
    return NextResponse.json({ error: "conversation_id, user_id, remind_at required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("follow_up_reminders")
    .insert({
      conversation_id,
      user_id,
      remind_at,
      note: note || null,
    })
    .select("*, conversation:conversations(id, subject)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Log activity
  await supabase.from("activity_log").insert({
    conversation_id,
    actor_id: user_id,
    action: "follow_up_set",
    details: { remind_at, note: note || null },
  });

  return NextResponse.json({ reminder: data });
}

// PATCH /api/reminders — Dismiss or update a reminder
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { id, dismiss, remind_at } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  if (dismiss) {
    await supabase
      .from("follow_up_reminders")
      .update({ is_dismissed: true })
      .eq("id", id);
  } else if (remind_at) {
    await supabase
      .from("follow_up_reminders")
      .update({ remind_at, is_fired: false })
      .eq("id", id);
  }

  return NextResponse.json({ success: true });
}

// DELETE /api/reminders — Delete a reminder
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  await supabase.from("follow_up_reminders").delete().eq("id", id);
  return NextResponse.json({ success: true });
}
