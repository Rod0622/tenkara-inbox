// src/lib/phone.ts
//
// Phone helpers for matching Quo call participants to internal supplier data.
//
// Strategy:
//   1. Normalize incoming phone to E.164 (digits-only, leading +).
//      Quo always sends E.164 like "+15551234567".
//   2. Match against inbox.supplier_contact_persons.phone (also normalized
//      at compare time, because rows may have been entered as "(555) 123-4567").
//   3. Follow the FK back to inbox.supplier_contacts for the parent supplier.
//   4. Optionally find the most-recent open conversation for that supplier
//      on a given email account (A2 behavior).

import { createServerClient } from "@/lib/supabase";

export function normalizeE164(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;

  // Strip everything except digits and a leading +
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // Common case: US/CA 10-digit number → add +1
  if (!hasPlus && digits.length === 10) return "+1" + digits;
  // 11-digit starting with 1 (US/CA) → +1...
  if (!hasPlus && digits.length === 11 && digits.startsWith("1")) return "+" + digits;
  // Anything else with a +: trust it
  if (hasPlus) return "+" + digits;
  // Fallback: best effort
  return "+" + digits;
}

// Compare two phone values irrespective of formatting.
export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeE164(a);
  const nb = normalizeE164(b);
  if (!na || !nb) return false;
  return na === nb;
}

export interface PhoneMatchResult {
  supplier_contact_id: string | null;
  supplier_contact_person_id: string | null;
  conversation_id: string | null;
  supplier_name?: string | null;
  person_name?: string | null;
}

// Find the supplier (and best-guess open conversation) for a participant phone.
// Returns nulls if no match. Never throws — failures degrade to a logged call
// without supplier linkage.
export async function matchPhoneToSupplier(
  participantPhone: string | null | undefined,
  opts?: { emailAccountId?: string | null }
): Promise<PhoneMatchResult> {
  const result: PhoneMatchResult = {
    supplier_contact_id: null,
    supplier_contact_person_id: null,
    conversation_id: null,
  };

  const phone = normalizeE164(participantPhone);
  if (!phone) return result;

  const supabase = createServerClient();

  // Step 1 — Find candidate persons. We can't normalize SQL-side cheaply,
  // so we fetch persons whose phone field is non-empty and filter in JS.
  // The table is small (one row per supplier contact person); this is fine.
  const { data: persons, error: pErr } = await supabase
    .from("supplier_contact_persons")
    .select("id, supplier_contact_id, name, phone")
    .not("phone", "is", null);

  if (pErr) {
    console.error("[phone] persons query failed:", pErr.message);
    return result;
  }

  const matchedPerson = (persons || []).find((p: any) =>
    phonesMatch(p.phone, phone)
  );

  if (matchedPerson) {
    result.supplier_contact_person_id = matchedPerson.id;
    result.supplier_contact_id = matchedPerson.supplier_contact_id;
    result.person_name = matchedPerson.name;
  }

  // If no person match, we can't infer the supplier. Return phone-only result.
  if (!result.supplier_contact_id) return result;

  // Step 2 — Pull supplier name for activity logs
  const { data: supplier } = await supabase
    .from("supplier_contacts")
    .select("id, name")
    .eq("id", result.supplier_contact_id)
    .maybeSingle();

  if (supplier) result.supplier_name = (supplier as any).name;

  // Step 3 — Find the most-recent open conversation for this supplier.
  // A2 behavior: only link if exactly one match candidate is "obvious".
  // If multiple open conversations exist on different accounts, prefer the
  // one on the email account this call came in on (when provided).
  const query = supabase
    .from("conversations")
    .select("id, email_account_id, last_message_at, status")
    .eq("supplier_contact_id", result.supplier_contact_id)
    .eq("status", "open")
    .order("last_message_at", { ascending: false })
    .limit(5);

  const { data: openConvos } = await query;

  if (openConvos && openConvos.length > 0) {
    // Prefer same-account match
    let preferred: any = null;
    if (opts?.emailAccountId) {
      preferred = (openConvos as any[]).find(
        (c) => c.email_account_id === opts.emailAccountId
      );
    }
    result.conversation_id = (preferred || openConvos[0]).id;
  }

  return result;
}

// Match a Quo userId (workspace user) to a team_member by stored email mapping.
// integration_configs.config.quo_user_email_map is a { quoUserId: email } record.
// Falls back to null if no mapping exists.
export async function matchQuoUserToTeamMember(
  quoUserId: string | null | undefined
): Promise<string | null> {
  if (!quoUserId) return null;
  const supabase = createServerClient();
  const { data: cfg } = await supabase
    .from("integration_configs")
    .select("config")
    .eq("provider", "quo")
    .maybeSingle();
  const map = (cfg as any)?.config?.quo_user_email_map || {};
  const email = (map as Record<string, string>)[quoUserId];
  if (!email) return null;

  const { data: member } = await supabase
    .from("team_members")
    .select("id")
    .eq("email", email.toLowerCase().trim())
    .maybeSingle();

  return (member as any)?.id || null;
}
