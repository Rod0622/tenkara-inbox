// ── src/lib/comment-attachments-storage.ts ─────────────────────────────
//
// Helpers for the team-chat attachment feature (Batch 8). Mirrors the
// shape of the email-attachments helper, but uses its own bucket so
// retention, billing, and lifecycle stay clean.
//
// Layout:
//   bucket: `comment-attachments`
//   path:   `{uploader_team_member_id}/{uuid}_{filename}`
//
// Bucket is private — every read goes through a short-lived signed URL.

import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type AnySupabase = SupabaseClient<any, any, any, any, any>;

export const BUCKET = "comment-attachments";

// 50 MB per file. Matches the bucket-side cap in the SQL migration so
// requests over the limit fail fast before reaching Storage.
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

// Block a small set of executable extensions. Everything else (PDFs,
// docs, images, archives) is allowed. We're not building Google Drive
// — this is just a guardrail against accidental .exe drops.
const BLOCKED_EXTENSIONS = [
  ".exe", ".bat", ".cmd", ".com", ".scr", ".pif",
  ".vbs", ".msi", ".sh", ".app", ".dmg", ".jar",
];

export function isBlockedFilename(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return BLOCKED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// Strip path separators + characters that would confuse Supabase Storage.
// Keeps the extension intact so the file downloads with the right type.
export function sanitizeFilename(name: string): string {
  if (!name) return "file.bin";
  const cleaned = name
    .replace(/[\/\\]/g, "_")
    .replace(/[^a-zA-Z0-9._\- ]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 200);
  return cleaned || "file.bin";
}

export interface UploadInput {
  uploaderId: string;     // team_members.id
  filename: string;
  mimeType: string | null;
  content: Buffer;
}

export interface UploadResult {
  ok: boolean;
  storagePath?: string;
  error?: string;
}

/**
 * Upload a single file to the comment-attachments bucket.
 * Does NOT write to the inbox.comment_attachments table — the caller does
 * that so they can choose to roll the insert into a larger transaction.
 */
export async function uploadCommentAttachment(
  supabase: AnySupabase,
  input: UploadInput
): Promise<UploadResult> {
  if (!input.uploaderId) {
    return { ok: false, error: "uploaderId is required" };
  }
  if (input.content.length === 0) {
    return { ok: false, error: "Empty file" };
  }
  if (input.content.length > MAX_FILE_BYTES) {
    return { ok: false, error: `File exceeds 50 MB limit` };
  }
  if (isBlockedFilename(input.filename)) {
    return { ok: false, error: "File type not allowed" };
  }

  const safe = sanitizeFilename(input.filename);
  const storagePath = `${input.uploaderId}/${randomUUID()}_${safe}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, input.content, {
      contentType: input.mimeType || "application/octet-stream",
      upsert: false,
    });

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, storagePath };
}

/**
 * Generate a short-lived signed URL so the browser can fetch the file
 * without exposing the bucket publicly. Default TTL: 1 hour, plenty for
 * rendering inline images + downloading file pills.
 */
export async function signedUrlForAttachment(
  supabase: AnySupabase,
  storagePath: string,
  ttlSeconds = 3600
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, ttlSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

/**
 * Remove a file from Storage. Called when:
 *   - User unattaches a pending file (DELETE /api/comments/attachments?id=...)
 *   - A comment is deleted (cascade — comments DELETE endpoint loops)
 *
 * Best-effort: errors are logged but don't propagate. Storage rows that
 * outlive their DB rows are harmless (just dead bytes).
 */
export async function removeCommentAttachment(
  supabase: AnySupabase,
  storagePath: string
): Promise<void> {
  try {
    const { error } = await supabase.storage
      .from(BUCKET)
      .remove([storagePath]);
    if (error) {
      console.error("[comment-attachments] remove failed:", storagePath, error.message);
    }
  } catch (e: any) {
    console.error("[comment-attachments] remove exception:", e?.message || String(e));
  }
}
