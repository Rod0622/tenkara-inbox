import { createServerClient } from "@/lib/supabase";
import { refreshMicrosoftToken } from "@/lib/microsoft-oauth";
import { runRulesForMessage } from "@/lib/rule-engine";

// Sync a microsoft_oauth account using delegated Graph API token
export async function syncMicrosoftOAuthAccount(accountId: string): Promise<{
  success: boolean;
  newMessages: number;
  newConversations: number;
  errors: string[];
}> {
  const supabase = createServerClient();
  const result = { success: false, newMessages: 0, newConversations: 0, errors: [] as string[] };

  try {
    const { data: account, error: accErr } = await supabase
      .from("email_accounts").select("*").eq("id", accountId).single();

    if (accErr || !account) { result.errors.push("Account not found"); return result; }

    // Get fresh access token
    let token: string;
    try {
      token = await refreshMicrosoftToken(accountId);
    } catch (tokenErr: any) {
      const msg = "OAuth token refresh failed: " + tokenErr.message;
      await supabase.from("email_accounts").update({ sync_error: msg }).eq("id", accountId);
      result.errors.push(msg);
      return result;
    }

    console.log("MS OAuth sync " + accountId + ": token refreshed, fetching emails");

    // Fetch emails using delegated token (/me/ endpoint)
    const BATCH_SIZE = 25;
    let url = "https://graph.microsoft.com/v1.0/me/messages?$top=" + BATCH_SIZE + "&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,conversationId,internetMessageId";

    if (account.last_sync_at) {
      url += "&$filter=receivedDateTime ge " + account.last_sync_at;
    }

    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = "Graph API error: " + (err.error?.message || res.statusText);
      await supabase.from("email_accounts").update({ sync_error: msg }).eq("id", accountId);
      result.errors.push(msg);
      return result;
    }

    const data = await res.json();
    const messages = data.value || [];

    console.log("MS OAuth sync " + accountId + ": fetched " + messages.length + " messages");

    if (messages.length === 0) {
      await supabase.from("email_accounts").update({ last_sync_at: new Date().toISOString(), sync_error: null }).eq("id", accountId);
      result.success = true;
      return result;
    }

    // Process each message
    for (const msg of messages) {
      try {
        const fromAddr = msg.from?.emailAddress || {};
        const fromEmail = (fromAddr.address || "").toLowerCase();
        const fromName = fromAddr.name || fromEmail;
        const subject = msg.subject || "(No subject)";
        const toAddresses = (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", ");
        const ccAddresses = (msg.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", ");
        const bodyText = msg.body?.content || msg.bodyPreview || "";
        const snippet = (msg.bodyPreview || "").slice(0, 200);
        const sentAt = msg.sentDateTime || msg.receivedDateTime;
        const isOutbound = fromEmail === account.email.toLowerCase();
        const providerId = "graph:" + msg.id;

        // Check if already synced
        const { data: existing } = await supabase
          .from("messages").select("id").eq("provider_message_id", providerId).maybeSingle();
        if (existing) continue;

        // Find or create conversation by subject + participants
        const normalizedSubject = subject.replace(/^(Re|Fwd|Fw):\s*/i, "").trim();
        const { data: existingConvo } = await supabase
          .from("conversations")
          .select("id")
          .eq("email_account_id", accountId)
          .ilike("subject", normalizedSubject)
          .maybeSingle();

        let conversationId: string;

        if (existingConvo) {
          conversationId = existingConvo.id;
          await supabase.from("conversations").update({
            last_message_at: sentAt,
            snippet: snippet,
            is_unread: !isOutbound,
            has_attachments: msg.hasAttachments || false,
          }).eq("id", conversationId);
        } else {
          const { data: newConvo, error: convoErr } = await supabase
            .from("conversations")
            .insert({
              email_account_id: accountId,
              subject: subject,
              from_name: fromName,
              from_email: fromEmail,
              to_addresses: toAddresses,
              snippet: snippet,
              last_message_at: sentAt,
              is_unread: !isOutbound,
              is_outbound: isOutbound,
              has_attachments: msg.hasAttachments || false,
              status: "open",
            })
            .select("id")
            .single();

          if (convoErr || !newConvo) continue;
          conversationId = newConvo.id;
          result.newConversations++;
        }

        // Insert message
        const { error: msgErr } = await supabase.from("messages").insert({
          conversation_id: conversationId,
          provider_message_id: providerId,
          message_id: msg.internetMessageId || providerId,
          from_name: fromName,
          from_email: fromEmail,
          to_addresses: toAddresses,
          cc_addresses: ccAddresses,
          subject: subject,
          body_text: bodyText,
          body_html: msg.body?.contentType === "html" ? bodyText : null,
          snippet: snippet,
          sent_at: sentAt,
          is_outbound: isOutbound,
          is_read: msg.isRead || false,
          has_attachments: msg.hasAttachments || false,
        });

        if (!msgErr) {
          result.newMessages++;

          // Run rules
          try {
            await runRulesForMessage(conversationId, {
              conversation_id: conversationId,
              subject, from_email: fromEmail, from_name: fromName,
              to_addresses: toAddresses, body_text: snippet,
            });
          } catch (_e) { /* rules are best-effort */ }
        }
      } catch (msgErr: any) {
        console.error("MS OAuth sync msg error:", msgErr.message);
      }
    }

    // Update sync timestamp
    await supabase.from("email_accounts").update({
      last_sync_at: new Date().toISOString(),
      sync_error: null,
    }).eq("id", accountId);

    result.success = true;
    return result;

  } catch (err: any) {
    console.error("MS OAuth sync error:", err.message);
    await supabase.from("email_accounts").update({ sync_error: err.message }).eq("id", accountId);
    result.errors.push(err.message);
    return result;
  }
}