export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

const MICROSOFT_PROVIDERS = ["microsoft", "godaddy", "outlook_com"];
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// Get Graph token
async function getGraphToken(): Promise<string> {
  const params = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID || "",
    scope: "https://graph.microsoft.com/.default",
    client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
    grant_type: "client_credentials",
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() }
  );
  if (!res.ok) throw new Error("Token request failed");
  const data = await res.json();
  return data.access_token;
}

// GET /api/attachments?message_id=xxx — List attachments for a message
// GET /api/attachments?message_id=xxx&attachment_id=yyy — Download specific attachment
// GET /api/attachments?message_id=xxx&download_all=true — Download all as ZIP
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const messageId = req.nextUrl.searchParams.get("message_id");
  const attachmentId = req.nextUrl.searchParams.get("attachment_id");
  const downloadAll = req.nextUrl.searchParams.get("download_all");

  if (!messageId) {
    return NextResponse.json({ error: "message_id is required" }, { status: 400 });
  }

  // Get message and its account
  const { data: message, error: msgErr } = await supabase
    .from("messages")
    .select("*, conversation:conversations(email_account_id)")
    .eq("id", messageId)
    .single();

  if (msgErr || !message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404 });
  }

  const accountId = (message as any).conversation?.email_account_id;
  if (!accountId) {
    return NextResponse.json({ error: "Account not found for message" }, { status: 404 });
  }

  const { data: account } = await supabase
    .from("email_accounts")
    .select("*")
    .eq("id", accountId)
    .single();

  if (!account) {
    return NextResponse.json({ error: "Email account not found" }, { status: 404 });
  }

  // Get the provider message ID (strip ms: prefix for Graph)
  const providerMsgId = message.provider_message_id || "";
  const isMicrosoft = MICROSOFT_PROVIDERS.includes(account.provider);

  if (isMicrosoft) {
    return handleGraphAttachments(account.email, providerMsgId, attachmentId, downloadAll === "true");
  } else {
    // For IMAP-synced messages, attachments aren't stored — would need re-fetch from IMAP
    // For now, return empty since IMAP sync doesn't store attachments
    return NextResponse.json({
      attachments: [],
      note: "IMAP attachment download requires re-fetching from mail server. Currently supported for Microsoft 365 accounts.",
    });
  }
}

async function handleGraphAttachments(
  userEmail: string,
  providerMsgId: string,
  attachmentId: string | null,
  downloadAll: boolean
) {
  try {
    const token = await getGraphToken();

    // Strip the ms: prefix
    const graphMsgId = providerMsgId.replace(/^ms:/, "");
    
    // For Graph API, we need the Graph message ID (not internetMessageId)
    // First try to find message by internetMessageId
    let graphMessageId = graphMsgId;
    
    // If the ID looks like an internetMessageId (contains @ or <), look up the real Graph ID
    if (graphMsgId.includes("@") || graphMsgId.includes("<")) {
      const searchRes = await fetch(
        `${GRAPH_BASE}/users/${userEmail}/messages?$filter=internetMessageId eq '${encodeURIComponent(graphMsgId)}'&$select=id`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.value?.[0]?.id) {
          graphMessageId = searchData.value[0].id;
        }
      }
    }

    // List attachments
    const listRes = await fetch(
      `${GRAPH_BASE}/users/${userEmail}/messages/${graphMessageId}/attachments`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!listRes.ok) {
      const err = await listRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: `Graph API error: ${err.error?.message || listRes.statusText}` },
        { status: 500 }
      );
    }

    const listData = await listRes.json();
    const attachments = (listData.value || []).map((att: any) => ({
      id: att.id,
      name: att.name,
      contentType: att.contentType,
      size: att.size,
      isInline: att.isInline || false,
    }));

    // If just listing attachments
    if (!attachmentId && !downloadAll) {
      return NextResponse.json({ attachments });
    }

    // Download specific attachment — fetch individually to get contentBytes
    if (attachmentId) {
      const attRes = await fetch(
        `${GRAPH_BASE}/users/${userEmail}/messages/${graphMessageId}/attachments/${attachmentId}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!attRes.ok) {
        return NextResponse.json({ error: "Failed to download attachment" }, { status: 500 });
      }
      const att = await attRes.json();

      if (!att.contentBytes) {
        return NextResponse.json({ error: "Attachment has no content" }, { status: 404 });
      }

      const bytes = Buffer.from(att.contentBytes, "base64");
      return new NextResponse(bytes, {
        headers: {
          "Content-Type": att.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(att.name)}"`,
          "Content-Length": String(bytes.length),
        },
      });
    }

    // Download all — fetch each attachment individually
    if (downloadAll) {
      const nonInline = (listData.value || []).filter((att: any) => !att.isInline);
      const allAttachments = [];

      for (const att of nonInline) {
        try {
          const attRes = await fetch(
            `${GRAPH_BASE}/users/${userEmail}/messages/${graphMessageId}/attachments/${att.id}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (attRes.ok) {
            const fullAtt = await attRes.json();
            if (fullAtt.contentBytes) {
              allAttachments.push({
                name: fullAtt.name,
                contentType: fullAtt.contentType,
                size: fullAtt.size,
                data: fullAtt.contentBytes,
              });
            }
          }
        } catch (e) {
          console.error(`Failed to fetch attachment ${att.name}:`, e);
        }
      }

      return NextResponse.json({ attachments: allAttachments, format: "base64" });
    }

    return NextResponse.json({ attachments });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}