import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// GET /api/drafts — list drafts (optionally filter by conversation_id or author_id)
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");
  const authorId = req.nextUrl.searchParams.get("author_id");

  let query = supabase
    .from("email_drafts")
    .select("*, conversation:conversations(id, subject, from_name, from_email, email_account_id), account:email_accounts(id, name, email)")
    .order("updated_at", { ascending: false });

  if (conversationId) query = query.eq("conversation_id", conversationId);
  if (authorId) query = query.eq("author_id", authorId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ drafts: data || [] });
}

// POST /api/drafts — create or update a draft
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { conversation_id, email_account_id, author_id, to_addresses, cc_addresses, bcc_addresses, subject, body_html, body_text, is_reply, source } = body;

  if (!conversation_id) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  // Check if draft already exists for this conversation + author
  const { data: existing } = await supabase
    .from("email_drafts")
    .select("id")
    .eq("conversation_id", conversation_id)
    .eq("author_id", author_id || "")
    .maybeSingle();

  if (existing) {
    // Update existing draft
    const { data, error } = await supabase
      .from("email_drafts")
      .update({
        to_addresses, cc_addresses, bcc_addresses, subject,
        body_html, body_text: body_text || (body_html || "").replace(/<[^>]*>/g, "").slice(0, 5000),
        email_account_id, is_reply: is_reply ?? true, source: source || "manual",
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ draft: data });
  }

  // Create new draft
  const { data, error } = await supabase
    .from("email_drafts")
    .insert({
      conversation_id, email_account_id, author_id: author_id || null,
      to_addresses, cc_addresses, bcc_addresses, subject,
      body_html, body_text: body_text || (body_html || "").replace(/<[^>]*>/g, "").slice(0, 5000),
      is_reply: is_reply ?? true, source: source || "manual",
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ draft: data });
}

// DELETE /api/drafts?id=xxx or ?conversation_id=xxx
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  if (id) {
    const { error } = await supabase.from("email_drafts").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (conversationId) {
    const { error } = await supabase.from("email_drafts").delete().eq("conversation_id", conversationId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    return NextResponse.json({ error: "id or conversation_id required" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
