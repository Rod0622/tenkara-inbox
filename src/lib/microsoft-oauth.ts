import { createServerClient } from "@/lib/supabase";

// Refresh a Microsoft OAuth access token using the stored refresh token
export async function refreshMicrosoftToken(accountId: string): Promise<string> {
  const supabase = createServerClient();

  const { data: account } = await supabase
    .from("email_accounts")
    .select("oauth_refresh_token, oauth_access_token, oauth_token_expires_at")
    .eq("id", accountId)
    .single();

  if (!account?.oauth_refresh_token) {
    throw new Error("No refresh token stored for this account");
  }

  // Check if current token is still valid (with 5 min buffer)
  if (account.oauth_access_token && account.oauth_token_expires_at) {
    const expiresAt = new Date(account.oauth_token_expires_at).getTime();
    if (Date.now() < expiresAt - 5 * 60 * 1000) {
      return account.oauth_access_token;
    }
  }

  // Refresh the token
  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID || "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
      refresh_token: account.oauth_refresh_token,
      grant_type: "refresh_token",
      scope: "openid profile email Mail.Read Mail.ReadWrite Mail.Send offline_access User.Read",
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error("Token refresh failed: " + (err.error_description || err.error || "unknown"));
  }

  const tokens = await res.json();

  // Update stored tokens
  const update: any = {
    oauth_access_token: tokens.access_token,
    oauth_token_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
  };
  // Microsoft may return a new refresh token
  if (tokens.refresh_token) {
    update.oauth_refresh_token = tokens.refresh_token;
  }

  await supabase.from("email_accounts").update(update).eq("id", accountId);

  return tokens.access_token;
}
