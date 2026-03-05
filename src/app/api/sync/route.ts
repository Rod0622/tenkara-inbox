import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { syncEmailAccount } from "@/lib/imap-sync";
import { createServerClient } from "@/lib/supabase";

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
      const result = await syncEmailAccount(accountId);
      return NextResponse.json(result);
    }

    // Otherwise sync all active accounts
    const { data: accounts } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("is_active", true);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ message: "No active accounts to sync" });
    }

    const results = [];
    for (const account of accounts) {
      const result = await syncEmailAccount(account.id);
      results.push({ accountId: account.id, ...result });
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
