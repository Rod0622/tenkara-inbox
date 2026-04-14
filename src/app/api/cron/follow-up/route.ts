export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import nodemailer from "nodemailer";

// Runs every hour to check for unreplied conversations and execute follow-up rules
export async function GET(req: NextRequest) {

  const startTime = Date.now();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "inbox" }, global: { headers: { "Cache-Control": "no-cache" } } }
  );

  const results = { rulesChecked: 0, conversationsChecked: 0, actionsExecuted: 0, errors: [] as string[] };

  try {
    // Get all active follow-up rules (trigger_type = "unreplied")
    const { data: rules, error: rulesErr } = await supabase
      .from("rules")
      .select("*")
      .eq("is_active", true)
      .eq("trigger_type", "unreplied")
      .order("sort_order");

    if (rulesErr) {
      console.error("[follow-up] Rules query error:", rulesErr.message);
      return NextResponse.json({ error: rulesErr.message, duration_ms: Date.now() - startTime }, { status: 500 });
    }

    if (!rules || rules.length === 0) {
      console.log("[follow-up] No active unreplied rules found");
      return NextResponse.json({ message: "No active follow-up rules", duration_ms: Date.now() - startTime });
    }

    results.rulesChecked = rules.length;
    console.log(`[follow-up] Found ${rules.length} unreplied rules:`, rules.map((r: any) => `${r.name} (${r.id.slice(0,8)})`).join(", "));

    // Get all open conversations with their last message info
    const { data: conversations } = await supabase
      .from("conversations")
      .select("id, email_account_id, status, from_email, subject, assignee_id")
      .eq("status", "open");

    console.log(`[follow-up] Found ${conversations?.length || 0} open conversations`);

    if (!conversations || conversations.length === 0) {
      return NextResponse.json({ message: "No open conversations", ...results, duration_ms: Date.now() - startTime });
    }

    // For each conversation, get the last message to determine if we're waiting for reply
    for (const convo of conversations) {
      if (Date.now() - startTime > 50000) break; // time limit

      try {
        // Get last message in this conversation
        const { data: lastMsg } = await supabase
          .from("messages")
          .select("id, from_email, is_outbound, sent_at, created_at")
          .eq("conversation_id", convo.id)
          .order("sent_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!lastMsg || !lastMsg.is_outbound) continue; // skip if last message is inbound or no messages

        const lastMsgTime = new Date(lastMsg.sent_at || lastMsg.created_at).getTime();
        const hoursSinceLastOutbound = (Date.now() - lastMsgTime) / (1000 * 60 * 60);

        // Get follow-up tracking for this conversation
        const { data: trackingRows } = await supabase
          .from("follow_up_tracking")
          .select("*")
          .eq("conversation_id", convo.id);

        results.conversationsChecked++;

        // Check each rule against this conversation
        for (const rule of rules) {
          // Account filter
          if (rule.account_ids?.length > 0 && !rule.account_ids.includes(convo.email_account_id)) continue;

          const conditions = rule.conditions || [];
          const actions = rule.actions || [];

          // Parse conditions
          let requiredHours = 0; // internally we work in hours
          let requiredFollowUpCount: number | null = null;

          for (const cond of conditions) {
            if (cond.field === "time_since_last_outbound" || cond.field === "days_since_last_outbound") {
              // Value format: "3:days" or "2:hours" or "30:minutes" or just "3" (legacy = days)
              const parts = (cond.value || "").split(":");
              const amount = parseFloat(parts[0]) || 0;
              const unit = parts[1] || "days";
              if (unit === "minutes") requiredHours = amount / 60;
              else if (unit === "hours") requiredHours = amount;
              else requiredHours = amount * 24; // days
            } else if (cond.field === "follow_up_count") {
              if (cond.operator === "equals") requiredFollowUpCount = parseInt(cond.value) || 0;
              else if (cond.operator === "greater_than") requiredFollowUpCount = (parseInt(cond.value) || 0) + 0.5; // hack: gt check
              else if (cond.operator === "less_than") requiredFollowUpCount = -(parseInt(cond.value) || 0); // negative = lt
            }
          }

          if (requiredHours <= 0) continue; // must have a time condition

          // Check if enough days have passed
          if (hoursSinceLastOutbound < requiredHours) continue;

          // Get or create tracking for this conversation+rule
          let tracking = (trackingRows || []).find((t: any) => t.rule_id === rule.id);
          const currentFollowUpCount = tracking?.follow_up_count || 0;

          // Check follow-up count condition
          if (requiredFollowUpCount !== null) {
            if (requiredFollowUpCount >= 0 && requiredFollowUpCount < 1) {
              // equals 0
              if (currentFollowUpCount !== 0) continue;
            } else if (requiredFollowUpCount > 0 && requiredFollowUpCount % 1 !== 0) {
              // greater_than N
              if (currentFollowUpCount <= Math.floor(requiredFollowUpCount)) continue;
            } else if (requiredFollowUpCount < 0) {
              // less_than N
              if (currentFollowUpCount >= Math.abs(requiredFollowUpCount)) continue;
            } else {
              // equals N
              if (currentFollowUpCount !== requiredFollowUpCount) continue;
            }
          }

          // Check if we already ran this rule recently (prevent double-firing)
          if (tracking?.last_follow_up_at) {
            const hoursSinceLastAction = (Date.now() - new Date(tracking.last_follow_up_at).getTime()) / (1000 * 60 * 60);
            // Min gap between follow-ups: at least half the required time, but minimum 5 minutes
            const minGapHours = Math.max(requiredHours * 0.5, 5 / 60);
            if (hoursSinceLastAction < minGapHours) continue;
          }

          console.log(`[follow-up] Rule "${rule.name}" matched conversation ${convo.id} (${hoursSinceLastOutbound.toFixed(1)}h, ${currentFollowUpCount} follow-ups)`);

          // Execute actions
          for (const action of actions) {
            try {
              if (action.type === "send_follow_up") {
                await sendFollowUpEmail(supabase, convo, action.value);
                results.actionsExecuted++;
              } else if (action.type === "create_draft") {
                await createDraftNote(supabase, convo, action.value);
                results.actionsExecuted++;
              } else if (action.type === "notify_assignee") {
                await notifyUser(supabase, convo, action.value);
                results.actionsExecuted++;
              }
            } catch (actionErr: any) {
              console.error(`[follow-up] Action ${action.type} failed:`, actionErr.message);
              results.errors.push(`${rule.name}: ${action.type} failed - ${actionErr.message}`);
            }
          }

          // Update tracking
          const now = new Date().toISOString();
          if (tracking) {
            await supabase.from("follow_up_tracking").update({
              follow_up_count: currentFollowUpCount + 1,
              last_follow_up_at: now,
              last_outbound_at: new Date(lastMsg.sent_at || lastMsg.created_at).toISOString(),
              updated_at: now,
            }).eq("id", tracking.id);
          } else {
            await supabase.from("follow_up_tracking").insert({
              conversation_id: convo.id,
              rule_id: rule.id,
              follow_up_count: 1,
              last_follow_up_at: now,
              last_outbound_at: new Date(lastMsg.sent_at || lastMsg.created_at).toISOString(),
              is_active: true,
            });
          }

          // Log activity
          await supabase.from("activity_log").insert({
            conversation_id: convo.id,
            actor_id: null,
            action: "follow_up_executed",
            details: {
              rule_id: rule.id,
              rule_name: rule.name,
              follow_up_number: currentFollowUpCount + 1,
              hours_since_outbound: Math.round(hoursSinceLastOutbound * 10) / 10,
            },
          });
        }
      } catch (convoErr: any) {
        results.errors.push(`Conversation ${convo.id}: ${convoErr.message}`);
      }
    }

    // Reset tracking when a conversation receives an inbound reply
    // Check conversations that have tracking but received a new inbound message
    const { data: activeTracking } = await supabase
      .from("follow_up_tracking")
      .select("id, conversation_id, last_outbound_at")
      .eq("is_active", true);

    for (const track of (activeTracking || [])) {
      const { data: newestInbound } = await supabase
        .from("messages")
        .select("id, sent_at")
        .eq("conversation_id", track.conversation_id)
        .eq("is_outbound", false)
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (newestInbound && track.last_outbound_at) {
        const inboundTime = new Date(newestInbound.sent_at).getTime();
        const outboundTime = new Date(track.last_outbound_at).getTime();
        if (inboundTime > outboundTime) {
          // Supplier replied! Reset tracking
          await supabase.from("follow_up_tracking").update({
            follow_up_count: 0,
            is_active: false,
            updated_at: new Date().toISOString(),
          }).eq("id", track.id);
        }
      }
    }

    console.log(`[follow-up] Done: ${results.conversationsChecked} conversations, ${results.actionsExecuted} actions, ${results.errors.length} errors, ${Date.now() - startTime}ms`);
    return NextResponse.json({ ...results, duration_ms: Date.now() - startTime });

  } catch (err: any) {
    console.error("[follow-up] Fatal error:", err.message);
    return NextResponse.json({ error: err.message, ...results }, { status: 500 });
  }
}

