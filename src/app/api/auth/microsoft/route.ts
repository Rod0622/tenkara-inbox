import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { getGraphToken } from "@/lib/microsoft-graph";

// POST /api/auth/microsoft — Test connection and update account to microsoft provider
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();
  const { email, name, account_id } = body;

  if (!email?.trim()) {
    return NextResponse.json({ error: "Email is required" }, { status: 400 });
  }

  // Test that we can get a Graph token
  try {
    const token = await getGraphToken();

    // Test that we can access this specific mailbox
    const testRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${email.trim()}/messages?$top=1&$select=id`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!testRes.ok) {
      const err = await testRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: `Cannot access mailbox ${email}: ${err.error?.message || testRes.statusText}` },
        { status: 400 }
      );
    }

    // If account_id provided, update existing account to microsoft provider
    if (account_id) {
      const { data, error } = await supabase
        .from("email_accounts")
        .update({
          provider: "microsoft",
          sync_error: null,
          is_active: true,
        })
        .eq("id", account_id)
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `Connected ${email} via Microsoft Graph API`,
        account: data,
      });
    }

    // Otherwise create a new account
    const { data: existing } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .maybeSingle();

    if (existing) {
      // Update existing
      const { data, error } = await supabase
        .from("email_accounts")
        .update({
          provider: "microsoft",
          name: name || email.split("@")[0],
          sync_error: null,
          is_active: true,
        })
        .eq("id", existing.id)
        .select()
        .single();

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      return NextResponse.json({
        success: true,
        message: `Updated ${email} to Microsoft Graph API`,
        account: data,
      });
    }

    // Create new
    const { data: newAccount, error: createErr } = await supabase
      .from("email_accounts")
      .insert({
        email: email.trim().toLowerCase(),
        name: name || email.split("@")[0],
        provider: "microsoft",
        icon: "🟠",
        color: "#D83B01",
        is_active: true,
      })
      .select()
      .single();

    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });

    return NextResponse.json({
      success: true,
      message: `Connected ${email} via Microsoft Graph API`,
      account: newAccount,
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: `Microsoft Graph connection failed: ${err.message}` },
      { status: 500 }
    );
  }
}