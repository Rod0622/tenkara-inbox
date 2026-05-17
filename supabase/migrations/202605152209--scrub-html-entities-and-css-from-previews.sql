-- Migration: scrub HTML entities and leaked CSS from existing preview/snippet fields
-- Date: 2026-05-15
-- Author: Rod (Claude session)
-- Context: The conversation list shows raw "&nbsp;" entities and leaked CSS rules
--          (".kl-table-subblock", ".paragraph_block", etc.) in preview/snippet
--          fields. Two root causes:
--            1. MS Graph sync previously kept the contents of <style> blocks when
--               stripping HTML. Marketing emails with giant <style> headers
--               leaked CSS into body_text/snippet/preview.
--            2. Some legacy rows were written before decodeEmailText was applied
--               to MS Graph previews, leaving "&nbsp;" and similar entities raw.
--          The sync code is fixed going forward; this migration scrubs the
--          existing rows so they display cleanly.
--
-- Strategy: case-by-case REPLACEs for the most common entities. PostgreSQL
-- has no built-in HTML entity decoder, so we cover the named entities that
-- appear in our data plus a regex-based numeric decimal entity strip.
-- Also detect rows that look like CSS dumps (lots of "{" and ":" and ";" with
-- no normal sentence structure) and blank those previews — better empty than
-- garbled. The next sync pass will refill them with clean text.

BEGIN;
SET search_path TO inbox;

-- Audit BEFORE
SELECT 'BEFORE_SCRUB' AS phase,
       (SELECT COUNT(*) FROM conversations WHERE preview LIKE '%&%;%')        AS convs_with_entities,
       (SELECT COUNT(*) FROM conversations WHERE preview ~ '!important' OR preview ~ '\.[a-zA-Z][-_a-zA-Z0-9]*\s+>\s+(?:div|span|td|tr|a|h[1-6]|p|li)\b' OR preview LIKE '%@media%') AS convs_with_css,
       (SELECT COUNT(*) FROM messages      WHERE snippet LIKE '%&%;%')        AS msgs_with_entities,
       (SELECT COUNT(*) FROM messages      WHERE snippet ~ '!important' OR snippet ~ '\.[a-zA-Z][-_a-zA-Z0-9]*\s+>\s+(?:div|span|td|tr|a|h[1-6]|p|li)\b' OR snippet LIKE '%@media%') AS msgs_with_css;

-- Helper: decode the named entities we actually see in our data.
CREATE OR REPLACE FUNCTION inbox.scrub_html_text(input TEXT)
RETURNS TEXT AS $$
DECLARE
  out TEXT;
BEGIN
  IF input IS NULL OR input = '' THEN
    RETURN input;
  END IF;
  out := input;
  -- Most common named entities
  out := replace(out, '&nbsp;',  ' ');
  out := replace(out, '&amp;',   '&');
  out := replace(out, '&lt;',    '<');
  out := replace(out, '&gt;',    '>');
  out := replace(out, '&quot;',  '"');
  out := replace(out, '&apos;',  '''');
  out := replace(out, '&#39;',   '''');
  out := replace(out, '&copy;',  '©');
  out := replace(out, '&reg;',   '®');
  out := replace(out, '&trade;', '™');
  out := replace(out, '&hellip;','…');
  out := replace(out, '&mdash;', '—');
  out := replace(out, '&ndash;', '–');
  out := replace(out, '&bull;',  '•');
  -- Numeric decimal/hex entities — too painful to decode per-match in pure SQL
  -- (no built-in HTML decoder, regexp_replace doesn't evaluate CASE per match).
  -- Strip them outright. The fixed sync code handles new rows via
  -- decodeEmailText(), so this only affects legacy rows where the alternative
  -- is leaving "&#39;" visible.
  out := regexp_replace(out, '&#x?[0-9a-fA-F]+;', '', 'g');
  -- Strip any remaining named entities we didn't handle explicitly.
  out := regexp_replace(out, '&[a-zA-Z][a-zA-Z0-9]+;', '', 'g');
  -- Collapse whitespace
  out := regexp_replace(out, '\s+', ' ', 'g');
  out := trim(out);
  RETURN out;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Apply scrub on conversations.preview that contains entities
UPDATE conversations
SET preview = inbox.scrub_html_text(preview)
WHERE preview LIKE '%&%;%';

-- Apply scrub on messages.snippet that contains entities
UPDATE messages
SET snippet = inbox.scrub_html_text(snippet)
WHERE snippet LIKE '%&%;%';

-- For rows that look like dumped CSS, blank the preview so the UI shows
-- nothing rather than gibberish. Next sync will repopulate with cleaned
-- content using the fixed code path. We catch three strong CSS signals:
--   1. `!important` — almost impossible in legitimate email prose
--   2. Descendant selectors like `.classname > div` — Klaviyo/Faire templates
--   3. `@media` queries
-- Earlier draft tried matching `.class {` directly, but the real Klaviyo dumps
-- have selectors like `.kl-table-subblock > div {…}` so the brace isn't
-- adjacent to the class name. The patterns below match what's actually in
-- the wild.
UPDATE conversations
SET preview = ''
WHERE preview ~ '!important'
   OR preview ~ '\.[a-zA-Z][-_a-zA-Z0-9]*\s+>\s+(?:div|span|td|tr|a|h[1-6]|p|li)\b'
   OR preview LIKE '%@media%';

-- Same for message snippets
UPDATE messages
SET snippet = ''
WHERE snippet ~ '!important'
   OR snippet ~ '\.[a-zA-Z][-_a-zA-Z0-9]*\s+>\s+(?:div|span|td|tr|a|h[1-6]|p|li)\b'
   OR snippet LIKE '%@media%';

-- Audit AFTER
SELECT 'AFTER_SCRUB' AS phase,
       (SELECT COUNT(*) FROM conversations WHERE preview LIKE '%&%;%')        AS convs_with_entities,
       (SELECT COUNT(*) FROM conversations WHERE preview ~ '!important' OR preview ~ '\.[a-zA-Z][-_a-zA-Z0-9]*\s+>\s+(?:div|span|td|tr|a|h[1-6]|p|li)\b' OR preview LIKE '%@media%') AS convs_with_css,
       (SELECT COUNT(*) FROM messages      WHERE snippet LIKE '%&%;%')        AS msgs_with_entities,
       (SELECT COUNT(*) FROM messages      WHERE snippet ~ '!important' OR snippet ~ '\.[a-zA-Z][-_a-zA-Z0-9]*\s+>\s+(?:div|span|td|tr|a|h[1-6]|p|li)\b' OR snippet LIKE '%@media%') AS msgs_with_css;

COMMIT;

-- ── Verify (run separately after migration) ────────────
-- SELECT id, subject, LEFT(preview, 100) AS preview, last_message_at
-- FROM conversations
-- WHERE last_message_at > now() - interval '7 days'
-- ORDER BY last_message_at DESC LIMIT 30;

-- ── Rollback ───────────────────────────────────────────
-- Not reversible without per-row history. The helper function can be dropped:
-- DROP FUNCTION IF EXISTS inbox.scrub_html_text(TEXT);
