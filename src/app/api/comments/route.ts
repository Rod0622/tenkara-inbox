import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { notifyMention, notifyWatchers } from "@/lib/notifications";
import { runRulesForEvent } from "@/lib/rule-engine";
import { removeCommentAttachment } from "@/lib/comment-attachments-storage";

// GET /api/comments?conversation_id=xxx
export async function GET(req: NextRequest) {
  const supabase = createServerClient();
  const conversationId = req.nextUrl.searchParams.get("conversation_id");

  if (!conversationId) {
    return NextResponse.json({ error: "conversation_id is required" }, { status: 400 });
  }

  const { data: comments, error } = await supabase
    .from("comments")
    .select(`
      *,
      author:team_members!author_id (id, name, initials, color)
    `)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const commentList = (comments || []) as any[];

  // Fetch attachments for all comments in this conversation in one shot,
  // then sign their URLs and group by comment_id (Batch 8).
  let attachmentsByComment: Record<string, any[]> = {};
  if (commentList.length > 0) {
    const ids = commentList.map(c => c.id);
    const { data: atts } = await supabase
      .from("comment_attachments")
      .select("id, comment_id, uploaded_by, storage_path, filename, mime_type, size_bytes, created_at")
      .in("comment_id", ids)
      .order("created_at", { ascending: true });
    const rows = (atts || []) as any[];
    // Sign in parallel; use the same helper as the dedicated endpoint
    const { signedUrlForAttachment } = await import("@/lib/comment-attachments-storage");
    const withUrls = await Promise.all(rows.map(async (r) => ({
      ...r,
      signed_url: await signedUrlForAttachment(supabase, r.storage_path),
    })));
    for (const a of withUrls) {
      if (!a.comment_id) continue;
      if (!attachmentsByComment[a.comment_id]) attachmentsByComment[a.comment_id] = [];
      attachmentsByComment[a.comment_id].push(a);
    }
  }
  const enriched = commentList.map(c => ({ ...c, attachments: attachmentsByComment[c.id] || [] }));

  return NextResponse.json({ comments: enriched });
}

