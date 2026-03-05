import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import {
  fetchEmails,
  getMailboxCredentials,
  getAllMailboxes,
  computeThreadKey,
} from "@/lib/email";
import { classifyEmail } from "@/lib/ai";

// POST /api/email/sync
// Syncs emails from IMAP into Supabase
// Body: { mailboxId?: string } — sync one or all mailboxes
export async function POST(req: NextRequest) {
  try {
    const { mailboxId } = await req.json().catch(() => ({}));
    const supabase = createServerClient();

    // Get mailbox(es) to sync
    const mailboxes = mailboxId
      ? [await getMailboxCredentials(mailboxId)].filter(Boolean)
      : await getAllMailboxes();

    if (mailboxes.length === 0) {
      return NextResponse.json({ error: "No mailboxes configured" }, { status: 404 });
    }

    let totalSynced = 0;

    for (const mb of mailboxes) {
      if (!mb) continue;

      try {
        console.log(`Syncing mailbox: ${mb.email}`);
        const emails = await fetchEmails(mb, 50, mb.last_uid || undefined);

        for (const email of emails) {
          // Compute thread key for grouping
          const threadKey = computeThreadKey(
            email.subject,
            email.messageId,
            email.inReplyTo,
            email.references
          );

          // Check if message already exists
          const { data: existing } = await supabase
            .from("messages")
            .select("id")
            .eq("mailbox_id", mb.id)
            .eq("imap_uid", email.uid)
            .single();

          if (existing) continue; // Already synced

          // Find or create conversation
          let conversationId: string;

          const { data: existingConvo } = await supabase
            .from("conversations")
            .select("id")
            .eq("mailbox_id", mb.id)
            .eq("thread_key", threadKey)
            .single();

          if (existingConvo) {
            conversationId = existingConvo.id;

            // Update conversation with latest message info
            await supabase
              .from("conversations")
              .update({
                preview: email.snippet,
                last_message_at: email.date.toISOString(),
                is_unread: true,
                message_count: undefined, // will increment below
              })
              .eq("id", conversationId);

            // Increment message count
            await supabase.rpc("inbox_increment_message_count", {
              conv_id: conversationId,
            }).catch(() => {
              // If RPC doesn't exist, update manually
              supabase
                .from("conversations")
                .select("message_count")
                .eq("id", conversationId)
                .single()
                .then(({ data }) => {
                  if (data) {
                    supabase
                      .from("conversations")
                      .update({ message_count: (data.message_count || 0) + 1 })
                      .eq("id", conversationId);
                  }
                });
            });
          } else {
            // Create new conversation
            const { data: newConvo, error } = await supabase
              .from("conversations")
              .insert({
                mailbox_id: mb.id,
                thread_key: threadKey,
                subject: email.subject,
                from_name: email.fromName,
                from_email: email.fromEmail,
                preview: email.snippet,
                is_unread: true,
                message_count: 1,
                last_message_at: email.date.toISOString(),
              })
              .select("id")
              .single();

            if (error || !newConvo) {
              console.error("Failed to create conversation:", error);
              continue;
            }

            conversationId = newConvo.id;

            // Auto-classify with AI (fire and forget for speed)
            classifyAndLabel(supabase, conversationId, email.subject, email.bodyText, email.fromEmail, email.fromName)
              .catch(console.error);
          }

          // Insert message
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            mailbox_id: mb.id,
            imap_uid: email.uid,
            message_id: email.messageId,
            in_reply_to: email.inReplyTo,
            references: email.references,
            from_name: email.fromName,
            from_email: email.fromEmail,
            to_addresses: email.to,
            cc_addresses: email.cc,
            subject: email.subject,
            body_text: email.bodyText,
            body_html: email.bodyHtml,
            snippet: email.snippet,
            has_attachments: email.hasAttachments,
            is_outbound: false,
            received_at: email.date.toISOString(),
          });

          totalSynced++;
        }

        // Update last synced UID
        if (emails.length > 0) {
          const lastUid = emails[emails.length - 1].uid;
          await supabase
            .from("mailboxes")
            .update({ last_uid: lastUid, last_synced_at: new Date().toISOString() })
            .eq("id", mb.id);
        }
      } catch (mbError: any) {
        console.error(`Error syncing ${mb.email}:`, mbError.message);
      }
    }

    return NextResponse.json({ synced: totalSynced });
  } catch (error: any) {
    console.error("Sync error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// ── Auto-classify helper ─────────────────────────────
async function classifyAndLabel(
  supabase: any,
  conversationId: string,
  subject: string,
  body: string,
  fromEmail: string,
  fromName: string
) {
  try {
    const classification = await classifyEmail(subject, body, fromEmail, fromName);

    // Get label IDs
    const { data: allLabels } = await supabase
      .from("labels")
      .select("id, name");

    if (!allLabels) return;

    for (const labelName of classification.labels) {
      const label = allLabels.find((l: any) => l.name === labelName);
      if (label) {
        await supabase.from("conversation_labels").upsert({
          conversation_id: conversationId,
          label_id: label.id,
        });
      }
    }
  } catch (err) {
    console.error("Classification failed:", err);
  }
}
