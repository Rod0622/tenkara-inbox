export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { syncEmailAccount } from "@/lib/imap-sync";
import { syncMicrosoftAccount } from "@/lib/microsoft-graph";
import { syncMicrosoftOAuthAccount } from "@/lib/microsoft-oauth-sync";
import { createServerClient } from "@/lib/supabase";

// Determine sync method for an account
function getSyncMethod(account: any): "microsoft_oauth" | "graph" | "imap" {
  // Prefer OAuth paths over IMAP — they're more reliable
  if (account.provider === "microsoft_oauth" && account.oauth_refresh_token) return "microsoft_oauth";
  if (account.provider === "google_oauth" && account.oauth_refresh_token) return "imap"; // routes to Gmail API inside syncEmailAccount
  if (account.provider === "microsoft") return "graph";
  if (account.microsoft_client_id) return "graph";
  // Fallback to IMAP (plain password auth)
  if (account.imap_host && account.imap_password) return "imap";
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
    // Create a fresh Supabase client to avoid any connection pool caching
    const { createClient } = await import("@supabase/supabase-js");
    const freshSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false }, db: { schema: "inbox" }, global: { headers: { "Cache-Control": "no-cache", "x-cache-bust": Date.now().toString() } } }
    );

    const { data: accounts, error: accountsError } = await freshSupabase
      .from("email_accounts")
      .select("id, name, email, provider, imap_host, imap_password, microsoft_client_id, oauth_refresh_token, last_sync_at")
      .eq("is_active", true);

    console.log(`[cron-sync] Fetched ${accounts?.length || 0} accounts:`, (accounts || []).map((a: any) => `${a.email}=${a.id.slice(0,8)}`).join(", "));
    // Debug: log what each account looks like for sync method detection
    for (const a of (accounts || [])) {
      const method = getSyncMethod(a);
      console.log(`[cron-sync] ${a.email}: ${method} (id: ${a.id.slice(0,8)}, provider=${a.provider}, imap_host=${a.imap_host || "null"}, has_imap_pw=${!!a.imap_password}, ms_client=${!!a.microsoft_client_id}, has_oauth_rt=${!!a.oauth_refresh_token})`);
    }
    if (accountsError) console.error(`[cron-sync] accounts query error:`, accountsError.message);

    if (!accounts || accounts.length === 0) {
      return NextResponse.json({ message: "No active accounts", duration_ms: Date.now() - startTime });
    }

    // Skip-if-recent guard: if an account was synced less than this long ago,
    // skip it to avoid redundant work when crons overlap or trigger close together.
    // Cron is scheduled every 5 minutes (300s); minimum gap of 4 minutes lets
    // long-running syncs from the previous tick wrap up before we start another.
    const MIN_SYNC_GAP_MS = 4 * 60 * 1000;

    const results = [];
    for (let account of accounts) {
      // Check if we have enough time left for another account
      const elapsed = Date.now() - startTime;
      if (elapsed > TOTAL_TIME_LIMIT) {
        console.log(`[cron-sync] Skipping ${account.email}: time limit reached (${elapsed}ms elapsed)`);
        results.push({ account: account.email, success: false, error: "Skipped: time limit", duration_ms: 0 });
        continue;
      }

      // Skip if synced recently (avoids redundant work from overlapping cron triggers)
      if (account.last_sync_at) {
        const sinceLast = Date.now() - new Date(account.last_sync_at).getTime();
        if (sinceLast < MIN_SYNC_GAP_MS) {
          console.log(`[cron-sync] Skipping ${account.email}: synced ${Math.round(sinceLast / 1000)}s ago (min gap ${MIN_SYNC_GAP_MS / 1000}s)`);
          results.push({ account: account.email, success: true, skipped: "recent_sync", duration_ms: 0 });
          continue;
        }
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

    // Note: unread-alert check moved to a separate hourly cron at /api/cron/unread-alerts.
    // Keeping it in the every-5-minutes sync was paginating through thousands of unread
    // conversations 288 times per day, eating disk I/O budget for almost no benefit
    // (the alerts already had a 24-hour cooldown, so 99% of runs did nothing useful).

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