// ── Action: Send follow-up email using template ──
async function sendFollowUpEmail(supabase: any, convo: any, templateId: string) {
  if (!templateId) throw new Error("No template ID provided");

  // Get template
  const { data: template } = await supabase.from("email_templates").select("*").eq("id", templateId).single();
  if (!template) throw new Error("Template not found: " + templateId);

  // Get account
  const { data: account } = await supabase.from("email_accounts").select("*").eq("id", convo.email_account_id).single();
  if (!account) throw new Error("Account not found");

  const to = convo.from_email;
  const subject = template.subject || `Re: ${convo.subject}`;
  const body = template.body || "";

  // Send via appropriate method
  if (account.provider === "microsoft_oauth" && account.oauth_refresh_token) {
    const { refreshMicrosoftToken } = await import("@/lib/microsoft-oauth");
    const token = await refreshMicrosoftToken(account.id);
    await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "HTML", content: body },
          toRecipients: [{ emailAddress: { address: to } }],
        },
        saveToSentItems: true,
      }),
    });
  } else if (account.smtp_host) {
    const smtpAuth: any = { user: account.smtp_user || account.email };
    if (account.provider === "google_oauth" && account.oauth_refresh_token) {
      const { refreshGoogleToken } = await import("@/lib/google-oauth");
      const accessToken = await refreshGoogleToken(account.id);
      smtpAuth.type = "OAuth2";
      smtpAuth.accessToken = accessToken;
    } else {
      smtpAuth.pass = account.smtp_password || account.imap_password;
    }
    const transport = nodemailer.createTransport({
      host: account.smtp_host, port: account.smtp_port || 587,
      secure: account.smtp_port === 465, auth: smtpAuth,
      tls: { rejectUnauthorized: false },
    });
    await transport.sendMail({
      from: `"${account.name}" <${account.email}>`, to, subject,
      html: body, text: body.replace(/<[^>]*>/g, ""),
    });
  } else {
    throw new Error("No sending method available for account " + account.email);
  }

  // Store sent message
  await supabase.from("messages").insert({
    conversation_id: convo.id,
    provider_message_id: "follow-up:" + Date.now(),
    from_name: account.name, from_email: account.email,
    to_addresses: to, subject,
    body_text: body.replace(/<[^>]*>/g, "").slice(0, 5000),
    body_html: body,
    snippet: body.replace(/<[^>]*>/g, "").slice(0, 200),
    is_outbound: true, has_attachments: false,
    sent_at: new Date().toISOString(),
  });

  // Update conversation
  await supabase.from("conversations").update({
    preview: body.replace(/<[^>]*>/g, "").slice(0, 200),
    last_message_at: new Date().toISOString(),
  }).eq("id", convo.id);

  console.log(`[follow-up] Sent follow-up email to ${to} for conversation ${convo.id}`);
}

