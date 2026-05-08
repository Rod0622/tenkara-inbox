import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { ensureAccountLabels } from "@/lib/folder-labels";

// GET /api/connect/microsoft/callback — Handle Microsoft OAuth callback
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const errorDesc = req.nextUrl.searchParams.get("error_description");
  const baseUrl = process.env.NEXTAUTH_URL || "https://tenkara-inbox-nine.vercel.app";
  const redirectUri = baseUrl + "/api/connect/microsoft/callback";

  if (error) {
    return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Microsoft auth failed: " + (errorDesc || error)));
  }

  if (!code) {
    return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("No authorization code received"));
  }

  // Parse state for display name
  let displayName = "";
  try {
    const stateData = JSON.parse(Buffer.from(state || "", "base64url").toString());
    displayName = stateData.name || "";
  } catch (_e) { /* ignore */ }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID || "",
        client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
        code: code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "openid profile email Mail.Read Mail.ReadWrite Mail.Send offline_access User.Read",
      }).toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      console.error("Microsoft token exchange failed:", err);
      return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Token exchange failed: " + (err.error_description || err.error || "unknown")));
    }

    const tokens = await tokenRes.json();

    if (!tokens.refresh_token) {
      return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("No refresh token received. Please try again."));
    }

    // Get user info (email) from Microsoft Graph
    const meRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });
    const meData = await meRes.json().catch(() => ({}));
    const email = (meData.mail || meData.userPrincipalName || "").toLowerCase();

    if (!email) {
      return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Could not determine email address"));
    }

    // Test mailbox access
    const testRes = await fetch("https://graph.microsoft.com/v1.0/me/messages?$top=1&$select=id", {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });

    if (!testRes.ok) {
      const err = await testRes.json().catch(() => ({}));
      return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Cannot access mailbox: " + (err.error?.message || "permission denied")));
    }

    // Save to database
    const supabase = createServerClient();
    const name = displayName || meData.displayName || email.split("@")[0];

    const accountData = {
      email: email,
      name: name,
      provider: "microsoft_oauth",
      icon: "🟠",
      color: "#D83B01",
      is_active: true,
      sync_error: null,
      oauth_access_token: tokens.access_token,
      oauth_refresh_token: tokens.refresh_token,
      oauth_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
    };

    // Check for existing
    const { data: existing } = await supabase
      .from("email_accounts").select("id").eq("email", email).maybeSingle();

    // Track the account id so we can run the labels hook after either branch.
    let accountId: string | null = null;

    if (existing) {
      const { error: updateErr } = await supabase.from("email_accounts").update(accountData).eq("id", existing.id);
      if (updateErr) {
        return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Failed to save: " + updateErr.message));
      }
      accountId = existing.id;
    } else {
      const { data: created, error: insertErr } = await supabase
        .from("email_accounts")
        .insert(accountData)
        .select("id")
        .single();
      if (insertErr) {
        return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Failed to save: " + insertErr.message));
      }
      accountId = created?.id || null;
    }

    // Ensure auto-labels + Completed folder. Best-effort.
    try {
      if (accountId) await ensureAccountLabels(accountId);
    } catch (e: any) {
      console.error("[connect/microsoft/callback] ensureAccountLabels failed:", e?.message || e);
    }

    return NextResponse.redirect(baseUrl + "/settings?success=" + encodeURIComponent("Connected " + email + " via Microsoft OAuth"));

  } catch (err: any) {
    console.error("Microsoft OAuth callback error:", err);
    return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("OAuth error: " + (err.message || "unknown")));
  }
}