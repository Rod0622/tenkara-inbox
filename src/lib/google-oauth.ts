import { createServerClient } from "@/lib/supabase";

// Refresh a Google OAuth access token using the stored refresh token
export async function refreshGoogleToken(accountId: string): Promise<string> {
  const supabase = createServerClient();

  const { data: account } = await supabase
    .from("email_accounts")
    .select("oauth_refresh_token, oauth_access_token, oauth_expires_at")
    .eq("id", accountId)
    .single();

  if (!account?.oauth_refresh_token) {
    throw new Error("No refresh token stored for this account");
  }

  // Check if current token is still valid (with 5 min buffer)
  if (account.oauth_access_token && account.oauth_expires_at) {
    const expiresAt = new Date(account.oauth_expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) {
      return account.oauth_access_token;
    }
  }

  // Refresh the token
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      refresh_token: account.oauth_refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error("Token refresh failed: " + (err.error_description || err.error || "unknown"));
  }

  const tokens = await res.json();

  // Update stored token
  await supabase.from("email_accounts").update({
    oauth_access_token: tokens.access_token,
    oauth_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
  }).eq("id", accountId);

  return tokens.access_token;
}

// Generate XOAUTH2 string for IMAP/SMTP authentication
export function buildXOAuth2Token(email: string, accessToken: string): string {
  const authString = "user=" + email + "\x01auth=Bearer " + accessToken + "\x01\x01";
  return Buffer.from(authString).toString("base64");
}