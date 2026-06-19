import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * /api/leak-review/suggestions?account_id=&supplier_email=&exclude=
 *
 * STAGE B — read-only helper. Given a foreign supplier the operator wants to
 * split out of a leaked thread, returns candidate destination conversations
 * in the SAME account that this supplier could merge into:
 *
 *   • exact-email matches first  — conversation's own from_email IS this email
 *   • domain matches second      — same company domain, different address
 *
 * Each candidate carries subject, message count, last activity so the
 * operator can choose confidently. The UI also always offers "create new
 * standalone conversation" as an option (not returned here).
 *
 * Excludes the source conversation (?exclude=) and any fresh split-orphans
 * are naturally included only if they're real destinations (operator's call).
 */

function domainOf(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const m = String(addr).toLowerCase().match(/[\w.\-+]+@([\w.\-]+)/);
  return m ? m[1].replace(/[>"'\s]+$/g, "") : null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id");
  const supplierEmail = (searchParams.get("supplier_email") || "").toLowerCase().trim();
  const exclude = searchParams.get("exclude");

  if (!accountId || !supplierEmail) {
    return NextResponse.json(
      { error: "account_id and supplier_email are required" },
      { status: 400 }
    );
  }
  const supplierDomain = domainOf(supplierEmail);

  const supabase = createServerClient();
  try {
    // Pull this account's conversations with their own from_email; we classify
    // exact vs domain match in JS (cheap, and avoids brittle SQL on the
    // from_email free-text).
    const { data: convos, error } = await supabase
      .from("conversations")
      .select("id, subject, from_email, last_message_at, folder_id, status")
      .eq("email_account_id", accountId)
      .neq("status", "trash")
      .neq("status", "merged")
      .limit(5000);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const exact: any[] = [];
    const domain: any[] = [];
    for (const c of (convos || []) as any[]) {
      if (exclude && c.id === exclude) continue;
      const cEmail = (c.from_email || "").toLowerCase();
      const cDom = domainOf(c.from_email);
      if (cEmail && cEmail === supplierEmail) {
        exact.push(c);
      } else if (supplierDomain && cDom && cDom === supplierDomain) {
        domain.push(c);
      }
    }

    // Attach message counts for the candidates (small sets).
    const candidateIds = [...exact, ...domain].map((c) => c.id);
    const counts = new Map<string, number>();
    if (candidateIds.length > 0) {
      const { data: msgs } = await supabase
        .from("messages")
        .select("conversation_id")
        .in("conversation_id", candidateIds)
        .limit(10000);
      for (const m of (msgs || []) as any[]) {
        counts.set(m.conversation_id, (counts.get(m.conversation_id) || 0) + 1);
      }
    }

    const shape = (c: any, matchType: string) => ({
      conversation_id: c.id,
      subject: c.subject,
      from_email: c.from_email,
      last_message_at: c.last_message_at,
      folder_id: c.folder_id,
      msg_count: counts.get(c.id) || 0,
      match_type: matchType,
    });

    const suggestions = [
      ...exact
        .sort((a, b) =>
          String(b.last_message_at || "").localeCompare(String(a.last_message_at || ""))
        )
        .map((c) => shape(c, "exact")),
      ...domain
        .sort((a, b) =>
          String(b.last_message_at || "").localeCompare(String(a.last_message_at || ""))
        )
        .map((c) => shape(c, "domain")),
    ];

    return NextResponse.json({ suggestions });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
