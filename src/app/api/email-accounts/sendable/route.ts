// src/app/api/email-accounts/sendable/route.ts
//
// GET /api/email-accounts/sendable?conversation_id=<uuid>
//
// Returns the list of email_accounts the current team member is allowed to
// send FROM in the given conversation. Per Q4:
//   - The conversation's original email_account_id is always allowed (the user
//     is reading this conversation, so they can reply on its original account)
//   - PLUS any other email_accounts where this user has account_access.can_send = true
//
// Used by ConversationDetail's reply modal to populate the FROM dropdown.
//
// Each account also returns its current signature so the UI can swap it
// when the FROM changes.

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const session: any = await getServerSession(authOptions);
  if (!session?.teamMember) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const conversationId = url.searchParams.get("conversation_id");

  const supabase = createServerClient();

  // 1. Find which accounts this user has send-access to
  const { data: accessRows, error: accessErr } = await supabase
    .from("account_access")
    .select("email_account_id, can_send")
    .eq("team_member_id", session.teamMember.id)
    .eq("can_send", true);

  if (accessErr) {
    return NextResponse.json({ error: accessErr.message }, { status: 500 });
  }

  const allowedAccountIds = new Set<string>(
    (accessRows || []).map((r: any) => r.email_account_id),
  );

  // 2. Add the conversation's original account if conversation_id was provided
  let conversationAccountId: string | null = null;
  if (conversationId) {
    const { data: convo } = await supabase
      .from("conversations")
      .select("email_account_id")
      .eq("id", conversationId)
      .maybeSingle();
    conversationAccountId = (convo as any)?.email_account_id || null;
    if (conversationAccountId) allowedAccountIds.add(conversationAccountId);
  }

  if (allowedAccountIds.size === 0) {
    return NextResponse.json({ accounts: [], conversation_account_id: null });
  }

  // 3. Fetch each allowed account's display info + signature
  const { data: accounts, error: accountsErr } = await supabase
    .from("email_accounts")
    .select("id, name, email, icon, color, is_active, signature, signature_enabled")
    .in("id", Array.from(allowedAccountIds))
    .eq("is_active", true);

  if (accountsErr) {
    return NextResponse.json({ error: accountsErr.message }, { status: 500 });
  }

  // Sort: conversation's original account first, then alphabetical by name
  const sorted = (accounts || []).slice().sort((a: any, b: any) => {
    if (a.id === conversationAccountId) return -1;
    if (b.id === conversationAccountId) return 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  return NextResponse.json({
    accounts: sorted.map((a: any) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      icon: a.icon,
      color: a.color,
      signature: a.signature || null,
      signature_enabled: !!a.signature_enabled,
      is_conversation_account: a.id === conversationAccountId,
    })),
    conversation_account_id: conversationAccountId,
  });
}
