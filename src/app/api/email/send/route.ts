import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { sendEmail, getMailboxCredentials } from "@/lib/email";

// POST /api/email/send
// Sends a reply via SMTP and stores it in Supabase
export async function POST(req: NextRequest) {
  try {
    const { conversationId, body: replyBody } = await req.json();
    if (!conversationId || !replyBody) {
      return NextResponse.json({ error: "Missing conversationId or body" }, { status: 400 });
    }

    const supabase = createServerClient();

    // Get conversation + latest message for threading
    const { data: convo } = await supabase
      .from("conversations")
      .select("*, mailbox_id")
      .eq("id", conversationId)
      .single();

    if (!convo) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    // Get the latest message for reply headers
    const { data: lastMsg } = await supabase
      .from("messages")
      .select("message_id, references, from_email")
      .eq("conversation_id", conversationId)
      .order("received_at", { ascending: false })
      .limit(1)
      .single();

    // Get mailbox credentials
    const creds = await getMailboxCredentials(convo.mailbox_id);
    if (!creds) {
      return NextResponse.json({ error: "Mailbox not configured" }, { status: 404 });
    }

    // Send via SMTP
    const subject = convo.subject?.startsWith("Re:") ? convo.subject : `Re: ${convo.subject}`;
    const replyTo = lastMsg?.from_email || convo.from_email;

    await sendEmail(
      creds,
      replyTo,
      subject,
      replyBody,
      undefined, // no HTML for now
      lastMsg?.message_id || undefined,
      lastMsg?.references || lastMsg?.message_id || undefined
    );

    // Store outbound message in Supabase
    await supabase.from("messages").insert({
      conversation_id: conversationId,
      mailbox_id: convo.mailbox_id,
      from_name: creds.email.split("@")[0],
      from_email: creds.email,
      to_addresses: replyTo,
      subject,
      body_text: replyBody,
      snippet: replyBody.slice(0, 200),
      is_outbound: true,
      received_at: new Date().toISOString(),
    });

    // Update conversation
    await supabase
      .from("conversations")
      .update({
        preview: replyBody.slice(0, 200),
        last_message_at: new Date().toISOString(),
      })
      .eq("id", conversationId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("Send error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
