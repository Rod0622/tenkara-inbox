export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import {
  uploadCommentAttachment,
  signedUrlForAttachment,
  removeCommentAttachment,
  MAX_FILE_BYTES,
  isBlockedFilename,
} from "@/lib/comment-attachments-storage";

// ── /api/comments/attachments ──────────────────────────────────────────
//
// Three handlers powering the team-chat upload flow (Batch 8):
//
//   POST   — multipart upload. Body is FormData with fields:
//              file:     the file blob (required)
//              author_id: team_members.id of the uploader (required)
//            Returns the new attachment row including its id, which the
//            client then sends as part of the comment POST to link it.
//
//   GET    — list attachments for a comment, with short-lived signed
//            URLs. Used by TeamChat when rendering comment bubbles.
//              ?comment_id=<uuid>
//
//   DELETE — unattach a pending file (before its comment is posted).
//            Removes the storage object + the DB row.
//              ?id=<attachment_uuid>&author_id=<uploader_uuid>
//            Only the uploader can unattach (matches comment delete rule).
//            Refuses to delete attachments already linked to a comment —
//            that cascade is handled by deleting the parent comment.

// Lightweight check on FormData size before parsing. Node 18+ supports
// streamed FormData but the cap below guards against memory blow-ups in
// case a client tries to upload a 1GB file by mistake.
const PRE_PARSE_LIMIT_BYTES = MAX_FILE_BYTES + 2 * 1024 * 1024; // 50 MB + 2 MB envelope

export async function POST(req: NextRequest) {
  // Content-length check before reading the body
  const contentLength = parseInt(req.headers.get("content-length") || "0", 10);
  if (contentLength > 0 && contentLength > PRE_PARSE_LIMIT_BYTES) {
    return NextResponse.json({ error: "Upload too large (max 50 MB)" }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (e: any) {
    return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
  }

  const file = formData.get("file");
  const authorId = formData.get("author_id");

  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (typeof authorId !== "string" || !authorId) {
    return NextResponse.json({ error: "author_id is required" }, { status: 400 });
  }
  // Filename comes from File.name when supported. For raw Blob, fall back.
  const filename = (file as any).name ? String((file as any).name) : "file.bin";

  if (isBlockedFilename(filename)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File exceeds 50 MB limit" }, { status: 413 });
  }
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Storage upload first
  const up = await uploadCommentAttachment(supabase, {
    uploaderId: authorId,
    filename,
    mimeType: file.type || null,
    content: buffer,
  });
  if (!up.ok || !up.storagePath) {
    return NextResponse.json({ error: up.error || "Upload failed" }, { status: 500 });
  }

  // Then insert the metadata row. comment_id stays NULL until the
  // accompanying comment POST links it.
  const { data: row, error: insErr } = await supabase
    .from("comment_attachments")
    .insert({
      comment_id: null,
      uploaded_by: authorId,
      storage_path: up.storagePath,
      filename,
      mime_type: file.type || null,
      size_bytes: buffer.length,
    })
    .select("id, comment_id, uploaded_by, storage_path, filename, mime_type, size_bytes, created_at")
    .single();

  if (insErr) {
    // Storage upload succeeded but DB insert failed — best-effort
    // cleanup so we don't leave an orphan file
    await removeCommentAttachment(supabase, up.storagePath);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  // Decorate with a signed URL so the client can preview the upload
  // immediately (e.g. show a thumbnail in the pending tray)
  const signedUrl = await signedUrlForAttachment(supabase, row.storage_path);

  return NextResponse.json({
    attachment: {
      ...row,
      signed_url: signedUrl,
    },
  });
}

export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const commentId = req.nextUrl.searchParams.get("comment_id");
  if (!commentId) {
    return NextResponse.json({ error: "comment_id is required" }, { status: 400 });
  }
  const { data, error } = await supabase
    .from("comment_attachments")
    .select("id, comment_id, uploaded_by, storage_path, filename, mime_type, size_bytes, created_at")
    .eq("comment_id", commentId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const rows = (data || []) as any[];
  // Sign URLs in parallel
  const withUrls = await Promise.all(rows.map(async (r) => ({
    ...r,
    signed_url: await signedUrlForAttachment(supabase, r.storage_path),
  })));
  return NextResponse.json({ attachments: withUrls });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");
  const authorId = req.nextUrl.searchParams.get("author_id");
  if (!id || !authorId) {
    return NextResponse.json({ error: "id and author_id are required" }, { status: 400 });
  }
  const { data: row, error: lookupErr } = await supabase
    .from("comment_attachments")
    .select("id, comment_id, uploaded_by, storage_path")
    .eq("id", id)
    .maybeSingle();
  if (lookupErr) return NextResponse.json({ error: lookupErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
  if (row.uploaded_by !== authorId) {
    return NextResponse.json({ error: "Only the uploader can unattach" }, { status: 403 });
  }
  if (row.comment_id) {
    // Don't allow unattaching from a posted comment — that path goes
    // through deleting the whole comment.
    return NextResponse.json({ error: "Attachment is linked to a posted comment; delete the comment to remove" }, { status: 409 });
  }

  // Storage delete first (idempotent), then DB
  await removeCommentAttachment(supabase, row.storage_path);
  const { error: delErr } = await supabase
    .from("comment_attachments")
    .delete()
    .eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