// ── Action: Create draft note for user to review ──
async function createDraftNote(supabase: any, convo: any, templateId: string) {
  const { data: template } = await supabase.from("email_templates").select("*").eq("id", templateId).maybeSingle();
  const templateName = template?.name || "follow-up";
  const subject = template?.subject || `Re: ${convo.subject}`;
  const bodyHtml = template?.body || "";

  // Create actual email draft
  await supabase.from("email_drafts").insert({
    conversation_id: convo.id,
    email_account_id: convo.email_account_id,
    author_id: convo.assignee_id || null,
    to_addresses: convo.from_email,
    subject,
    body_html: bodyHtml,
    body_text: bodyHtml.replace(/<[^>]*>/g, "").slice(0, 5000),
    is_reply: true,
    source: "auto_follow_up",
  });

  // Also create a note for visibility
  const noteText = `📧 **Auto Follow-up Draft Created**\n\nTemplate: ${templateName}\nSubject: ${subject}\n\n_A draft has been saved to your Drafts folder. Review and send when ready._`;

  await supabase.from("notes").insert({
    conversation_id: convo.id,
    text: noteText,
    author_id: null,
  });

  // Notify assignee
  if (convo.assignee_id) {
    await supabase.from("notifications").insert({
      user_id: convo.assignee_id,
      conversation_id: convo.id,
      title: "Follow-up draft ready",
      body: `A follow-up draft for "${convo.subject}" is ready in your Drafts.`,
      type: "follow_up",
    });
  }
}

// ── Action: Notify user ──
async function notifyUser(supabase: any, convo: any, targetValue: string) {
  // targetValue can be "assignee" or a specific user ID
  let userId = targetValue;
  if (targetValue === "assignee" || !targetValue) {
    userId = convo.assignee_id;
  }
  if (!userId) {
    // Notify all active admins if no assignee
    const { data: admins } = await supabase.from("team_members").select("id").eq("role", "admin").eq("is_active", true);
    for (const admin of (admins || [])) {
      await supabase.from("notifications").insert({
        user_id: admin.id,
        conversation_id: convo.id,
        title: "No response from supplier",
        body: `"${convo.subject}" — supplier hasn't replied. No assignee set.`,
        type: "follow_up",
      });
    }
    return;
  }

  await supabase.from("notifications").insert({
    user_id: userId,
    conversation_id: convo.id,
    title: "No response from supplier",
    body: `"${convo.subject}" — supplier hasn't replied and needs follow-up.`,
    type: "follow_up",
  });
}