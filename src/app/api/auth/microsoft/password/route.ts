import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// POST /api/auth/microsoft-password
// Connects a client's Microsoft 365 email using their email + password
// Saves as IMAP/SMTP account (outlook.office365.com)
export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  let body: any;
  try {
    body = await req.json();
  } catch (_e) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password, name } = body;

  if (!email?.trim() || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const displayName = name || trimmedEmail.split("@")[0];

  try {
    // Check for existing account
    const { data: existing } = await supabase
      .from("email_accounts").select("id").eq("email", trimmedEmail).maybeSingle();

    const accountData = {
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
      message: "Connected " + trimmedEmail + " via IMAP/SMTP (outlook.office365.com)",
    });

  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to connect: " + (err.message || "Unknown error") },
      { status: 500 }
    );
  }
}