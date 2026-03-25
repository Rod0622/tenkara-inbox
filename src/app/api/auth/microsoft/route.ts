import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Imap from "imap";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function testImapConnection(email: string, password: string) {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user: email,
      password,
      host: "outlook.office365.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once("ready", function () {
      imap.end();
      resolve(true);
    });

    imap.once("error", function (err: any) {
      reject(err);
    });

    try {
      imap.connect();
    } catch (err) {
      reject(err);
    }
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const email = body.email?.trim();
    const password = body.password;
    const name = body.name || email?.split("@")[0];

    if (!email || !password) {
      return NextResponse.json(
        { error: "Missing email or password" },
        { status: 400 }
      );
    }

    console.log("🔐 Testing IMAP connection:", email);

    // ✅ TEST LOGIN FIRST
    try {
      await testImapConnection(email, password);
      console.log("✅ IMAP login success");
    } catch (imapError: any) {
      console.error("❌ IMAP failed:", imapError);

      return NextResponse.json(
        {
          error:
            "Cannot connect to mailbox. Check credentials or mailbox type.",
        },
        { status: 400 }
      );
    }

    // ✅ SAVE TO DB (FIXED PROVIDER VALUE)
    const { data, error } = await supabase
      .from("email_accounts")
      .insert([
        {
          email,
          name,
          provider: "microsoft", // ✅ FIXED HERE
          imap_host: "outlook.office365.com",
          imap_port: 993,
          smtp_host: "smtp.office365.com",
          smtp_port: 587,
          username: email,
          password,
          created_at: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("❌ DB error:", error);

      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    console.log("✅ Account saved");

    return NextResponse.json({
      success: true,
      account: data,
    });
  } catch (err: any) {
    console.error("❌ Route error:", err);

    return NextResponse.json(
      { error: "Unexpected server error" },
      { status: 500 }
    );
  }
}