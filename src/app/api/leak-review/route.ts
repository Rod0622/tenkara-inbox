import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

/**
 * /api/leak-review
 *
 * STAGE A — DETECTION ONLY (read-only).
 *
 * Surfaces conversations suspected of containing a cross-supplier "leak":
 * a single conversation whose messages collectively involve 2+ DIFFERENT
 * external supplier domains. This is the symptom of a bad merge / over-eager
 * subject-threading — two unrelated suppliers' emails glued into one thread,
 * which leaks confidential pricing between competitors.
 *
 * Scope: PER ACCOUNT (caller passes ?account_id=). Keeps the scan light on
 * the database — scanning every account at once is heavy on the small
 * compute instance.
 *
 * Method (done in JS for reliability, matching how the manual cleanup ran):
 *   1. Pull this account's conversations (id, subject, folder_id,
 *      last_message_at, status != trash).
 *   2. Pull their messages (from_email, to_addresses, is_outbound).
 *   3. For each conversation, derive the set of external supplier domains:
 *        - inbound message  → supplier = from_email domain
 *        - outbound message → supplier = primary recipient domain
 *      excluding our OWN domains and known noise senders.
 *   4. Flag any conversation with 2+ distinct external supplier domains.
 *
 * Returns one row per suspected conversation with the conflicting suppliers
 * and per-supplier message counts, so the UI can show what to review.
 *
 * NO writes. Split/merge actions come in Stage B.
 */

// Our own mailbox domains — never count these as a "supplier".
const OWN_DOMAINS = new Set([
  "roveessentials.com",
  "trytenkara.com",
  "vitaorganicasupps.com",
  "bobberlabs.com",
  "pharmalabenterprises.com",
  "nutripro.com",
]);

// Free-mail and infra domains that shouldn't drive a "different supplier"
// conflict on their own (a gmail.com supplier is real, but two different
// gmail senders aren't necessarily two companies; and infra/bounce senders
// are never suppliers). We exclude infra/bounce entirely; gmail is allowed
// as a supplier but flagged loosely (see NOISE_SENDERS).
const NOISE_SENDERS = [
  "mailer-daemon",
  "postmaster",
  "no-reply",
  "noreply",
  "donotreply",
  "do-not-reply",
  "notifications@",
  "bounce",
  "mailermailer",
  "sendgrid",
  "mailchimp",
  "amazonses",
  "alibaba.com",
  "service.alibaba",
  "docusign",
  "shopify",
  "airtable",
  "brevo",
  "knowde",
];

function domainOf(addr: string | null | undefined): string | null {
  if (!addr) return null;
  const m = String(addr)
    .toLowerCase()
    .match(/[\w.\-+]+@([\w.\-]+)/);
  if (!m) return null;
  return m[1].replace(/[>"'\s]+$/g, "");
}

function isNoise(addr: string | null | undefined): boolean {
  if (!addr) return true;
  const lower = String(addr).toLowerCase();
  return NOISE_SENDERS.some((n) => lower.includes(n));
}

function firstRecipientDomain(toAddresses: string | null | undefined): string | null {
  if (!toAddresses) return null;
  // to_addresses may be a JSON-ish array string or a comma list; grab first email.
  const m = String(toAddresses).toLowerCase().match(/[\w.\-+]+@[\w.\-]+/);
  return m ? domainOf(m[0]) : null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const accountId = searchParams.get("account_id");

  if (!accountId) {
    return NextResponse.json(
      { error: "account_id is required" },
      { status: 400 }
    );
  }

  const supabase = createServerClient();

  try {
    // 1. Conversations for this account (exclude trash/merged shells).
    const { data: convos, error: convErr } = await supabase
      .from("conversations")
      .select("id, subject, folder_id, status, last_message_at, from_email")
      .eq("email_account_id", accountId)
      .neq("status", "trash")
      .neq("status", "merged")
      .limit(5000);

    if (convErr) {
      return NextResponse.json({ error: convErr.message }, { status: 500 });
    }
    if (!convos || convos.length === 0) {
      return NextResponse.json({ suspects: [] });
    }

    // Load dismissed conversation ids (reviewed & judged not-a-leak) to
    // exclude them from the suspect list.
    const { data: dismissedRows } = await supabase
      .from("leak_review_dismissed")
      .select("conversation_id");
    const dismissed = new Set(
      (dismissedRows || []).map((d: any) => d.conversation_id)
    );

    const convIds = convos
      .map((c: any) => c.id)
      .filter((id: string) => !dismissed.has(id));

    // 2. Messages for those conversations. Chunk the .in() to stay under
    //    PostgREST URL limits (~150 ids/chunk), dispatched in parallel.
    const CHUNK = 150;
    const chunks: string[][] = [];
    for (let i = 0; i < convIds.length; i += CHUNK) {
      chunks.push(convIds.slice(i, i + CHUNK));
    }

    const msgResults = await Promise.all(
      chunks.map((ids) =>
        supabase
          .from("messages")
          .select("conversation_id, from_email, to_addresses, is_outbound")
          .in("conversation_id", ids)
          .limit(10000)
      )
    );

    // 3. Group supplier domains per conversation.
    type SupplierAgg = {
      domain: string;
      sampleEmail: string;
      msgCount: number;
    };
    const byConv = new Map<string, Map<string, SupplierAgg>>();

    for (const r of msgResults) {
      if (r.error) {
        return NextResponse.json({ error: r.error.message }, { status: 500 });
      }
      for (const m of (r.data || []) as any[]) {
        const convId = m.conversation_id;
        // Supplier address: sender for inbound, primary recipient for outbound.
        const supplierAddr = m.is_outbound
          ? (String(m.to_addresses || "").toLowerCase().match(/[\w.\-+]+@[\w.\-]+/)?.[0] || null)
          : (m.from_email || null);
        if (!supplierAddr || isNoise(supplierAddr)) continue;
        const dom = m.is_outbound
          ? firstRecipientDomain(m.to_addresses)
          : domainOf(m.from_email);
        if (!dom || OWN_DOMAINS.has(dom)) continue;

        if (!byConv.has(convId)) byConv.set(convId, new Map());
        const supMap = byConv.get(convId)!;
        const existing = supMap.get(dom);
        if (existing) {
          existing.msgCount += 1;
        } else {
          supMap.set(dom, { domain: dom, sampleEmail: supplierAddr, msgCount: 1 });
        }
      }
    }

    // 4. Flag conversations with 2+ distinct external supplier domains.
    const convById = new Map(convos.map((c: any) => [c.id, c]));
    const suspects: any[] = [];
    for (const [convId, supMap] of Array.from(byConv.entries())) {
      if (supMap.size >= 2) {
        const c: any = convById.get(convId);
        if (!c) continue;
        const suppliers = Array.from(supMap.values()).sort(
          (a: SupplierAgg, b: SupplierAgg) => b.msgCount - a.msgCount
        );
        suspects.push({
          conversation_id: convId,
          subject: c.subject,
          folder_id: c.folder_id,
          status: c.status,
          last_message_at: c.last_message_at,
          supplier_count: supMap.size,
          suppliers, // [{domain, sampleEmail, msgCount}, ...] desc by count
        });
      }
    }

    // Most recently active first.
    suspects.sort((a, b) =>
      String(b.last_message_at || "").localeCompare(String(a.last_message_at || ""))
    );

    return NextResponse.json({ suspects, scanned: convos.length });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}