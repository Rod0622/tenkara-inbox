export type TaskStatus = "todo" | "in_progress" | "completed";

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  initials: string;
  color: string;
  role: "admin" | "member";
  department: "Operations" | "Management" | "Dev" | "Sales" | "Support" | "Uncategorized";
  is_active?: boolean;
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
  thread_id: string;
  email_account_id: string;
  folder_id: string | null;
  subject: string;
  from_name: string;
  from_email: string;
  preview: string;
  is_unread: boolean;
  is_starred: boolean;
  assignee_id: string | null;
  status: "open" | "closed" | "snoozed" | "trash";
  last_message_at: string;
  created_at: string;
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
  conversation_id?: string;
  label_id: string;
  label?: Label;
}

export interface Note {
  id: string;
  conversation_id: string;
  author_id: string;
  text: string;
  created_at: string;
  author?: TeamMember;
}

export interface Task {
  id: string;
  conversation_id: string | null;
  text: string;
  assignee_id: string | null;
  is_done: boolean;
  status: TaskStatus;
  due_date: string | null;
  created_at: string;
  updated_at?: string;
  assignee?: TeamMember;
  assignees?: TeamMember[];
  task_assignees?: {
    team_member_id: string;
    team_member?: TeamMember;
  }[];
  conversation?: {
    id: string;
    subject: string;
    from_name?: string;
    from_email?: string;
    email_account_id?: string;
  } | null;
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

export interface ActivityLog {
  id: string;
  conversation_id: string;
  actor_id: string | null;
  action: string;
  details: Record<string, any>;
  created_at: string;
  actor?: {
    id: string;
    name: string;
    initials: string;
    color: string;
  };
}

export interface RealtimePayload<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: T;
}

export interface Folder {
  id: string;
  email_account_id: string;
  name: string;
  icon: string;
  color: string;
  sort_order: number;
  is_system: boolean;
  parent_folder_id: string | null;
}

export interface SidebarProps {
  activeMailbox: string | null;
  setActiveMailbox: (id: string | null) => void;
  activeView: string;
  setActiveView: (view: string) => void;
  activeFolder: string | null;
  setActiveFolder: (id: string | null) => void;
  mailboxes: Mailbox[];
  conversations: Conversation[];
  currentUser: TeamMember | null;
  taskCount?: number;
  onMoveToFolder?: (conversationIds: string[], folderId: string) => Promise<void>;
}

export interface ConversationListProps {
  conversations: Conversation[];
  activeConvo: Conversation | null;
  setActiveConvo: (convo: Conversation) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  teamMembers: TeamMember[];
  onBulkAction?: (ids: string[], action: string, payload?: any) => Promise<void>;
}

export interface ConversationDetailProps {
  conversation: Conversation | null;
  currentUser: TeamMember | null;
  teamMembers: TeamMember[];
  onAddNote: (conversationId: string, text: string, title?: string) => Promise<void>;
  onToggleTask: (taskId: string, isDone: boolean) => Promise<void>;
  onAddTask: (conversationId: string, text: string, assigneeIds?: string[], dueDate?: string) => Promise<void>;
  onUpdateTask: (taskId: string, updates: { status?: TaskStatus; dueDate?: string | null; assigneeIds?: string[] }) => Promise<void>;
  onAssign: (conversationId: string, assigneeId: string | null, updatedConversation?: any) => Promise<void>;
  onSendReply: (conversationId: string, text: string) => Promise<void>;
  onMoveToFolder?: (conversationIds: string[], folderId: string) => Promise<void>;
}

export interface AiSidebarProps {
  conversation: Conversation | null;
}