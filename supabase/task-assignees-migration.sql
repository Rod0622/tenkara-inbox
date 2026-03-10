-- Run this in Supabase if your existing project already has the inbox schema.
CREATE TABLE IF NOT EXISTS inbox.task_assignees (
  task_id UUID REFERENCES inbox.tasks(id) ON DELETE CASCADE,
  team_member_id UUID REFERENCES inbox.team_members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (task_id, team_member_id)
);

INSERT INTO inbox.task_assignees (task_id, team_member_id)
SELECT id, assignee_id
FROM inbox.tasks
WHERE assignee_id IS NOT NULL
ON CONFLICT (task_id, team_member_id) DO NOTHING;

ALTER PUBLICATION supabase_realtime ADD TABLE inbox.task_assignees;
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
