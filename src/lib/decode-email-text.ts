// ─── HTML entity decoder for email text ─────────────────────────────────────
//
// Gmail's `snippet` field and Microsoft Graph's `bodyPreview` field both
// arrive as HTML-entity-encoded text. When we store them directly into
// snippet/preview/body_text columns and render as plain text, the user
// sees literal "&#39;" instead of an apostrophe.
//
// Run any email-derived plaintext through `decodeEmailText` BEFORE storing
// it in the database. We do this at the storage layer rather than at render
// time so the cleanup is one-time-and-done — the data flowing into the UI
// is correct everywhere it's read from.
//
// Coverage: named entities (&amp;, &nbsp; etc.), numeric decimal (&#39;),
// numeric hex (&#x27;), and stray invisible whitespace (zero-width chars,
// non-breaking spaces) that look weird when chained in previews.
// ────────────────────────────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",      // NBSP → regular space for preview/snippet readability
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bull: "•",
  middot: "·",
  laquo: "«",
  raquo: "»",
  cent: "¢",
  pound: "£",
  euro: "€",
  yen: "¥",
  para: "¶",
  sect: "§",
  deg: "°",
  plusmn: "±",
  times: "×",
  divide: "÷",
};

/**
 * Decode HTML entities in plaintext-ish strings. Safe to call on already-
 * decoded text — it just won't find any entities to replace.
 *
 * Three pattern families handled:
 *   • &#NNN;     → decimal codepoint
 *   • &#xHHH;    → hexadecimal codepoint
 *   • &name;     → named entity (see NAMED_ENTITIES; unknowns left alone)
 *
 * Also collapses runs of whitespace (including NBSP/zero-width) to single
 * spaces and trims edges — important for previews where Gmail packs many
 * NBSPs and tabs into "Save&nbsp;Big&nbsp;Across..." style output.
 */
export function decodeEmailText(input: string | null | undefined): string {
  if (!input) return "";

  // Replace numeric entities (decimal and hex)
  let out = input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : _;
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : _;
    });

  // Replace named entities
  out = out.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) => {
    return NAMED_ENTITIES[name] ?? match;
  });

  // Normalise weird whitespace into regular spaces, then collapse.
  // Covered: NBSP (U+00A0), tab, CRLF, zero-width space, zero-width non-joiner,
  // zero-width joiner, BOM. Newlines in body_text are intentionally preserved
  // by callers that want them; this helper is for one-line previews. Callers
  // that need newlines preserved should use `decodeEmailTextPreserveNewlines`.
  out = out
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return out;
}

/**
 * Same decoding rules as `decodeEmailText` but preserves newline characters.
 * Use for `body_text` where paragraph structure matters; reach for the
 * standard version for preview/snippet fields.
 */
export function decodeEmailTextPreserveNewlines(input: string | null | undefined): string {
  if (!input) return "";

  let out = input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : _;
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) && cp > 0 ? String.fromCodePoint(cp) : _;
    });

  out = out.replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (match, name) => {
    return NAMED_ENTITIES[name] ?? match;
  });

  // Normalise zero-widths and NBSP only — preserve real newlines.
  out = out
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, " ")
    // Collapse runs of horizontal whitespace (NOT newlines) into one space
    .replace(/[ \t\f\v]+/g, " ")
    // Collapse 3+ newlines into 2 (paragraph break)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return out;
}
