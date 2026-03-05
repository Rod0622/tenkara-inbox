-- ═══════════════════════════════════════════════════════
-- TENKARA INBOX — Database Schema v2
-- Multi-provider email support (Gmail, Microsoft, IMAP)
-- Run this in your Supabase SQL Editor
-- ═══════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS inbox;

-- ── Email Accounts (the core change) ─────────────────
-- Each connected email account, regardless of provider
CREATE TABLE inbox.email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT '📬',
  color TEXT DEFAULT '#4ADE80',
  provider TEXT NOT NULL CHECK (provider IN ('gmail','microsoft','outlook_com','icloud','godaddy','imap')),
  imap_host TEXT,
  imap_port INTEGER DEFAULT 993,
  imap_user TEXT,
  imap_password TEXT,
  imap_tls BOOLEAN DEFAULT true,
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 587,
  smtp_user TEXT,
  smtp_password TEXT,
  smtp_tls BOOLEAN DEFAULT true,
  oauth_access_token TEXT,
  oauth_refresh_token TEXT,
  oauth_expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_sync_uid TEXT,
  sync_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Provider presets ─────────────────────────────────
CREATE TABLE inbox.provider_presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  icon TEXT,
  imap_host TEXT NOT NULL,
  imap_port INTEGER DEFAULT 993,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER DEFAULT 587,
  auth_type TEXT DEFAULT 'password' CHECK (auth_type IN ('password','oauth','app_password')),
  notes TEXT
);

INSERT INTO inbox.provider_presets VALUES
  ('gmail','Gmail or Google Workspace','🔵','imap.gmail.com',993,'smtp.gmail.com',587,'app_password','Requires App Password: myaccount.google.com → Security → App Passwords'),
  ('microsoft','Office 365 / Outlook','🟠','outlook.office365.com',993,'smtp.office365.com',587,'password','Use full email as username'),
  ('outlook_com','Outlook.com (personal)','🔷','outlook.office365.com',993,'smtp.office365.com',587,'password','Use full email as username'),
  ('icloud','iCloud Mail','⚪','imap.mail.me.com',993,'smtp.mail.me.com',587,'app_password','Requires App-Specific Password from appleid.apple.com'),
  ('godaddy','GoDaddy (Microsoft-hosted)','🟢','outlook.office365.com',993,'smtp.office365.com',587,'password','GoDaddy email is hosted on Microsoft 365. Use full email as username.'),
  ('imap','Other (IMAP)','⚙️','',993,'',587,'password','Enter your IMAP and SMTP server details manually');

-- ── Team Members ─────────────────────────────────────
CREATE TABLE inbox.team_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  initials TEXT NOT NULL,
  color TEXT DEFAULT '#4ADE80',
  role TEXT DEFAULT 'member' CHECK (role IN ('admin','member')),
  department TEXT DEFAULT 'Uncategorized',
  avatar_url TEXT,
  password_hash TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Account access ───────────────────────────────────
CREATE TABLE inbox.account_access (
  email_account_id UUID REFERENCES inbox.email_accounts(id) ON DELETE CASCADE,
  team_member_id UUID REFERENCES inbox.team_members(id) ON DELETE CASCADE,
  can_send BOOLEAN DEFAULT true,
  can_manage BOOLEAN DEFAULT false,
  PRIMARY KEY (email_account_id, team_member_id)
);

-- ── Labels ───────────────────────────────────────────
CREATE TABLE inbox.labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  color TEXT NOT NULL,
  bg_color TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Conversations ────────────────────────────────────
CREATE TABLE inbox.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_account_id UUID REFERENCES inbox.email_accounts(id),
  thread_id TEXT,
  subject TEXT,
  from_name TEXT,
  from_email TEXT,
  preview TEXT,
  is_unread BOOLEAN DEFAULT true,
  is_starred BOOLEAN DEFAULT false,
  assignee_id UUID REFERENCES inbox.team_members(id),
  status TEXT DEFAULT 'open' CHECK (status IN ('open','closed','snoozed')),
  last_message_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_conv_account ON inbox.conversations(email_account_id);
CREATE INDEX idx_conv_assignee ON inbox.conversations(assignee_id);
CREATE INDEX idx_conv_status ON inbox.conversations(status);
CREATE INDEX idx_conv_last_msg ON inbox.conversations(last_message_at DESC);

