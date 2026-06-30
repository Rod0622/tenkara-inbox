export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { downloadAttachmentBytes } from "@/lib/attachments-storage";

const MICROSOFT_PROVIDERS = ["microsoft_oauth", "microsoft", "godaddy", "outlook_com"];
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
  const inlineMode = req.nextUrl.searchParams.get("inline") === "1";

  if (!messageId) {
    return NextResponse.json({ error: "message_id is required" }, { status: 400 });
  }

  // 1. Try our own Storage-backed attachments first.
  //
  // READ STRATEGY — via RPC, not a direct table read.
  //
  // History: we originally read attachments with the supabase-js SDK, but it
  // returned only ONE row for multi-row messages, so we switched to a raw
  // PostgREST fetch (`/rest/v1/attachments?message_id=eq.X`). That worked for a
  // long time — but rows inserted by the attachment re-detection backfill turned
  // out to be INVISIBLE to PostgREST's table-read endpoint (a 200 with an empty
  // body), even though the exact same rows are returned by SQL, by triggers, and
  // by an RPC function. RLS is open (USING true), the schema/columns are correct,
  // and the code is identical to known-good versions — so this is a PostgREST
  // table-read layer issue, not application code.
  //
  // The fix: read through a SECURITY DEFINER SQL function
  // (`inbox.get_message_attachments`) called via supabase.rpc(). RPC executes
  // real SQL, which sees every row reliably, sidestepping the broken table-read
  // path. We keep the raw PostgREST fetch as a fallback in case the RPC function
  // is ever missing.
  type AttachmentRow = {
    id: string;
    filename: string;
    mime_type: string | null;
    size_bytes: number | null;
    is_inline: boolean;
    content_id: string | null;
    storage_path: string;
  };
  let ownRows: AttachmentRow[] | null = null;
  let ownErr: { message: string } | null = null;
  let _debugUrl = "";
  let _debugStatus = 0;
  let _debugRawBody = "";

  // Primary path: RPC (reliable — runs real SQL).
  try {
    const { data: rpcRows, error: rpcErr } = await supabase
      .schema("inbox")
      .rpc("get_message_attachments", { p_message_id: messageId });
    if (rpcErr) {
      ownErr = { message: `rpc error: ${rpcErr.message}` };
    } else if (Array.isArray(rpcRows)) {
      ownRows = rpcRows as AttachmentRow[];
    }
  } catch (e: any) {
    ownErr = { message: e?.message || "rpc fetch failed" };
  }

  // Fallback path: raw PostgREST fetch (only if RPC returned nothing usable).
  if (!Array.isArray(ownRows) || ownRows.length === 0) {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/attachments` +
      `?message_id=eq.${encodeURIComponent(messageId)}` +
      `&select=id,filename,mime_type,size_bytes,is_inline,content_id,storage_path`;
    _debugUrl = url;
    const rawRes = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
        "Accept-Profile": "inbox",
      },
    });
    _debugStatus = rawRes.status;
    if (req.nextUrl.searchParams.get("debug") === "1") {
      _debugRawBody = await rawRes.clone().text();
    }
    if (!rawRes.ok) {
      ownErr = { message: `PostgREST status ${rawRes.status}: ${await rawRes.text()}` };
    } else {
      ownRows = await rawRes.json();
    }
  } catch (e: any) {
    ownErr = { message: e?.message || "fetch failed" };
  }
  } // end fallback raw-fetch block

  // TEMP DIAGNOSTIC: ?debug=1 surfaces exactly what the raw PostgREST fetch
  // returned (status, url, body) instead of silently falling through to the
  // Graph fallback. Remove once the empty-list bug is fixed.
  if (req.nextUrl.searchParams.get("debug") === "1") {
    return NextResponse.json({
      debug: true,
      messageId,
      builtUrl: _debugUrl.replace(process.env.NEXT_PUBLIC_SUPABASE_URL || "", "<SUPABASE_URL>"),
      rawStatus: _debugStatus,
      rawBody: _debugRawBody.slice(0, 1000),
      serviceKeyPrefix: (process.env.SUPABASE_SERVICE_ROLE_KEY || "").slice(0, 8),
      serviceKeyLen: (process.env.SUPABASE_SERVICE_ROLE_KEY || "").length,
      ownErr,
      ownRowsCount: Array.isArray(ownRows) ? ownRows.length : null,
    });
  }

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
          contentId: r.content_id || null,
        })),
      });
    }

    // ── Single download ──
    if (attachmentId) {
      // Fetch the requested attachment DIRECTLY by its id, rather than calling
      // .find() against the message's attachment list. The list fetch above can
      // intermittently return a PARTIAL set of rows (the same row-count
      // inconsistency documented for this endpoint), and when the requested
      // attachment wasn't in that partial set, .find() returned undefined and
      // the route 404'd ("Attachment not found") even though the file exists.
      // Querying by primary key returns exactly the one row we need, with no
      // dependency on the list being complete.
      let row: AttachmentRow | null = null;
      try {
        const rowUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/attachments` +
          `?id=eq.${encodeURIComponent(attachmentId)}` +
          `&select=id,filename,mime_type,size_bytes,is_inline,content_id,storage_path` +
          `&limit=1`;
        const rowRes = await fetch(rowUrl, {
          headers: {
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
            "Accept-Profile": "inbox",
          },
        });
        if (rowRes.ok) {
          const rows = await rowRes.json();
          if (Array.isArray(rows) && rows.length > 0) row = rows[0];
        }
      } catch {
        row = null;
      }

      // Fallback: if the direct fetch somehow missed, try the list we already have.
      if (!row) {
        row = (ownRows || []).find((r: any) => r.id === attachmentId) || null;
      }

      if (!row) {
        return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
      }
      const dl = await downloadAttachmentBytes(supabase, row.storage_path);
      if (!dl) {
        return NextResponse.json({ error: "Failed to download attachment from storage" }, { status: 500 });
      }

      // parse=eml — serve a parsed forwarded-email view for the
      // AttachmentPreviewModal. Returns JSON, not raw bytes.
      // The .eml format is RFC822 — we use mailparser (already a dep,
      // used by IMAP sync) to extract headers and body.
      const parse = req.nextUrl.searchParams.get("parse");
      if (parse === "eml") {
        try {
          // Lazy-load mailparser only when needed
          const { simpleParser } = await import("mailparser");
          const parsed = await simpleParser(Buffer.from(dl.bytes));
          const formatAddr = (a: any): string => {
            if (!a) return "";
            if (typeof a === "string") return a;
            if (a.text) return a.text;
            if (Array.isArray(a.value)) {
              return a.value
                .map((v: any) => v.name ? `${v.name} <${v.address}>` : v.address)
                .filter(Boolean)
                .join(", ");
            }
            return "";
          };
          return NextResponse.json({
            from: formatAddr(parsed.from),
            to: formatAddr(parsed.to),
            cc: formatAddr(parsed.cc),
            date: parsed.date ? parsed.date.toUTCString() : "",
            subject: parsed.subject || "",
            body_html: parsed.html || "",
            body_text: parsed.text || "",
            attachments_count: (parsed.attachments || []).length,
          });
        } catch (e: any) {
          return NextResponse.json(
            { error: `Failed to parse email: ${e?.message || "unknown"}` },
            { status: 500 }
          );
        }
      }

      // For inline previews, infer a useful Content-Type from the filename
      // extension when the stored MIME is missing or generic. Browsers won't
      // render application/octet-stream in an <iframe> / <img>; they'd force
      // a download — even when the bytes are a real PDF or image. Many of
      // our attachments came in with octet-stream from the IMAP/Graph layer.
      const inferContentType = (filename: string): string | null => {
        const ext = filename.toLowerCase().slice(filename.lastIndexOf(".") + 1);
        const map: Record<string, string> = {
          pdf: "application/pdf",
          jpg: "image/jpeg", jpeg: "image/jpeg",
          png: "image/png", gif: "image/gif", webp: "image/webp",
          svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
          txt: "text/plain", csv: "text/csv", log: "text/plain",
          md: "text/markdown", json: "application/json", xml: "application/xml",
          yaml: "text/yaml", yml: "text/yaml",
          eml: "message/rfc822",
          html: "text/html", htm: "text/html",
        };
        return map[ext] || null;
      };
      const storedMime = row.mime_type || dl.contentType || "";
      const isGenericMime = !storedMime || storedMime.toLowerCase() === "application/octet-stream";
      const effectiveMime =
        inlineMode && isGenericMime
          ? (inferContentType(row.filename) || storedMime || "application/octet-stream")
          : (storedMime || "application/octet-stream");

      return new NextResponse(new Uint8Array(dl.bytes), {
        headers: {
          "Content-Type": effectiveMime,
          "Content-Disposition": `${inlineMode ? "inline" : "attachment"}; filename="${encodeURIComponent(row.filename)}"`,
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