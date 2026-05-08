import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { ensureAccountLabels } from "@/lib/folder-labels";

// POST /api/auth/microsoft/password — Connect client Microsoft 365 email via IMAP
// Saves credentials without testing IMAP (basic auth may be disabled)
// The sync engine will attempt connection and report errors via sync_error
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
    const { data: existing } = await supabase
      .from("email_accounts").select("id").eq("email", trimmedEmail).maybeSingle();

    const accountData = {
      email: trimmedEmail,
      name: displayName,
      provider: "godaddy",
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

    // Track the account id so we can run the labels hook after either branch.
    let accountId: string | null = null;

    if (existing) {
      const { error } = await supabase.from("email_accounts").update(accountData).eq("id", existing.id);
      if (error) return NextResponse.json({ error: "Update failed: " + error.message }, { status: 500 });
      accountId = existing.id;
    } else {
      const { data: created, error } = await supabase
        .from("email_accounts")
        .insert(accountData)
        .select("id")
        .single();
      if (error) return NextResponse.json({ error: "Insert failed: " + error.message }, { status: 500 });
      accountId = created?.id || null;
    }

    // Ensure auto-labels + Completed folder. Best-effort — do not fail the request.
    try {
      if (accountId) await ensureAccountLabels(accountId);
    } catch (e: any) {
      console.error("[microsoft/password/POST] ensureAccountLabels failed:", e?.message || e);
    }

    return NextResponse.json({
      success: true,
      message: "Connected " + trimmedEmail + " — will sync via IMAP on next cycle",
    });

  } catch (err: any) {
    return NextResponse.json({ error: "Failed: " + (err.message || "Unknown error") }, { status: 500 });
  }
}