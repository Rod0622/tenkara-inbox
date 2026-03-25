import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getGraphToken } from "@/lib/microsoft-graph";

// POST /api/auth/microsoft — Test connection and create/update account
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { email, name, account_id, microsoft_client_id, microsoft_tenant_id, microsoft_client_secret } = body;

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  const credentials = (microsoft_client_id && microsoft_tenant_id && microsoft_client_secret)
    ? { clientId: microsoft_client_id, tenantId: microsoft_tenant_id, clientSecret: microsoft_client_secret }
    : undefined;

  try {
    const token = await getGraphToken(credentials);

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

    if (account_id) {
      const update: any = { provider: "microsoft", sync_error: null, is_active: true };
      if (credentials) {
        update.microsoft_client_id = credentials.clientId;
        update.microsoft_tenant_id = credentials.tenantId;
        update.microsoft_client_secret = credentials.clientSecret;
      }
      const { data, error } = await supabase.from("email_accounts").update(update).eq("id", account_id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, message: "Connected " + email, account: data });
    }

    const { data: existing } = await supabase
      .from("email_accounts").select("id").eq("email", email.trim().toLowerCase()).maybeSingle();

    if (existing) {
      const update: any = { provider: "microsoft", name: name || email.split("@")[0], sync_error: null, is_active: true };
      if (credentials) {
        update.microsoft_client_id = credentials.clientId;
        update.microsoft_tenant_id = credentials.tenantId;
        update.microsoft_client_secret = credentials.clientSecret;
      }
      const { data, error } = await supabase.from("email_accounts").update(update).eq("id", existing.id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, message: "Updated " + email, account: data });
    }

    const insert: any = {
      email: email.trim().toLowerCase(),
      name: name || email.split("@")[0],
      provider: "microsoft", icon: "🟠", color: "#D83B01", is_active: true,
    };
    if (credentials) {
      insert.microsoft_client_id = credentials.clientId;
      insert.microsoft_tenant_id = credentials.tenantId;
      insert.microsoft_client_secret = credentials.clientSecret;
    }
    const { data: newAccount, error: createErr } = await supabase.from("email_accounts").insert(insert).select().single();
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
    return NextResponse.json({ success: true, message: "Connected " + email, account: newAccount });

  } catch (err: any) {
    return NextResponse.json({ error: "Microsoft Graph connection failed: " + err.message }, { status: 500 });
  }
}