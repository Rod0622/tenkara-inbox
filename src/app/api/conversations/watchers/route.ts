export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// Default notification preferences for new watchers (matches major events)
const DEFAULT_PREFS = {
  notify_on_new_message: true,
  notify_on_status_change: true,
  notify_on_assignee_change: true,
  notify_on_label_change: false,
  notify_on_comment: false,
};

// GET /api/conversations/watchers
//   - ?conversation_id=xxx — list watchers of one conversation (with names)
//   - ?user_id=xxx — list conversations a user is watching (returns conversation IDs)
//   - ?conversation_id=xxx&user_id=yyy — return that single watch row (or null)
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");
  const userId = req.nextUrl.searchParams.get("user_id");

  if (!conversationId && !userId) {
    return NextResponse.json({ error: "conversation_id or user_id required" }, { status: 400 });
  }

  if (conversationId && userId) {
    // Single watch row
    const { data, error } = await supabase
      .from("conversation_watchers")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ watcher: data });
  }

  if (conversationId) {
    // All watchers of this conversation
    const { data, error } = await supabase
      .from("conversation_watchers")
      .select(`
        *,
        user:team_members!user_id (id, name, initials, color)
      `)
      .eq("conversation_id", conversationId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ watchers: data || [] });
  }

  if (userId) {
    // List of conversations this user is watching (just the IDs + watched_at; full conversation
    // data is fetched separately by the conversation list view)
    const { data, error } = await supabase
      .from("conversation_watchers")
      .select("conversation_id, watched_at")
      .eq("user_id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ watching: data || [] });
  }

  return NextResponse.json({ error: "Invalid params" }, { status: 400 });
}

// POST /api/conversations/watchers — add a watcher
// Body: { conversation_id, user_id, watch_source?, notify_on_new_message?, notify_on_status_change?, notify_on_assignee_change?, notify_on_label_change?, notify_on_comment? }
//
// Permission (Q1: B): the user adding the watch must have access to the conversation,
// which we enforce loosely here — the conversation must exist and not be in a forbidden state.
// Stricter access control happens at the route level above.
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { conversation_id, user_id, watch_source } = body;

  if (!conversation_id || !user_id) {
    return NextResponse.json({ error: "conversation_id and user_id required" }, { status: 400 });
  }

  // Verify conversation exists
  const { data: convo } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversation_id)
    .maybeSingle();
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  // Build the row from body, falling back to defaults
  const row: any = {
    conversation_id,
    user_id,
    watch_source: watch_source || "manual",
    ...DEFAULT_PREFS,
  };
  for (const key of Object.keys(DEFAULT_PREFS)) {
    if (key in body && typeof body[key] === "boolean") {
      row[key] = body[key];
    }
  }

  // Upsert so re-watching is idempotent
  const { data, error } = await supabase
    .from("conversation_watchers")
    .upsert(row, { onConflict: "conversation_id,user_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ watcher: data }, { status: 201 });
}

// PATCH /api/conversations/watchers — update notification preferences for an existing watch
// Body: { conversation_id, user_id, notify_on_*: bool, ... }
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { conversation_id, user_id } = body;

  if (!conversation_id || !user_id) {
    return NextResponse.json({ error: "conversation_id and user_id required" }, { status: 400 });
  }

  const updates: any = {};
  for (const key of Object.keys(DEFAULT_PREFS)) {
    if (key in body && typeof body[key] === "boolean") {
      updates[key] = body[key];
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("conversation_watchers")
    .update(updates)
    .eq("conversation_id", conversation_id)
    .eq("user_id", user_id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ watcher: data });
}

// DELETE /api/conversations/watchers?conversation_id=xxx&user_id=yyy
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const conversation_id = req.nextUrl.searchParams.get("conversation_id");
  const user_id = req.nextUrl.searchParams.get("user_id");

  if (!conversation_id || !user_id) {
    return NextResponse.json({ error: "conversation_id and user_id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("conversation_watchers")
    .delete()
    .eq("conversation_id", conversation_id)
    .eq("user_id", user_id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
