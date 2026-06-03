// ── src/lib/supplier-contact-resolver.ts ───────────────────────────────
//
// Given an email address, decide if it represents a supplier and return
// (or create) the corresponding supplier_contacts.id. Called from the
// sync engines (imap-sync, microsoft-graph, microsoft-oauth-sync) when
// they create a new conversation, so every fresh conversation gets an
// accurate supplier_contact_id at write time.
//
// Filter rules (matches batch5-supplier-backfill-v2.sql exactly — both
// the backfill and the going-forward path must agree on what counts as
// a supplier):
//
//   - Internal: emails in team_members.email or email_accounts.email,
//     OR emails on the domain of any email_account (e.g. @trytenkara.com)
//   - Public-provider exception: @gmail.com, @yahoo.com, @outlook.com etc.
//     are NOT treated as internal domains, even if a team member uses one,
//     because they're shared. Only exact email matches filter those out.
//   - Transactional: SaaS service domains (DocuSign, Stripe, etc.)
//   - No-reply patterns: noreply@*, no-reply@*, notifications@*
//
// Loading the internal context (team_members + email_accounts) is a few
// rows from Supabase. Sync engines should load it ONCE per sync run and
// pass the resulting `InternalContext` to every ensureSupplierContact()
// call to avoid repeating the lookup per message.

import type { SupabaseClient } from "@supabase/supabase-js";

// The exported functions accept `any` for the supabase client to avoid
// the recurring schema-generic collision between createServerClient (which
// returns SupabaseClient<any, "public", "inbox", ...>) and SupabaseClient's
// default generic. We don't depend on type-checked queries inside the helper
// so the loss of inference here is benign.
type AnySupabase = SupabaseClient<any, any, any, any, any>;

// ── Static blocklists ─────────────────────────────────────────────────
//
// These should stay in lockstep with the CTEs in
// batch5-supplier-backfill-v2.sql. If you add to one, add to the other.
const TRANSACTIONAL_DOMAINS = new Set<string>([
  "mailchimp.com", "mandrillapp.com", "sendgrid.net",
  "amazonses.com", "email.amazonses.com",
  "docusignmail.com", "docusign.net", "docusign.com",
  "stripe.com", "paypal.com",
  "shopify.com", "myshopify.com",
  "vercel.com", "vercel.app",
  "supabase.io", "supabase.com",
  "notion.so", "notion.com",
  "slack.com", "zoom.us", "calendly.com",
  "hubspot.com", "linkedin.com", "github.com",
  "asana.com", "atlassian.net", "atlassian.com",
  "accounts.google.com", "google.com", "e.google.com",
  "microsoft.com", "microsoftonline.com", "onedrive.com",
  "bitwarden.com", "anthropic.com",
  "cursor.com", "cursor.sh",
]);

const PUBLIC_EMAIL_PROVIDERS = new Set<string>([
  "gmail.com",
  "yahoo.com", "yahoo.co.uk", "yahoo.fr", "yahoo.de", "yahoo.it", "yahoo.es",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com",
  "aol.com",
  "protonmail.com", "proton.me",
  "mail.com",
  "yandex.com", "yandex.ru",
  "gmx.com", "gmx.de", "gmx.net",
  "zoho.com", "fastmail.com", "pm.me",
  "163.com", "126.com", "qq.com",
  "sina.com", "sina.cn", "foxmail.com",
]);

const NOREPLY_REGEX = /^(noreply|no-reply|notifications)@/i;

// ── Internal context ──────────────────────────────────────────────────
//
// The set of emails and domains considered "internal" — these are
// excluded from supplier classification.
export type InternalContext = {
  internalEmails: Set<string>;    // exact lowercased email matches
  internalDomains: Set<string>;   // lowercased domains, excluding public providers
};