-- ── Messages (stored locally) ────────────────────────
CREATE TABLE inbox.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  provider_message_id TEXT,
  from_name TEXT NOT NULL,
  from_email TEXT NOT NULL,
  to_addresses TEXT,
  cc_addresses TEXT,
  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  snippet TEXT,
  is_outbound BOOLEAN DEFAULT false,
  has_attachments BOOLEAN DEFAULT false,
  sent_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_msg_conv ON inbox.messages(conversation_id);
CREATE INDEX idx_msg_sent ON inbox.messages(sent_at DESC);

-- ── Conversation Labels ──────────────────────────────
CREATE TABLE inbox.conversation_labels (
  conversation_id UUID REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  label_id UUID REFERENCES inbox.labels(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, label_id)
);

-- ── Notes ────────────────────────────────────────────
CREATE TABLE inbox.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  author_id UUID REFERENCES inbox.team_members(id),
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Tasks ────────────────────────────────────────────
CREATE TABLE inbox.tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  assignee_id UUID REFERENCES inbox.team_members(id),
  is_done BOOLEAN DEFAULT false,
  due_date DATE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ── Activity Log ─────────────────────────────────────
CREATE TABLE inbox.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES inbox.conversations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES inbox.team_members(id),
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Realtime ─────────────────────────────────────────
ALTER PUBLICATION supabase_realtime ADD TABLE inbox.conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE inbox.messages;
ALTER PUBLICATION supabase_realtime ADD TABLE inbox.notes;
ALTER PUBLICATION supabase_realtime ADD TABLE inbox.tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE inbox.conversation_labels;

-- ── Auto-update timestamps ───────────────────────────
CREATE OR REPLACE FUNCTION inbox.update_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

CREATE TRIGGER t1 BEFORE UPDATE ON inbox.conversations FOR EACH ROW EXECUTE FUNCTION inbox.update_updated_at();
CREATE TRIGGER t2 BEFORE UPDATE ON inbox.tasks FOR EACH ROW EXECUTE FUNCTION inbox.update_updated_at();
CREATE TRIGGER t3 BEFORE UPDATE ON inbox.team_members FOR EACH ROW EXECUTE FUNCTION inbox.update_updated_at();
CREATE TRIGGER t4 BEFORE UPDATE ON inbox.email_accounts FOR EACH ROW EXECUTE FUNCTION inbox.update_updated_at();

-- ═══════════════════════════════════════════════════════
-- SEED DATA
-- ═══════════════════════════════════════════════════════

INSERT INTO inbox.team_members (email, name, initials, color, role, department) VALUES
  ('rod@trytenkara.com','Rod','RD','#4ADE80','admin','Operations'),
  ('david@trytenkara.com','David Z','DZ','#58A6FF','admin','Management'),
  ('ben@trytenkara.com','Ben S','BS','#BC8CFF','admin','Management'),
  ('marygrace@trytenkara.com','Mary Grace','MG','#F0883E','member','Support'),
  ('cj@trytenkara.com','CJ Munko','CM','#F85149','member','Operations'),
  ('ryan@trytenkara.com','Ryan Walsh','RW','#39D2C0','member','Sales');

INSERT INTO inbox.labels (name, color, bg_color, sort_order) VALUES
  ('New','#39D2C0','rgba(57,210,192,0.12)',0),
  ('Inquiry','#58A6FF','rgba(88,166,255,0.12)',1),
  ('Call Skillset','#BC8CFF','rgba(188,140,255,0.12)',2),
  ('Security Cleared','#4ADE80','rgba(74,222,128,0.12)',3),
  ('Negotiation','#F5D547','rgba(245,213,71,0.12)',4),
  ('Setup','#39D2C0','rgba(57,210,192,0.12)',5),
  ('Ordering','#F0883E','rgba(240,136,62,0.12)',6),
  ('Tracking','#58A6FF','rgba(88,166,255,0.12)',7),
  ('Completed','#4ADE80','rgba(74,222,128,0.12)',8),
  ('Escalated','#F85149','rgba(248,81,73,0.12)',9),
  ('Urgent','#F85149','rgba(248,81,73,0.12)',10),
  ('Junk Email','#7D8590','rgba(125,133,144,0.12)',11);

-- ═══════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (permissive for now)
-- ═══════════════════════════════════════════════════════
ALTER TABLE inbox.email_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.provider_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.team_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.account_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.conversation_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE inbox.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "all_access" ON inbox.email_accounts FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.provider_presets FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.team_members FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.account_access FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.labels FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.conversations FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.messages FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.conversation_labels FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.notes FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.tasks FOR ALL USING (true);
CREATE POLICY "all_access" ON inbox.activity_log FOR ALL USING (true);
