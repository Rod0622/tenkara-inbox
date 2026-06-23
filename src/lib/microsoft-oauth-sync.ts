import { refreshMicrosoftToken } from "@/lib/microsoft-oauth";
import { onNewConversationFromSync, onIncomingMessageReopenCheck } from "@/lib/folder-labels";
import { cleanSubject as cleanSubjectFn } from "@/lib/email";
import { ensureSupplierContact, loadInternalContext, extractFirstEmail, type InternalContext } from "@/lib/supplier-contact-resolver";

// Sync a microsoft_oauth account using delegated Graph API token
export async function syncMicrosoftOAuthAccount(accountId: string): Promise<{
  success: boolean;
  newMessages: number;
  newConversations: number;
  errors: string[];
}> {
  // Use a fresh Supabase client with cache-busting to avoid stale read-replica data
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false },
      db: { schema: "inbox" },
      global: { headers: { "Cache-Control": "no-cache", "x-cache-bust": Date.now().toString() } },
    }
  );
  const result = { success: false, newMessages: 0, newConversations: 0, errors: [] as string[] };

  // Load internal context once per sync run for supplier classification
  const internalCtx: InternalContext = await loadInternalContext(supabase);

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

    // Fetch emails using delegated token (/me/ endpoint).
    // Pagination uses Microsoft's recommended @odata.nextLink cursor rather
    // than self-managed $skip offsets. Outlook Mail's $skip is unreliable for
    // deep paging (it can stop short / repeat on large mailboxes), which is why
    // earlier inbox walks stalled before reaching the oldest mail. We persist
    // the nextLink URL in last_sync_uid between cron runs and resume from it,
    // walking the WHOLE mailbox across ALL folders (/me/messages) to completion.
    // Page size. 250 (vs the old 50) speeds up backfill ~5x — each cron run
    // pages 250 messages following nextLink. Graph allows up to 1000 for
    // /messages, but a large $select payload makes 250 a safe practical size
    // that stays within the per-run time budget. Already-synced messages are
    // dedup-skipped cheaply, so early recent-mail pages process fast.
    const BATCH_SIZE = 250;
    let url: string;
    const fields = "id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,conversationId,internetMessageId";
    // Is last_sync_uid a saved nextLink (a full URL) vs. a legacy numeric offset?
    const savedCursor = (account.last_sync_uid || "").trim();
    const savedNextLink = savedCursor.startsWith("https://") ? savedCursor : "";

    if (account.last_sync_at) {
      // Incremental sync — new messages across ALL folders since last_sync_at.
      // `/me/messages` spans Inbox, Sent, Archive, custom folders. Sent mail is
      // classified outbound downstream via the from==account.email check.
      const syncDate = new Date(account.last_sync_at).toISOString().replace(/\.\d{3}Z$/, "Z");
      url = "https://graph.microsoft.com/v1.0/me/messages?$top=" + BATCH_SIZE + "&$orderby=receivedDateTime desc&$select=" + fields + "&$filter=receivedDateTime ge " + syncDate;
    } else if (savedNextLink) {
      // Initial backfill in progress — resume exactly where we left off by
      // following the saved nextLink (do NOT rebuild the query or extract the
      // skiptoken; Microsoft requires using the nextLink URL verbatim).
      url = savedNextLink;
    } else {
      // Initial backfill, first page — walk ALL folders, newest-first. The
      // server returns @odata.nextLink we then follow to completion.
      url = "https://graph.microsoft.com/v1.0/me/messages?$top=" + BATCH_SIZE + "&$orderby=receivedDateTime desc&$select=" + fields;
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
    // Microsoft's continuation cursor. Present => more pages remain; absent =>
    // we've reached the end of the mailbox (backfill complete).
    const nextLink: string = data["@odata.nextLink"] || "";

    console.log("MS OAuth sync " + accountId + ": fetched " + messages.length + " messages" + (nextLink ? " (more pages)" : " (last page)"));

    if (messages.length === 0) {
      if (account.last_sync_at) {
        // Incremental sync found no new messages — update timestamp.
        await supabase.from("email_accounts").update({ last_sync_at: new Date().toISOString(), sync_error: null }).eq("id", accountId);
      } else if (nextLink) {
        // Empty page but more pages remain — save the cursor and continue next run.
        await supabase.from("email_accounts").update({ last_sync_uid: nextLink, sync_error: null }).eq("id", accountId);
      } else {
        // Initial backfill reached the end — mark complete (switch to incremental).
        await supabase.from("email_accounts").update({
          last_sync_at: new Date().toISOString(),
          sync_error: null,
        }).eq("id", accountId);
        console.log("MS OAuth sync " + accountId + ": initial backfill complete (no more pages)");
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

    // ── OPTIMIZATION: Batch existence check ──
    // Build a Set of provider_message_ids we already have, in one query.
    // Replaces N single-row lookups (one per message) with one IN query.
    const providerIds = messages.map((email: any) => "ms:" + (email.internetMessageId || email.id));
    const existingIds = new Set<string>();
    const BATCH = 200;
    for (let i = 0; i < providerIds.length; i += BATCH) {
      const slice = providerIds.slice(i, i + BATCH);
      const { data: existingRows } = await supabase
        .from("messages")
        .select("provider_message_id")
        .in("provider_message_id", slice);
      for (const row of (existingRows || [])) existingIds.add(row.provider_message_id);
    }
    if (existingIds.size > 0) {
      console.log(`MS OAuth sync ${accountId}: skipping ${existingIds.size}/${messages.length} already-synced messages`);
    }

    // Process each message
    for (const email of messages) {
      try {
        const msgId = email.internetMessageId || email.id;
        const providerId = "ms:" + msgId;

        // Skip messages we already have (checked in batch above)
        if (existingIds.has(providerId)) continue;

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
          const subj = cleanSubjectFn(email.subject || "");
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
          const subj = cleanSubjectFn(email.subject || "") || "(No Subject)";
          // Resolve supplier_contact_id at insert time. Compute the
          // to-addresses string here (the existing version below was AFTER
          // the insert) so we can use it for outbound classification.
          const fromEmailForInsert = email.from?.emailAddress?.address || "";
          const fromNameForInsert  = email.from?.emailAddress?.name    || "";
          const toAddrForLookup    = (email.toRecipients || []).map((r: any) => r.emailAddress?.address).filter(Boolean).join(", ");
          const supplierEmailForLookup = isOutbound ? extractFirstEmail(toAddrForLookup) : fromEmailForInsert;
          const supplierContactId = await ensureSupplierContact(
            supabase,
            supplierEmailForLookup,
            isOutbound ? null : fromNameForInsert,
            internalCtx
          );
          const { data: nc, error: ce } = await supabase.from("conversations").insert({
            email_account_id: accountId,
            thread_id: email.conversationId ? "ms:" + email.conversationId : "ms:" + email.id,
            subject: subj,
            from_name: fromNameForInsert || fromEmailForInsert || "Unknown",
            from_email: fromEmailForInsert,
            preview: (email.bodyPreview || "").slice(0, 200),
            is_unread: !isOutbound,
            status: "open",
            last_message_at: email.receivedDateTime || new Date().toISOString(),
            // Link to supplier_contacts (may be null if internal/transactional/noreply)
            supplier_contact_id: supplierContactId,
          }).select("id").single();

          if (ce) {
            console.error("MS OAuth sync: conversation insert failed:", ce.message, "subject:", email.subject);
            continue;
          }
          conversationId = nc.id;
          result.newConversations++;

          // Auto-apply [account, Inbox] labels (or just [account] for outbound).
          // Best-effort — never throws. Use nc.id directly so TS narrows correctly.
          await onNewConversationFromSync(nc.id, accountId, isOutbound);
        }

        // Insert message — handle both HTML and plain-text body contentTypes.
        // Previously this only honored "html" and fell back to bodyPreview
        // (capped at ~255 chars by Graph), so plain-text emails were truncated.
        const rawBodyContent: string = email.body?.content || "";
        const bodyContentType = (email.body?.contentType || "").toLowerCase();
        const escapeHtml = (s: string) =>
          s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");

        let bodyHtml: string | null = null;
        let bodyText: string;
        if (bodyContentType === "html" && rawBodyContent) {
          bodyHtml = rawBodyContent;
          // Strip <style> and <script> tags AND their contents — otherwise
          // marketing-email CSS rules leak into body_text/snippet/preview.
          bodyText = rawBodyContent
            .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 5000);
        } else if (bodyContentType === "text" && rawBodyContent) {
          bodyText = rawBodyContent.slice(0, 5000);
          bodyHtml = "<div style=\"white-space: pre-wrap;\">" + escapeHtml(rawBodyContent) + "</div>";
        } else {
          bodyText = email.bodyPreview || "";
          bodyHtml = null;
        }
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

        // Reopen rule: inbound message on an existing CLOSED conversation
        // reopens it (auto-assign to last closer if unassigned & closed within
        // 3 business days). Self-guards on status==="closed". Best-effort.
        if (!isOutbound && conversationId) {
          await onIncomingMessageReopenCheck(conversationId, false);
        }

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

        // Note: computeResponseTime moved out of the hot path. It adds 3-4 queries
        // per message and isn't time-critical. A separate background task can compute
        // response times asynchronously. (For now: skipping during sync.)
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
      // Initial backfill — follow the @odata.nextLink cursor.
      if (nextLink) {
        // More pages remain — persist the nextLink and resume next cron run.
        // Do NOT set last_sync_at yet (still backfilling).
        await supabase.from("email_accounts").update({
          last_sync_uid: nextLink,
          sync_error: null,
        }).eq("id", accountId);
        result.success = true;
        return result;
      } else {
        // No nextLink — reached the end of the mailbox. Backfill complete:
        // switch to incremental mode. Clear the cursor.
        await supabase.from("email_accounts").update({
          last_sync_at: new Date().toISOString(),
          last_sync_uid: null,
          sync_error: null,
        }).eq("id", accountId);
        console.log("MS OAuth sync " + accountId + ": initial backfill complete (all pages walked)");
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

// ── Compute response time for latest message in a conversation ──
async function computeResponseTime(supabase: any, conversationId: string) {
  try {
    const { data: convo } = await supabase
      .from("conversations")
      .select("id, email_account_id, assignee_id")
      .eq("id", conversationId)
      .single();
    if (!convo) return;

    const { data: messages } = await supabase
      .from("messages")
      .select("id, from_email, is_outbound, sent_at, sent_by_user_id")
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true });

    if (!messages || messages.length < 2) return;

    const newMsg = messages[messages.length - 1];
    let triggerMsg = null;
    for (let i = messages.length - 2; i >= 0; i--) {
      if (messages[i].is_outbound !== newMsg.is_outbound) {
        triggerMsg = messages[i];
        break;
      }
    }
    if (!triggerMsg) return;

    const diffMinutes = (new Date(newMsg.sent_at).getTime() - new Date(triggerMsg.sent_at).getTime()) / (1000 * 60);
    if (diffMinutes <= 0 || diffMinutes > 30 * 24 * 60) return;

    const { data: existing } = await supabase
      .from("response_times")
      .select("id")
      .eq("trigger_message_id", triggerMsg.id)
      .eq("response_message_id", newMsg.id)
      .maybeSingle();
    if (existing) return;

    const supplierEmail = triggerMsg.is_outbound
      ? newMsg.from_email?.toLowerCase()
      : triggerMsg.from_email?.toLowerCase();
    const supplierDomain = supplierEmail ? supplierEmail.split("@")[1] || null : null;
    const direction = triggerMsg.is_outbound ? "supplier_reply" : "team_reply";
    const teamMemberId = direction === "team_reply"
      ? (newMsg.sent_by_user_id || convo.assignee_id || null)
      : null;

    await supabase.from("response_times").insert({
      conversation_id: conversationId,
      email_account_id: convo.email_account_id,
      direction,
      trigger_message_id: triggerMsg.id,
      trigger_sent_at: triggerMsg.sent_at,
      response_message_id: newMsg.id,
      response_sent_at: newMsg.sent_at,
      response_minutes: Math.round(diffMinutes * 10) / 10,
      response_business_minutes: null,
      supplier_email: supplierEmail || null,
      supplier_domain: supplierDomain || null,
      team_member_id: teamMemberId,
    });
  } catch (_err) { /* non-critical */ }
}