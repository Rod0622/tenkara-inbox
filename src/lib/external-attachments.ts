// ── External-API attachment lookups ─────────────────────────────────────
//
// Shared by:
//   - GET /api/external/conversations/[id]  (attachments array per message)
//   - GET /api/external/attachments/[id]    (metadata lookup before download)
//   - dispatchMessageReceivedWebhook        (attachments array in the payload)
//
// IMPORTANT — DO NOT USE THE SUPABASE JS SDK FOR attachments QUERIES.
// The SDK under-returns rows on inbox.attachments (returns 1 row where the
// DB has several). Proven in src/app/api/attachments/route.ts: SQL Editor →
// 4 rows, SDK → 1 row, raw PostgREST fetch → 4 rows. So every query here
// goes straight to PostgREST with the service-role key + Accept-Profile.
//
// External field shape (FINAL — already promised to Sam; do not change):
//   { id, filename, content_type, size_bytes, is_inline, download_url }
// Never expose storage_path or content_id externally.

export type AttachmentRow = {
  id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  is_inline: boolean;
  content_id: string | null;
  storage_path: string;
};

export type ExternalAttachment = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number | null;
  is_inline: boolean;
  download_url: string;
};

const SELECT_COLUMNS = "id,filename,mime_type,size_bytes,is_inline,content_id,storage_path,message_id";

function postgrestHeaders(): Record<string, string> {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY || ""}`,
    // Service role keys can reach all schemas — Accept-Profile picks "inbox".
    "Accept-Profile": "inbox",
  };
}

/** Map a DB row to the external (Sam-facing) shape. */
export function toExternalAttachment(row: AttachmentRow): ExternalAttachment {
  return {
    id: row.id,
    filename: row.filename,
    content_type: row.mime_type || "application/octet-stream",
    size_bytes: row.size_bytes ?? null,
    is_inline: !!row.is_inline,
    download_url: `/api/external/attachments/${row.id}`,
  };
}

/**
 * Fetch a single attachment row by id. Returns null on not-found OR on any
 * error — callers that need to distinguish should use the throwing variant
 * below. Used by the webhook (best-effort) contexts.
 */
export async function fetchAttachmentRowById(
  attachmentId: string
): Promise<AttachmentRow | null> {
  try {
    return await fetchAttachmentRowByIdOrThrow(attachmentId);
  } catch {
    return null;
  }
}

/**
 * Fetch a single attachment row by id. Throws on transport/PostgREST errors
 * so fail-loud callers (the download route) can return an explicit 5xx.
 * Returns null only for a clean "no such row".
 */
export async function fetchAttachmentRowByIdOrThrow(
  attachmentId: string
): Promise<AttachmentRow | null> {
  const url =
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/attachments` +
    `?id=eq.${encodeURIComponent(attachmentId)}` +
    `&select=${SELECT_COLUMNS}` +
    `&limit=1`;
  // no-store: Next's data cache can otherwise pin an empty response
  // fetched before the attachment rows existed (see /api/attachments).
  const res = await fetch(url, { cache: "no-store", headers: postgrestHeaders() });
  if (!res.ok) {
    throw new Error(`PostgREST status ${res.status}: ${await res.text().catch(() => "")}`);
  }
  const rows = (await res.json()) as AttachmentRow[];
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/**
 * Fetch attachment rows for many messages at once, returned as a map of
 * message_id → rows. Chunked `in.(...)` queries (50 ids per request) keep
 * URLs well under length limits even for 200-message threads.
 *
 * Best-effort by design: any chunk failure is swallowed and those messages
 * simply have no entries in the map (callers default to []). This is the
 * behaviour the webhook needs; the thread-history route accepts it too —
 * a missing attachments list is recoverable, a failed thread fetch is not.
 */
export async function fetchAttachmentsForMessages(
  messageIds: string[]
): Promise<Map<string, AttachmentRow[]>> {
  const byMessage = new Map<string, AttachmentRow[]>();
  if (!messageIds || messageIds.length === 0) return byMessage;

  const CHUNK = 50;
  for (let i = 0; i < messageIds.length; i += CHUNK) {
    const chunk = messageIds.slice(i, i + CHUNK);
    try {
      const idList = chunk.map((id) => encodeURIComponent(id)).join(",");
      const url =
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/attachments` +
        `?message_id=in.(${idList})` +
        `&select=${SELECT_COLUMNS}` +
        `&order=filename.asc`;
      // no-store: Next's data cache can otherwise pin an empty response
  // fetched before the attachment rows existed (see /api/attachments).
  const res = await fetch(url, { cache: "no-store", headers: postgrestHeaders() });
      if (!res.ok) {
        console.error(
          `[external-attachments] chunk fetch failed: PostgREST status ${res.status}`
        );
        continue;
      }
      const rows = (await res.json()) as (AttachmentRow & { message_id: string })[];
      for (const row of rows || []) {
        const list = byMessage.get(row.message_id) || [];
        list.push(row);
        byMessage.set(row.message_id, list);
      }
    } catch (e: any) {
      console.error(`[external-attachments] chunk fetch error: ${e?.message || e}`);
    }
  }
  return byMessage;
}