// POST /api/comments — create a new comment
// Body shape:
//   { conversation_id, author_id, body, mentions?: string[] }
// `mentions` is an array of team_member IDs and/or the special token "@everyone".
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { conversation_id, author_id, body: commentBody, mentions, attachment_ids } = body;

  if (!conversation_id || !author_id || (!commentBody?.trim() && !(Array.isArray(attachment_ids) && attachment_ids.length > 0))) {
    return NextResponse.json(
      { error: "conversation_id, author_id, and either body or attachments are required" },
      { status: 400 }
    );
  }

  // Normalize and de-duplicate mentions array
  const rawMentions: string[] = Array.isArray(mentions) ? mentions : [];
  const cleanedMentions = Array.from(new Set(
    rawMentions
      .filter((m) => typeof m === "string" && m.length > 0)
  ));

  // Pending attachments to link on success — same author must own them.
  const cleanedAttachmentIds: string[] = Array.isArray(attachment_ids)
    ? Array.from(new Set(attachment_ids.filter((a: any) => typeof a === "string" && a.length > 0)))
    : [];

  const { data: comment, error } = await supabase
    .from("comments")
    .insert({
      conversation_id,
      author_id,
      body: (commentBody || "").trim(),
      mentions: cleanedMentions,
    })
    .select(`
      *,
      author:team_members!author_id (id, name, initials, color)
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Link any pending attachments to the new comment. Scoped to the same
  // author so user A can't smuggle user B's pending uploads onto a comment.
  // Pre-flight read so we can fail-gracefully if any id is invalid.
  let linkedAttachments: any[] = [];
  if (cleanedAttachmentIds.length > 0) {
    const { data: pending } = await supabase
      .from("comment_attachments")
      .select("id, uploaded_by, comment_id")
      .in("id", cleanedAttachmentIds);
    const valid = (pending || []).filter(
      (p: any) => p.uploaded_by === author_id && !p.comment_id
    );
    if (valid.length > 0) {
      const { data: linked } = await supabase
        .from("comment_attachments")
        .update({ comment_id: comment.id })
        .in("id", valid.map((v: any) => v.id))
        .select("id, comment_id, uploaded_by, storage_path, filename, mime_type, size_bytes, created_at");
      linkedAttachments = linked || [];
    }
  }

  // Resolve @everyone, @group, and @user mentions to a list of user IDs to notify.
  //
  // The `mentions` payload from the client is an array of opaque strings:
  //   - The literal "@everyone" → expand to all active members
  //   - "group:<uuid>"          → expand to all active members of that group
  //   - "<uuid>"                → a single team_member id (direct mention)
  //
  // Group expansion: look up active members of each group, dedupe across all
  // groups and direct mentions, then exclude the author from the final
  // notify list. Skipped silently if a group id doesn't exist (e.g. deleted
  // between picker open and submit).
  let notifyUserIds: string[] = [];
  const hasEveryone = cleanedMentions.includes("@everyone");
  const groupTokens = cleanedMentions.filter((m) => m.startsWith("group:"));
  const directUserIds = cleanedMentions.filter((m) => m !== "@everyone" && !m.startsWith("group:"));

  if (hasEveryone) {
    const { data: allActive } = await supabase
      .from("team_members")
      .select("id")
      .eq("is_active", true);
    notifyUserIds = (allActive || []).map((m: any) => m.id);
  }

  // Collect group names for the notification title (e.g. "mentioned @Ops")
  // and resolve each group to its active member IDs.
  const groupNames: string[] = [];
  if (groupTokens.length > 0) {
    const groupIds = groupTokens.map((t) => t.slice("group:".length));
    const { data: groups } = await supabase
      .from("user_groups")
      .select("id, name, user_group_members(team_member_id)")
      .in("id", groupIds)
      .eq("is_active", true);

    // Look up active member ids in one query so we can intersect.
    const { data: activeMembers } = await supabase
      .from("team_members")
      .select("id")
      .eq("is_active", true);
    const activeSet = new Set((activeMembers || []).map((m: any) => m.id));

    for (const g of groups || []) {
      groupNames.push((g as any).name);
      const memberIds: string[] = ((g as any).user_group_members || [])
        .map((mm: any) => mm.team_member_id)
        .filter((id: string) => activeSet.has(id));
      for (const uid of memberIds) {
        if (!notifyUserIds.includes(uid)) notifyUserIds.push(uid);
      }
    }
  }

  // Add direct user mentions
  for (const uid of directUserIds) {
    if (!notifyUserIds.includes(uid)) notifyUserIds.push(uid);
  }

  // Don't notify the author of their own message
  notifyUserIds = notifyUserIds.filter((id) => id !== author_id);

  // Fire mention notifications (best-effort).
  // Fetch actor name + conversation subject so the notification has useful context.
  if (notifyUserIds.length > 0) {
    try {
      const [{ data: actor }, { data: convo }] = await Promise.all([
        supabase.from("team_members").select("name").eq("id", author_id).maybeSingle(),
        supabase.from("conversations").select("subject").eq("id", conversation_id).maybeSingle(),
      ]);
      // Determine the most-specific mention type for the notification title.
      // Priority: everyone > group > direct. If multiple kinds were mentioned
      // in the same comment we surface the broadest one so the user knows
      // it's a broad shout-out.
      const mentionType: "direct" | "everyone" | "group" =
        hasEveryone ? "everyone"
        : groupNames.length > 0 ? "group"
        : "direct";
      await notifyMention(notifyUserIds, author_id, commentBody.trim(), conversation_id, {
        actorName: actor?.name || undefined,
        mentionType,
        groupNames: groupNames.length > 0 ? groupNames : undefined,
        conversationSubject: convo?.subject || undefined,
      });
    } catch (notifyErr: any) {
      console.error("[comments/POST] notify error:", notifyErr?.message || notifyErr);
    }
  }

  // Fire event-based rules (new_comment trigger, comment_type: comment)
  try {
    await runRulesForEvent({
      event_type: "new_comment",
      conversation_id,
      initiator_user_id: author_id || null,
      event_key: `new_comment:comment:${comment?.id}`,
      comment_id: comment?.id,
      comment_type: "comment",
      comment_text: commentBody.trim(),
      mentioned_user_ids: cleanedMentions,
    });
  } catch (ruleErr: any) {
    console.error("[comments/POST] rule processing error:", ruleErr?.message || ruleErr);
  }

  // Notify watchers about the new comment (best-effort)
  // Exclude users already notified via @mention to avoid duplicate notifications
  try {
    const previewBody = (commentBody || "").trim().slice(0, 140);
    const attachmentSuffix = linkedAttachments.length > 0
      ? (previewBody ? " · " : "") + `📎 ${linkedAttachments.length} attachment${linkedAttachments.length === 1 ? "" : "s"}`
      : "";
    await notifyWatchers(conversation_id, "comment", {
      title: "New comment in conversation",
      body: previewBody + attachmentSuffix,
      actorId: author_id || null,
      excludeUserIds: notifyUserIds,
    });
  } catch (_e) { /* best-effort */ }

  // ─── Footprint: comment_added ─────────────────────────────────────
  await supabase.from("activity_log").insert({
    conversation_id,
    actor_id: author_id || null,
    action: "comment_added",
    details: {
      comment_id: comment?.id,
      preview: (commentBody || "").trim().slice(0, 80),
      attachment_count: linkedAttachments.length,
    },
  });

  return NextResponse.json({ comment: { ...comment, attachments: linkedAttachments } });
}

// PATCH /api/comments — edit an existing comment's body (author only).
// Body shape: { id, author_id, body }
// We require author_id in the body and check it matches the comment's author
// before allowing the update. No admin override — only the author can edit.
// On a successful edit we set edited_at = now() so the UI can show "(edited)".
//
// We intentionally do NOT re-run mention notifications on edit — would create
// spam when someone edits to fix a typo. Mentions array stays as-is.
export async function PATCH(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { id, author_id, body: newBody } = body || {};

  if (!id || !author_id || !newBody?.trim()) {
    return NextResponse.json({ error: "id, author_id, and body are required" }, { status: 400 });
  }

  // Fetch the comment to verify authorship + get conversation_id for the
  // audit log entry below.
  const { data: existing, error: lookupErr } = await supabase
    .from("comments")
    .select("id, author_id, conversation_id")
    .eq("id", id)
    .maybeSingle();

  if (lookupErr || !existing) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (existing.author_id !== author_id) {
    return NextResponse.json({ error: "Only the author can edit this comment" }, { status: 403 });
  }

  const { data: updated, error } = await supabase
    .from("comments")
    .update({ body: newBody.trim(), edited_at: new Date().toISOString() })
    .eq("id", id)
    .select(`
      *,
      author:team_members!author_id (id, name, initials, color)
    `)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ─── Footprint: comment_edited ────────────────────────────────────
  if (existing.conversation_id) {
    await supabase.from("activity_log").insert({
      conversation_id: existing.conversation_id,
      actor_id: author_id,
      action: "comment_edited",
      details: {
        comment_id: id,
        preview: newBody.trim().slice(0, 80),
      },
    });
  }

  return NextResponse.json({ comment: updated });
}

// DELETE /api/comments?id=X&author_id=Y — delete a comment (author only).
// Same authorship check as PATCH. Hard delete (no soft delete) — keeps the
// data model simple and matches user expectation when they "delete" a chat.
export async function DELETE(req: NextRequest) {
  const supabase = createServerClient();
  const id = req.nextUrl.searchParams.get("id");
  const authorId = req.nextUrl.searchParams.get("author_id");

  if (!id || !authorId) {
    return NextResponse.json({ error: "id and author_id are required" }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("comments")
    .select("id, author_id, conversation_id, body")
    .eq("id", id)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  if (existing.author_id !== authorId) {
    return NextResponse.json({ error: "Only the author can delete this comment" }, { status: 403 });
  }

  // Fetch attachment storage paths BEFORE deleting the comment. The FK
  // cascade will remove the DB rows automatically, but storage objects
  // need explicit cleanup (Postgres doesn't know about Supabase Storage).
  const { data: atts } = await supabase
    .from("comment_attachments")
    .select("storage_path")
    .eq("comment_id", id);
  const storagePaths = ((atts || []) as any[]).map(a => a.storage_path).filter(Boolean);

  const { error } = await supabase.from("comments").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Best-effort storage cleanup in parallel
  await Promise.all(storagePaths.map((p: string) => removeCommentAttachment(supabase, p)));

  // ─── Footprint: comment_deleted ───────────────────────────────────
  if (existing.conversation_id) {
    await supabase.from("activity_log").insert({
      conversation_id: existing.conversation_id,
      actor_id: authorId,
      action: "comment_deleted",
      details: {
        comment_id: id,
        preview: String(existing.body || "").slice(0, 80),
      },
    });
  }
  return NextResponse.json({ ok: true });
}