import { NextRequest, NextResponse } from "next/server";

// GET /api/connect/microsoft — Redirect to Microsoft OAuth consent
export async function GET(req: NextRequest) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const baseUrl = process.env.NEXTAUTH_URL || "https://tenkara-inbox-5fdl.vercel.app";
  const redirectUri = baseUrl + "/api/connect/microsoft/callback";

  if (!clientId) {
    return NextResponse.json({ error: "Microsoft OAuth not configured" }, { status: 500 });
  }

  // Pass display name through state param
  const name = req.nextUrl.searchParams.get("name") || "";
  const state = Buffer.from(JSON.stringify({ name })).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    response_mode: "query",
    scope: "openid profile email Mail.Read Mail.ReadWrite Mail.Send offline_access User.Read",
    state: state,
    prompt: "consent",
  });

  // Use "common" endpoint for multi-tenant (works with any Microsoft 365 org)
  const url = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" + params.toString();
  return NextResponse.redirect(url);
}
