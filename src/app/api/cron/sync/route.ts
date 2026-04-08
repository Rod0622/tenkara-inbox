export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { syncEmailAccount } from "@/lib/imap-sync";
import { syncMicrosoftAccount } from "@/lib/microsoft-graph";
import { syncMicrosoftOAuthAccount } from "@/lib/microsoft-oauth-sync";
import { createServerClient } from "@/lib/supabase";

// Determine sync method for an account
function getSyncMethod(account: any): "microsoft_oauth" | "graph" | "imap" {
  if (account.provider === "microsoft_oauth" && account.oauth_refresh_token) return "microsoft_oauth";
  if (account.provider === "microsoft") return "graph";
  if (account.microsoft_client_id && !account.imap_host) return "graph";
  return "imap";
}

// GET /api/cron/sync — Called by Vercel Cron
// Secured by CRON_SECRET header check
export async function GET(req: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  const supabase = createServerClient();

  const TOTAL_TIME_LIMIT = 55000; // 55s total, leaving 5s margin for the 60s function timeout

  try {
    const { data: accounts, error: accountsError } = await supabase
      .from("email_accounts")
      .select("id, name, email, provider, imap_host, imap_password, microsoft_client_id, oauth_refresh_token")
      .eq("is_active", true);

    console.log(`[cron-sync] Fetched ${accounts?.length || 0} accounts:`, (accounts || []).map((a: any) => `${a.email}=${a.id.slice(0,8)}`).join(", "));
    if (accountsError) console.error(`[cron-sync] accounts query error:`, accountsError.message);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ message: "No active accounts", duration_ms: Date.now() - startTime });
    }

    const results = [];
    for (const account of accounts) {
      // Check if we have enough time left for another account
      const elapsed = Date.now() - startTime;
      if (elapsed > TOTAL_TIME_LIMIT) {
        console.log(`[cron-sync] Skipping ${account.email}: time limit reached (${elapsed}ms elapsed)`);
        results.push({ account: account.email, success: false, error: "Skipped: time limit", duration_ms: 0 });
        continue;
      }

      const remainingMs = TOTAL_TIME_LIMIT - elapsed;
      const accountStart = Date.now();
      try {
        // Verify the account still exists (handle stale IDs from cached queries)
        const { data: verified } = await supabase.from("email_accounts")
          .select("id").eq("id", account.id).maybeSingle();
        
        let syncId = account.id;
        if (!verified) {
          // ID doesn't exist — try to find current account by email
          const { data: byEmail } = await supabase.from("email_accounts")
            .select("id, provider, imap_host, microsoft_client_id, oauth_refresh_token")
            .eq("email", account.email).eq("is_active", true).maybeSingle();
          if (!byEmail) {
            console.log(`[cron-sync] ${account.email}: account deleted, skipping`);
            results.push({ account: account.email, success: false, error: "Account deleted", duration_ms: 0 });
            continue;
          }
          console.log(`[cron-sync] ${account.email}: stale ID ${account.id.slice(0,8)}, using ${byEmail.id.slice(0,8)}`);
          syncId = byEmail.id;
          // Update method based on fresh data
          account = { ...account, ...byEmail };
        }

        const method = getSyncMethod(account);
        console.log(`[cron-sync] ${account.email}: ${method} (id: ${syncId.slice(0,8)})`);

        let result;
        if (method === "microsoft_oauth") {
          result = await syncMicrosoftOAuthAccount(syncId);
        } else if (method === "graph") {
          result = await syncMicrosoftAccount(syncId, remainingMs);
        } else {
          result = await syncEmailAccount(syncId);
        }

        results.push({
          account: account.email,
          method,
          success: result.success !== false,
          newMessages: result.newMessages || 0,
          newConversations: result.newConversations || 0,
          duration_ms: Date.now() - accountStart,
        });
      } catch (err: any) {
        console.error(`[cron-sync] ${account.email} failed:`, err.message);
        results.push({
          account: account.email,
          success: false,
          error: err.message,
          duration_ms: Date.now() - accountStart,
        });
      }
    }

    const totalNew = results.reduce((sum, r) => sum + (r.newMessages || 0), 0);
    const totalFailed = results.filter((r) => !r.success).length;

    console.log(`[cron-sync] Done: ${accounts.length} accounts, ${totalNew} new messages, ${totalFailed} failed, ${Date.now() - startTime}ms`);

    return NextResponse.json({
      synced: accounts.length,
      new_messages: totalNew,
      failed: totalFailed,
      duration_ms: Date.now() - startTime,
      results,
    });
  } catch (error: any) {
    console.error("[cron-sync] Fatal error:", error.message);
    return NextResponse.json({ error: error.message, duration_ms: Date.now() - startTime }, { status: 500 });
  }
}