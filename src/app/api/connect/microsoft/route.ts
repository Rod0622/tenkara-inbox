import { NextRequest, NextResponse } from "next/server";

// GET /api/connect/microsoft — Redirect to Microsoft OAuth consent
//
// Query params:
//   name   — display name for the account (passed through `state`)
//   tenant — OPTIONAL. A tenant id (GUID) or verified domain, e.g.
//            "californiachemical.com". Use this when the mailbox lives in a
//            CUSTOMER directory so consent is evaluated against THAT tenant
//            instead of the generic endpoint. Defaults to "organizations"
//            (any work/school tenant). Pass "common" to also allow personal
//            Microsoft accounts.
//   email  — OPTIONAL. Pre-selects the account on the sign-in page
//            (login_hint), so the user can't accidentally auth the wrong one.
export async function GET(req: NextRequest) {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const baseUrl = process.env.NEXTAUTH_URL || "https://tenkara-inbox-nine.vercel.app";
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
    // `prompt=consent` used to be hardcoded here. It forces the consent screen
    // on EVERY sign-in, even after an admin has already granted tenant-wide
    // consent. In a customer tenant where user consent is disabled, that
    // re-opens the "admin approval required" flow every single time — which
    // looks exactly like the admin's approval never took effect.
    //
    // It is also NOT needed for refresh tokens: on the Microsoft v2.0
    // endpoint `offline_access` (in the scope list above) is what issues the
    // refresh token. That's a Google-specific requirement, not a Microsoft one.
    prompt: "select_account",
  });

  // Pre-select the mailbox being connected, when the caller knows it.
  const loginHint = (req.nextUrl.searchParams.get("email") || "").trim();
  if (loginHint) params.set("login_hint", loginHint);

  // Tenant-targeted authorize endpoint. encodeURIComponent keeps a stray
  // slash in the query param from escaping the path segment.
  const tenant = (req.nextUrl.searchParams.get("tenant") || "organizations").trim();
  const url =
    "https://login.microsoftonline.com/" +
    encodeURIComponent(tenant) +
    "/oauth2/v2.0/authorize?" +
    params.toString();

  return NextResponse.redirect(url);
}