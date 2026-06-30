export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { refreshGoogleToken } from "@/lib/google-oauth";

// ─── DIAGNOSTIC ─────────────────────────────────────────────────────────────
// Temporary route to inspect WHY attachment detection missed a message.
//
//   GET /api/debug/attachment-mime?message_id=<our-db-message-id>
//
// It looks up the message, finds its Gmail account + provider_message_id,
// refreshes the Gmail token, fetches the message with format=full, and dumps
// the MIME part tree (mimeType / filename / has-body-data / attachmentId for
// every part, recursively). That tells us exactly what hasAttachmentsCheck
// saw and why it returned false.
//
// DELETE THIS ROUTE once the detection bug is understood/fixed.
// ─────────────────────────────────────────────────────────────────────────────

type PartSummary = {
  mimeType: string;
  filename: string;
  hasBodyData: boolean;
  attachmentId: string | null;
  contentId: string | null;
  size: number | null;
  childCount: number;
  children?: PartSummary[];
};

function summarizePart(p: any): PartSummary {
  const headers: Record<string, string> = {};
  for (const h of (p.headers || [])) headers[String(h.name || "").toLowerCase()] = h.value;
  return {
    mimeType: p.mimeType || "",
    filename: p.filename || "",
    hasBodyData: !!(p.body && p.body.data),
    attachmentId: p.body?.attachmentId || null,
    contentId: headers["content-id"] || null,
    size: p.body?.size ?? null,
    childCount: Array.isArray(p.parts) ? p.parts.length : 0,
    children: Array.isArray(p.parts) ? p.parts.map(summarizePart) : undefined,
  };
}

// Mirror of the live detection logic so we can show its verdict.
function hasAttachmentsCheck(parts: any[]): boolean {
  for (const p of parts) {
    if (p.filename && p.filename.length > 0) return true;
    const mt = String(p.mimeType || "").toLowerCase();
    if (mt === "message/rfc822") return true;
    if (Array.isArray(p.parts) && hasAttachmentsCheck(p.parts)) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  const messageId = req.nextUrl.searchParams.get("message_id");
  if (!messageId) {
    return NextResponse.json({ error: "message_id required" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Look up the message + its account
  const { data: msg, error: msgErr } = await supabase
    .from("messages")
    .select("id, provider_message_id, subject, conversation_id, has_attachments")
    .eq("id", messageId)
    .maybeSingle();

  if (msgErr || !msg) {
    return NextResponse.json({ error: "message not found", detail: msgErr?.message }, { status: 404 });
  }

  const { data: convo } = await supabase
    .from("conversations")
    .select("email_account_id")
    .eq("id", msg.conversation_id)
    .maybeSingle();

  const accountId = convo?.email_account_id;
  if (!accountId) {
    return NextResponse.json({ error: "account not found for message" }, { status: 404 });
  }

  const { data: account } = await supabase
    .from("email_accounts")
    .select("id, email, provider")
    .eq("id", accountId)
    .maybeSingle();

  if (!account || account.provider !== "google_oauth") {
    return NextResponse.json({
      error: "this diagnostic only supports google_oauth accounts",
      provider: account?.provider,
    }, { status: 400 });
  }

  // provider_message_id is "gmail:<id>"
  const pmid = String(msg.provider_message_id || "");
  const gmailId = pmid.startsWith("gmail:") ? pmid.slice("gmail:".length) : pmid;

  let token: string;
  try {
    token = await refreshGoogleToken(accountId, true);
  } catch (e: any) {
    return NextResponse.json({ error: "token refresh failed", detail: e?.message }, { status: 500 });
  }

  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${gmailId}?format=full`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    return NextResponse.json({
      error: "gmail fetch failed",
      status: res.status,
      detail: await res.text().catch(() => ""),
    }, { status: 500 });
  }

  const gmailMsg = await res.json();
  const topParts = gmailMsg.payload?.parts || [];

  // What the live detection logic would conclude:
  const detectedHasAttachments = hasAttachmentsCheck(topParts);

  // Also: does the TOP-LEVEL payload itself carry a filename/attachmentId
  // (single-part messages where the attachment is the payload, not in .parts)?
  const topLevelFilename = gmailMsg.payload?.filename || "";
  const topLevelAttachmentId = gmailMsg.payload?.body?.attachmentId || null;
  const topLevelMime = gmailMsg.payload?.mimeType || "";

  return NextResponse.json({
    db: {
      message_id: msg.id,
      subject: msg.subject,
      stored_has_attachments: msg.has_attachments,
      provider_message_id: msg.provider_message_id,
    },
    gmail: {
      topLevelMimeType: topLevelMime,
      topLevelFilename,
      topLevelAttachmentId,
      topLevelHasParts: topParts.length,
      detection_verdict: detectedHasAttachments,
      mimeTree: summarizePart(gmailMsg.payload || {}),
    },
  }, { status: 200 });
}
