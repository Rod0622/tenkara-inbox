// ═══════════════════════════════════════════════════════
// TENKARA INBOX — Type Definitions
// ═══════════════════════════════════════════════════════

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  initials: string;
  color: string;
  role: "admin" | "member";
  department: "Operations" | "Management" | "Dev" | "Sales" | "Support" | "Uncategorized";
  created_at: string;
}

export interface Mailbox {
  id: string;
  name: string;
  email: string;
  icon: string;
  color: string;
}

export interface Conversation {
  id: string;
  gmail_thread_id: string;
  mailbox_id: string;
  subject: string;
  from_name: string;
  from_email: string;
  preview: string;
  is_unread: boolean;
  is_starred: boolean;
  assignee_id: string | null;
  status: "open" | "closed" | "snoozed";
  last_message_at: string;
  created_at: string;
  // Joined data
  labels?: ConversationLabel[];
  notes?: Note[];
  tasks?: Task[];
  messages?: GmailMessage[];
  assignee?: TeamMember;
}

export interface Label {
  id: string;
  name: string;
  color: string;
  bg_color: string;
}

export interface ConversationLabel {
  conversation_id: string;
  label_id: string;
  label?: Label;
}

export interface Note {
  id: string;
  conversation_id: string;
  author_id: string;
  text: string;
  created_at: string;
  // Joined
  author?: TeamMember;
}

export interface Task {
  id: string;
  conversation_id: string;
  text: string;
  assignee_id: string | null;
  is_done: boolean;
  due_date: string | null;
  created_at: string;
  // Joined
  assignee?: TeamMember;
}

export interface GmailMessage {
  id: string;
  thread_id: string;
  from_name: string;
  from_email: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  snippet: string;
}

// ── API Request/Response Types ───────────────────────

export interface AiRequest {
  conversation: Conversation;
  query: string;
}

export interface AiResponse {
  text: string;
}

export interface ClassificationResult {
  labels: string[];
  department: string;
  priority: "low" | "normal" | "high" | "urgent";
  suggested_assignee: string | null;
  summary: string;
}

export interface SlackNotification {
  channel: string;
  text: string;
  blocks?: any[];
}

// ── Supabase Realtime Payload ────────────────────────

export interface RealtimePayload<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: T;
}

// ── Component Props ──────────────────────────────────

export interface SidebarProps {
  activeMailbox: string | null;
  setActiveMailbox: (id: string | null) => void;
  activeView: string;
  setActiveView: (view: string) => void;
  mailboxes: Mailbox[];
  conversations: Conversation[];
  currentUser: TeamMember | null;
}

export interface ConversationListProps {
  conversations: Conversation[];
  activeConvo: Conversation | null;
  setActiveConvo: (convo: Conversation) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  teamMembers: TeamMember[];
}

export interface ConversationDetailProps {
  conversation: Conversation | null;
  currentUser: TeamMember | null;
  teamMembers: TeamMember[];
  onAddNote: (conversationId: string, text: string) => Promise<void>;
  onToggleTask: (taskId: string, isDone: boolean) => Promise<void>;
  onAddTask: (conversationId: string, text: string, assigneeId?: string) => Promise<void>;
  onAssign: (conversationId: string, assigneeId: string | null) => Promise<void>;
  onSendReply: (conversationId: string, text: string) => Promise<void>;
}

export interface AiSidebarProps {
  conversation: Conversation | null;
}
