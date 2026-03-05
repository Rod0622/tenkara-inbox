import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { createServerClient } from "@/lib/supabase";
import { notifyTaskCreated } from "@/lib/slack";

// GET — Fetch tasks for a conversation
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const conversationId = req.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*, assignee:inbox.team_members(*)")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

// POST — Create a new task
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { conversationId, text, assigneeId, dueDate } = await req.json();
  if (!conversationId || !text) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const supabase = createServerClient();

  const { data: task, error } = await supabase
    .from("tasks")
    .insert({
      conversation_id: conversationId,
      text,
      assignee_id: assigneeId || null,
      due_date: dueDate || null,
    })
    .select("*, assignee:inbox.team_members(*)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Get conversation subject for notifications
  const { data: convo } = await supabase
    .from("conversations")
    .select("subject")
    .eq("id", conversationId)
    .single();

  // Slack notification
  notifyTaskCreated(
    text,
    task.assignee?.name || null,
    convo?.subject || "Unknown",
    dueDate
  ).catch(console.error);

  return NextResponse.json(task, { status: 201 });
}

// PATCH — Toggle task completion
export async function PATCH(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { taskId, isDone } = await req.json();
  if (!taskId || isDone === undefined) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const supabase = createServerClient();
  const { data, error } = await supabase
    .from("tasks")
    .update({ is_done: isDone })
    .eq("id", taskId)
    .select("*, assignee:inbox.team_members(*)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
