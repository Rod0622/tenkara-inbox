import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { syncEmailAccount } from "@/lib/imap-sync";
import { syncMicrosoftAccount } from "@/lib/microsoft-graph";
import { syncMicrosoftOAuthAccount } from "@/lib/microsoft-oauth-sync";
import { createServerClient } from "@/lib/supabase";

// Determine sync method for an account
function getSyncMethod(account: any): "microsoft_oauth" | "graph" | "imap" {
  // Microsoft OAuth (delegated token via user consent)
  if (account.provider === "microsoft_oauth" && account.oauth_refresh_token) return "microsoft_oauth";
  // Microsoft Graph (application token via Azure AD)
  if (account.provider === "microsoft") return "graph";
  if (account.microsoft_client_id && !account.imap_host) return "graph";
  // Everything else: IMAP
  return "imap";
}

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
        .select("provider, imap_host, imap_password, microsoft_client_id, oauth_refresh_token")
        .eq("id", accountId)
        .single();

      const method = account ? getSyncMethod(account) : "imap";
      console.log(`Sync account ${accountId}: using ${method} (provider: ${account?.provider})`);

      if (method === "microsoft_oauth") {
        const result = await syncMicrosoftOAuthAccount(accountId);
        return NextResponse.json(result);
      } else if (method === "graph") {
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
      .select("id, provider, imap_host, imap_password, microsoft_client_id, oauth_refresh_token")
      .eq("is_active", true);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ message: "No active accounts to sync" });
    }

    const results = [];
    for (const account of accounts) {
      try {
        const method = getSyncMethod(account);
        console.log(`Batch sync ${account.id}: ${method} (provider: ${account.provider})`);

        let result;
        if (method === "microsoft_oauth") {
          result = await syncMicrosoftOAuthAccount(account.id);
        } else if (method === "graph") {
          result = await syncMicrosoftAccount(account.id);
        } else {
          result = await syncEmailAccount(account.id);
        }
        results.push({ accountId: account.id, provider: account.provider, ...result });
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