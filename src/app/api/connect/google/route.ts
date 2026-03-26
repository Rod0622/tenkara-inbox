import { NextRequest, NextResponse } from "next/server";

// GET /api/connect/google — Redirect to Google OAuth consent
export async function GET(req: NextRequest) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const baseUrl = process.env.NEXTAUTH_URL || "https://tenkara-inbox-5fdl.vercel.app";
  const redirectUri = baseUrl + "/api/connect/google/callback";

  if (!clientId) {
    return NextResponse.json({ error: "Google OAuth not configured" }, { status: 500 });
  }

  // Pass display name through state param
  const name = req.nextUrl.searchParams.get("name") || "";
  const state = Buffer.from(JSON.stringify({ name })).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email openid",
    access_type: "offline",
    prompt: "consent",
    state: state,
  });

  const url = "https://accounts.google.com/o/oauth2/v2/auth?" + params.toString();
  return NextResponse.redirect(url);
}
