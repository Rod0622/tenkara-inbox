-- Migration: allow standalone compose drafts (NULL conversation_id)
-- Date: 2026-05-14
-- Author: Rod (Claude session)
-- Context: ComposeEmail standalone window currently loses content on close.
--          Adding auto-save means drafts need to live in email_drafts without
--          a conversation_id. This drops the NOT NULL constraint (if present)
--          and adds a partial unique index so each user has at most one
--          conversation-less draft (matches Gmail/Missive single-current-compose UX).

BEGIN;
SET search_path TO inbox;

-- 1. Drop NOT NULL on conversation_id (idempotent — does nothing if already nullable)
ALTER TABLE inbox.email_drafts
  ALTER COLUMN conversation_id DROP NOT NULL;

-- 2. Drop foreign key and re-add with ON DELETE CASCADE behavior preserved
--    (only run if needed — comment out if the FK already allows NULLs cleanly)
--    Skipping FK recreation; PostgreSQL allows NULL FKs by default.

-- 3. Partial unique index: one standalone draft per author
--    (does not interfere with conversation-bound drafts which can have many per author)
CREATE UNIQUE INDEX IF NOT EXISTS email_drafts_one_standalone_per_author
  ON inbox.email_drafts (author_id)
  WHERE conversation_id IS NULL;

COMMIT;

-- ── Verify (run separately after migration) ─────────────
-- Should return "YES" for the column being nullable
SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'inbox'
  AND table_name = 'email_drafts'
  AND column_name = 'conversation_id';

-- Should return the new index
SELECT indexname FROM pg_indexes
WHERE schemaname = 'inbox'
  AND tablename = 'email_drafts'
  AND indexname = 'email_drafts_one_standalone_per_author';

-- ── Rollback (only if needed) ──────────────────────────
-- BEGIN;
-- SET search_path TO inbox;
-- DROP INDEX IF EXISTS email_drafts_one_standalone_per_author;
-- -- WARNING: setting NOT NULL back will fail if any standalone drafts exist.
-- --          Delete them first: DELETE FROM email_drafts WHERE conversation_id IS NULL;
-- ALTER TABLE email_drafts ALTER COLUMN conversation_id SET NOT NULL;
-- COMMIT;
