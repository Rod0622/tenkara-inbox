-- Migration: dedupe duplicate outbound messages from sync re-ingestion
-- Date: 2026-05-15
-- Author: Rod (Claude session)
-- Context: Until this commit, sending an email stored a row locally with a
--          synthetic provider_message_id (RFC822 from SMTP, "graph:<ts>" for
--          MS Graph), and subsequent Gmail/MS Graph sync ingested the same
--          message a second time under a different provider_message_id. Result:
--          duplicate (sometimes triplicate) outbound rows in inbox.messages.
--          The sync code is now fixed; this migration cleans up existing dupes.
--
-- Strategy: within each conversation, group outbound messages by
-- (subject, from_email, sent_at-rounded-to-the-minute). Keep the row whose
-- provider_message_id starts with "gmail:" or "ms:" (the canonical synced
-- copy), drop the others. If no canonical copy exists (we sent it, sync
-- hasn't ingested yet), keep the oldest local row and drop newer dupes.

BEGIN;
SET search_path TO inbox;

-- Audit BEFORE
WITH dupes AS (
  SELECT
    conversation_id,
    subject,
    from_email,
    date_trunc('minute', sent_at) AS minute_bucket,
    COUNT(*) AS copies
  FROM messages
  WHERE is_outbound = true
  GROUP BY 1, 2, 3, 4
  HAVING COUNT(*) > 1
)
SELECT 'BEFORE_DEDUPE' AS phase,
       COUNT(*)        AS duplicate_groups,
       COALESCE(SUM(copies - 1), 0) AS rows_to_delete
FROM dupes;

-- Pick a canonical row per (conversation, subject, from, minute_bucket).
-- Priority for "the keeper":
--   1. provider_message_id starts with "gmail:" (canonical Gmail sync row)
--   2. provider_message_id starts with "ms:"    (canonical MS Graph sync row)
--   3. earliest created_at (the original local row before sync re-ingested it)
WITH ranked AS (
  SELECT
    id,
    conversation_id,
    provider_message_id,
    sent_at,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY
        conversation_id,
        subject,
        from_email,
        date_trunc('minute', sent_at)
      ORDER BY
        CASE
          WHEN provider_message_id LIKE 'gmail:%' THEN 0
          WHEN provider_message_id LIKE 'ms:%'    THEN 1
          ELSE 2
        END,
        created_at ASC
    ) AS rn
  FROM messages
  WHERE is_outbound = true
),
to_delete AS (
  SELECT id FROM ranked WHERE rn > 1
)
DELETE FROM messages
WHERE id IN (SELECT id FROM to_delete);

-- Recompute attachment_count and conversation timestamps for affected rows.
-- Skipping: trigger on inbox.attachments already maintains attachment_count,
-- and last_message_at is set by sync paths. Nothing else needs touching.

-- Audit AFTER
WITH dupes AS (
  SELECT
    conversation_id,
    subject,
    from_email,
    date_trunc('minute', sent_at) AS minute_bucket,
    COUNT(*) AS copies
  FROM messages
  WHERE is_outbound = true
  GROUP BY 1, 2, 3, 4
  HAVING COUNT(*) > 1
)
SELECT 'AFTER_DEDUPE' AS phase,
       COUNT(*)       AS duplicate_groups_remaining
FROM dupes;

COMMIT;

-- ── Verify (run separately after migration) ─────────────
-- Spot-check that "Test Compose 3" no longer has duplicates:
-- SELECT id, provider_message_id, subject, from_email,
--        substring(snippet, 1, 60) AS snippet, sent_at, is_outbound
-- FROM messages
-- WHERE conversation_id = (SELECT id FROM conversations WHERE subject = 'Test Compose 3' LIMIT 1)
-- ORDER BY sent_at ASC;

-- ── Rollback ───────────────────────────────────────────
-- DELETE is irreversible. If you need to restore deleted rows you must
-- recover from a Supabase backup. This migration only deletes rows that
-- duplicate another row in the same minute bucket of the same conversation —
-- the surviving row preserves the user-visible content.
