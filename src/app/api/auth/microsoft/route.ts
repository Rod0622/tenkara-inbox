import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import Imap from "imap";

function maskEmail(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return "***";
  if (name.length <= 2) return `${name[0] || "*"}***@${domain}`;
  return `${name.slice(0, 2)}***@${domain}`;
}

function safeError(error: any) {
  return {
    message: error?.message || null,
    code: error?.code || null,
    details: error?.details || null,
    hint: error?.hint || null,
    name: error?.name || null,
    stack: error?.stack || null,
  };
}

function testImapConnection(email: string, password: string) {
  return new Promise<void>((resolve, reject) => {
    const imap = new Imap({
      user: email,
      password,
      host: "outlook.office365.com",
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      authTimeout: 15000,
      connTimeout: 15000,
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

export async function POST(req: NextRequest) {
  const requestId = `godaddy-ms365-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const supabase = createServerClient();

  console.log(`[${requestId}] /api/auth/microsoft/password START`);

  let body: any;
  try {
    body = await req.json();
  } catch (error) {
    console.error(`[${requestId}] Invalid JSON body`, safeError(error));
    return NextResponse.json(
      {
        error: "Invalid request body",
        requestId,
      },
      { status: 400 }
    );
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  const name = String(body?.name || "").trim() || email.split("@")[0] || "Mailbox";

  console.log(`[${requestId}] Parsed body`, {
    email: maskEmail(email),
    hasPassword: Boolean(password),
    name,
  });

  if (!email || !password) {
    console.warn(`[${requestId}] Missing email or password`, {
      emailPresent: Boolean(email),
      passwordPresent: Boolean(password),
    });

    return NextResponse.json(
      {
        error: "Email and password are required",
        requestId,
      },
      { status: 400 }
    );
  }

  try {
    console.log(`[${requestId}] Testing IMAP login`, {
      email: maskEmail(email),
      host: "outlook.office365.com",
      port: 993,
    });

    try {
      await testImapConnection(email, password);
      console.log(`[${requestId}] IMAP login success`, {
        email: maskEmail(email),
      });
    } catch (imapError: any) {
      console.error(`[${requestId}] IMAP login failed`, safeError(imapError));
      return NextResponse.json(
        {
          error:
            "Failed to connect to Microsoft 365 mailbox. Check the email/password and confirm this mailbox is actually hosted on Microsoft 365.",
          requestId,
          debug: safeError(imapError),
        },
        { status: 400 }
      );
    }

    console.log(`[${requestId}] Checking existing account`, {
      email: maskEmail(email),
    });

    const { data: existing, error: existingError } = await supabase
      .from("email_accounts")
      .select("id,email,provider")
      .eq("email", email)
      .maybeSingle();

    if (existingError) {
      console.error(
        `[${requestId}] Existing-account lookup failed`,
        safeError(existingError)
      );
      return NextResponse.json(
        {
          error: existingError.message || "Failed to check existing account",
          requestId,
          debug: safeError(existingError),
        },
        { status: 500 }
      );
    }

    console.log(`[${requestId}] Existing account result`, {
      found: Boolean(existing),
      existingId: existing?.id || null,
      existingProvider: existing?.provider || null,
    });

    const accountData = {
      email,
      name,
      provider: "godaddy",
      imap_host: "outlook.office365.com",
      imap_port: 993,
      imap_user: email,
      imap_password: password,
      imap_tls: true,
      smtp_host: "smtp.office365.com",
      smtp_port: 587,
      smtp_user: email,
      smtp_password: password,
      smtp_tls: true,
      icon: "🟡",
      color: "#F0883E",
      is_active: true,
      sync_error: null,
      updated_at: new Date().toISOString(),
    };

    console.log(`[${requestId}] Prepared accountData`, {
      email: maskEmail(accountData.email),
      provider: accountData.provider,
      imap_host: accountData.imap_host,
      smtp_host: accountData.smtp_host,
    });

    if (existing?.id) {
      console.log(`[${requestId}] Updating existing account`, {
        id: existing.id,
        email: maskEmail(email),
      });

      const { data: updated, error: updateError } = await supabase
        .from("email_accounts")
        .update(accountData)
        .eq("id", existing.id)
        .select("id,email,provider")
        .single();

      if (updateError) {
        console.error(`[${requestId}] Update failed`, safeError(updateError));
        return NextResponse.json(
          {
            error: updateError.message || "Failed to update account",
            requestId,
            debug: safeError(updateError),
          },
          { status: 500 }
        );
      }

      console.log(`[${requestId}] Update success`, updated);

      return NextResponse.json({
        success: true,
        requestId,
        account: updated,
        message: `Connected ${email} via Microsoft 365 / GoDaddy IMAP-SMTP`,
      });
    }

    console.log(`[${requestId}] Inserting new account`, {
      email: maskEmail(email),
    });

    const { data: inserted, error: insertError } = await supabase
      .from("email_accounts")
      .insert({
        ...accountData,
        created_at: new Date().toISOString(),
      })
      .select("id,email,provider")
      .single();

    if (insertError) {
      console.error(`[${requestId}] Insert failed`, safeError(insertError));
      return NextResponse.json(
        {
          error: insertError.message || "Failed to insert account",
          requestId,
          debug: safeError(insertError),
        },
        { status: 500 }
      );
    }

    console.log(`[${requestId}] Insert success`, inserted);

    return NextResponse.json({
      success: true,
      requestId,
      account: inserted,
      message: `Connected ${email} via Microsoft 365 / GoDaddy IMAP-SMTP`,
    });
  } catch (error: any) {
    console.error(`[${requestId}] Unhandled route error`, safeError(error));

    return NextResponse.json(
      {
        error: error?.message || "Unexpected server error",
        requestId,
        debug: safeError(error),
      },
      { status: 500 }
    );
  }
}