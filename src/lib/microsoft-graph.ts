import { createServerClient } from "@/lib/supabase";

// ── Microsoft Graph Client Credentials ──────────────
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_TENANT_ID = process.env.MICROSOFT_TENANT_ID || "";
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

interface GraphToken {
  access_token: string;
  expires_in: number;
  token_type: string;
}

interface GraphMessage {
  id: string;
  subject: string;
  from: { emailAddress: { name: string; address: string } };
  toRecipients: { emailAddress: { name: string; address: string } }[];
  ccRecipients: { emailAddress: { name: string; address: string } }[];
  body: { contentType: string; content: string };
  bodyPreview: string;
  receivedDateTime: string;
  sentDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  conversationId: string;
  internetMessageId: string;
  parentFolderId: string;
}

// ── Get access token via client credentials flow ─────
export async function getGraphToken(
  credentials?: { clientId?: string; tenantId?: string; clientSecret?: string }
): Promise<string> {
  const clientId = credentials?.clientId || MICROSOFT_CLIENT_ID;
  const tenantId = credentials?.tenantId || MICROSOFT_TENANT_ID;
  const clientSecret = credentials?.clientSecret || MICROSOFT_CLIENT_SECRET;

  if (!clientId || !tenantId || !clientSecret) {
    throw new Error("Microsoft Graph credentials not configured. Provide per-account credentials or set MICROSOFT_CLIENT_ID, MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_SECRET env vars.");
  }

  const tokenUrl = "https://login.microsoftonline.com/" + tenantId + "/oauth2/v2.0/token";

  const params = new URLSearchParams({
    client_id: clientId,
    scope: "https://graph.microsoft.com/.default",
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error("Token request failed: " + (err.error_description || err.error || res.statusText));
  }

  const data: GraphToken = await res.json();
  return data.access_token;
}

// Helper to get credentials for a specific account from Supabase
export async function getAccountCredentials(accountId: string) {
  const supabase = createServerClient();
  const { data: account } = await supabase
    .from("email_accounts")
    .select("microsoft_client_id, microsoft_tenant_id, microsoft_client_secret")
    .eq("id", accountId)
    .single();

  if (account?.microsoft_client_id && account?.microsoft_tenant_id && account?.microsoft_client_secret) {
    return {
      clientId: account.microsoft_client_id,
      tenantId: account.microsoft_tenant_id,
      clientSecret: account.microsoft_client_secret,
    };
  }
  return undefined; // Fall back to env vars
}

// Get token for a specific email account (checks per-account creds first, then env vars)
export async function getGraphTokenForAccount(accountId: string): Promise<string> {
  const creds = await getAccountCredentials(accountId);
  return getGraphToken(creds);
}

// Get token by email address (looks up account in DB)
export async function getGraphTokenForEmail(email: string): Promise<string> {
  const supabase = createServerClient();
  const { data: account } = await supabase
    .from("email_accounts")
    .select("microsoft_client_id, microsoft_tenant_id, microsoft_client_secret")
    .eq("email", email.toLowerCase())
    .single();

  const creds = (account?.microsoft_client_id && account?.microsoft_tenant_id && account?.microsoft_client_secret)
    ? { clientId: account.microsoft_client_id, tenantId: account.microsoft_tenant_id, clientSecret: account.microsoft_client_secret }
    : undefined;

  return getGraphToken(creds);
}

// ── Fetch emails from a mailbox ─────────────────────
export async function fetchGraphEmails(
  userEmail: string,
  sinceDateTime?: string,
  top: number = 50
): Promise<GraphMessage[]> {
  const token = await getGraphTokenForEmail(userEmail);

  // Per-page size (Graph max is 1000, but 50 is safe for body content)
  const pageSize = Math.min(top, 50);
  let url = `${GRAPH_BASE}/users/${userEmail}/messages?$top=${pageSize}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,ccRecipients,body,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,conversationId,internetMessageId,parentFolderId`;

  // Only fetch emails since last sync
  if (sinceDateTime) {
    // Graph API requires format: yyyy-MM-ddTHH:mm:ssZ (no milliseconds)
    const cleanDate = new Date(sinceDateTime).toISOString().replace(/\.\d{3}Z$/, "Z");
    url += `&$filter=receivedDateTime ge ${cleanDate}`;
  }

  const messages: GraphMessage[] = [];
  let nextLink: string | null = url;

  while (nextLink) {
    const res: Response = await fetch(nextLink, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Graph API error: ${err.error?.message || res.statusText}`);
    }

    const data = await res.json();
    messages.push(...(data.value || []));

    // Pagination
    nextLink = data["@odata.nextLink"] || null;

    // Safety limit
    if (messages.length >= top) break;
  }

  return messages;
}

// ── Send email via Graph API ────────────────────────
export async function sendGraphEmail(
  fromEmail: string,
  to: string,
  subject: string,
  body: string,
  cc?: string,
  attachments?: { name: string; type: string; data: string }[]
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const token = await getGraphTokenForEmail(fromEmail);

  const toRecipients = to.split(",").map((addr) => ({
    emailAddress: { address: addr.trim() },
  }));

  const ccRecipients = cc
    ? cc.split(",").map((addr) => ({
        emailAddress: { address: addr.trim() },
      }))
    : [];

  const message: any = {
    subject,
    body: {
      contentType: "HTML",
      content: body.replace(/\n/g, "<br>"),
    },
    toRecipients,
  };

  if (ccRecipients.length > 0) {
    message.ccRecipients = ccRecipients;
  }

  if (attachments && attachments.length > 0) {
    message.attachments = attachments.map((att) => ({
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: att.name,
      contentType: att.type || "application/octet-stream",
      contentBytes: att.data,
    }));
  }

  const res = await fetch(`${GRAPH_BASE}/users/${fromEmail}/sendMail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return {
      success: false,
      error: err.error?.message || res.statusText,
    };
  }

  return { success: true };
}


// ── Sync a Microsoft account (multi-batch for Pro 60s timeout) ──
export async function syncMicrosoftAccount(accountId: string, timeBudgetMs?: number): Promise<{
  success: boolean;
  newMessages: number;
  newConversations: number;
  errors: string[];
  hasMore?: boolean;
}> {
  const supabase = createServerClient();
  const result = { success: false, newMessages: 0, newConversations: 0, errors: [] as string[], hasMore: false };

  try {
    const { data: account, error: accErr } = await supabase
      .from("email_accounts").select("*").eq("id", accountId).single();

    if (accErr || !account) { result.errors.push("Account not found"); return result; }

    const BATCH_SIZE = 50;
    const MAX_BATCHES = 10; // Up to 500 emails per sync call
    const TIME_LIMIT_MS = timeBudgetMs ? Math.min(timeBudgetMs - 2000, 55000) : 50000; // Leave 2s margin
    const syncStart = Date.now();
    const token = await getGraphTokenForAccount(accountId);
    const isInitialSync = !account.last_sync_at;

    // Skip rules during bulk initial sync to save time
    let runRulesFn: any = null;
    if (!isInitialSync) {
      const mod = await import("@/lib/rule-engine");
      runRulesFn = mod.runRulesForMessage;
    }

    let batchCount = 0;
    let currentSkipOffset = parseInt(account.last_sync_uid || "0") || 0;

    while (batchCount < MAX_BATCHES) {
      // Time check — stop if we're running out of time
      if (Date.now() - syncStart > TIME_LIMIT_MS) {
        console.log(`[graph-sync] ${account.email}: time limit reached after ${batchCount} batches`);
        result.hasMore = true;
        break;
      }

      let emails: GraphMessage[];

      if (isInitialSync) {
        // Initial bulk sync with skip offset
        const pageUrl = `${GRAPH_BASE}/users/${account.email}/messages?$top=${BATCH_SIZE}&$skip=${currentSkipOffset}&$orderby=receivedDateTime desc&$select=id,subject,from,toRecipients,ccRecipients,bodyPreview,receivedDateTime,sentDateTime,isRead,hasAttachments,conversationId,internetMessageId`;

        const res: Response = await fetch(pageUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(`Graph API error: ${err.error?.message || res.statusText}`);
        }
        const data = await res.json();
        emails = data.value || [];
        result.hasMore = emails.length >= BATCH_SIZE;
      } else {
        // Incremental sync — fetch all new emails since last sync, one batch only
        emails = await fetchGraphEmails(account.email, account.last_sync_at, BATCH_SIZE);
        // Incremental doesn't loop
        batchCount = MAX_BATCHES; // Will exit loop after processing
      }

      if (emails.length === 0) {
        result.hasMore = false;
        break;
      }

      // Process emails in this batch
      let batchNewCount = 0;
      for (const email of emails) {
        try {
          const msgId = email.internetMessageId || email.id;
          const { data: existing } = await supabase.from("messages")
            .select("id").eq("provider_message_id", `ms:${msgId}`).maybeSingle();
          if (existing) continue;

          const isOutbound = email.from?.emailAddress?.address?.toLowerCase() === account.email.toLowerCase();
          let conversationId: string | null = null;

          // Thread by Graph conversationId
          if (email.conversationId) {
            const { data: c } = await supabase.from("conversations").select("id")
              .eq("thread_id", `ms:${email.conversationId}`).eq("email_account_id", accountId).maybeSingle();
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
              thread_id: email.conversationId ? `ms:${email.conversationId}` : `ms:${email.id}`,
              subject: subj,
              from_name: email.from?.emailAddress?.name || email.from?.emailAddress?.address || "Unknown",
              from_email: email.from?.emailAddress?.address || "",
              preview: (email.bodyPreview || "").slice(0, 200),
              is_unread: !isOutbound, status: "open",
              last_message_at: email.receivedDateTime || new Date().toISOString(),
            }).select("id").single();
            if (ce) { result.errors.push(ce.message); continue; }
            conversationId = nc.id;
            result.newConversations++;
          }

          const bodyText = email.bodyPreview || (email.body?.content || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
          const toAddr = (email.toRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean).join(", ");
          const ccAddr = (email.ccRecipients || []).map((r) => r.emailAddress?.address).filter(Boolean).join(", ");

          const { error: me } = await supabase.from("messages").insert({
            conversation_id: conversationId, provider_message_id: `ms:${msgId}`,
            from_name: email.from?.emailAddress?.name || "Unknown",
            from_email: email.from?.emailAddress?.address || "",
            to_addresses: toAddr, cc_addresses: ccAddr,
            subject: email.subject || "(No Subject)",
            body_text: bodyText.slice(0, 5000),
            body_html: null,
            snippet: bodyText.slice(0, 200),
            is_outbound: isOutbound, has_attachments: email.hasAttachments || false,
            sent_at: email.sentDateTime || email.receivedDateTime || new Date().toISOString(),
          });
          if (me) { result.errors.push(me.message); continue; }

          const convoUpdate: any = {
            preview: (email.bodyPreview || bodyText).slice(0, 200),
            last_message_at: email.receivedDateTime || new Date().toISOString(),
            is_unread: !isOutbound,
          };
          if (email.hasAttachments) convoUpdate.has_attachments = true;

          await supabase.from("conversations").update(convoUpdate).eq("id", conversationId);

          if (runRulesFn && conversationId) {
            try {
              await runRulesFn(conversationId, {
                conversation_id: conversationId, subject: email.subject || "",
                from_email: email.from?.emailAddress?.address || "",
                from_name: email.from?.emailAddress?.name || "",
                to_addresses: toAddr, body_text: bodyText,
              }, isOutbound ? "outgoing" : "incoming");
            } catch (re: any) { console.error("Rule error:", re.message); }
          }

          result.newMessages++;
          batchNewCount++;
        } catch (ee: any) { result.errors.push(ee.message); }
      }

      // Advance offset for initial sync
      if (isInitialSync) {
        currentSkipOffset += emails.length;
        // Save progress after each batch so we don't lose work if we time out
        await supabase.from("email_accounts").update({
          last_sync_uid: currentSkipOffset.toString(),
          sync_error: result.errors.length > 0 ? result.errors[0] : null,
        }).eq("id", accountId);
      }

      batchCount++;
      console.log(`[graph-sync] ${account.email}: batch ${batchCount}, offset ${currentSkipOffset}, +${batchNewCount} new (${result.newMessages} total), ${Date.now() - syncStart}ms`);

      // If this batch was less than full, we've reached the end
      if (!result.hasMore) break;
    }

    // Final sync state update
    if (isInitialSync && !result.hasMore) {
      // Initial sync complete — set last_sync_at so future syncs are incremental
      await supabase.from("email_accounts").update({
        last_sync_at: new Date().toISOString(),
        last_sync_uid: currentSkipOffset.toString(),
        sync_error: null,
      }).eq("id", accountId);
      console.log(`[graph-sync] ${account.email}: initial sync COMPLETE at offset ${currentSkipOffset}`);
    } else if (!isInitialSync) {
      await supabase.from("email_accounts").update({
        last_sync_at: new Date().toISOString(),
        sync_error: result.errors.length > 0 ? result.errors[0] : null,
      }).eq("id", accountId);
    }

    result.success = true;
  } catch (err: any) {
    result.errors.push(err.message);
    const s2 = createServerClient();
    await s2.from("email_accounts").update({ sync_error: err.message }).eq("id", accountId);
  }

  return result;
}