import { createHash } from "crypto";

// ── Attachment storage helper ───────────────────────────────────────────────
//
// Single source of truth for writing attachments to Supabase. Used by every
// sync path (IMAP, Gmail API, future Microsoft Graph backfill) so that the
// upload + insert logic stays consistent.
//
// Layout in storage bucket `email-attachments`:
//   {accountId}/{messageId}/{attachmentSlug}--{filename}
//
// The slug is a short hash of the content + index, which ensures uniqueness
// for messages that have multiple attachments with the same filename (e.g.
// "image.png" repeated several times across an HTML email's inline images).

const BUCKET = "email-attachments";

export interface AttachmentUploadInput {
  filename: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentId: string | null;
  checksum: string | null;
  content: Buffer;
}

export interface AttachmentUploadResult {
  ok: boolean;
  storagePath?: string;
  attachmentId?: string;
  skipped?: "duplicate" | "empty";
  error?: string;
}

// Safe filename: collapses spaces, strips path separators and other characters
// that confuse Supabase Storage's path parser. Keeps the extension so the file
// downloads with the right type from the user's perspective.
function sanitizeFilename(name: string): string {
  if (!name) return "attachment.bin";
  const cleaned = name
    .replace(/[\/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._\- ]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 200);
  return cleaned || "attachment.bin";
}

// Stable short hash for filename uniqueness. Not security-sensitive — just
// enough entropy that two same-named attachments don't overwrite each other.
function shortHash(buf: Buffer, fallbackSeed: string): string {
  try {
    return createHash("sha256")
      .update(buf.length > 0 ? buf : Buffer.from(fallbackSeed))
      .digest("hex")
      .slice(0, 12);
  } catch {
    return Math.random().toString(36).slice(2, 14);
  }
}

/**
 * Upload an attachment to Supabase Storage and insert a row in
 * inbox.attachments. Idempotent — re-running on the same message + content
 * returns `skipped: 'duplicate'` instead of creating dupes (via the unique
 * indexes on the table).
 *
 * Errors are reported via the returned object rather than thrown, so a single
 * bad attachment doesn't kill the whole sync run.
 */
export async function uploadAttachmentToStorage(
  supabase: any,
  params: {
    accountId: string;
    messageId: string;
    attachment: AttachmentUploadInput;
    indexInMessage?: number;
  }
): Promise<AttachmentUploadResult> {
  const { accountId, messageId, attachment } = params;
  const indexInMessage = params.indexInMessage ?? 0;

  if (!attachment.content || attachment.content.length === 0) {
    return { ok: false, skipped: "empty" };
  }

  // Compute checksum if mailparser didn't provide one. We use it for dedup
  // on re-sync; the table has a unique index on (message_id, checksum).
  const checksum =
    attachment.checksum ||
    (() => {
      try {
        return createHash("sha256").update(attachment.content).digest("hex");
      } catch {
        return null;
      }
    })();

  // Build the storage path. We prefix the filename with a short content hash
  // so two attachments named "image.png" in the same message don't collide.
  const safeFilename = sanitizeFilename(attachment.filename);
  const hashPrefix = shortHash(attachment.content, `${messageId}:${indexInMessage}:${safeFilename}`);
  const storagePath = `${accountId}/${messageId}/${hashPrefix}--${safeFilename}`;

  // Upload bytes. Use `upsert: true` so re-syncs don't fail on existing files
  // (the unique index on the table is the real idempotency guard; storage
  // just stores the latest bytes for that path).
  try {
    const { error: uploadErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, attachment.content, {
        contentType: attachment.contentType || "application/octet-stream",
        upsert: true,
      });

    if (uploadErr) {
      return { ok: false, error: `storage upload: ${uploadErr.message}` };
    }
  } catch (e: any) {
    return { ok: false, error: `storage upload threw: ${e?.message || "unknown"}` };
  }

  // Insert (or, for a duplicate image already stored on this message, append
  // this cid to the existing row) via the upsert_attachment RPC.
  //
  // Why an RPC: one physical image can be referenced by MULTIPLE cids in a
  // single message (e.g. a signature quoted several times down a reply chain,
  // cids i0_/i1_/i2_). The table dedups identical images per message
  // (UNIQUE(message_id, checksum) / UNIQUE(message_id, filename, size_bytes)),
  // so a plain insert would drop the 2nd/3rd cid and those inline images
  // couldn't resolve. The RPC atomically inserts a new row OR appends the cid
  // to the existing row's content_id[] array, so every cid resolves.
  try {
    const { data, error: rpcErr } = await supabase
      .schema("inbox")
      .rpc("upsert_attachment", {
        p_message_id: messageId,
        p_filename: attachment.filename || safeFilename,
        p_mime_type: attachment.contentType || null,
        p_size_bytes: attachment.size || attachment.content.length,
        p_is_inline: !!attachment.isInline,
        p_content_id: attachment.contentId || null,
        p_storage_path: storagePath,
        p_checksum: checksum,
      });

    if (rpcErr) {
      return { ok: false, error: `db upsert: ${rpcErr.message}` };
    }

    // RPC returns rows of { out_id, action }. action ∈ inserted|appended|unchanged.
    const row = Array.isArray(data) ? data[0] : data;
    const action = row?.action as string | undefined;
    const rowId = row?.out_id as string | undefined;

    // 'unchanged' = the image AND this cid were already stored → a true no-op
    // duplicate (preserve the previous "skipped: duplicate" semantics so
    // backfill stats stay meaningful). 'inserted'/'appended' are real work.
    if (action === "unchanged") {
      return { ok: true, storagePath, attachmentId: rowId, skipped: "duplicate" };
    }
    return { ok: true, storagePath, attachmentId: rowId };
  } catch (e: any) {
    return { ok: false, error: `db upsert threw: ${e?.message || "unknown"}` };
  }
}

/**
 * Fetch a signed download URL for an attachment. Used by the API endpoint
 * to serve files without exposing the bucket publicly.
 *
 * @param expiresIn  Seconds the URL stays valid. Default: 10 minutes.
 */
export async function getAttachmentSignedUrl(
  supabase: any,
  storagePath: string,
  expiresIn = 600
): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, expiresIn);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/**
 * Download attachment bytes directly. Used when the API needs to stream the
 * file back to the user rather than redirect to a signed URL.
 */
export async function downloadAttachmentBytes(
  supabase: any,
  storagePath: string
): Promise<{ bytes: Buffer; contentType: string } | null> {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(storagePath);
    if (error || !data) return null;
    const arrayBuf = await data.arrayBuffer();
    return {
      bytes: Buffer.from(arrayBuf),
      contentType: (data as any).type || "application/octet-stream",
    };
  } catch {
    return null;
  }
}

export const ATTACHMENT_BUCKET = BUCKET;