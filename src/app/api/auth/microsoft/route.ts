import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getGraphToken } from "@/lib/microsoft-graph";

// POST /api/auth/microsoft — Connect via Azure AD Graph API (Our Company accounts)
export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, name, account_id, microsoft_client_id, microsoft_tenant_id, microsoft_client_secret } = body;

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // Use per-account credentials if provided, otherwise fall back to env vars
  const credentials = (microsoft_client_id && microsoft_tenant_id && microsoft_client_secret)
    ? { clientId: microsoft_client_id, tenantId: microsoft_tenant_id, clientSecret: microsoft_client_secret }
    : undefined;

  try {
    const token = await getGraphToken(credentials);

    // Test mailbox access
    const testRes = await fetch(
      "https://graph.microsoft.com/v1.0/users/" + email.trim() + "/messages?$top=1&$select=id",
      { headers: { Authorization: "Bearer " + token } }
    );

    if (!testRes.ok) {
      const err = await testRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: "Cannot access mailbox " + email + ": " + (err.error?.message || testRes.statusText) },
        { status: 400 }
      );
    }

    // Update or create account
    const trimmedEmail = email.trim().toLowerCase();
    const displayName = name || trimmedEmail.split("@")[0];

    const { data: existing } = await supabase
      .from("email_accounts").select("id").eq("email", trimmedEmail).maybeSingle();

    const accountFields: any = {
      provider: "microsoft",
      name: displayName,
      email: trimmedEmail,
      sync_error: null,
      is_active: true,
      icon: "🟠",
      color: "#D83B01",
    };

    if (credentials) {
      accountFields.microsoft_client_id = credentials.clientId;
      accountFields.microsoft_tenant_id = credentials.tenantId;
      accountFields.microsoft_client_secret = credentials.clientSecret;
    }

    if (existing || account_id) {
      const id = account_id || existing?.id;
      const { data, error } = await supabase.from("email_accounts").update(accountFields).eq("id", id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, message: "Connected " + trimmedEmail, account: data });
    }

    const { data: newAccount, error: createErr } = await supabase.from("email_accounts").insert(accountFields).select().single();
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
    return NextResponse.json({ success: true, message: "Connected " + trimmedEmail, account: newAccount });

  } catch (err: any) {
    return NextResponse.json({ error: "Microsoft Graph connection failed: " + err.message }, { status: 500 });
  }
}