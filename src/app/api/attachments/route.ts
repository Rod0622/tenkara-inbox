export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { downloadAttachmentBytes } from "@/lib/attachments-storage";

const MICROSOFT_PROVIDERS = ["microsoft", "godaddy", "outlook_com"];
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ─── Endpoint contract ──────────────────────────────────────────────────────
//
// GET /api/attachments?message_id=xxx
//   → List attachments for a message (metadata only; no bytes).
//     Returns: { attachments: [{ id, name, contentType, size, isInline }] }
//
// GET /api/attachments?message_id=xxx&attachment_id=yyy
//   → Stream a single attachment's bytes back to the caller.
//     Response is the file itself with appropriate Content-Type +
//     Content-Disposition headers.
//
// GET /api/attachments?message_id=xxx&download_all=true
//   → Returns base64-encoded data for every non-inline attachment.
//     Used by the "Download all" action; consumed in JS and turned into a ZIP.
//
// Resolution order:
//   1. Our own `inbox.attachments` table + Storage bucket. Works for any
//      provider that has been (re)synced after we shipped attachment capture.
//   2. Microsoft Graph fallback. Only kicks in if (1) returns nothing AND the
//      provider is Microsoft — historically these worked via Graph and we
//      keep that path live so old messages don't 404.
// ────────────────────────────────────────────────────────────────────────────

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

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const messageId = req.nextUrl.searchParams.get("message_id");
  const attachmentId = req.nextUrl.searchParams.get("attachment_id");
  const downloadAll = req.nextUrl.searchParams.get("download_all");

  if (!messageId) {
    return NextResponse.json({ error: "message_id is required" }, { status: 400 });
  }

  // 1. Try our own Storage-backed attachments first.
  const { data: ownRows, error: ownErr } = await supabase
    .schema("inbox")
    .from("attachments")
    .select("id, filename, mime_type, size_bytes, is_inline, content_id, storage_path")
    .eq("message_id", messageId);

  const hasOwnRows = !ownErr && Array.isArray(ownRows) && ownRows.length > 0;

  if (hasOwnRows) {
    // ── List metadata only ──
    if (!attachmentId && !downloadAll) {
      return NextResponse.json({
        attachments: ownRows!.map((r: any) => ({
          id: r.id,
          name: r.filename,
          contentType: r.mime_type || "application/octet-stream",
          size: r.size_bytes || 0,
          isInline: !!r.is_inline,
        })),
      });
    }

    // ── Single download ──
    if (attachmentId) {
      const row = ownRows!.find((r: any) => r.id === attachmentId);
      if (!row) {
        return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
      }
      const dl = await downloadAttachmentBytes(supabase, row.storage_path);
      if (!dl) {
        return NextResponse.json({ error: "Failed to download attachment from storage" }, { status: 500 });
      }
      return new NextResponse(new Uint8Array(dl.bytes), {
        headers: {
          "Content-Type": row.mime_type || dl.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(row.filename)}"`,
          "Content-Length": String(dl.bytes.length),
        },
      });
    }

    // ── Download all (non-inline) as base64 array ──
    if (downloadAll === "true") {
      const nonInline = ownRows!.filter((r: any) => !r.is_inline);
      const allAttachments = [];
      for (const row of nonInline) {
        const dl = await downloadAttachmentBytes(supabase, row.storage_path);
        if (dl) {
          allAttachments.push({
            name: row.filename,
            contentType: row.mime_type || "application/octet-stream",
            size: dl.bytes.length,
            data: dl.bytes.toString("base64"),
          });
        }
      }
      return NextResponse.json({ attachments: allAttachments, format: "base64" });
    }
  }

  // 2. No rows in our own table → fall back to Microsoft Graph for legacy
  //    Microsoft accounts. For everything else, return empty (the message
  //    was synced before attachment capture shipped — needs a backfill run).
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

  const providerMsgId = message.provider_message_id || "";
  const isMicrosoft = MICROSOFT_PROVIDERS.includes(account.provider);

  if (isMicrosoft) {
    return handleGraphAttachments(account.email, providerMsgId, attachmentId, downloadAll === "true");
  }

  // Pre-capture Gmail/IMAP messages. Return empty + a hint so the UI can
  // explain why nothing's here.
  return NextResponse.json({
    attachments: [],
    note: "Attachments for this message were not captured during sync. Run the Attachment Backfill from Settings to re-fetch.",
  });
}

async function handleGraphAttachments(
  userEmail: string,
  providerMsgId: string,
  attachmentId: string | null,
  downloadAll: boolean
) {
  try {
    const token = await getGraphToken();
    const graphMsgId = providerMsgId.replace(/^ms:/, "");
    let graphMessageId = graphMsgId;

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

    if (!attachmentId && !downloadAll) {
      return NextResponse.json({ attachments });
    }

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
      return new NextResponse(new Uint8Array(bytes), {
        headers: {
          "Content-Type": att.contentType || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(att.name)}"`,
          "Content-Length": String(bytes.length),
        },
      });
    }

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