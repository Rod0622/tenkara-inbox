-- Run this in Supabase for the upgraded task system.
CREATE TABLE IF NOT EXISTS inbox.task_assignees (
  task_id UUID REFERENCES inbox.tasks(id) ON DELETE CASCADE,
  team_member_id UUID REFERENCES inbox.team_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (task_id, team_member_id)
);

ALTER TABLE inbox.tasks
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'todo'
CHECK (status IN ('todo','in_progress','completed'));

UPDATE inbox.tasks
SET status = CASE WHEN is_done THEN 'completed' ELSE 'todo' END
WHERE status IS NULL;

INSERT INTO inbox.task_assignees (task_id, team_member_id)
SELECT id, assignee_id
FROM inbox.tasks
WHERE assignee_id IS NOT NULL
ON CONFLICT (task_id, team_member_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_rel pr
    JOIN pg_publication p ON p.oid = pr.prpubid
    JOIN pg_class c ON c.oid = pr.prrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE p.pubname = 'supabase_realtime'
      AND n.nspname = 'inbox'
      AND c.relname = 'task_assignees'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE inbox.task_assignees;
  END IF;
END $$;

ALTER TABLE inbox.task_assignees ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'inbox' AND tablename = 'task_assignees' AND policyname = 'all_access'
  ) THEN
    CREATE POLICY "all_access" ON inbox.task_assignees FOR ALL USING (true);
  END IF;
END $$;
