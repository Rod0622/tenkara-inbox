export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

// Default notification preferences for new watchers (matches major events)
const DEFAULT_PREFS = {
  notify_on_new_message: true,
  notify_on_status_change: true,
  notify_on_assignee_change: true,
  notify_on_label_change: false,
  notify_on_comment: false,
};

// SECURITY: write operations (POST/PATCH/DELETE) and the personal "what am I
// watching" read are scoped to the authenticated NextAuth session user — a
// caller can only manage THEIR OWN watch, never another user's (closes an
// IDOR where user_id was trusted from the request).
//
// Legitimate "watch another user" flows (auto-watch on task assignment, rule
// engine, merge transfer) run server-side via lib helpers / direct DB writes,
// NOT through this public endpoint, so they are unaffected.
//
// Listing the watchers OF a conversation (with names) stays available to any
// authenticated user, since who's watching a thread is team-visible by design.
async function sessionUserId(): Promise<string | null> {
  const session: any = await getServerSession(authOptions);
  return session?.user?.id || null;
}

// GET /api/conversations/watchers
//   - ?conversation_id=xxx  → list watchers of one conversation (team-visible)
//   - (no params)           → list conversations the CURRENT user is watching
//   - ?conversation_id=xxx (with no explicit user) → also returns current user's watch row
export async function GET(req: NextRequest) {
  const sessionUid = await sessionUserId();
  if (!sessionUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");
  // If a user_id is present alongside conversation_id, the caller is asking
  // "is <user> watching this?" — we treat that as "is the CURRENT user
  // watching", deriving identity from the session and ignoring the param
  // (closes the IDOR while matching the existing frontend call signature in
  // WatchToggle.tsx, which sends ?conversation_id=X&user_id=Y).
  const userIdParam = req.nextUrl.searchParams.get("user_id");

  if (conversationId && userIdParam) {
    const { data, error } = await supabase
      .from("conversation_watchers")
      .select("*")
      .eq("conversation_id", conversationId)
      .eq("user_id", sessionUid)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ watcher: data });
  }

  if (conversationId) {
    // All watchers of this conversation (team-visible display).
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

  // No conversation_id → list of conversations the CURRENT user is watching.
  const { data, error } = await supabase
    .from("conversation_watchers")
    .select("conversation_id, watched_at")
    .eq("user_id", sessionUid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ watching: data || [] });
}

// POST — add a watch for the CURRENT user only.
export async function POST(req: NextRequest) {
  const sessionUid = await sessionUserId();
  if (!sessionUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const body = await req.json();
  const { conversation_id, watch_source } = body;

  if (!conversation_id) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  }

  const { data: convo } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", conversation_id)
    .maybeSingle();
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const row: any = {
    conversation_id,
    user_id: sessionUid,
    watch_source: watch_source || "manual",
    ...DEFAULT_PREFS,
  };
  for (const key of Object.keys(DEFAULT_PREFS)) {
    if (key in body && typeof body[key] === "boolean") {
      row[key] = body[key];
    }
  }

  const { data, error } = await supabase
    .from("conversation_watchers")
    .upsert(row, { onConflict: "conversation_id,user_id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ watcher: data }, { status: 201 });
}

// PATCH — update the CURRENT user's notification prefs for a watch.
export async function PATCH(req: NextRequest) {
  const sessionUid = await sessionUserId();
  if (!sessionUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const body = await req.json();
  const { conversation_id } = body;

  if (!conversation_id) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
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
    .eq("user_id", sessionUid)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ watcher: data });
}

// DELETE — remove the CURRENT user's watch.
export async function DELETE(req: NextRequest) {
  const sessionUid = await sessionUserId();
  if (!sessionUid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServerClient();
  const conversation_id = req.nextUrl.searchParams.get("conversation_id");

  if (!conversation_id) {
    return NextResponse.json({ error: "conversation_id required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("conversation_watchers")
    .delete()
    .eq("conversation_id", conversation_id)
    .eq("user_id", sessionUid);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}