import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  console.log("microsoft-password: start");

  let body: any;
  try {
    const text = await req.text();
    console.log("microsoft-password: raw body length:", text.length);
    body = JSON.parse(text);
  } catch (e: any) {
    console.log("microsoft-password: body parse error:", e.message);
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const email = body.email;
  const password = body.password;
  const name = body.name;

  console.log("microsoft-password: email:", email, "hasPassword:", !!password, "name:", name);

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required" }, { status: 400 });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const displayName = name || trimmedEmail.split("@")[0];

  try {
    const supabase = createServerClient();

    const { data: existing, error: lookupErr } = await supabase
      .from("email_accounts").select("id").eq("email", trimmedEmail).maybeSingle();

    console.log("microsoft-password: existing:", existing?.id, "lookupErr:", lookupErr?.message);

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
      console.log("microsoft-password: update result:", error?.message || "OK");
      if (error) return NextResponse.json({ error: "Update failed: " + error.message }, { status: 500 });
    } else {
      const { error } = await supabase.from("email_accounts").insert(accountData);
      console.log("microsoft-password: insert result:", error?.message || "OK");
      if (error) return NextResponse.json({ error: "Insert failed: " + error.message }, { status: 500 });
    }

    console.log("microsoft-password: success");
    return NextResponse.json({ success: true, message: "Connected " + trimmedEmail });

  } catch (err: any) {
    console.log("microsoft-password: catch error:", err.message);
    return NextResponse.json({ error: "Failed: " + err.message }, { status: 500 });
  }
}