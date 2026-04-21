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
      .select("id, name, email, provider, imap_host, imap_password, microsoft_client_id, oauth_refresh_token")
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

    const results = [];
    for (let account of accounts) {
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

    // ── Check for users with too many unread emails and notify ──
    const UNREAD_THRESHOLD = 5; // Alert when user has 5+ unread assigned emails
    try {
      // Get all active team members
      const { data: members } = await supabase.from("team_members").select("id, name").eq("is_active", true);

      if (members && members.length > 0) {
        // Count unread conversations per assignee — paginate to avoid 1000-row cap
        let allConvos: any[] = [];
        let offset = 0;
        while (true) {
          const { data: batch } = await supabase
            .from("conversations")
            .select("assignee_id")
            .eq("is_unread", true)
            .neq("status", "trash")
            .neq("status", "merged")
            .not("assignee_id", "is", null)
            .range(offset, offset + 998);
          if (!batch || batch.length === 0) break;
          allConvos = allConvos.concat(batch);
          if (batch.length < 999) break;
          offset += 999;
        }

        // Count per user
        const unreadByUser: Record<string, number> = {};
        for (const c of allConvos) {
          unreadByUser[c.assignee_id] = (unreadByUser[c.assignee_id] || 0) + 1;
        }

        // Check which users exceed threshold
        for (const member of members) {
          const count = unreadByUser[member.id] || 0;
          if (count < UNREAD_THRESHOLD) continue;

          // Check if we already sent this alert in the last 24 hours
          const { data: recentAlert } = await supabase
            .from("notifications")
            .select("id")
            .eq("user_id", member.id)
            .eq("type", "unread_alert")
            .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
            .limit(1);

          if (recentAlert && recentAlert.length > 0) continue; // Already alerted recently

          // Create notification
          await supabase.from("notifications").insert({
            user_id: member.id,
            title: `You have ${count} unread emails`,
            body: `${count} assigned emails are waiting for your attention. Please review and respond.`,
            type: "unread_alert",
          });

          console.log(`[cron-sync] Unread alert: ${member.name} has ${count} unread emails`);
        }
      }
    } catch (alertErr: any) {
      console.error("[cron-sync] Unread alert check failed:", alertErr.message);
    }

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