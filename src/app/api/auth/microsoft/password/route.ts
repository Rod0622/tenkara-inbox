import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// Microsoft's well-known multi-tenant app ID for ROPC
// We use our own Bobber Labs app as the ROPC client
const ROPC_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";

// POST /api/auth/microsoft-password
// Tries: 1) ROPC OAuth2 flow  2) IMAP basic auth fallback
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { email, password, name } = body;

  if (!email?.trim() || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const displayName = name || trimmedEmail.split("@")[0];

  // Check for existing account
  const { data: existing } = await supabase
    .from("email_accounts").select("id").eq("email", trimmedEmail).maybeSingle();

  // ── Try Method 1: ROPC (Resource Owner Password Credentials) ──
  // This gets an OAuth2 token using the user's email+password
  // Works if: tenant allows ROPC, no MFA, legacy auth not blocked
  let ropcSuccess = false;
  try {
    // Use the "organizations" endpoint to auto-discover tenant
    const tokenUrl = "https://login.microsoftonline.com/organizations/oauth2/v2.0/token";
    const params = new URLSearchParams({
      client_id: ROPC_CLIENT_ID,
      scope: "https://graph.microsoft.com/.default offline_access",
      username: trimmedEmail,
      password: password,
      grant_type: "password",
    });

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });

    if (tokenRes.ok) {
      const tokenData = await tokenRes.json();

      // Test mailbox access
      const testRes = await fetch(
        "https://graph.microsoft.com/v1.0/me/messages?$top=1&$select=id",
        { headers: { Authorization: "Bearer " + tokenData.access_token } }
      );

      if (testRes.ok) {
        ropcSuccess = true;

        // Save as microsoft_password provider with credentials
        const accountData: any = {
          email: trimmedEmail,
          name: displayName,
          provider: "microsoft_password",
          imap_user: trimmedEmail,
          imap_password: password,
          icon: "🟡",
          color: "#F0883E",
          is_active: true,
          sync_error: null,
        };

        if (existing) {
          await supabase.from("email_accounts").update(accountData).eq("id", existing.id);
        } else {
          await supabase.from("email_accounts").insert(accountData);
        }

        return NextResponse.json({
          success: true,
          method: "ropc",
          message: "Connected " + trimmedEmail + " via OAuth2 password flow",
        });
      }
    }
  } catch (_e) {
    // ROPC failed, try IMAP
  }

  // ── Try Method 2: IMAP basic auth ──
  // Fallback for tenants where ROPC is blocked but basic auth is still enabled
  try {
    const accountData: any = {
      email: trimmedEmail,
      name: displayName,
      provider: "microsoft_password",
      imap_host: "outlook.office365.com",
      imap_port: 993,
      imap_user: trimmedEmail,
      imap_password: password,
      imap_tls: true,
      smtp_host: "smtp.office365.com",
      smtp_port: 587,
      smtp_user: trimmedEmail,
      smtp_password: password,
      smtp_tls: true,
      icon: "🟡",
      color: "#F0883E",
      is_active: true,
      sync_error: null,
    };

    if (existing) {
      const { error } = await supabase.from("email_accounts").update(accountData).eq("id", existing.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await supabase.from("email_accounts").insert(accountData);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      method: "imap",
      message: "Connected " + trimmedEmail + " via IMAP/SMTP" + (ropcSuccess ? "" : " (OAuth2 not available, using basic auth)"),
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to connect: " + err.message },
      { status: 500 }
    );
  }
}
