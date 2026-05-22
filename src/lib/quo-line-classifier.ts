// src/lib/quo-line-classifier.ts
//
// Pure helpers for classifying Quo phone line names into private/shared and
// suggesting an owner email or a matching email_account brand.
//
// Quo line names from Try Tenkara's workspace follow patterns like:
//   "Vita Organica | Shared"            → shared, brand=Vita Organica
//   "Rod E. | Operations"               → private, owner=Rod E.
//   "Andrea M. | Operations"            → private, owner=Andrea M.
//   "Tenkara Sales | Shared"            → shared, brand=Tenkara Sales
//   "Mike P. | Logistics"               → private, owner=Mike P.
//   "Drixter O. | Sales EA"             → private, owner=Drixter O.
//
// Rules (in priority order):
//   1. If line name contains " | Shared" suffix → shared
//   2. If line name's first segment matches a known email_account name → shared
//   3. If line name's first segment matches a person pattern
//      ("First L." or "Firstname Lastname") → private
//   4. Otherwise → unknown
//
// For privates, we try to suggest the owner team member by matching the
// person-segment to team member display names.

export type LineClassification = {
  line_type: "private" | "shared" | "unknown";
  // For shared lines: best-guess brand name (the segment before "| Shared" or the full name)
  brand_hint?: string;
  // For private lines: the person-name segment (e.g. "Rod E." or "Andrea M.")
  person_hint?: string;
};

const SHARED_SUFFIX_RE = /\s*[\|·]\s*shared\b/i;
// Patterns like "Rod E.", "Andrea M.", "Bal R."
const PERSON_INITIAL_RE = /^[A-ZÀ-Ý][a-zà-ÿ]+\s+[A-ZÀ-Ý]\.?$/;
// Patterns like "Mike Parsons" (two full words capitalized)
const PERSON_FULL_RE = /^[A-ZÀ-Ý][a-zà-ÿ]+\s+[A-ZÀ-Ý][a-zà-ÿ]+$/;

export function classifyLineName(rawName: string | null | undefined): LineClassification {
  const name = (rawName || "").trim();
  if (!name) return { line_type: "unknown" };

  // Rule 1: explicit "| Shared" suffix wins
  if (SHARED_SUFFIX_RE.test(name)) {
    const brand = name.replace(SHARED_SUFFIX_RE, "").trim().replace(/\s*\|\s*$/, "").trim();
    return { line_type: "shared", brand_hint: brand || name };
  }

  // Split by separator " | " — first segment is the most useful
  const segments = name.split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  const firstSegment = segments[0] || name;

  // Rule 3: person-name pattern in first segment
  if (PERSON_INITIAL_RE.test(firstSegment) || PERSON_FULL_RE.test(firstSegment)) {
    return { line_type: "private", person_hint: firstSegment };
  }

  // Rule 2 (looser): if it doesn't look like a person, it's probably a brand
  // (e.g. "Tenkara Sales" without "| Shared" suffix). The caller can match the
  // brand_hint against email_account names to decide.
  return { line_type: "shared", brand_hint: firstSegment };
}

// Given a classification's person_hint (e.g. "Rod E."), find the best-matching
// team member email. The match is loose: tokenize the hint and match against
// each member's name; pick the one with the most overlap.
export function suggestOwnerEmail(
  personHint: string | null | undefined,
  members: Array<{ id: string; name: string; email: string | null }>
): string | null {
  if (!personHint) return null;
  const hintTokens = personHint
    .toLowerCase()
    .replace(/\./g, "")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (hintTokens.length === 0) return null;

  let bestEmail: string | null = null;
  let bestScore = 0;

  for (const m of members) {
    if (!m.email || !m.name) continue;
    const memberTokens = m.name.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
    let score = 0;
    for (const ht of hintTokens) {
      for (const mt of memberTokens) {
        // Full match
        if (mt === ht) { score += 3; continue; }
        // Initial match: "E." in hint matches "Esposito" in member
        if (ht.length === 1 && mt.startsWith(ht)) { score += 1; continue; }
        // Prefix match (≥3 chars)
        if (ht.length >= 3 && mt.startsWith(ht)) { score += 2; continue; }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestEmail = m.email;
    }
  }

  // Require at least one strong match (first-name full match scores 3)
  return bestScore >= 3 ? bestEmail : null;
}

// Match a brand_hint against the list of email_accounts. Case-insensitive
// substring/prefix matching on the email_account name.
export function suggestEmailAccountId(
  brandHint: string | null | undefined,
  accounts: Array<{ id: string; name: string }>
): string | null {
  if (!brandHint) return null;
  const hint = brandHint.toLowerCase().trim();
  if (!hint) return null;

  // First pass: exact case-insensitive match
  for (const a of accounts) {
    if ((a.name || "").toLowerCase().trim() === hint) return a.id;
  }
  // Second pass: account name starts with hint, or hint starts with account name
  for (const a of accounts) {
    const an = (a.name || "").toLowerCase().trim();
    if (!an) continue;
    if (an.startsWith(hint) || hint.startsWith(an)) return a.id;
  }
  // Third pass: substring
  for (const a of accounts) {
    const an = (a.name || "").toLowerCase().trim();
    if (!an) continue;
    if (an.includes(hint) || hint.includes(an)) return a.id;
  }
  return null;
}
