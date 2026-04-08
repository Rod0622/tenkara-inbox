import { createServerClient } from "@/lib/supabase";

// Refresh a Google OAuth access token using the stored refresh token
export async function refreshGoogleToken(accountId: string, forceRefresh: boolean = false): Promise<string> {
  const supabase = createServerClient();

  const { data: account, error: fetchErr } = await supabase
    .from("email_accounts")
    .select("email, oauth_refresh_token, oauth_access_token, oauth_expires_at")
    .eq("id", accountId)
    .maybeSingle();

  if (fetchErr || !account) {
    throw new Error("Account not found for token refresh: " + (fetchErr?.message || accountId));
  }

  if (!account.oauth_refresh_token) {
    throw new Error("No refresh token stored for this account");
  }

  // Check if current token is still valid (with 5 min buffer) — skip if forceRefresh
  if (!forceRefresh && account.oauth_access_token && account.oauth_expires_at) {
    const expiresAt = new Date(account.oauth_expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) {
      console.log(`[google-oauth] ${account.email}: using cached token (expires in ${Math.round((expiresAt - Date.now()) / 60000)}m)`);
      return account.oauth_access_token;
    }
  }

  // Refresh the token — use cache: no-store and unique URL to prevent any HTTP caching
  console.log(`[google-oauth] ${account.email}: refreshing access token...`);
  const refreshStart = Date.now();
  const res = await fetch(`https://oauth2.googleapis.com/token?_t=${Date.now()}`, {
    method: "POST",
    headers: { 
      "Content-Type": "application/x-www-form-urlencoded",
      "Cache-Control": "no-cache, no-store",
    },
    cache: "no-store" as any,
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
      refresh_token: account.oauth_refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`[google-oauth] ${account.email}: refresh failed:`, err.error_description || err.error);
    throw new Error("Token refresh failed: " + (err.error_description || err.error || "unknown"));
  }

  const tokens = await res.json();
  const refreshDuration = Date.now() - refreshStart;
  console.log(`[google-oauth] ${account.email}: got new token in ${refreshDuration}ms, expires_in=${tokens.expires_in}s, scope=${tokens.scope || "not returned"}, token_start=${(tokens.access_token || "").slice(0, 20)}`);

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