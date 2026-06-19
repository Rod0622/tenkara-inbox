import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * /api/leak-review/messages?conversation_id=xxx
 *
 * STAGE A — read-only. Returns one suspected conversation's messages with
 * the derived supplier domain per message, so the review panel can group
 * them and let the operator visually confirm which messages belong to a
 * foreign supplier before any split.
 */

const OWN_DOMAINS = new Set([
  "roveessentials.com",
  "trytenkara.com",
  "vitaorganicasupps.com",
  "bobberlabs.com",
  "pharmalabenterprises.com",
  "nutripro.com",
]);

function domainOf(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const m = String(addr).toLowerCase().match(/[\w.\-+]+@([\w.\-]+)/);
  return m ? m[1].replace(/[>"'\s]+$/g, "") : null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const conversationId = searchParams.get("conversation_id");
  if (!conversationId) {
    return NextResponse.json(
      { error: "conversation_id is required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();
  try {
    const { data: msgs, error } = await supabase
      .from("messages")
      .select(
        "id, from_email, from_name, to_addresses, is_outbound, sent_at, subject, snippet, body_text"
      )
      .eq("conversation_id", conversationId)
      .order("sent_at", { ascending: true })
      .limit(2000);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const enriched = (msgs || []).map((m: any) => {
      const supplierAddr = m.is_outbound
        ? String(m.to_addresses || "").toLowerCase().match(/[\w.\-+]+@[\w.\-]+/)?.[0] || null
        : m.from_email || null;
      const dom = m.is_outbound
        ? domainOf(String(m.to_addresses || "").match(/[\w.\-+]+@[\w.\-]+/)?.[0] || "")
        : domainOf(m.from_email);
      return {
        ...m,
        supplier_email: supplierAddr,
        supplier_domain: dom,
        is_own_domain: dom ? OWN_DOMAINS.has(dom) : false,
      };
    });

    return NextResponse.json({ messages: enriched });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}