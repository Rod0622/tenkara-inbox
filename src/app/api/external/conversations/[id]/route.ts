export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { authenticateBearer, hasScope } from "@/lib/api-token-auth";
import { checkAndRecordRateLimit, rateLimitedResponse } from "@/lib/api-token-rate-limit";
import { fetchAttachmentsForMessages, toExternalAttachment } from "@/lib/external-attachments";
import { notifyEmailAssigned, notifyWatchers } from "@/lib/notifications";
import { clearPendingOutreachMarker } from "@/lib/folder-labels";

// ── GET /api/external/conversations/[id] ───────────────────────────────
//
// Bearer-token authenticated. Requires conversations:read scope.
//
// Returns conversation header + ALL messages in the thread, oldest first,
// so the agent can produce contextual drafts.
//
// Response shape:
//   {
//     conversation: { id, subject, from_name, from_email, last_message_at,
//                     email_account_id, account_name, status },
//     messages: [
//       { id, is_outbound, from_email, from_name, to_addresses, cc_addresses,
//         subject, body_text, body_html, sent_at,
//         attachments: [{ id, filename, content_type, size_bytes, is_inline,
//                         download_url }] },
//       ...
//     ]
//   }
//
// The attachments array is best-effort: if the lookup fails the messages
// still return, each with attachments: []. Bytes are fetched via the
// download_url (GET /api/external/attachments/{id}).
//
// Caps messages at 200 to bound the response size. If a thread is longer
// than that (rare), the agent gets the most-recent 200.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await authenticateBearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasScope(token, "conversations:read")) {
    return NextResponse.json(
      { error: "Token missing required scope: conversations:read" },
      { status: 403 }
    );
  }

  const rl = await checkAndRecordRateLimit(token.id, `/api/external/conversations/${params.id}`);
  if (!rl.allowed) return rateLimitedResponse(rl);

  const supabase = createServerClient();

  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select(
      "id, subject, from_name, from_email, last_message_at, email_account_id, status, merged_into, account:email_accounts(name)"
    )
    .eq("id", params.id)
    .maybeSingle();

  if (convoErr) return NextResponse.json({ error: convoErr.message }, { status: 500 });
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  // Most recent 200 messages, then reverse client-side so oldest-first is
  // the natural reading order. Limit + order in one query.
  const { data: msgsDesc, error: msgsErr } = await supabase
    .from("messages")
    .select(
      "id, is_outbound, from_email, from_name, to_addresses, cc_addresses, subject, body_text, body_html, sent_at"
    )
    .eq("conversation_id", params.id)
    .order("sent_at", { ascending: false })
    .limit(200);

  if (msgsErr) return NextResponse.json({ error: msgsErr.message }, { status: 500 });

  const messages = (msgsDesc || []).slice().reverse();

  // Attachments per message — additive, best-effort (failures → []).
  // Raw PostgREST under the hood; see src/lib/external-attachments.ts for
  // why the SDK is not used on the attachments table.
  const attachmentsByMessage = await fetchAttachmentsForMessages(
    messages.map((m: any) => m.id)
  );
  const messagesWithAttachments = messages.map((m: any) => ({
    ...m,
    attachments: (attachmentsByMessage.get(m.id) || []).map(toExternalAttachment),
  }));

  return NextResponse.json({
    conversation: {
      id: convo.id,
      subject: convo.subject,
      from_name: convo.from_name,
      from_email: convo.from_email,
      last_message_at: convo.last_message_at,
      email_account_id: convo.email_account_id,
      account_name: (convo as any).account?.name || null,
      status: convo.status,
      // Merge relationship. When an operator merges thread A INTO thread B,
      // A's messages/tasks/notes/activity are MOVED (conversation_id updated
      // in place — no inserts, so no message.received fires) and A is marked
      // status="merged" with merged_into=B.
      //
      // For a partner tracking conversation ids: a non-null merged_into means
      // this id is now a shell and the live thread is merged_into. Re-fetch
      // that id to pick up messages that moved in — typically a supplier
      // replying from a different domain than we outreached to.
      //
      // Unmerge sets merged_into back to null and status back to open, so
      // polling this field reflects both directions.
      merged_into: (convo as any).merged_into || null,
    },
    messages: messagesWithAttachments,
  });
}

