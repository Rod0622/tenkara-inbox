# Supabase Migrations

This folder is the audit log of every database change applied to the live `inbox` schema in Supabase project `oojfhwoimfqgvsedosps`.

## Convention

Every migration file is named:

```
YYYYMMDDHHMM--short-description.sql
```

Examples:

```
202605151430--add-rule-priority-column.sql
202605161045--backfill-attachment-count.sql
202605200915--create-activity-log-index.sql
```

The leading timestamp is in **UTC**, year through minute, no separators. This sorts correctly alphabetically and gives a clear chronological history.

## File structure

Every migration file follows this structure:

```sql
-- Migration: <short description>
-- Date: YYYY-MM-DD
-- Author: Rod (or Claude session)
-- Context: <why this change is needed, link to feature/bug if applicable>

BEGIN;
SET search_path TO inbox;

-- ── Migration ──────────────────────────────────────────
-- (idempotent statements: IF NOT EXISTS, CREATE OR REPLACE, etc.)

COMMIT;

-- ── Verify (run separately after migration) ─────────────
-- SELECT ... ;

-- ── Rollback (only if needed) ──────────────────────────
-- BEGIN;
-- ... reverse statements ...
-- COMMIT;
```

## Workflow

1. Claude delivers SQL as a new file in this folder.
2. Rod copies the migration block into Supabase SQL Editor and runs it.
3. Rod runs the verify query to confirm it worked.
4. Rod commits the file to GitHub alongside any related code changes.

The file in the repo is the record of "this ran in production on this date." Don't edit migration files after they've been applied — write a new migration to amend them.

## Historical migrations (pre-folder)

The following files in `supabase/` predate this folder and remain there for reference:

- `schema.sql` — initial schema bootstrap
- `task-assignees-migration.sql` — task_assignees table
- `task-system-migration.sql` — task status column + task_assignees

All ad-hoc SQL run between project start and the introduction of this folder lives only in Supabase's query history.

## Rules

- ✅ Idempotent — every migration must be safe to re-run (use `IF NOT EXISTS`, `IF EXISTS`, `CREATE OR REPLACE`, `ON CONFLICT DO NOTHING`)
- ✅ Wrapped in `BEGIN; ... COMMIT;` for multi-statement changes
- ✅ Always set `search_path TO inbox` or fully-qualify table names
- ✅ Include a verify SELECT
- ✅ Include a rollback block (commented out)
- ❌ Never `DROP TABLE` without explicit confirmation from Rod
- ❌ Never delete data without showing the row count first
- ❌ Never edit a migration file after it has been applied to production
