import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import Imap from "imap";

function testImapConnection(email: string, password: string) {
  return new Promise<void>((resolve, reject) => {
    const imap = new Imap({
      user: email,
      password,
      host: "outlook.office365.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    let settled = false;

    imap.once("ready", () => {
      if (settled) return;
      settled = true;
      try {
        imap.end();
      } catch {}
      resolve();
    });

    imap.once("error", (err: any) => {
      if (settled) return;
      settled = true;
      reject(err);
    });

    try {
      imap.connect();
    } catch (err) {
      if (settled) return;
      settled = true;
      reject(err);
    }
  });
}

// POST /api/auth/microsoft/password
// Connects a Microsoft 365 mailbox using email + password
// Saves as IMAP/SMTP account using outlook.office365.com
export async function POST(req: NextRequest) {
  const supabase = createServerClient();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password, name } = body || {};

  if (!email?.trim() || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const trimmedEmail = String(email).trim().toLowerCase();
  const displayName = name?.trim() || trimmedEmail.split("@")[0];

  try {
    // 1) Test IMAP login first so we do not save broken accounts
    try {
      await testImapConnection(trimmedEmail, password);
    } catch (imapErr: any) {
      return NextResponse.json(
        {
          error:
            "Failed to connect to Microsoft 365 mailbox. Please check the email/password and confirm IMAP basic auth is allowed for this account.",
          details: imapErr?.message || "IMAP login failed",
        },
        { status: 400 }
      );
    }

    // 2) Check for existing account
    const { data: existing, error: existingError } = await supabase
      .from("email_accounts")
      .select("id")
      .eq("email", trimmedEmail)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: existingError.message },
        { status: 500 }
      );
    }

    const accountData = {
      email: trimmedEmail,
      name: displayName,
      provider: "microsoft", // FIXED
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

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("email_accounts")
        .update(accountData)
        .eq("id", existing.id);

      if (updateError) {
        return NextResponse.json(
          { error: updateError.message },
          { status: 500 }
        );
      }
    } else {
      const { error: insertError } = await supabase
        .from("email_accounts")
        .insert(accountData);

      if (insertError) {
        return NextResponse.json(
          { error: insertError.message },
          { status: 500 }
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: `Connected ${trimmedEmail} via IMAP/SMTP (outlook.office365.com)`,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: "Failed to connect: " + (err?.message || "Unknown error") },
      { status: 500 }
    );
  }
}