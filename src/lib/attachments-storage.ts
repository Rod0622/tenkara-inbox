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

  // Insert metadata row. We rely on the table's partial unique indexes:
  //   • UNIQUE (message_id, checksum) WHERE checksum IS NOT NULL
  //   • UNIQUE (message_id, filename, size_bytes) WHERE checksum IS NULL
  // If either fires, we got a duplicate — that's a "skipped" success.
  try {
    const { data, error: insertErr } = await supabase
      .schema("inbox")
      .from("attachments")
      .insert({
        message_id: messageId,
        filename: attachment.filename || safeFilename,
        mime_type: attachment.contentType || null,
        size_bytes: attachment.size || attachment.content.length,
        is_inline: !!attachment.isInline,
        content_id: attachment.contentId || null,
        storage_path: storagePath,
        checksum,
      })
      .select("id")
      .single();

    if (insertErr) {
      // Postgres unique-violation code is "23505". Treat as a successful skip
      // rather than an error — re-sync should be a no-op.
      const code = (insertErr as any).code || "";
      const msg = String(insertErr.message || "").toLowerCase();
      if (code === "23505" || msg.includes("duplicate") || msg.includes("unique")) {
        return { ok: true, storagePath, skipped: "duplicate" };
      }
      return { ok: false, error: `db insert: ${insertErr.message}` };
    }

    return { ok: true, storagePath, attachmentId: data.id };
  } catch (e: any) {
    return { ok: false, error: `db insert threw: ${e?.message || "unknown"}` };
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