// ── PATCH /api/external/conversations/[id] ─────────────────────────────
//
// Bearer-token authenticated. Requires conversations:write scope.
//
// Sets, changes, or clears the conversation's assignee — the external
// mirror of the in-app assign action, built for Sierra's Control Room
// operator assignments. Body:
//
//   { "assignee_email": "mildred@trytenkara.com" }   → assign / reassign
//   { "assignee_email": null }                       → unassign
//   { "status": "closed" }                           → close (reversible)
//   { "status": "trash" }                            → move to trash
//
// At least one of assignee_email / status must be present; both may be sent
// together. Only "closed" and "trash" are accepted for status — there is no
// "archived" status in this system (Archive is a FOLDER, not a status), and
// open/snoozed/spam/merged are not partner-settable.
//
// status exists for the agent-side "drop lead" flow: deleting the staged
// draft leaves an empty conversation shell that still lists in the operator's
// Inbox (page.tsx treats folder_id IS NULL as belonging to the system Inbox
// view). Closing it removes it from the open view while staying reversible
// and auditable — deliberately not a hard DELETE.
//
// GUARD: status changes are refused when the conversation already has
// messages. The drop-lead case is a never-sent shell (0 messages); once real
// mail exists, hiding the thread is an operator decision, not an agent one.
//
// Keyed by the team member's Tenkara login email (case-insensitive).
// Unlike create (which warns and proceeds), an unmatched email here is a
// hard 422 — assignment is this call's only job, so failing loudly beats
// silently doing nothing.
//
// OWNERSHIP: tokens may only PATCH conversations their own agent created
// (thread_id prefix "external:{token.name}:"). Deliberately stricter than
// GET — writes deserve a tighter gate than reads.
//
// Conventions mirrored from the in-app assign API:
//   - assigning clears folder_id (conversation lives in the assignee's
//     personal inbox); unassigning leaves the folder as-is
//   - "assigned"/"unassigned" activity-log entry (agent named in details;
//     actor falls back to the assignee since agents have no member row)
//   - the new assignee gets the standard "Email assigned to you"
//     notification; watchers with the assignee-change flag are notified
//     with the assignee excluded (no double notification)
//
// Idempotent: PATCHing the current assignee returns 200 with
// changed: false and performs no writes or notifications.
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const token = await authenticateBearer(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasScope(token, "conversations:write")) {
    return NextResponse.json(
      { error: "Token missing required scope: conversations:write" },
      { status: 403 }
    );
  }

  const rl = await checkAndRecordRateLimit(token.id, `/api/external/conversations/${params.id}`);
  if (!rl.allowed) return rateLimitedResponse(rl);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "missing_field", detail: "Invalid JSON body" },
      { status: 400 }
    );
  }
  const hasAssignee = "assignee_email" in (body || {});
  const hasStatus = "status" in (body || {});

  if (!hasAssignee && !hasStatus) {
    return NextResponse.json(
      { error: "missing_field", detail: "at least one of assignee_email or status is required" },
      { status: 400 }
    );
  }

  let assigneeEmail: string | null = null;
  if (hasAssignee) {
    const rawAssignee = body.assignee_email;
    if (rawAssignee !== null && (typeof rawAssignee !== "string" || !rawAssignee.trim())) {
      return NextResponse.json(
        { error: "invalid_field", detail: "assignee_email must be a non-empty string or null" },
        { status: 400 }
      );
    }
    assigneeEmail = rawAssignee === null ? null : rawAssignee.trim().toLowerCase();
  }

  const PARTNER_SETTABLE_STATUSES = ["closed", "trash"];
  let newStatus: string | null = null;
  if (hasStatus) {
    const rawStatus = body.status;
    if (typeof rawStatus !== "string" || !PARTNER_SETTABLE_STATUSES.includes(rawStatus.trim().toLowerCase())) {
      return NextResponse.json(
        {
          error: "invalid_field",
          detail: `status must be one of: ${PARTNER_SETTABLE_STATUSES.join(", ")}`,
        },
        { status: 400 }
      );
    }
    newStatus = rawStatus.trim().toLowerCase();
  }

  const supabase = createServerClient();

  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .select("id, subject, thread_id, assignee_id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (convoErr) return NextResponse.json({ error: convoErr.message }, { status: 500 });
  if (!convo) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });

  const ownedPrefix = `external:${token.name}:`;
  if (!String(convo.thread_id || "").startsWith(ownedPrefix)) {
    return NextResponse.json(
      { error: "forbidden", detail: "This token may only update conversations created by its own agent" },
      { status: 403 }
    );
  }

  // Empty-shell guard for status changes (see header note).
  if (newStatus) {
    const { count: msgCount, error: cntErr } = await supabase
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", convo.id);
    if (cntErr) return NextResponse.json({ error: cntErr.message }, { status: 500 });
    if ((msgCount || 0) > 0) {
      return NextResponse.json(
        {
          error: "conflict",
          detail:
            "status may only be changed on a conversation with no messages. " +
            "This thread has real mail — closing it is an operator decision.",
          message_count: msgCount,
        },
        { status: 409 }
      );
    }
  }

  // Resolve the target assignee (null = unassign).
  let newAssignee: { id: string; name: string } | null = null;
  if (hasAssignee && assigneeEmail) {
    const { data: member } = await supabase
      .from("team_members")
      .select("id, name, email, is_active")
      .ilike("email", assigneeEmail)
      .maybeSingle();
    if (!member || member.is_active === false) {
      return NextResponse.json(
        { error: "assignee_not_found", detail: `assignee_email "${assigneeEmail}" did not match an active team member` },
        { status: 422 }
      );
    }
    newAssignee = { id: member.id, name: member.name };
  }

  const newAssigneeId = hasAssignee ? (newAssignee?.id || null) : (convo.assignee_id || null);
  const assigneeChanged = hasAssignee && (convo.assignee_id || null) !== newAssigneeId;
  const statusChanged = !!newStatus && convo.status !== newStatus;

  // Nothing to do — no writes, no notifications. Preserves the existing
  // assignee-only idempotent behaviour.
  if (!assigneeChanged && !statusChanged) {
    return NextResponse.json({
      success: true,
      conversation_id: convo.id,
      assignee_id: newAssigneeId,
      assignee_name: newAssignee?.name || null,
      status: convo.status,
      changed: false,
    });
  }

  const updatePayload: Record<string, any> = {};
  if (assigneeChanged) {
    updatePayload.assignee_id = newAssigneeId;
    // Assigning moves the conversation to the assignee's personal inbox
    // (folder cleared); unassigning leaves it where it was.
    if (newAssigneeId) updatePayload.folder_id = null;
  }
  if (statusChanged) updatePayload.status = newStatus;

  const { error: updErr } = await supabase
    .from("conversations")
    .update(updatePayload)
    .eq("id", convo.id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Assigning cleared folder_id above, so the "Pending Outreach" folder marker
  // is stale — strip it. This is the exact path that left 28 mislabelled
  // threads on 2026-07-28: agent creates unassigned, then assigns ~2s later.
  if (assigneeChanged && newAssigneeId) {
    await clearPendingOutreachMarker(convo.id);
  }

  // Audit + notifications — best-effort past this point; the assignment
  // itself has already succeeded.
  try {
    const rows: any[] = [];
    if (assigneeChanged) {
      rows.push({
        conversation_id: convo.id,
        actor_id: newAssigneeId || convo.assignee_id,
        action: newAssigneeId ? "assigned" : "unassigned",
        details: {
          assignee_id: newAssigneeId,
          previous_assignee_id: convo.assignee_id || null,
          assigned_by_agent: token.name,
        },
      });
    }
    if (statusChanged) {
      // "closed" matches the in-app close route's action name so both show
      // identically in the activity timeline.
      rows.push({
        conversation_id: convo.id,
        actor_id: null,
        action: newStatus === "closed" ? "closed" : "trashed",
        details: {
          new_status: newStatus,
          previous_status: convo.status,
          changed_by_agent: token.name,
        },
      });
    }
    if (rows.length) await supabase.from("activity_log").insert(rows);
  } catch (e: any) {
    console.error("[external/conversations] PATCH activity log failed:", e?.message);
  }

  try {
    if (assigneeChanged && newAssigneeId) {
      await notifyEmailAssigned(convo.id, newAssigneeId, null, convo.subject || "Conversation");
    }
    if (assigneeChanged) await notifyWatchers(convo.id, "assignee_change", {
      title: newAssignee
        ? `${token.name} assigned this conversation to ${newAssignee.name}`
        : `${token.name} unassigned this conversation`,
      body: convo.subject || undefined,
      actorId: null,
      excludeUserIds: newAssigneeId ? [newAssigneeId] : [],
    });
  } catch (e: any) {
    console.error("[external/conversations] PATCH notify failed:", e?.message);
  }

  return NextResponse.json({
    success: true,
    conversation_id: convo.id,
    assignee_id: newAssigneeId,
    assignee_name: newAssignee?.name || null,
    status: statusChanged ? newStatus : convo.status,
    changed: true,
  });
}