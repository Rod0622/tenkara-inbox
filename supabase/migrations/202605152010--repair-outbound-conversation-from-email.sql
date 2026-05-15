-- Migration: repair conversations where from_email = own account email
-- Date: 2026-05-15
-- Author: Rod (Claude session)
-- Context: Until this commit, the send route stored OUR OWN account email in
--          conversations.from_email when creating a new outbound conversation
--          (instead of the recipient's email). This caused replies to send to
--          ourselves and the conversation header to display our own account
--          name as the "other party." The send route is now fixed for NEW
--          conversations; this migration repairs existing broken rows by
--          inferring the correct other-party address from the messages table.
--
-- Strategy: for each conversation whose from_email matches its own
-- email_account_id's email address, find the most recent OUTBOUND message in
-- that conversation and use its first to_addresses entry as the corrected
-- from_email. If there's any inbound message, prefer that message's from_email.

BEGIN;
SET search_path TO inbox;

-- Helper: extract first email out of a "Name <email>, ..." string.
-- Returns lowercased bare email, or NULL if nothing extractable.
CREATE OR REPLACE FUNCTION inbox.first_email_from_addresses(addrs TEXT)
RETURNS TEXT AS $$
DECLARE
  first_part TEXT;
  angle_match TEXT[];
  cleaned TEXT;
BEGIN
  IF addrs IS NULL OR length(trim(addrs)) = 0 THEN
    RETURN NULL;
  END IF;
  first_part := trim(split_part(addrs, ',', 1));
  IF first_part = '' THEN
    RETURN NULL;
  END IF;
  -- Try to match "Display <email@host>"
  angle_match := regexp_match(first_part, '<\s*([^<>]+?)\s*>');
  IF angle_match IS NOT NULL THEN
    cleaned := angle_match[1];
  ELSE
    cleaned := first_part;
  END IF;
  -- Strip surrounding quotes/whitespace
  cleaned := regexp_replace(cleaned, '^["''[:space:]]+|["''[:space:]]+$', '', 'g');
  IF position('@' IN cleaned) = 0 THEN
    RETURN NULL;
  END IF;
  RETURN lower(cleaned);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Audit: how many conversations are affected, before repair
WITH bad AS (
  SELECT c.id, c.from_email, ea.email AS account_email
  FROM conversations c
  JOIN email_accounts ea ON ea.id = c.email_account_id
  WHERE lower(c.from_email) = lower(ea.email)
)
SELECT 'BEFORE_REPAIR' AS phase, count(*) AS broken_conversations FROM bad;

-- Apply the repair
WITH bad_convos AS (
  SELECT c.id, c.from_email, ea.email AS account_email
  FROM conversations c
  JOIN email_accounts ea ON ea.id = c.email_account_id
  WHERE lower(c.from_email) = lower(ea.email)
),
inferred AS (
  SELECT
    bc.id AS conv_id,
    bc.account_email,
    -- Prefer most-recent INBOUND message's from_email
    (
      SELECT m.from_email
      FROM messages m
      WHERE m.conversation_id = bc.id
        AND m.is_outbound = false
        AND lower(m.from_email) != lower(bc.account_email)
      ORDER BY m.sent_at DESC
      LIMIT 1
    ) AS inbound_from,
    -- Fall back to first to_addresses of most-recent OUTBOUND message
    (
      SELECT inbox.first_email_from_addresses(m.to_addresses)
      FROM messages m
      WHERE m.conversation_id = bc.id
        AND m.is_outbound = true
        AND inbox.first_email_from_addresses(m.to_addresses) IS NOT NULL
        AND inbox.first_email_from_addresses(m.to_addresses) != lower(bc.account_email)
      ORDER BY m.sent_at DESC
      LIMIT 1
    ) AS outbound_to
  FROM bad_convos bc
)
UPDATE conversations c
SET
  from_email = COALESCE(i.inbound_from, i.outbound_to, c.from_email),
  from_name  = COALESCE(
    (SELECT m.from_name FROM messages m
     WHERE m.conversation_id = c.id
       AND m.is_outbound = false
       AND lower(m.from_email) != lower(i.account_email)
     ORDER BY m.sent_at DESC LIMIT 1),
    -- Use the local-part as a name if we only have an outbound recipient
    split_part(COALESCE(i.inbound_from, i.outbound_to, c.from_name), '@', 1),
    c.from_name
  )
FROM inferred i
WHERE c.id = i.conv_id
  AND COALESCE(i.inbound_from, i.outbound_to) IS NOT NULL;

-- Audit: how many still broken after the repair (should be only conversations
-- with literally zero non-self messages to infer from)
WITH bad AS (
  SELECT c.id
  FROM conversations c
  JOIN email_accounts ea ON ea.id = c.email_account_id
  WHERE lower(c.from_email) = lower(ea.email)
)
SELECT 'AFTER_REPAIR' AS phase, count(*) AS still_broken FROM bad;

COMMIT;

-- ── Verify (run separately) ────────────────────────────
-- Show a sample of conversations that now have non-self from_email
-- SELECT c.id, c.subject, c.from_email, ea.email AS account_email
-- FROM conversations c
-- JOIN email_accounts ea ON ea.id = c.email_account_id
-- WHERE c.created_at > now() - interval '30 days'
-- ORDER BY c.last_message_at DESC
-- LIMIT 20;

-- ── Rollback ───────────────────────────────────────────
-- This migration is not reversible without per-row history. If you need to
-- revert, restore the affected rows from a Supabase backup.
-- The helper function can be dropped if not needed elsewhere:
--   DROP FUNCTION IF EXISTS inbox.first_email_from_addresses(TEXT);
