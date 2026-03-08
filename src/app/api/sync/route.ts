import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncEmailAccount } from "@/lib/imap-sync";
import { syncMicrosoftAccount } from "@/lib/microsoft-graph";
import { createServerClient } from "@/lib/supabase";

// Providers that use Microsoft Graph instead of IMAP
const MICROSOFT_PROVIDERS = ["microsoft", "godaddy", "outlook_com"];

// POST /api/sync — Sync one or all email accounts
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { accountId } = await req.json().catch(() => ({ accountId: null }));
    const supabase = createServerClient();

    // If specific account, sync just that one
    if (accountId) {
      // Get the account to determine provider
      const { data: account } = await supabase
        .from("email_accounts")
        .select("provider")
        .eq("id", accountId)
        .single();

      if (account && MICROSOFT_PROVIDERS.includes(account.provider)) {
        const result = await syncMicrosoftAccount(accountId);
        return NextResponse.json(result);
      } else {
        const result = await syncEmailAccount(accountId);
        return NextResponse.json(result);
      }
    }

    // Otherwise sync all active accounts
    const { data: accounts } = await supabase
      .from("email_accounts")
      .select("id, provider")
      .eq("is_active", true);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ message: "No active accounts to sync" });
    }

    const results = [];
    for (const account of accounts) {
      try {
        if (MICROSOFT_PROVIDERS.includes(account.provider)) {
          const result = await syncMicrosoftAccount(account.id);
          results.push({ accountId: account.id, provider: account.provider, ...result });
        } else {
          const result = await syncEmailAccount(account.id);
          results.push({ accountId: account.id, provider: account.provider, ...result });
        }
      } catch (err: any) {
        results.push({ accountId: account.id, provider: account.provider, success: false, errors: [err.message] });
      }
    }

    return NextResponse.json({
      synced: results.length,
      results,
    });
  } catch (error: any) {
    console.error("Sync error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}