import { createServerClient } from "@/lib/supabase";
import { refreshMicrosoftToken } from "@/lib/microsoft-oauth";

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
      token = await refreshMicrosoftToken(accountId, true);
    } catch (tokenErr: any) {
      const msg = "OAuth token refresh failed: " + tokenErr.message;
      console.error("MS OAuth sync " + accountId + ": " + msg);
      await supabase.from("email_accounts").update({ sync_error: msg }).eq("id", accountId);
      result.errors.push(msg);
      return result;
    }

    console.log("MS OAuth sync " + accountId + ": token refreshed, fetching emails");
    console.log("MS OAuth sync " + accountId + ": last_sync_at=" + (account.last_sync_at || "null") + ", Graph URL prefix: " + (account.last_sync_at ? "incremental" : "initial skip=" + (account.last_sync_uid || "0")));

    // Fetch emails using delegated token (/me/ endpoint)
    const BATCH_SIZE = 10;
    let url: string;
    const fields = "id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,conversationId,internetMessageId";

    if (account.last_sync_at) {
      // Incremental sync — fetch only new inbox messages
      const syncDate = new Date(account.last_sync_at).toISOString().replace(/\.\d{3}Z$/, "Z");
      url = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=" + BATCH_SIZE + "&$orderby=receivedDateTime desc&$select=" + fields + "&$filter=receivedDateTime ge " + syncDate;
    } else {
      const skipOffset = parseInt(account.last_sync_uid || "0") || 0;

      // Safety: if initial sync has been paginating too long (skip > 500),
      // force-complete it and switch to incremental sync going forward
      if (skipOffset > 500) {
        console.log("MS OAuth sync " + accountId + ": initial sync stuck at skip=" + skipOffset + ", forcing transition to incremental sync");
        await supabase.from("email_accounts").update({
          last_sync_at: new Date().toISOString(),
          sync_error: null,
        }).eq("id", accountId);
        result.success = true;
        return result;
      }

      // Initial sync — use skip offset for pagination
      url = "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=" + BATCH_SIZE + "&$skip=" + skipOffset + "&$orderby=receivedDateTime desc&$select=" + fields;
    }

    const res = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const msg = "Graph API error: " + (err.error?.message || res.statusText);
      console.error("MS OAuth sync " + accountId + ": " + msg + " (status: " + res.status + ", code: " + (err.error?.code || "none") + ")");
      await supabase.from("email_accounts").update({ sync_error: msg }).eq("id", accountId);
      result.errors.push(msg);
      return result;
    }

    const data = await res.json();
    const messages = data.value || [];

    console.log("MS OAuth sync " + accountId + ": fetched " + messages.length + " messages");

    if (messages.length === 0) {
      if (account.last_sync_at) {
        // Incremental sync found no new messages — that's fine, update timestamp
        await supabase.from("email_accounts").update({ last_sync_at: new Date().toISOString(), sync_error: null }).eq("id", accountId);
      } else {
        // Initial sync with skip offset found no more messages — mark complete
        await supabase.from("email_accounts").update({ last_sync_at: new Date().toISOString(), sync_error: null }).eq("id", accountId);
        console.log("MS OAuth sync " + accountId + ": initial sync complete (no more messages at offset " + (account.last_sync_uid || "0") + ")");
      }
      result.success = true;
      return result;
    }

    // Load rules engine
    let runRulesFn: any = null;
    try {
      const mod = await import("@/lib/rule-engine");
      runRulesFn = mod.runRulesForMessage;
    } catch (_e) { /* rules optional */ }

    // Process each message
    for (const email of messages) {
      try {
        const msgId = email.internetMessageId || email.id;
        const providerId = "ms:" + msgId;

        // Check if already synced
        const { data: existing } = await supabase
          .from("messages").select("id").eq("provider_message_id", providerId).maybeSingle();
        if (existing) continue;

        const isOutbound = (email.from?.emailAddress?.address || "").toLowerCase() === account.email.toLowerCase();
        let conversationId: string | null = null;

        // Thread by Graph conversationId
        if (email.conversationId) {
          const { data: c } = await supabase.from("conversations").select("id")
            .eq("thread_id", "ms:" + email.conversationId).eq("email_account_id", accountId).maybeSingle();
          if (c) conversationId = c.id;
        }

        // Thread by subject
        if (!conversationId) {
          const subj = (email.subject || "").replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, "").trim();
          if (subj) {
            const { data: m } = await supabase.from("conversations").select("id")
              .eq("email_account_id", accountId).eq("subject", subj)
              .gte("last_message_at", new Date(Date.now() - 30*24*60*60*1000).toISOString())
              .order("last_message_at", { ascending: false }).limit(1).maybeSingle();
            if (m) conversationId = m.id;
          }
        }

        // Create conversation
        if (!conversationId) {
          const subj = (email.subject || "").replace(/^(Re|Fwd|Fw|RE|FW|FWD):\s*/gi, "").trim() || "(No Subject)";
          const { data: nc, error: ce } = await supabase.from("conversations").insert({
            email_account_id: accountId,
            thread_id: email.conversationId ? "ms:" + email.conversationId : "ms:" + email.id,
            subject: subj,
            from_name: email.from?.emailAddress?.name || email.from?.emailAddress?.address || "Unknown",
            from_email: email.from?.emailAddress?.address || "",
            preview: (email.bodyPreview || "").slice(0, 200),
            is_unread: !isOutbound,
            status: "open",
            last_message_at: email.receivedDateTime || new Date().toISOString(),
          }).select("id").single();

          if (ce) {
            console.error("MS OAuth sync: conversation insert failed:", ce.message, "subject:", email.subject);
            continue;
          }
          conversationId = nc.id;
          result.newConversations++;
        }

        // Insert message
        const bodyHtml = email.body?.contentType === "html" ? email.body.content : null;
        const bodyText = bodyHtml ? bodyHtml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 5000) : (email.bodyPreview || "");
        const toAddr = (email.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", ");
        const ccAddr = (email.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", ");

        const { error: me } = await supabase.from("messages").insert({
          conversation_id: conversationId,
          provider_message_id: providerId,
          from_name: email.from?.emailAddress?.name || "Unknown",
          from_email: email.from?.emailAddress?.address || "",
          to_addresses: toAddr,
          cc_addresses: ccAddr,
          subject: email.subject || "(No Subject)",
          body_text: bodyText.slice(0, 5000),
          body_html: bodyHtml,
          snippet: (email.bodyPreview || bodyText).slice(0, 200),
          is_outbound: isOutbound,
          has_attachments: email.hasAttachments || false,
          sent_at: email.sentDateTime || email.receivedDateTime || new Date().toISOString(),
        });

        if (me) {
          console.error("MS OAuth sync: message insert failed:", me.message);
          continue;
        }

        result.newMessages++;

        // Update conversation preview
        await supabase.from("conversations").update({
          preview: bodyText.slice(0, 200),
          last_message_at: email.receivedDateTime || new Date().toISOString(),
          is_unread: !isOutbound,
        }).eq("id", conversationId);

        // Run rules
        if (runRulesFn) {
          try {
            await runRulesFn(conversationId, {
              conversation_id: conversationId,
              subject: email.subject || "",
              from_email: email.from?.emailAddress?.address || "",
              from_name: email.from?.emailAddress?.name || "",
              to_addresses: toAddr,
              cc_addresses: (email.ccRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", "),
              body_text: bodyText.slice(0, 200),
              email_account_id: accountId,
              has_attachments: !!email.hasAttachments,
            });
          } catch (_e) { /* best-effort */ }
        }
      } catch (msgErr: any) {
        console.error("MS OAuth sync msg error:", msgErr.message);
      }
    }

    console.log("MS OAuth sync " + accountId + ": done. " + result.newConversations + " new convos, " + result.newMessages + " new msgs");

    if (account.last_sync_at) {
      // Incremental sync — update timestamp
      await supabase.from("email_accounts").update({
        last_sync_at: new Date().toISOString(),
        sync_error: null,
      }).eq("id", accountId);
    } else {
      // Initial sync — save skip offset for next batch, or mark complete if no more
      const skipOffset = parseInt(account.last_sync_uid || "0") || 0;
      const newOffset = skipOffset + messages.length;

      if (messages.length < BATCH_SIZE) {
        // No more messages — initial sync complete
        await supabase.from("email_accounts").update({
          last_sync_at: new Date().toISOString(),
          last_sync_uid: String(newOffset),
          sync_error: null,
        }).eq("id", accountId);
      } else {
        // More messages to fetch — save offset, don't set last_sync_at yet
        await supabase.from("email_accounts").update({
          last_sync_uid: String(newOffset),
          sync_error: null,
        }).eq("id", accountId);
        result.success = true;
        return result;
      }
    }

    result.success = true;
    return result;

  } catch (err: any) {
    console.error("MS OAuth sync error:", err.message);
    await supabase.from("email_accounts").update({ sync_error: err.message }).eq("id", accountId);
    result.errors.push(err.message);
    return result;
  }
}