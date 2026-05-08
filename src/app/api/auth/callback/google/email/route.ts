import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { ensureAccountLabels } from "@/lib/folder-labels";

// GET /api/auth/callback/google-email — Handle Google OAuth callback
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");
  const baseUrl = process.env.NEXTAUTH_URL || "https://tenkara-inbox-5fdl.vercel.app";
  const redirectUri = baseUrl + "/api/auth/callback/google-email";

  if (error) {
    return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Google auth cancelled: " + error));
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
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: code,
        client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
        client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.json().catch(() => ({}));
      console.error("Google token exchange failed:", err);
      return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Token exchange failed: " + (err.error_description || err.error || "unknown")));
    }

    const tokens = await tokenRes.json();
    // tokens: { access_token, refresh_token, expires_in, token_type, scope, id_token }

    if (!tokens.refresh_token) {
      console.error("No refresh token received. User may need to re-consent.");
      return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("No refresh token received. Please try again."));
    }

    // Get user email from Google
    const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });
    const userInfo = await userInfoRes.json().catch(() => ({}));
    const email = (userInfo.email || "").toLowerCase();

    if (!email) {
      return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Could not determine email address"));
    }

    // Test Gmail access
    const testRes = await fetch("https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=1", {
      headers: { Authorization: "Bearer " + tokens.access_token },
    });

    if (!testRes.ok) {
      const err = await testRes.json().catch(() => ({}));
      return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("Cannot access Gmail: " + (err.error?.message || "permission denied")));
    }

    // Save to database
    const supabase = createServerClient();
    const name = displayName || email.split("@")[0];

    const accountData = {
      email: email,
      name: name,
      provider: "google_oauth",
      imap_host: "imap.gmail.com",
      imap_port: 993,
      imap_user: email,
      imap_password: tokens.refresh_token, // Store refresh token as "password" for IMAP XOAUTH2
      imap_tls: true,
      smtp_host: "smtp.gmail.com",
      smtp_port: 587,
      smtp_user: email,
      smtp_password: tokens.refresh_token,
      smtp_tls: true,
      icon: "🔵",
      color: "#4285F4",
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
      console.error("[google-email/callback] ensureAccountLabels failed:", e?.message || e);
    }

    // Success — redirect back to settings
    return NextResponse.redirect(baseUrl + "/settings?success=" + encodeURIComponent("Connected " + email + " via Google OAuth"));

  } catch (err: any) {
    console.error("Google OAuth callback error:", err);
    return NextResponse.redirect(baseUrl + "/settings?error=" + encodeURIComponent("OAuth error: " + (err.message || "unknown")));
  }
}