export async function loadInternalContext(supabase: AnySupabase): Promise<InternalContext> {
  const [tmRes, eaRes] = await Promise.all([
    supabase.from("team_members").select("email"),
    supabase.from("email_accounts").select("email"),
  ]);

  const internalEmails = new Set<string>();
  const internalDomains = new Set<string>();

  const ingest = (email: string | null | undefined) => {
    if (!email || !email.includes("@")) return;
    const lower = email.toLowerCase().trim();
    internalEmails.add(lower);
    const domain = lower.split("@")[1] || "";
    if (domain && !PUBLIC_EMAIL_PROVIDERS.has(domain)) {
      internalDomains.add(domain);
    }
  };

  for (const r of tmRes.data || []) ingest((r as any).email);
  for (const r of eaRes.data || []) ingest((r as any).email);

  return { internalEmails, internalDomains };
}

// ── Filter predicates ─────────────────────────────────────────────────
export function isInternalAddress(email: string, ctx: InternalContext): boolean {
  const lower = email.toLowerCase().trim();
  if (ctx.internalEmails.has(lower)) return true;
  const domain = lower.split("@")[1] || "";
  if (domain && ctx.internalDomains.has(domain)) return true;
  return false;
}

export function isTransactionalSender(email: string): boolean {
  const domain = (email.toLowerCase().split("@")[1] || "");
  return TRANSACTIONAL_DOMAINS.has(domain);
}

export function isNoReplyAddress(email: string): boolean {
  return NOREPLY_REGEX.test(email.trim());
}

// ── Email extraction helper ───────────────────────────────────────────
//
// Pulls the first email out of a string that might be RFC822-formatted
// like `"Name" <name@example.com>` or just `name@example.com`, or a
// comma-separated list of either form. Returns null if no valid email
// found.
const EMAIL_REGEX = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
export function extractFirstEmail(input: string | null | undefined): string | null {
  if (!input) return null;
  const match = input.match(EMAIL_REGEX);
  return match ? match[0].toLowerCase() : null;
}

// ── Main entry point: get-or-create supplier_contact ──────────────────
//
// Returns the supplier_contacts.id for the given email, creating a new
// row if none exists. Returns null if:
//   - email is missing/invalid
//   - email is internal (per InternalContext)
//   - email is a transactional/SaaS sender
//   - email matches a noreply pattern
//
// `name` is used when creating a new row; if missing, falls back to the
// local-part of the email.
//
// `ctx` is optional — if not supplied, the function loads internal
// context fresh, but that incurs an extra round-trip per call. Sync
// engines should load context once at the start of the run and pass it.
export async function ensureSupplierContact(
  supabase: AnySupabase,
  email: string | null | undefined,
  name?: string | null,
  ctx?: InternalContext
): Promise<string | null> {
  if (!email) return null;
  const lower = email.toLowerCase().trim();
  if (!lower || !lower.includes("@")) return null;

  // Filter rules — must match the SQL backfill migration.
  const internalCtx = ctx || await loadInternalContext(supabase);
  if (isInternalAddress(lower, internalCtx)) return null;
  if (isTransactionalSender(lower)) return null;
  if (isNoReplyAddress(lower)) return null;

  // Try lookup first — most sync runs hit existing suppliers.
  const { data: existing, error: lookupErr } = await supabase
    .from("supplier_contacts")
    .select("id")
    .ilike("email", lower)
    .maybeSingle();
  if (lookupErr) {
    console.error("[supplier-resolver] lookup failed:", lookupErr.message);
    return null;
  }
  if (existing) return (existing as any).id;

  // Create a fresh row. Name defaults to the local-part if no display
  // name was passed in.
  const safeName = (name && name.trim()) || lower.split("@")[0] || lower;
  const { data: created, error: createErr } = await supabase
    .from("supplier_contacts")
    .insert({ email: lower, name: safeName })
    .select("id")
    .single();
  if (createErr) {
    // Race condition: someone else inserted this email between our
    // lookup and our insert. Look it up again — should exist now.
    const { data: retry } = await supabase
      .from("supplier_contacts")
      .select("id")
      .ilike("email", lower)
      .maybeSingle();
    if (retry) return (retry as any).id;
    console.error("[supplier-resolver] create failed:", createErr.message);
    return null;
  }
  return (created as any)?.id || null;
}
