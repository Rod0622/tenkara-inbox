-- Migration: supplier_contact_persons table
-- Date: 2026-05-15
-- Author: Rod (Claude session)
-- Context: Command center needs to support multiple contact people per supplier.
--          A supplier_contact represents a company/entity (e.g. "Yara") identified
--          by its primary email. A supplier_contact_person represents an individual
--          human at that supplier (e.g. "Yna Csorders, Order Coordinator").
--          One-to-many: a supplier can have zero or more contact people.
--
--          No change needed to supplier_contacts.name — the existing "name" column
--          already serves as the supplier-level display name and is editable via
--          the extended PATCH /api/contact-command-center endpoint.

BEGIN;
SET search_path TO inbox;

-- 1. Create the table
CREATE TABLE IF NOT EXISTS inbox.supplier_contact_persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_contact_id uuid NOT NULL
    REFERENCES inbox.supplier_contacts(id) ON DELETE CASCADE,
  name text NOT NULL,
  title text,
  email text,
  phone text,
  notes text,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Index on supplier_contact_id for fast lookup per supplier
CREATE INDEX IF NOT EXISTS supplier_contact_persons_supplier_idx
  ON inbox.supplier_contact_persons (supplier_contact_id);

-- 3. RLS — match existing pattern (permissive; service role bypasses anyway)
ALTER TABLE inbox.supplier_contact_persons ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inbox'
      AND tablename = 'supplier_contact_persons'
      AND policyname = 'all_access'
  ) THEN
    CREATE POLICY "all_access" ON inbox.supplier_contact_persons FOR ALL USING (true);
  END IF;
END$$;

COMMIT;

-- ── Verify (run separately after migration) ─────────────
-- Should show 9 columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'inbox' AND table_name = 'supplier_contact_persons'
ORDER BY ordinal_position;

-- Should show the FK constraint
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'inbox.supplier_contact_persons'::regclass;

-- Should show the index
SELECT indexname FROM pg_indexes
WHERE schemaname = 'inbox'
  AND tablename = 'supplier_contact_persons';

-- ── Rollback (only if needed) ──────────────────────────
-- BEGIN;
-- SET search_path TO inbox;
-- DROP TABLE IF EXISTS inbox.supplier_contact_persons;  -- cascades to FK + index + policy
-- COMMIT;
