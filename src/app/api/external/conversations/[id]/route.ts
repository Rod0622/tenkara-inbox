export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { authenticateBearer, hasScope } from "@/lib/api-token-auth";
import { checkAndRecordRateLimit, rateLimitedResponse } from "@/lib/api-token-rate-limit";
import { fetchAttachmentsForMessages, toExternalAttachment } from "@/lib/external-attachments";

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
      "id, subject, from_name, from_email, last_message_at, email_account_id, status, account:email_accounts(name)"
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
    },
    messages: messagesWithAttachments,
  });
}