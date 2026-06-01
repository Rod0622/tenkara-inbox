export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { authenticateBearer, hasScope } from "@/lib/api-token-auth";
import { checkAndRecordRateLimit, rateLimitedResponse } from "@/lib/api-token-rate-limit";

// ── GET /api/external/conversations ─────────────────────────────────────
//
// Bearer-token authenticated endpoint for external integrations (e.g. Sammy's
// drafting agent) to look up conversations.
//
// Requires scope: conversations:read
//
// Query params (all optional, combinable):
//   email           filter to conversations where from_email = X
//                   (use case: "what's the latest thread with supplier@foo.com?")
//   subject_like    case-insensitive substring match on subject
//   account_id      filter to one email account
//   limit           cap on results (default 20, max 100)
//   updated_since   ISO timestamp — only conversations with last_message_at
//                   >= this value. Lets the agent paginate by recency.
//
// Returns: { conversations: [{ id, subject, from_name, from_email, preview,
//             last_message_at, email_account_id, account_name, status }, ...] }
//
// Sensitive fields like assignee_id, internal status, follow-up dates etc.
// are deliberately NOT returned — the external surface is intentionally
// narrower than the internal one.
export async function GET(req: NextRequest) {
  const token = await authenticateBearer(req);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasScope(token, "conversations:read")) {
    return NextResponse.json(
      { error: "Token missing required scope: conversations:read" },
      { status: 403 }
    );
  }

  // Rate limit (Phase 2). Checked AFTER auth so an unauthenticated 401
  // doesn't burn limit budget.
  const rl = await checkAndRecordRateLimit(token.id, "/api/external/conversations");
  if (!rl.allowed) return rateLimitedResponse(rl);

  const url = req.nextUrl;
  const email = url.searchParams.get("email");
  const subjectLike = url.searchParams.get("subject_like");
  const accountId = url.searchParams.get("account_id");
  const updatedSince = url.searchParams.get("updated_since");
  const limitRaw = parseInt(url.searchParams.get("limit") || "20", 10);
  const limit = Math.min(Math.max(isNaN(limitRaw) ? 20 : limitRaw, 1), 100);

  const supabase = createServerClient();
  let query = supabase
    .from("conversations")
    .select(
      "id, subject, from_name, from_email, preview, last_message_at, email_account_id, status, account:email_accounts(name)"
    )
    .neq("status", "trash")
    .neq("status", "merged")
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (email) query = query.eq("from_email", email);
  if (subjectLike) query = query.ilike("subject", `%${subjectLike}%`);
  if (accountId) query = query.eq("email_account_id", accountId);
  if (updatedSince) query = query.gte("last_message_at", updatedSince);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Shape the response. account is a relation — flatten its name onto the
  // top-level so the partner doesn't have to navigate a nested object.
  const conversations = (data || []).map((c: any) => ({
    id: c.id,
    subject: c.subject,
    from_name: c.from_name,
    from_email: c.from_email,
    preview: c.preview,
    last_message_at: c.last_message_at,
    email_account_id: c.email_account_id,
    account_name: c.account?.name || null,
    status: c.status,
  }));

  return NextResponse.json({ conversations });
}
