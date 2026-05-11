"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  Archive,
  Ban,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Circle,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  File,
  FileText,
  FolderOpen,
  Forward,
  GitBranch,
  GitMerge,
  Image,
  Loader2,
  Mail,
  MessageSquare,
  Paperclip,
  Phone,
  Pencil,
  Plus,
  Reply,
  RotateCcw,
  Search,
  Send,
  Star,
  Tag,
  Trash2,
  User,
  Users,
  X,
  ClipboardCheck,
  Link2,
  StickyNote,
} from "lucide-react";
import FormModal from "./FormModal";
import {
  useConversationDetail,
  useFolders,
  useLabels,
  useRelatedThreads,
  useThreadSummary,
} from "@/lib/hooks";
import type { ConversationDetailProps, TeamMember } from "@/types";
import { createBrowserClient } from "@/lib/supabase";
import { addBusinessHours, type SupplierHours } from "@/lib/business-hours";
import TaskCountdown from "@/components/TaskCountdown";
import RichTextEditor from "@/components/RichTextEditor";
import AIDraftModal from "@/components/AIDraftModal";
import Avatar from "./ConversationDetail/Avatar";
import HighlightedText from "./ConversationDetail/HighlightedText";
import MessageHeader from "./ConversationDetail/MessageHeader";
import ActivityList from "./ConversationDetail/ActivityList";
import MoveToFolderDropdown from "./ConversationDetail/MoveToFolderDropdown";
import AssignDropdown from "./ConversationDetail/AssignDropdown";
import CallAssignment from "./ConversationDetail/CallAssignment";
import StatusDropdown from "./ConversationDetail/StatusDropdown";
import SlaResetPanel from "./ConversationDetail/SlaResetPanel";
import LabelPicker from "./ConversationDetail/LabelPicker";
import TeamChat from "./ConversationDetail/TeamChat";
import ThreadAttachmentBar from "./ConversationDetail/ThreadAttachmentBar";
import MessageAttachments from "./ConversationDetail/MessageAttachments";
import WatchToggle from "./WatchToggle";
import type { SuggestedTaskItem, OpenActionItemState, CompletedItemState } from "./ConversationDetail/types";
import { normalizeSuggestedTaskText, getNormalizedTokens, getTaskMatchMeta } from "./ConversationDetail/utils";

// Strip HTML tags + decode common entities from a string. Used when we surface
// message previews in chips/labels — raw email bodies often contain &nbsp; &amp;
// etc. that look ugly when shown as plain text.
function plainPreview(input: any, maxLen = 80): string {
  if (!input) return "";
  let s = String(input);
  // Strip tags first
  s = s.replace(/<[^>]*>/g, " ");
  // Decode named entities we commonly see
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
  // Decode numeric entities (decimal and hex)
  s = s.replace(/&#(\d+);/g, (_, n) => {
    try { return String.fromCharCode(parseInt(n, 10)); } catch { return ""; }
  });
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => {
    try { return String.fromCharCode(parseInt(n, 16)); } catch { return ""; }
  });
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > maxLen) s = s.slice(0, maxLen) + "…";
  return s;
}

export default function ConversationDetail({
  conversation: convo,
  currentUser,
  teamMembers,
  onAddNote,
  onToggleTask,
  onAddTask,
  onUpdateTask,
  onAssign,
  onSendReply,
  onMoveToFolder,
  globalSearchQuery,
}: ConversationDetailProps) {
  const [replyText, setReplyText] = useState("");
  // Batch 11: cc/bcc on the main reply editor (mirrors the inline-compose pattern)
  const [replyCc, setReplyCc] = useState("");
  const [replyBcc, setReplyBcc] = useState("");
  const [showReplyCc, setShowReplyCc] = useState(false);
  const [showReplyBcc, setShowReplyBcc] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpCustomDate, setFollowUpCustomDate] = useState("");
  const [followUpCustomTime, setFollowUpCustomTime] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");
  const [settingFollowUp, setSettingFollowUp] = useState(false);
  const [showInlineCompose, setShowInlineCompose] = useState(false);
  const [inlineComposeTo, setInlineComposeTo] = useState("");
  const [inlineComposeSubject, setInlineComposeSubject] = useState("");
  const [inlineComposeBody, setInlineComposeBody] = useState("");
  const [inlineComposeCc, setInlineComposeCc] = useState("");
  const [inlineComposeBcc, setInlineComposeBcc] = useState("");
  const [showInlineComposeCc, setShowInlineComposeCc] = useState(false);
  const [showInlineComposeBcc, setShowInlineComposeBcc] = useState(false);
  const [sendingInlineCompose, setSendingInlineCompose] = useState(false);
  const [activeReminder, setActiveReminder] = useState<any>(null);

  // Phase 4: folders for the StatusDropdown's "close to" picker
  const allFolders = useFolders();

  // In-thread search
  const [threadSearch, setThreadSearch] = useState("");
  const [threadSearchActive, setThreadSearchActive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const matchRefs = useRef<(HTMLElement | null)[]>([]);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  // Scroll to current match
  useEffect(() => {
    if (!threadSearchActive || !threadSearch) return;
    const timer = setTimeout(() => {
      const container = messagesScrollRef.current;
      if (!container) return;
      const marks = container.querySelectorAll("mark[data-match-idx]");
      if (marks.length === 0) return;
      const idx = ((currentMatchIndex % marks.length) + marks.length) % marks.length;
      // Reset all
      marks.forEach((m) => (m as HTMLElement).style.background = "rgba(245,213,71,0.4)");
      // Highlight and scroll to current
      const target = marks[idx] as HTMLElement;
      if (target) {
        target.style.background = "rgba(245,213,71,0.8)";
        // Find the closest scrollable parent and scroll
        const targetTop = target.offsetTop;
        let parent = target.offsetParent as HTMLElement | null;
        let accumulatedTop = target.offsetTop;
        while (parent && parent !== container) {
          accumulatedTop += parent.offsetTop;
          parent = parent.offsetParent as HTMLElement | null;
        }
        container.scrollTop = accumulatedTop - container.clientHeight / 2;
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [currentMatchIndex, threadSearch, threadSearchActive]);

  // Reset search when conversation changes
  useEffect(() => {
    setThreadSearch("");
    setThreadSearchActive(false);
    setCurrentMatchIndex(0);
    matchRefs.current = [];
  }, [convo?.id]);

  // Fetch existing reminder for this conversation
  useEffect(() => {
    if (!convo?.id || !currentUser?.id) { setActiveReminder(null); return; }
    fetch("/api/reminders?user_id=" + currentUser.id)
      .then((r) => r.json())
      .then((data) => {
        const match = (data.reminders || []).find(
          (r: any) => r.conversation_id === convo.id && !r.is_dismissed
        );
        setActiveReminder(match || null);
      })
      .catch(() => setActiveReminder(null));
  }, [convo?.id, currentUser?.id, showFollowUp]); // re-fetch after setting a reminder
  const [replyAttachments, setReplyAttachments] = useState<{ name: string; size: number; type: string; data: string }[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const [showReplyDrive, setShowReplyDrive] = useState(false);
  const [replyDriveFolders, setReplyDriveFolders] = useState<any[]>([]);
  const [replyDriveFiles, setReplyDriveFiles] = useState<any[]>([]);
  const [replyDrivePath, setReplyDrivePath] = useState<{ id: string; name: string }[]>([]);
  const [replyDriveLoading, setReplyDriveLoading] = useState(false);
  const [replyDriveDefaultFolder, setReplyDriveDefaultFolder] = useState<string | null>(null);
  const [showReplyTemplateModal, setShowReplyTemplateModal] = useState(false);
  const [replyTemplates, setReplyTemplates] = useState<any[]>([]);
  const [showAIDraftModal, setShowAIDraftModal] = useState(false);
  const [showReplyEditor, setShowReplyEditor] = useState(false);
  const [showFormModal, setShowFormModal] = useState<{ taskId?: string; categoryId?: string } | null>(null);
  const [replySignature, setReplySignature] = useState("");
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);

  // Check for drafts when conversation loads
  useEffect(() => {
    if (!convo?.id || !currentUser?.id) return;
    (async () => {
      try {
        const res = await fetch(`/api/drafts?conversation_id=${convo.id}`);
        if (res.ok) {
          const data = await res.json();
          const myDraft = (data.drafts || []).find((d: any) => d.author_id === currentUser.id) || (data.drafts || [])[0];
          if (myDraft) {
            setReplyText(myDraft.body_html || myDraft.body_text || "");
            setLoadedDraftId(myDraft.id);
            setShowReplyEditor(true);
          } else {
            setLoadedDraftId(null);
          }
        }
      } catch { /* silent */ }
    })();
  }, [convo?.id, currentUser?.id]);

  // Auto-save draft when user stops typing for 3 seconds
  useEffect(() => {
    if (!convo?.id || !currentUser?.id || !showReplyEditor) return;
    const plainText = (replyText || "").replace(/<[^>]*>/g, "").trim();
    // Don't save empty or signature-only drafts
    const sigText = (replySignature || "").replace(/<[^>]*>/g, "").trim();
    if (!plainText || plainText === sigText) {
      // If there was a loaded draft and user cleared the text, delete the draft
      if (loadedDraftId && !plainText) {
        fetch(`/api/drafts?id=${loadedDraftId}`, { method: "DELETE" }).catch(() => {});
        setLoadedDraftId(null);
      }
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/drafts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: convo.id,
            email_account_id: convo.email_account_id,
            author_id: currentUser.id,
            to_addresses: convo.from_email,
            subject: `Re: ${convo.subject}`,
            body_html: replyText,
            is_reply: true,
            source: "manual",
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.draft?.id) setLoadedDraftId(data.draft.id);
        }
      } catch { /* silent */ }
    }, 3000);
    return () => clearTimeout(timer);
  }, [replyText, convo?.id, showReplyEditor]);

  // Fetch account signature for replies
  useEffect(() => {
    if (convo?.email_account_id) {
      Promise.resolve().then(() => {
        const sb = createBrowserClient();
        sb.from("email_accounts")
          .select("signature, signature_enabled")
          .eq("id", convo.email_account_id)
          .single()
          .then(({ data }: any) => {
            if (data?.signature_enabled && data?.signature) {
              setReplySignature(data.signature);
            } else {
              setReplySignature("");
            }
          });
      });
    }
  }, [convo?.email_account_id]);
  const [noteText, setNoteText] = useState("");
  const [noteTitle, setNoteTitle] = useState("");
  // Optional: pin the new note to a specific message in the thread
  const [noteMessageId, setNoteMessageId] = useState<string | null>(null);
  // Selection mode in Messages tab — set when user is picking a message to attach.
  //   "creating" = picking for the new-note form
  //   string id  = picking for an existing note (retroactive change)
  //   null       = not in selection mode
  const [pickingMessageFor, setPickingMessageFor] = useState<"creating" | string | null>(null);
  // When set, briefly highlight the note with this id (after navigating from a marker)
  const [highlightedNoteId, setHighlightedNoteId] = useState<string | null>(null);
  // Notes by id → DOM element, used to scroll-to-note when clicking a marker
  const noteRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Which note is currently in the "pick a message to attach" mode (for retroactive attaching)
  const [attachingNoteId, setAttachingNoteId] = useState<string | null>(null);
  // Loading state during retroactive attach/detach
  const [attachingPending, setAttachingPending] = useState<string | null>(null);
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [showTaskInput, setShowTaskInput] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [deletingTasks, setDeletingTasks] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTaskText, setEditTaskText] = useState("");
  const [editTaskAssigneeIds, setEditTaskAssigneeIds] = useState<string[]>([]);
  const [editTaskDueDate, setEditTaskDueDate] = useState("");
  const [editTaskCategoryId, setEditTaskCategoryId] = useState("");
  const [editTaskDueTime, setEditTaskDueTime] = useState("");
  const [activeTab, setActiveTab] = useState("messages");
  const [sending, setSending] = useState(false);
  const [newTaskText, setNewTaskText] = useState("");
  const [newTaskAssigneeIds, setNewTaskAssigneeIds] = useState<string[]>([]);
  const [newTaskDueDate, setNewTaskDueDate] = useState("");
  const [newTaskDueTime, setNewTaskDueTime] = useState("");
  const [newTaskCategoryId, setNewTaskCategoryId] = useState("");
  const [taskCategories, setTaskCategories] = useState<any[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<any[]>([]);
  const [showTaskTemplates, setShowTaskTemplates] = useState(false);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [accountAccessMap, setAccountAccessMap] = useState<Record<string, string[]>>({});
  const [creatingSuggestedTasks, setCreatingSuggestedTasks] = useState<string[]>([]);
  const [creatingAllSuggestedTasks, setCreatingAllSuggestedTasks] = useState(false);
  // Batch 11: also includes responsiveness score for the header chip
  const [supplierHoursInfo, setSupplierHoursInfo] = useState<{
    timezone: string;
    work_start: string;
    work_end: string;
    work_days: number[];
    responsiveness_score?: number | null;
    responsiveness_tier?: string | null;
    qualifying_exchanges?: number | null;
    weighted_median_minutes?: number | null;
    all_time_median_minutes?: number | null;
    score_updated_at?: string | null;
  } | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardCc, setForwardCc] = useState("");
  const [forwardSubject, setForwardSubject] = useState("");
  const [forwardBody, setForwardBody] = useState("");
  const [forwardSending, setForwardSending] = useState(false);
  // Reply-as-modal state: gives users the ability to edit To / Subject before sending,
  // unlike the inline reply textarea which only supports the body.
  const [showReplyModal, setShowReplyModal] = useState(false);
  const [replyModalTo, setReplyModalTo] = useState("");
  const [replyModalCc, setReplyModalCc] = useState("");
  const [replyModalBcc, setReplyModalBcc] = useState("");
  const [replyModalSubject, setReplyModalSubject] = useState("");
  const [replyModalBody, setReplyModalBody] = useState("");
  const [replyModalSending, setReplyModalSending] = useState(false);
  const [trashingConversation, setTrashingConversation] = useState(false);
  const [markingSpam, setMarkingSpam] = useState(false);

  const {
    notes,
    tasks,
    messages,
    activities,
    refetch: refetchDetail,
  } = useConversationDetail(convo?.id || null);

  // Auto-activate thread search when coming from global search
  useEffect(() => {
    if (globalSearchQuery && convo?.id) {
      setThreadSearch(globalSearchQuery);
      setThreadSearchActive(true);
      setCurrentMatchIndex(0);
      matchRefs.current = [];
      setActiveTab("messages");
    }
  }, [convo?.id, globalSearchQuery]);

  // Fetch supplier business hours + responsiveness score for header display
  useEffect(() => {
    setSupplierHoursInfo(null);
    if (!convo?.from_email || convo.from_email === "internal") return;
    Promise.resolve().then(() => {
      const sb = createBrowserClient();
      // Batch 11: extended select to also pull responsiveness score columns (Batch 10's stored values).
      sb.from("supplier_contacts")
        .select("timezone, work_start, work_end, work_days, responsiveness_score, responsiveness_tier, qualifying_exchanges, weighted_median_minutes, all_time_median_minutes, score_updated_at")
        .eq("email", convo.from_email.toLowerCase())
        .maybeSingle()
        .then(({ data }: any) => {
          if (data) setSupplierHoursInfo(data);
        });
    });
  }, [convo?.id, convo?.from_email]);

  // Re-scroll when messages load
  useEffect(() => {
    if (!threadSearchActive || !threadSearch || messages.length === 0) return;
    const timer = setTimeout(() => {
      const container = messagesScrollRef.current;
      if (!container) return;
      const marks = container.querySelectorAll("mark[data-match-idx]");
      if (marks.length === 0) return;
      const idx = ((currentMatchIndex % marks.length) + marks.length) % marks.length;
      marks.forEach((m) => (m as HTMLElement).style.background = "rgba(245,213,71,0.4)");
      const target = marks[idx] as HTMLElement;
      if (target) {
        target.style.background = "rgba(245,213,71,0.8)";
        let accumulatedTop = target.offsetTop;
        let parent = target.offsetParent as HTMLElement | null;
        while (parent && parent !== container) {
          accumulatedTop += parent.offsetTop;
          parent = parent.offsetParent as HTMLElement | null;
        }
        container.scrollTop = accumulatedTop - container.clientHeight / 2;
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [messages.length, threadSearchActive]);

  const {
    threads: relatedThreads,
    externalEmail,
    summary,
    loading: relatedThreadsLoading,
  } = useRelatedThreads(convo?.id || null);

  // Batch 8: load all labels so we can render label chips as "Parent / Child"
  // when they have a parent. The hook returns the full labels list including parent_label_id.
  const allLabelsForChips = useLabels();
  const labelChipName = (label: any): string => {
    if (!label) return "";
    if (!label.parent_label_id) return label.name || "";
    const parent = allLabelsForChips.find((l: any) => l.id === label.parent_label_id);
    return parent ? `${parent.name} / ${label.name}` : label.name || "";
  };

  // Merge state
  const [mergedThreads, setMergedThreads] = useState<any[]>([]);
  const [mergingThreadId, setMergingThreadId] = useState<string | null>(null);
  const [unmergingId, setUnmergingId] = useState<string | null>(null);
  const [mergeDataLoaded, setMergeDataLoaded] = useState(false);

  // Lazy-load merge data only when Related Threads tab is opened
  useEffect(() => {
    if (activeTab !== "related" || !convo?.id || mergeDataLoaded) return;
    fetch(`/api/merge?conversation_id=${convo.id}`)
      .then(r => r.json())
      .then(d => { setMergedThreads(d.merges || []); setMergeDataLoaded(true); })
      .catch(() => { setMergedThreads([]); setMergeDataLoaded(true); });
  }, [activeTab, convo?.id, mergeDataLoaded]);

  // Reset merge data when conversation changes
  useEffect(() => {
    setMergedThreads([]);
    setMergeDataLoaded(false);
  }, [convo?.id]);

  const handleMerge = async (threadId: string) => {
    if (!convo?.id || !confirm("Merge this thread into the current conversation?\n\nAll messages, tasks, notes, and activities will be moved here. This can be undone later.")) return;
    setMergingThreadId(threadId);
    try {
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ primary_id: convo.id, merge_ids: [threadId], actor_id: currentUser?.id }),
      });
      if (res.ok) {
        await refetchDetail();
        setMergeDataLoaded(false); // trigger refetch of merge data
      } else {
        const err = await res.json();
        alert("Merge failed: " + (err.error || "Unknown error"));
      }
    } catch (e: any) { alert("Merge failed: " + e.message); }
    setMergingThreadId(null);
  };

  const handleUnmerge = async (mergeId: string) => {
    if (!confirm("Unmerge this thread?\n\nAll original messages, tasks, notes will be restored to the original conversation.")) return;
    setUnmergingId(mergeId);
    try {
      const res = await fetch(`/api/merge?merge_id=${mergeId}&actor_id=${currentUser?.id || ""}`, { method: "DELETE" });
      if (res.ok) {
        await refetchDetail();
        setMergeDataLoaded(false); // trigger refetch of merge data
      } else {
        const err = await res.json();
        alert("Unmerge failed: " + (err.error || "Unknown error"));
      }
    } catch (e: any) { alert("Unmerge failed: " + e.message); }
    setUnmergingId(null);
  };

  const {
    summary: threadSummary,
    loading: threadSummaryLoading,
    generating: threadSummaryGenerating,
    generateSummary,
  } = useThreadSummary(convo?.id || null);

  // Load task categories and user groups (including account-based groups)
  useEffect(() => {
    Promise.resolve().then(() => {
      const sb = createBrowserClient();
      sb.from("task_categories").select("*").eq("is_active", true).order("sort_order")
        .then(({ data }) => setTaskCategories(data || []));

      // Load task templates
      sb.from("task_templates").select("*").eq("is_active", true).order("sort_order")
        .then(({ data }) => setTaskTemplates(data || []), () => setTaskTemplates([]));

      // Load manual user groups
      sb.from("user_groups").select("*, user_group_members(team_member_id)").eq("is_active", true).order("created_at")
        .then(async ({ data: manualGroups }) => {
          const groups = [...(manualGroups || [])];

          // Also create virtual groups from account_access
          const [accRes, accessRes] = await Promise.all([
            sb.from("email_accounts").select("id, name, icon, color").eq("is_active", true),
            sb.from("account_access").select("email_account_id, team_member_id"),
          ]);

          const accounts = accRes.data || [];
          const accessRows = accessRes.data || [];

          // Build account -> members map
          const accountMembers: Record<string, string[]> = {};
          for (const row of accessRows) {
            if (!accountMembers[row.email_account_id]) accountMembers[row.email_account_id] = [];
            accountMembers[row.email_account_id].push(row.team_member_id);
          }
          setAccountAccessMap(accountMembers);

          // Create virtual groups for accounts that have access restrictions
          for (const acc of accounts) {
            const memberIds = accountMembers[acc.id];
            if (memberIds && memberIds.length > 0) {
              groups.push({
                id: `account:${acc.id}`,
                name: acc.name,
                icon: acc.icon || "📬",
                color: acc.color || "var(--info)",
                is_active: true,
                _isAccountGroup: true,
                user_group_members: memberIds.map((id) => ({ team_member_id: id })),
              });
            }
          }

          setUserGroups(groups);
        });
    });
  }, []);

  useEffect(() => {
    setActiveTab("messages");
    setShowNoteInput(false);
    setShowTaskInput(false);
    setReplyText("");
    setNoteText("");
    setNewTaskText("");
    setNewTaskAssigneeIds([]);
    setNewTaskDueDate("");
  }, [convo?.id]);

  useEffect(() => {
    if (!convo?.id) return;

    if (currentUser?.id) {
      fetch("/api/conversations/activity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          actor_id: currentUser.id,
          action: "viewed",
          details: {},
        }),
      }).catch(() => {});
    }

    if (convo.is_unread) {
      fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          is_unread: false,
          actor_id: currentUser?.id,
        }),
      }).catch(() => {});
    }
  }, [convo?.id, convo?.is_unread, currentUser?.id]);

  // Batch 11: gate on assignee_id explicitly. If the conversation has no assignee_id,
  // the assignee is unambiguously null — don't fall back to a possibly-stale embedded object.
  const assignee = useMemo(() => {
    if (!convo?.assignee_id) return null;
    return convo.assignee || teamMembers.find((member) => member.id === convo.assignee_id) || null;
  }, [convo, teamMembers]);

  const tabs = [
    { id: "messages", label: "Messages", count: messages.length },
    { id: "notes", label: "Notes", count: notes.length },
    { id: "tasks", label: "Tasks", count: tasks.length },
    { id: "activity", label: "Activity", count: activities.length },
    { id: "related", label: "Related Threads", count: relatedThreads.length },
    { id: "summary", label: "Summary", count: 0 },
  ];

  const isReviewTab = activeTab !== "messages";

  // Members who have access to this conversation's email account
  const assignableMembers = useMemo(() => {
    const active = teamMembers.filter((m) => m.is_active !== false);
    if (!convo?.email_account_id) return active;
    const allowedIds = accountAccessMap[convo.email_account_id];
    if (!allowedIds || allowedIds.length === 0) return active; // no restrictions = all users
    return active.filter((m) => allowedIds.includes(m.id));
  }, [teamMembers, convo?.email_account_id, accountAccessMap]);

  const getTaskAssignees = (task: any) =>
    task.assignees?.length ? task.assignees : task.assignee ? [task.assignee] : [];

  const handleAddNoteInternal = async () => {
    if (!convo || !noteText.trim()) return;
    await onAddNote(convo.id, noteText.trim(), noteTitle.trim(), noteMessageId);
    setNoteText("");
    setNoteTitle("");
    setNoteMessageId(null);
    setShowNoteInput(false);
    await refetchDetail();
  };

  // Click a note-marker on a message: switch to Notes tab, scroll to + flash the note.
  const handleJumpToNote = (noteId: string) => {
    setActiveTab("notes");
    // Defer to next tick so the Notes tab DOM is mounted
    setTimeout(() => {
      const el = noteRefs.current[noteId];
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setHighlightedNoteId(noteId);
      // Clear the highlight after the flash animation
      setTimeout(() => setHighlightedNoteId(null), 1800);
    }, 80);
  };

  // Retroactively attach an existing note to a specific message (or detach if null).
  const handleAttachNoteToMessage = async (noteId: string, messageId: string | null) => {
    setAttachingPending(noteId);
    try {
      const res = await fetch("/api/conversations/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note_id: noteId, message_id: messageId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || "Failed to update note attachment");
        return;
      }
      setAttachingNoteId(null);
      await refetchDetail();
    } finally {
      setAttachingPending(null);
    }
  };

  // Triggered when the user is in "pick a message" mode and clicks one.
  // Routes the pick back to whichever workflow started selection mode.
  const handleMessagePicked = (messageId: string) => {
    if (pickingMessageFor === "creating") {
      // For the new-note form: just store the id and return to the Notes tab
      setNoteMessageId(messageId);
      setPickingMessageFor(null);
      setActiveTab("notes");
    } else if (typeof pickingMessageFor === "string") {
      // For an existing note: PATCH the attachment, return to Notes tab
      const noteId = pickingMessageFor;
      handleAttachNoteToMessage(noteId, messageId);
      setPickingMessageFor(null);
      setActiveTab("notes");
    }
  };

  // Enter selection mode for the new-note form, switching to Messages tab.
  const startPickingForNewNote = () => {
    setPickingMessageFor("creating");
    setActiveTab("messages");
  };

  // Enter selection mode for an existing note, switching to Messages tab.
  const startPickingForExistingNote = (noteId: string) => {
    setPickingMessageFor(noteId);
    setAttachingNoteId(null); // close any inline picker that was open
    setActiveTab("messages");
  };

  const handleAddTaskInternal = async () => {
    if (!convo || !newTaskText.trim()) return;

    // Calculate due_time from hours using supplier business hours
    let computedDueDate = newTaskDueDate || undefined;
    let computedDueTime: string | undefined = undefined;
    if (newTaskDueTime) {
      const hours = parseInt(newTaskDueTime);
      if (hours > 0) {
        // Fetch supplier hours if available
        let supplierHrs: SupplierHours | null = null;
        try {
          if ((convo as any)?.supplier_contact_id) {
            const sb = createBrowserClient();
            const { data: sc } = await sb.from("supplier_contacts")
              .select("timezone, work_start, work_end, work_days")
              .eq("id", (convo as any).supplier_contact_id)
              .single();
            if (sc) supplierHrs = sc;
          }
        } catch (_e) { /* use defaults */ }

        const result = addBusinessHours(new Date(), hours, supplierHrs);
        computedDueDate = computedDueDate || result.dueDate;
        computedDueTime = result.dueTime;
      }
    }

    await onAddTask(
      convo.id,
      newTaskText.trim(),
      newTaskAssigneeIds.length > 0
        ? newTaskAssigneeIds
        : currentUser?.id
          ? [currentUser.id]
          : [],
      computedDueDate,
      newTaskCategoryId || undefined,
      computedDueTime
    );

    await refetchDetail();
    setActiveTab("tasks");
    setNewTaskText("");
    setNewTaskAssigneeIds([]);
    setNewTaskDueDate("");
    setNewTaskDueTime("");
    setNewTaskCategoryId("");
    setShowTaskInput(false);
  };

  const handleDeleteTasks = async (taskIds: string[]) => {
    if (taskIds.length === 0) return;
    if (!confirm(`Delete ${taskIds.length} task${taskIds.length !== 1 ? "s" : ""}? This removes the task for all assignees.`)) return;
    setDeletingTasks(true);
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_ids: taskIds }),
      });
      setSelectedTaskIds([]);
      await refetchDetail();
    } catch (e) { console.error(e); }
    setDeletingTasks(false);
  };

  const startEditTask = (task: any) => {
    const assignees = task.assignees || [];
    setEditingTaskId(task.id);
    setEditTaskText(task.text || "");
    setEditTaskAssigneeIds(assignees.map((a: any) => a.id));
    setEditTaskDueDate(task.due_date || "");
    setEditTaskDueTime(task.due_time || "");
    setEditTaskCategoryId(task.category_id || "");
  };

  const cancelEditTask = () => {
    setEditingTaskId(null);
    setEditTaskText("");
    setEditTaskAssigneeIds([]);
    setEditTaskDueDate("");
    setEditTaskDueTime("");
    setEditTaskCategoryId("");
  };

  const saveEditTask = async () => {
    if (!editingTaskId || !editTaskText.trim()) return;
    try {
      // Calculate due_time from hours using supplier business hours
      let computedDueDate = editTaskDueDate || null;
      let computedDueTime: string | null = editTaskDueTime || null;
      if (editTaskDueTime && !editTaskDueTime.includes(":")) {
        // It's hours, not a time string
        const hours = parseInt(editTaskDueTime);
        if (hours > 0) {
          let supplierHrs: SupplierHours | null = null;
          try {
            if ((convo as any)?.supplier_contact_id) {
              const sb = createBrowserClient();
              const { data: sc } = await sb.from("supplier_contacts")
                .select("timezone, work_start, work_end, work_days")
                .eq("id", (convo as any).supplier_contact_id)
                .single();
              if (sc) supplierHrs = sc;
            }
          } catch (_e) { /* use defaults */ }

          const result = addBusinessHours(new Date(), hours, supplierHrs);
          computedDueDate = computedDueDate || result.dueDate;
          computedDueTime = result.dueTime;
        }
      }

      await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: editingTaskId,
          text: editTaskText.trim(),
          due_date: computedDueDate,
          due_time: computedDueTime,
          assignee_ids: editTaskAssigneeIds,
          category_id: editTaskCategoryId || null,
        }),
      });

      // Update task_assignees: rebuild the join table
      const sb = createBrowserClient();
      await sb.from("task_assignees").delete().eq("task_id", editingTaskId);
      if (editTaskAssigneeIds.length > 0) {
        await sb.from("task_assignees").insert(
          editTaskAssigneeIds.map((mid) => ({ task_id: editingTaskId, team_member_id: mid }))
        );
      }

      cancelEditTask();
      await refetchDetail();
    } catch (e) { console.error(e); }
  };

  const openReplyTemplatePicker = async () => {
    setShowReplyTemplateModal(true);
    if (replyTemplates.length === 0) {
      Promise.resolve().then(() => {
        const sb = createBrowserClient();
        sb.from("email_templates").select("*").eq("is_active", true).order("scope").order("sort_order")
          .then(({ data }) => setReplyTemplates(data || []));
      });
    }
  };

  const openReplyDrivePicker = async () => {
    setShowReplyDrive(true);
    setReplyDriveFolders([]); setReplyDriveFiles([]); setReplyDrivePath([]);
    setReplyDriveLoading(true);
    try {
      const configRes = await fetch("/api/drive?action=config");
      const config = await configRes.json();
      if (config.mode === "direct" && config.folderId) {
        setReplyDriveDefaultFolder(config.folderId);
        setReplyDrivePath([{ id: config.folderId, name: "Training Files" }]);
        const [fr, fi] = await Promise.all([
          fetch(`/api/drive?action=folders&folder_id=${config.folderId}`),
          fetch(`/api/drive?action=files&folder_id=${config.folderId}`),
        ]);
        setReplyDriveFolders((await fr.json()).folders || []);
        setReplyDriveFiles((await fi.json()).files || []);
      }
    } catch (e) { console.error(e); }
    setReplyDriveLoading(false);
  };

  const navigateReplyDriveFolder = async (folder: any) => {
    setReplyDrivePath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setReplyDriveLoading(true);
    try {
      const [fr, fi] = await Promise.all([
        fetch(`/api/drive?action=folders&folder_id=${folder.id}`),
        fetch(`/api/drive?action=files&folder_id=${folder.id}`),
      ]);
      setReplyDriveFolders((await fr.json()).folders || []);
      setReplyDriveFiles((await fi.json()).files || []);
    } catch (e) { console.error(e); }
    setReplyDriveLoading(false);
  };

  const navigateReplyDrivePath = async (index: number) => {
    const newPath = index < 0 ? [{ id: replyDriveDefaultFolder!, name: "Training Files" }] : replyDrivePath.slice(0, index + 1);
    setReplyDrivePath(newPath);
    setReplyDriveLoading(true);
    try {
      const fId = newPath[newPath.length - 1].id;
      const [fr, fi] = await Promise.all([
        fetch(`/api/drive?action=folders&folder_id=${fId}`),
        fetch(`/api/drive?action=files&folder_id=${fId}`),
      ]);
      setReplyDriveFolders((await fr.json()).folders || []);
      setReplyDriveFiles((await fi.json()).files || []);
    } catch (e) { console.error(e); }
    setReplyDriveLoading(false);
  };

  const attachReplyDriveFile = async (file: any) => {
    try {
      const res = await fetch(`/api/drive?action=download&file_id=${file.id}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(blob);
      });
      setReplyAttachments((prev) => [...prev, {
        name: file.name, size: file.size || 0,
        type: file.mimeType || "application/octet-stream", data,
      }]);
    } catch (e) { console.error(e); }
  };

  // ── Pre-send checks ──
  const checkMissingAttachments = (bodyHtml: string, attachmentCount: number): string | null => {
    const text = bodyHtml.replace(/<[^>]*>/g, "").toLowerCase();
    const attachmentKeywords = [
      "attached", "attachment", "attachments", "attaching", "enclosed", "enclosing",
      "find attached", "see attached", "please find", "i have attached", "i've attached",
      "sending you the file", "here is the file", "here are the files",
    ];
    const imageKeywords = ["image", "images", "photo", "photos", "picture", "pictures", "screenshot", "screenshots"];
    const infoKeywords = ["my address", "our address", "my phone", "our phone", "phone number", "contact number", "my number"];

    if (attachmentCount > 0) return null; // has attachments, no warning needed

    const matchedAttachment = attachmentKeywords.find(kw => text.includes(kw));
    if (matchedAttachment) return `Your message mentions "${matchedAttachment}" but no files are attached.`;

    const matchedImage = imageKeywords.find(kw => text.includes(kw));
    if (matchedImage) return `Your message mentions "${matchedImage}" but no files are attached.`;

    const matchedInfo = infoKeywords.find(kw => text.includes(kw));
    if (matchedInfo) return `Your message mentions "${matchedInfo}" — did you include the details?`;

    return null;
  };

  const handleSendReplyInternal = async () => {
    if (!convo) return;
    const textContent = replyText.replace(/<[^>]*>/g, "").trim();
    if (!textContent && replyAttachments.length === 0) return;

    // Check for missing attachments
    const warning = checkMissingAttachments(replyText, replyAttachments.length);
    if (warning && !confirm(warning + "\n\nSend anyway?")) return;

    setSending(true);
    try {
      // Batch 11: pass cc/bcc through. The hook → /api/send already supports them.
      await onSendReply(
        convo.id,
        replyText,
        replyAttachments.length > 0 ? replyAttachments : undefined,
        replyCc.trim() || undefined,
        replyBcc.trim() || undefined,
      );
      setReplyText("");
      setReplyAttachments([]);
      setReplyCc("");
      setReplyBcc("");
      setShowReplyCc(false);
      setShowReplyBcc(false);
      // Delete draft if one was loaded
      if (loadedDraftId) {
        fetch(`/api/drafts?id=${loadedDraftId}`, { method: "DELETE" }).catch(() => {});
        setLoadedDraftId(null);
      }
      await refetchDetail();
    } finally {
      setSending(false);
    }
  };

  const handleReplyAction = () => {
    if (!convo) return;
    setActiveTab("messages");

    // Pre-populate the modal:
    //   • To: most recent inbound sender, otherwise original convo.from_email
    //   • Subject: existing subject prefixed with "Re: " (unless already prefixed)
    //   • Body: empty (signature will be appended on send via the existing pipeline)
    const latestInbound =
      [...messages].reverse().find((msg: any) => !msg.is_outbound) || messages[messages.length - 1];

    const replyTo = latestInbound?.from_email || convo.from_email || "";
    const baseSubject = String(convo.subject || "").trim();
    const replySubject = /^re:\s/i.test(baseSubject)
      ? baseSubject
      : `Re: ${baseSubject || "(No subject)"}`;

    setReplyModalTo(replyTo);
    setReplyModalCc("");
    setReplyModalBcc("");
    setReplyModalSubject(replySubject);
    setReplyModalBody("");
    setShowReplyModal(true);
  };

  const handleSendReplyModal = async () => {
    if (!convo) return;
    if (!replyModalTo.trim() || !replyModalSubject.trim() || !replyModalBody.trim()) return;

    // Optional missing-attachment check (mirrors Forward flow)
    const warning = checkMissingAttachments(replyModalBody, 0);
    if (warning && !confirm(warning + "\n\nSend anyway?")) return;

    try {
      setReplyModalSending(true);

      // Use /api/send in REPLY mode (conversation_id present) so the message
      // threads correctly into this conversation. The endpoint accepts
      // overrides for `to` and `subject`.
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          account_id: convo.email_account_id,
          to: replyModalTo.trim(),
          cc: replyModalCc.trim(),
          bcc: replyModalBcc.trim(),
          subject: replyModalSubject.trim(),
          body: replyModalBody,
          actor_id: currentUser?.id || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to send reply");
      }

      // Close + reset
      setShowReplyModal(false);
      setReplyModalTo("");
      setReplyModalCc("");
      setReplyModalBcc("");
      setReplyModalSubject("");
      setReplyModalBody("");
    } catch (error: any) {
      console.error("Reply (modal) failed:", error);
      alert(error?.message || "Failed to send reply");
    } finally {
      setReplyModalSending(false);
    }
  };

  const handleOpenForward = () => {
    if (!convo) return;

    const latestMessage = messages[messages.length - 1];
    const sourceBody = String(latestMessage?.body_text || latestMessage?.snippet || convo.preview || "");

    const formattedForward = [
      "",
      "",
      "---------- Forwarded message ---------",
      `From: ${latestMessage?.from_name || convo.from_name || ""} <${latestMessage?.from_email || convo.from_email || ""}>`,
      latestMessage?.to_addresses ? `To: ${latestMessage.to_addresses}` : "",
      latestMessage?.cc_addresses ? `Cc: ${latestMessage.cc_addresses}` : "",
      `Subject: ${latestMessage?.subject || convo.subject || ""}`,
      latestMessage?.sent_at ? `Date: ${new Date(latestMessage.sent_at).toLocaleString()}` : "",
      "",
      sourceBody,
    ]
      .filter(Boolean)
      .join("\n");

    setForwardTo("");
    setForwardCc("");
    setForwardSubject(
      convo.subject?.toLowerCase().startsWith("fwd:")
        ? convo.subject
        : `Fwd: ${convo.subject || "(No subject)"}`
    );
    setForwardBody(formattedForward);
    setShowForwardModal(true);
  };

  const handleSendForward = async () => {
    if (!convo) return;
    if (!forwardTo.trim() || !forwardSubject.trim() || !forwardBody.trim()) return;

    // Check for missing attachments in forward body
    const warning = checkMissingAttachments(forwardBody, 0);
    if (warning && !confirm(warning + "\n\nSend anyway?")) return;

    try {
      setForwardSending(true);

      const res = await fetch("/api/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account_id: convo.email_account_id,
          to: forwardTo.trim(),
          cc: forwardCc.trim(),
          subject: forwardSubject.trim(),
          body: forwardBody,
          actor_id: currentUser?.id || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to forward email");
      }

      setShowForwardModal(false);
      setForwardTo("");
      setForwardCc("");
      setForwardSubject("");
      setForwardBody("");
    } catch (error: any) {
      console.error("Forward failed:", error);
      alert(error?.message || "Failed to forward email");
    } finally {
      setForwardSending(false);
    }
  };

  const handleTrashConversation = async () => {
    if (!convo) return;
    if (trashingConversation) return;
    if (!confirm("Move this conversation to trash?")) return;

    try {
      setTrashingConversation(true);

      const res = await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: convo.id,
          status: "trash",
          actor_id: currentUser?.id || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to move conversation to trash");
      }

      window.location.reload();
    } catch (error: any) {
      console.error("Trash failed:", error);
      alert("Trash failed: " + (error?.message || "Unknown error"));
    } finally {
      setTrashingConversation(false);
    }
  };

  // Batch 6: Mark conversation as spam
  const handleMarkAsSpam = async () => {
    if (!convo) return;
    if (markingSpam) return;
    if (!confirm("Mark this conversation as spam? It will be moved to the Spam folder.")) return;

    try {
      setMarkingSpam(true);

      const res = await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: convo.id,
          status: "spam",
          actor_id: currentUser?.id || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to mark as spam");
      }

      window.location.reload();
    } catch (error: any) {
      console.error("Mark as spam failed:", error);
      alert("Mark as spam failed: " + (error?.message || "Unknown error"));
    } finally {
      setMarkingSpam(false);
    }
  };

  // Batch 6: Restore from spam — reverts status to "open"
  const handleNotSpam = async () => {
    if (!convo) return;
    if (markingSpam) return;

    try {
      setMarkingSpam(true);

      const res = await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          conversation_id: convo.id,
          status: "open",
          actor_id: currentUser?.id || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to restore from spam");
      }

      window.location.reload();
    } catch (error: any) {
      console.error("Restore from spam failed:", error);
      alert("Restore from spam failed: " + (error?.message || "Unknown error"));
    } finally {
      setMarkingSpam(false);
    }
  };

  const handleSetFollowUp = async (remindAt: string) => {
    if (!convo || !currentUser?.id) return;
    setSettingFollowUp(true);
    try {
      const res = await fetch("/api/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          user_id: currentUser.id,
          remind_at: remindAt,
          note: followUpNote.trim() || null,
        }),
      });
      const data = await res.json();
      setActiveReminder(data.reminder || { remind_at: remindAt, note: followUpNote.trim() || null });
      setShowFollowUp(false);
      setFollowUpNote("");
      setFollowUpCustomDate("");
      setFollowUpCustomTime("");
    } catch (e) {
      console.error("Failed to set follow-up:", e);
    } finally {
      setSettingFollowUp(false);
    }
  };

  const handleDismissReminder = async () => {
    if (!activeReminder?.id) return;
    try {
      await fetch("/api/reminders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: activeReminder.id, dismiss: true }),
      });
      setActiveReminder(null);
      setShowFollowUp(false);
    } catch (e) {
      console.error("Failed to dismiss reminder:", e);
    }
  };

  const handleInlineComposeSend = async () => {
    if (!convo || !inlineComposeTo.trim()) return;

    // Check for missing attachments
    const warning = checkMissingAttachments(inlineComposeBody, 0);
    if (warning && !confirm(warning + "\n\nSend anyway?")) return;

    setSendingInlineCompose(true);
    try {
      const subject = inlineComposeSubject.trim() || convo.subject;
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          account_id: convo.email_account_id,
          to: inlineComposeTo.trim(),
          cc: inlineComposeCc.trim() || undefined,
          bcc: inlineComposeBcc.trim() || undefined,
          subject,
          body: inlineComposeBody,
          actor_id: currentUser?.id,
        }),
      });
      if (res.ok) {
        setShowInlineCompose(false);
        setInlineComposeTo(""); setInlineComposeSubject(""); setInlineComposeBody("");
        setInlineComposeCc(""); setInlineComposeBcc("");
        setShowInlineComposeCc(false); setShowInlineComposeBcc(false);
        refetchDetail();
      } else {
        const err = await res.json();
        alert("Send failed: " + (err.error || "Unknown error"));
      }
    } catch (e: any) {
      alert("Send failed: " + e.message);
    } finally {
      setSendingInlineCompose(false);
    }
  };

  const getFollowUpTime = (preset: string): string => {
    const now = new Date();
    switch (preset) {
      case "2h": return new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
      case "4h": return new Date(now.getTime() + 4 * 60 * 60 * 1000).toISOString();
      case "tomorrow_9am": {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
      }
      case "tomorrow_2pm": {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        d.setHours(14, 0, 0, 0);
        return d.toISOString();
      }
      case "next_monday": {
        const d = new Date(now);
        const daysUntilMonday = (8 - d.getDay()) % 7 || 7;
        d.setDate(d.getDate() + daysUntilMonday);
        d.setHours(9, 0, 0, 0);
        return d.toISOString();
      }
      default: return now.toISOString();
    }
  };

  const handleToggleRead = async () => {
    if (!convo) return;
    try {
      await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          is_unread: !convo.is_unread,
        }),
      });
    } catch (error) {
      console.error("Toggle read failed:", error);
    }
  };

  const handleToggleStar = async () => {
    if (!convo) return;
    try {
      await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          is_starred: !convo.is_starred,
        }),
      });
    } catch (error) {
      console.error("Toggle star failed:", error);
    }
  };

  const existingTaskTextSet = useMemo(() => {
    return new Set(
      tasks
        .map((task) => normalizeSuggestedTaskText(task?.text || ""))
        .filter(Boolean)
    );
  }, [tasks]);

  const suggestedTaskItems = useMemo<SuggestedTaskItem[]>(() => {
    return (threadSummary?.summary?.suggested_tasks || [])
      .filter((item: string) => typeof item === "string" && item.trim())
      .map((item: string, index: number) => {
        const normalizedText = normalizeSuggestedTaskText(item);
        return {
          id: `${normalizedText || item}-${index}`,
          text: item.trim(),
          normalizedText,
          alreadyCreated: existingTaskTextSet.has(normalizedText),
        };
      });
  }, [threadSummary?.summary?.suggested_tasks, existingTaskTextSet]);

  const pendingSuggestedTaskItems = useMemo<SuggestedTaskItem[]>(
    () => suggestedTaskItems.filter((item: SuggestedTaskItem) => !item.alreadyCreated),
    [suggestedTaskItems]
  );


  const openActionItemStates = useMemo<OpenActionItemState[]>(() => {
    return (threadSummary?.summary?.open_action_items || [])
      .filter((item: string) => typeof item === "string" && item.trim())
      .map((item: string, index: number) => {
        const match = getTaskMatchMeta(item, tasks);
        const state: OpenActionItemState["state"] = !match.matchedTask
          ? "needs_task"
          : match.isCompleted
            ? "completed"
            : "tracked";

        return {
          id: `${normalizeSuggestedTaskText(item) || item}-${index}`,
          text: item.trim(),
          taskMatch: match.matchedTask,
          score: match.score,
          state,
        };
      });
  }, [threadSummary?.summary?.open_action_items, tasks]);

  const completedItemStates = useMemo<CompletedItemState[]>(() => {
    return (threadSummary?.summary?.completed_items || [])
      .filter((item: string) => typeof item === "string" && item.trim())
      .map((item: string, index: number) => {
        const match = getTaskMatchMeta(item, tasks);
        const state: CompletedItemState["state"] = !match.matchedTask
          ? "ai_only"
          : match.isCompleted
            ? "confirmed_completed"
            : "still_open";

        return {
          id: `${normalizeSuggestedTaskText(item) || item}-${index}`,
          text: item.trim(),
          taskMatch: match.matchedTask,
          score: match.score,
          state,
        };
      });
  }, [threadSummary?.summary?.completed_items, tasks]);

  const createSuggestedTask = async (taskText: string) => {
    if (!convo || !taskText.trim()) return;

    const normalized = normalizeSuggestedTaskText(taskText);
    if (existingTaskTextSet.has(normalized)) return;

    try {
      setCreatingSuggestedTasks((prev) => [...prev, taskText]);

      await onAddTask(
        convo.id,
        taskText.trim(),
        currentUser?.id ? [currentUser.id] : [],
        undefined
      );

      await refetchDetail();
    } finally {
      setCreatingSuggestedTasks((prev) => prev.filter((item) => item !== taskText));
    }
  };

  const createAllSuggestedTasks = async () => {
    if (!convo) return;

    const tasksToCreate = pendingSuggestedTaskItems.map((item) => item.text);

    if (tasksToCreate.length === 0) return;

    try {
      setCreatingAllSuggestedTasks(true);
      for (const taskText of tasksToCreate) {
        await onAddTask(
          convo.id,
          taskText.trim(),
          currentUser?.id ? [currentUser.id] : [],
          undefined
        );
      }
      await refetchDetail();
    } finally {
      setCreatingAllSuggestedTasks(false);
    }
  };

  if (!convo) {
    return (
      <div className="flex-1 flex items-center justify-center flex-col gap-4 text-[var(--text-muted)] bg-[var(--bg)]">
        <div className="w-16 h-16 rounded-2xl bg-[var(--surface)] flex items-center justify-center">
          <Mail size={24} />
        </div>
        <div className="text-[15px] font-medium">Select a conversation</div>
        <div className="text-xs">Choose from the list to view details</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--border)] flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {/* Phase 4f: editorial eyebrow — real metadata, not filler */}
          <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1 truncate">
            THREAD
            <span className="mx-1.5">·</span>
            <span className="tabular-nums">{messages.length}</span> {messages.length === 1 ? "MESSAGE" : "MESSAGES"}
            <span className="mx-1.5">·</span>
            {assignee ? (
              <>ASSIGNED TO <span className="text-[var(--text-secondary)]">{assignee.name.toUpperCase()}</span></>
            ) : (
              "UNASSIGNED"
            )}
          </div>
          <div className="text-xl font-normal font-serif text-[var(--text-primary)] truncate tracking-tight mb-1.5">
            {convo.subject}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-[var(--text-secondary)]">{convo.from_name}</span>
            <span className="text-[var(--text-muted)]">&lt;{convo.from_email}&gt;</span>
            {/* Batch 11: Supplier responsiveness chip — small icon-only with hover tooltip */}
            {supplierHoursInfo && supplierHoursInfo.responsiveness_score !== null && supplierHoursInfo.responsiveness_score !== undefined && (() => {
              const tier = supplierHoursInfo.responsiveness_tier as string;
              const TIER_COLORS: Record<string, string> = { excellent: "var(--accent)", good: "var(--info)", fair: "var(--warning)", low: "var(--danger)", no_response: "var(--text-muted)" };
              const TIER_LABELS: Record<string, string> = { excellent: "Excellent", good: "Good", fair: "Fair", low: "Low", no_response: "No response" };
              const color = TIER_COLORS[tier] || "var(--text-muted)";
              const label = TIER_LABELS[tier] || "—";
              const score = supplierHoursInfo.responsiveness_score;
              const exchanges = supplierHoursInfo.qualifying_exchanges ?? 0;
              const median = supplierHoursInfo.weighted_median_minutes ?? supplierHoursInfo.all_time_median_minutes ?? null;
              const fmtM = (m: number | null) => m === null ? "—" : m < 60 ? Math.round(m) + "m" : m < 1440 ? (Math.round(m / 60 * 10) / 10) + "h" : (Math.round(m / 1440 * 10) / 10) + "d";
              const tooltip = `${label} · score ${score}/4 · ${exchanges} exchanges${median !== null ? ` · ${fmtM(median)} median` : ""}`;
              return (
                <span
                  title={tooltip}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold border"
                  style={{ color, background: color + "1A", borderColor: color + "40" }}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                  {label}
                </span>
              );
            })()}
          </div>

          {/* ── Participants row ── */}
          {convo.from_email !== "internal" && (() => {
            const seen = new Set<string>();
            const participants: { name: string; email: string }[] = [];
            for (const msg of (messages || [])) {
              const addAddr = (raw: string | null | undefined, fallbackName?: string) => {
                if (!raw) return;
                for (const part of raw.split(",")) {
                  const trimmed = part.trim().toLowerCase();
                  if (!trimmed || seen.has(trimmed)) continue;
                  seen.add(trimmed);
                  // Try to extract "Name <email>" format
                  const match = part.match(/^(.+?)\s*<(.+?)>$/);
                  if (match) {
                    participants.push({ name: match[1].trim(), email: match[2].trim().toLowerCase() });
                  } else {
                    participants.push({ name: fallbackName || trimmed.split("@")[0], email: trimmed });
                  }
                }
              };
              // From
              if (msg.from_email && !seen.has(msg.from_email.toLowerCase())) {
                seen.add(msg.from_email.toLowerCase());
                participants.push({ name: msg.from_name || msg.from_email.split("@")[0], email: msg.from_email.toLowerCase() });
              }
              // To + CC
              addAddr(msg.to_addresses);
              addAddr(msg.cc_addresses);
            }
            if (participants.length <= 1) return null;
            const MAX_SHOW = 5;
            const shown = participants.slice(0, MAX_SHOW);
            const extra = participants.length - MAX_SHOW;
            return (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Users size={11} className="text-[var(--text-muted)] shrink-0" />
                {shown.map((p, i) => (
                  <span key={p.email} title={`${p.name} <${p.email}>`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--surface)] border border-[var(--border)] text-[10px] text-[var(--text-secondary)] max-w-[160px] truncate">
                    <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-white shrink-0"
                      style={{ background: i === 0 ? "var(--info)" : i === 1 ? "var(--accent)" : i === 2 ? "#BC8CFF" : i === 3 ? "var(--warning)" : "var(--highlight)" }}>
                      {(p.name || "?").slice(0, 2).toUpperCase()}
                    </span>
                    <span className="truncate">{p.name || p.email}</span>
                  </span>
                ))}
                {extra > 0 && (
                  <span className="text-[10px] text-[var(--text-muted)]">+{extra} more</span>
                )}
              </div>
            );
          })()}

          {/* Supplier Business Hours badge */}
          {supplierHoursInfo && (
            <div className="flex items-center gap-1.5 mt-1">
              <AlarmClock size={11} className="text-[var(--accent)] shrink-0" />
              <span className="text-[10px] text-[var(--text-secondary)]">
                <span className="text-[var(--text-muted)]">Hours:</span> {supplierHoursInfo.work_start || "09:00"}–{supplierHoursInfo.work_end || "17:00"}
                {supplierHoursInfo.timezone && <> · <span className="text-[var(--text-muted)]">TZ:</span> {supplierHoursInfo.timezone}</>}
                {supplierHoursInfo.work_days && supplierHoursInfo.work_days.length < 7 && (
                  <> · {supplierHoursInfo.work_days.map((d: number) => ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d]).join(", ")}</>
                )}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {(convo.labels || []).map(
              (cl) =>
                cl.label && (
                  <span
                    key={cl.label_id || cl.label?.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold"
                    style={{ background: cl.label.bg_color, color: cl.label.color }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: cl.label.color }}
                    />
                    {labelChipName(cl.label)}
                  </span>
                )
            )}

            <LabelPicker
              conversationId={convo.id}
              currentLabels={convo.labels || []}
              onToggle={() => {}}
            />

            {onMoveToFolder && (
              <MoveToFolderDropdown
                conversationId={convo.id}
                currentFolderId={convo.folder_id}
                onMove={onMoveToFolder}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <AssignDropdown
            currentAssignee={assignee}
            currentUser={currentUser}
            teamMembers={teamMembers}
            onAssign={onAssign}
            conversationId={convo.id}
          />

          <CallAssignment
            conversationId={convo.id}
            tasks={tasks}
            teamMembers={teamMembers}
            taskCategories={taskCategories}
            onRefetch={refetchDetail}
          />

          <StatusDropdown
            conversationId={convo.id}
            currentStatus={convo.status || "open"}
            currentAssigneeId={convo.assignee_id || null}
            emailAccountId={convo.email_account_id || null}
            currentUser={currentUser}
            folders={allFolders}
            onClosed={() => {
              window.location.reload();
            }}
            onReopened={() => {
              window.location.reload();
            }}
          />

          <div className="flex gap-1">
            {/* Compose Email button for internal/team conversations */}
            {convo.from_email === "internal" && (
              <button
                onClick={() => setShowInlineCompose(!showInlineCompose)}
                title="Compose email to supplier"
                className={`h-8 px-3 rounded-md border flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                  showInlineCompose
                    ? "border-[var(--accent)]/40 bg-[var(--accent)]/10 text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
                }`}
              >
                <Mail size={14} />
                Compose Email
              </button>
            )}

            <button
              onClick={handleToggleStar}
              title={convo.is_starred ? "Unstar" : "Star"}
              className={`w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center hover:bg-[var(--surface-2)] ${
                convo.is_starred ? "text-[var(--highlight)]" : "text-[var(--text-secondary)]"
              }`}
            >
              <Star size={16} fill={convo.is_starred ? "var(--highlight)" : "none"} />
            </button>

            {/* Watch toggle (Batch 4) */}
            {currentUser?.id && (
              <div className="relative w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center hover:bg-[var(--surface-2)]">
                <WatchToggle conversationId={convo.id} userId={currentUser.id} variant="header" />
              </div>
            )}

            <button
              onClick={handleToggleRead}
              title={convo.is_unread ? "Mark as read" : "Mark as unread"}
              className="w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] flex items-center justify-center hover:bg-[var(--surface-2)]"
            >
              {convo.is_unread ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>

            <button
              onClick={handleReplyAction}
              title="Reply"
              className="w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] flex items-center justify-center hover:bg-[var(--surface-2)]"
            >
              <Reply size={16} />
            </button>

            <button
              onClick={handleOpenForward}
              title="Forward"
              className="w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] flex items-center justify-center hover:bg-[var(--surface-2)]"
            >
              <Forward size={16} />
            </button>

            {/* Follow-up / Snooze */}
            <div className="relative">
              <button
                onClick={() => setShowFollowUp(!showFollowUp)}
                title={activeReminder ? "Follow-up set — click to view" : "Set follow-up reminder"}
                className={`w-8 h-8 rounded-md border flex items-center justify-center hover:bg-[var(--surface-2)] relative ${
                  activeReminder
                    ? "text-[var(--warning)] border-[var(--warning)]/40 bg-[var(--warning)]/10"
                    : showFollowUp ? "text-[var(--warning)] border-[var(--warning)]/30 bg-[var(--surface)]" : "text-[var(--text-secondary)] border-[var(--border)] bg-[var(--surface)]"
                }`}
              >
                <AlarmClock size={16} />
                {activeReminder && !activeReminder.is_fired && (
                  <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[var(--warning)] border border-[var(--bg)]" />
                )}
              </button>

              {showFollowUp && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowFollowUp(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-[280px] bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden">
                    <div className="px-3 py-2 border-b border-[var(--border)]">
                      <div className="text-xs font-bold text-[var(--text-primary)]">Follow-up Reminder</div>
                      <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Get notified to follow up on this email</div>
                    </div>

                    {/* Show existing active reminder */}
                    {activeReminder && (
                      <div className="mx-2 mt-2 p-2.5 rounded-lg border border-[var(--warning)]/20 bg-[var(--warning)]/5">
                        <div className="flex items-center gap-2 mb-1">
                          <AlarmClock size={12} className="text-[var(--warning)]" />
                          <span className="text-[11px] font-semibold text-[var(--warning)]">
                            {activeReminder.is_fired ? "Reminder fired" : "Reminder set"}
                          </span>
                        </div>
                        <div className="text-[11px] text-[var(--text-primary)]">
                          {new Date(activeReminder.remind_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </div>
                        {activeReminder.note && (
                          <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">{activeReminder.note}</div>
                        )}
                        <button
                          onClick={handleDismissReminder}
                          className="mt-2 w-full px-2 py-1 rounded-md border border-[var(--border)] text-[10px] text-[var(--text-secondary)] hover:text-[var(--danger)] hover:border-[var(--danger)]/30 transition-colors"
                        >
                          Dismiss reminder
                        </button>
                      </div>
                    )}

                    {/* Quick presets */}
                    <div className="p-2 space-y-0.5">
                      <div className="px-2.5 py-1 text-[10px] text-[var(--text-muted)] font-semibold uppercase">
                        {activeReminder ? "Reschedule" : "Quick set"}
                      </div>
                      {[
                        { key: "2h", label: "In 2 hours" },
                        { key: "4h", label: "In 4 hours" },
                        { key: "tomorrow_9am", label: "Tomorrow 9:00 AM" },
                        { key: "tomorrow_2pm", label: "Tomorrow 2:00 PM" },
                        { key: "next_monday", label: "Next Monday 9:00 AM" },
                      ].map((preset) => (
                        <button
                          key={preset.key}
                          disabled={settingFollowUp}
                          onClick={() => handleSetFollowUp(getFollowUpTime(preset.key))}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left hover:bg-[var(--surface)] transition-colors disabled:opacity-50"
                        >
                          <AlarmClock size={12} className="text-[var(--warning)] flex-shrink-0" />
                          <span className="text-[11px] text-[var(--text-primary)]">{preset.label}</span>
                        </button>
                      ))}
                    </div>

                    {/* Custom date/time */}
                    <div className="px-3 py-2 border-t border-[var(--border)] space-y-2">
                      <div className="text-[10px] text-[var(--text-muted)] font-semibold uppercase">Custom</div>
                      <div className="flex gap-1.5">
                        <input
                          type="date"
                          value={followUpCustomDate}
                          onChange={(e) => setFollowUpCustomDate(e.target.value)}
                          className="flex-1 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                        />
                        <input
                          type="time"
                          value={followUpCustomTime}
                          onChange={(e) => setFollowUpCustomTime(e.target.value)}
                          className="w-24 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                        />
                      </div>
                      <input
                        type="text"
                        value={followUpNote}
                        onChange={(e) => setFollowUpNote(e.target.value)}
                        placeholder="Add a note (optional)"
                        className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                      />
                      <button
                        disabled={!followUpCustomDate || settingFollowUp}
                        onClick={() => {
                          const dateStr = followUpCustomDate + "T" + (followUpCustomTime || "09:00") + ":00";
                          handleSetFollowUp(new Date(dateStr).toISOString());
                        }}
                        className="w-full px-3 py-1.5 rounded-lg bg-[var(--warning)] text-[var(--bg)] text-xs font-semibold hover:bg-[#f09e5e] disabled:opacity-50 transition-colors"
                      >
                        {settingFollowUp ? "Setting..." : activeReminder ? "Reschedule" : "Set Reminder"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Mark as spam / Not spam — Batch 6 */}
            {convo.status === "spam" ? (
              <button
                onClick={handleNotSpam}
                title="Not spam (restore to inbox)"
                disabled={markingSpam}
                className="px-2 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[10px] font-bold text-[var(--accent)] flex items-center gap-1 hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                <RotateCcw size={12} />
                Not spam
              </button>
            ) : (
              <button
                onClick={handleMarkAsSpam}
                title="Mark as spam"
                disabled={markingSpam}
                className="w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                <Ban size={16} />
              </button>
            )}

            <button
              onClick={handleTrashConversation}
              title="Trash"
              disabled={trashingConversation}
              className="w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-50"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex border-b border-[var(--surface-2)] px-5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); if (tab.id === "tasks" || tab.id === "notes") refetchDetail(); }}
            className={`px-4 py-2.5 text-xs font-semibold transition-all flex items-center gap-1.5 ${
              activeTab === tab.id
                ? "text-[var(--accent)] border-b-2 border-[var(--accent)]"
                : "text-[var(--text-muted)] border-b-2 border-transparent"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className={`text-[10px] px-1.5 py-0 rounded font-bold ${
                  activeTab === tab.id
                    ? "bg-[rgba(74,222,128,0.12)] text-[var(--accent)]"
                    : "bg-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div
        ref={messagesScrollRef}
        className={`${
          isReviewTab ? "flex-1 overflow-hidden px-5 py-4" : "flex-1 overflow-y-auto px-5 py-4"
        }`}
      >
        {activeTab === "messages" && (
          <>
            {/* Selection-mode banner — appears when the user came here from a note's
                "Attach to message" action. Each message in the list below becomes
                clickable until they pick one or cancel. */}
            {pickingMessageFor !== null && (
              <div className="mb-3 px-4 py-3 rounded-xl border-2 border-[var(--info)] bg-[var(--info)]/10 flex items-center justify-between gap-3 sticky top-0 z-10">
                <div className="flex items-center gap-2 text-[13px] text-[var(--text-primary)]">
                  <Link2 size={14} className="text-[var(--info)]" />
                  <span className="font-semibold">Pick a message</span>
                  <span className="text-[var(--text-secondary)]">
                    {pickingMessageFor === "creating"
                      ? "to attach to your new note"
                      : "to attach this note to"}
                  </span>
                </div>
                <button
                  onClick={() => {
                    setPickingMessageFor(null);
                    // Return to wherever the user came from
                    setActiveTab("notes");
                  }}
                  className="text-[12px] px-3 py-1 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Attachment summary bar — shows all attachments across all messages */}
            <ThreadAttachmentBar messages={messages} />

            {/* In-thread search bar */}
            {threadSearchActive ? (
              (() => {
                const sq = threadSearch.trim().toLowerCase();
                const totalMatches = sq ? messages.reduce((count: number, msg: any) => {
                  const bt = msg.body_text || (msg.body_html ? msg.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") : "") || msg.snippet || "";
                  return count + (bt.toLowerCase().split(sq).length - 1);
                }, 0) : 0;
                const safeIndex = totalMatches > 0 ? ((currentMatchIndex % totalMatches) + totalMatches) % totalMatches : 0;

                return (
                  <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--surface)]">
                    <Search size={14} className="text-[var(--text-muted)] flex-shrink-0" />
                    <input
                      value={threadSearch}
                      onChange={(e) => { setThreadSearch(e.target.value); setCurrentMatchIndex(0); matchRefs.current = []; }}
                      placeholder="Search in this thread..."
                      autoFocus
                      className="flex-1 bg-transparent text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (e.shiftKey) setCurrentMatchIndex((p) => Math.max(0, p - 1));
                          else setCurrentMatchIndex((p) => p + 1);
                        }
                        if (e.key === "Escape") { setThreadSearchActive(false); setThreadSearch(""); }
                      }}
                    />
                    {threadSearch && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-[var(--text-muted)] tabular-nums">{totalMatches > 0 ? (safeIndex + 1) + "/" + totalMatches : "0 results"}</span>
                        <button onClick={() => setCurrentMatchIndex((p) => Math.max(0, p - 1))} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]"><ChevronUp size={14} /></button>
                        <button onClick={() => setCurrentMatchIndex((p) => p + 1)} className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]"><ChevronDown size={14} /></button>
                      </div>
                    )}
                    <button onClick={() => { setThreadSearchActive(false); setThreadSearch(""); matchRefs.current = []; }} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
                  </div>
                );
              })()
            ) : (
              <div className="flex justify-end mb-2">
                <button onClick={() => setThreadSearchActive(true)} className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--surface)] transition-colors">
                  <Search size={12} /> Search in thread
                </button>
              </div>
            )}

            {(() => {
              // Count matches across all messages for navigation
              matchRefs.current = [];
              let globalMatchIdx = 0;
              const searchQ = threadSearch.trim().toLowerCase();

              return messages.map((msg: any, idx: number) => {
                const bodyText = msg.body_text || (msg.body_html ? msg.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") : "") || msg.snippet || "";
                const matchCountInMsg = searchQ ? (bodyText.toLowerCase().split(searchQ).length - 1) : 0;
                const msgStartIdx = globalMatchIdx;
                globalMatchIdx += matchCountInMsg;
                // Phase 4e: drop cap on the first message of the thread, but ONLY if it's
                // text-only (no body_html). HTML emails have unpredictable structure
                // (tables, banners, blockquotes) where ::first-letter would land in the
                // wrong place. This keeps drop caps as flair on simple replies and notes,
                // and avoids breaking marketing/templated emails.
                const isFirstMessage = idx === 0;
                const isTextOnly = !msg.body_html;
                const showDropCap = isFirstMessage && isTextOnly && !searchQ;
                const isPickMode = pickingMessageFor !== null;

                return (
                  <div
                    key={msg.id}
                    data-message-id={msg.id}
                    onClick={isPickMode ? () => handleMessagePicked(msg.id) : undefined}
                    role={isPickMode ? "button" : undefined}
                    tabIndex={isPickMode ? 0 : undefined}
                    onKeyDown={isPickMode ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleMessagePicked(msg.id);
                      }
                    } : undefined}
                    className={`mb-4 p-4 rounded-xl border transition-all ${
                      isPickMode
                        ? "cursor-pointer border-dashed border-[var(--info)]/40 hover:border-[var(--info)] hover:bg-[var(--info)]/5 hover:shadow-md"
                        : msg.is_outbound
                          ? "bg-[rgba(74,222,128,0.04)] border-[rgba(74,222,128,0.1)]"
                          : "bg-[var(--surface)] border-[var(--surface-2)]"
                    } ${searchQ && matchCountInMsg > 0 ? "ring-1 ring-[var(--highlight)]/20" : ""}`}
                  >
                <MessageHeader msg={msg} convo={convo} />

                {/* Note markers — show small chips for any notes attached to THIS message.
                    Click a chip to jump to the note in the Notes tab. */}
                {(() => {
                  const attachedNotes = (notes || []).filter((n: any) => n.message_id === msg.id);
                  if (attachedNotes.length === 0) return null;
                  return (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2 mb-2">
                      {attachedNotes.map((n: any) => {
                        const authorName = n.author?.name || "Someone";
                        const titleOrPreview = n.title || (n.text ? String(n.text).slice(0, 40) : "Note");
                        return (
                          <button
                            key={n.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleJumpToNote(n.id);
                            }}
                            title={`Note by ${authorName}: ${titleOrPreview}`}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-[var(--info)]/30 bg-[var(--info)]/10 text-[11px] font-medium text-[var(--info)] hover:bg-[var(--info)]/20 transition-colors max-w-[260px]"
                          >
                            <StickyNote size={10} className="shrink-0" />
                            <span className="truncate">{titleOrPreview}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}

                <div className="text-[14px] leading-[1.7] text-[var(--text-secondary)]">
                  {msg.body_html && !searchQ ? (
                    <div
                      className="prose prose-sm prose-invert max-w-none [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--border)] [&_td]:p-2 [&_th]:border [&_th]:border-[var(--border)] [&_th]:p-2 [&_th]:bg-[var(--surface-2)] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded [&_img]:my-2 [&_a]:text-[var(--info)] [&_a]:underline [&_a]:break-all [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-secondary)] [&_pre]:bg-[var(--surface-2)] [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_hr]:border-[var(--border)]"
                      dangerouslySetInnerHTML={{ __html: msg.body_html }}
                    />
                  ) : (
                    <div className={`whitespace-pre-wrap${showDropCap ? " [&::first-letter]:font-serif [&::first-letter]:text-[46px] [&::first-letter]:leading-[0.85] [&::first-letter]:float-left [&::first-letter]:pr-2 [&::first-letter]:pt-1 [&::first-letter]:text-[var(--text-primary)]" : ""}`}>
                      {searchQ ? (
                        <HighlightedText text={bodyText || "(No text content)"} query={searchQ} matchRefs={matchRefs} startIndex={msgStartIdx} />
                      ) : (
                        msg.body_text || msg.snippet || "(No text content)"
                      )}
                    </div>
                  )}
                </div>
                {msg.has_attachments && (
                  <MessageAttachments messageId={msg.id} />
                )}
                  </div>
                );
              });
            })()}

            {messages.length === 0 && (
              <div className="text-center py-10">
                {convo.from_email === "internal" ? (
                  <div className="space-y-3">
                    <MessageSquare size={32} className="mx-auto text-[var(--text-muted)]" />
                    <p className="text-[var(--text-muted)] text-sm">Team conversation — no emails yet</p>
                    <button
                      onClick={() => setShowInlineCompose(true)}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-xs font-semibold hover:bg-[var(--accent)] transition-colors"
                    >
                      <Send size={14} />
                      Compose Email
                    </button>
                  </div>
                ) : (
                  <p className="text-[var(--text-muted)] text-sm">No messages yet. Click the sync button in the sidebar to fetch emails.</p>
                )}
              </div>
            )}

            {/* Inline compose for internal conversations */}
            {showInlineCompose && convo.from_email === "internal" && (
              <div className="mt-4 rounded-xl border border-[var(--accent)]/20 bg-[var(--surface)] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-bold text-[var(--text-primary)]">New Email</div>
                  <button onClick={() => setShowInlineCompose(false)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[10px] text-[var(--text-muted)] font-semibold">To *</label>
                    <div className="flex gap-2">
                      {!showInlineComposeCc && <button onClick={() => setShowInlineComposeCc(true)} className="text-[9px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Cc</button>}
                      {!showInlineComposeBcc && <button onClick={() => setShowInlineComposeBcc(true)} className="text-[9px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]">Bcc</button>}
                    </div>
                  </div>
                  <input
                    value={inlineComposeTo}
                    onChange={(e) => setInlineComposeTo(e.target.value)}
                    placeholder="supplier@example.com (comma-separated for multiple)"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                  />
                </div>
                {showInlineComposeCc && (
                  <div>
                    <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Cc</label>
                    <input value={inlineComposeCc} onChange={(e) => setInlineComposeCc(e.target.value)}
                      placeholder="cc@example.com"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]" />
                  </div>
                )}
                {showInlineComposeBcc && (
                  <div>
                    <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Bcc</label>
                    <input value={inlineComposeBcc} onChange={(e) => setInlineComposeBcc(e.target.value)}
                      placeholder="bcc@example.com"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]" />
                  </div>
                )}
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Subject</label>
                  <input
                    value={inlineComposeSubject}
                    onChange={(e) => setInlineComposeSubject(e.target.value)}
                    placeholder={convo.subject}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Message</label>
                  <RichTextEditor
                    value={inlineComposeBody}
                    onChange={setInlineComposeBody}
                    compact
                    signature={replySignature}
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button onClick={() => setShowInlineCompose(false)}
                    className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                    Cancel
                  </button>
                  <button
                    onClick={handleInlineComposeSend}
                    disabled={sendingInlineCompose || !inlineComposeTo.trim() || !inlineComposeBody.replace(/<[^>]*>/g, "").trim()}
                    className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-xs font-semibold hover:bg-[var(--accent)] disabled:opacity-50 flex items-center gap-2"
                  >
                    {sendingInlineCompose ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    {sendingInlineCompose ? "Sending..." : "Send Email"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === "notes" && (
          <div className="h-full overflow-y-auto pr-2 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">Internal Notes</div>
              <button
                onClick={() => setShowNoteInput((v) => !v)}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--info)] hover:bg-[var(--surface-2)]"
              >
                <Plus size={13} />
                New note
              </button>
            </div>

            {showNoteInput && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <input
                  value={noteTitle}
                  onChange={(e) => setNoteTitle(e.target.value)}
                  placeholder="Note title (e.g. Follow-up needed, Pricing info, Decision)"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-semibold text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none mb-2 focus:border-[var(--accent)]"
                />
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Write an internal note..."
                  rows={4}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                />

                {/* Optional: pin this note to a specific message in the thread.
                    Clicking the button drops the user into Messages tab in selection
                    mode where they pick a message visually. The picked message shows
                    here as a chip with a remove button. */}
                {messages.length > 0 && (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2.5">
                    <div className="text-[11px] font-semibold text-[var(--text-secondary)] mb-2 flex items-center gap-1.5">
                      <Link2 size={11} />
                      Attach to a specific message <span className="text-[var(--text-muted)] font-normal">(optional)</span>
                    </div>
                    {noteMessageId ? (
                      (() => {
                        const m = messages.find((x: any) => x.id === noteMessageId);
                        const idx = messages.findIndex((x: any) => x.id === noteMessageId);
                        if (!m) {
                          // Fallback if the message somehow disappeared from the list
                          return (
                            <div className="text-[12px] text-[var(--text-muted)]">
                              Selected message no longer in this thread.
                              <button onClick={() => setNoteMessageId(null)} className="ml-2 underline hover:text-[var(--text-secondary)]">Clear</button>
                            </div>
                          );
                        }
                        const sender = m.from_name || m.from_email || "Unknown sender";
                        const date = m.sent_at ? new Date(m.sent_at).toLocaleString() : "";
                        const previewSrc = m.body_text || m.snippet || m.body_html;
                        const preview = plainPreview(previewSrc, 80);
                        return (
                          <div className="flex items-start gap-2 rounded-md border border-[var(--info)]/30 bg-[var(--info)]/8 p-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-[11px] font-semibold text-[var(--info)]">
                                #{idx + 1} · {sender} · {date}
                              </div>
                              {preview && (
                                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 truncate">
                                  {preview}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={startPickingForNewNote}
                                className="text-[10px] px-2 py-1 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                                title="Pick a different message"
                              >
                                Change
                              </button>
                              <button
                                onClick={() => setNoteMessageId(null)}
                                className="text-[10px] px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--danger)] hover:border-[var(--danger)]/40"
                                title="Remove the attachment"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <button
                        onClick={startPickingForNewNote}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:border-[var(--info)]/50 hover:text-[var(--info)] transition-colors"
                      >
                        <MessageSquare size={12} />
                        Pick a message
                      </button>
                    )}
                  </div>
                )}

                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => {
                      setShowNoteInput(false);
                      setNoteText("");
                      setNoteTitle("");
                      setNoteMessageId(null);
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-2)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddNoteInternal}
                    disabled={!noteText.trim()}
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold hover:bg-[var(--accent)] disabled:opacity-40"
                  >
                    Save note
                  </button>
                </div>
              </div>
            )}

            {notes.length === 0 && (
              <div className="text-center py-10 text-[var(--text-muted)] text-sm">No notes yet</div>
            )}

            {notes.map((note: any) => {
              const author =
                note.author || teamMembers.find((member) => member.id === note.author_id) || null;
              // If attached, find which message in the thread this note points to.
              const attachedMessage = note.message_id
                ? messages.find((m: any) => m.id === note.message_id)
                : null;
              const attachedIdx = attachedMessage
                ? messages.findIndex((m: any) => m.id === note.message_id)
                : -1;
              const isHighlighted = highlightedNoteId === note.id;
              const isPending = attachingPending === note.id;

              return (
                <div
                  key={note.id}
                  ref={(el) => { noteRefs.current[note.id] = el; }}
                  className={`rounded-xl border p-4 transition-all duration-300 ${
                    isHighlighted
                      ? "border-[var(--accent)] bg-[var(--accent-dim)] shadow-lg ring-2 ring-[var(--accent)]/30"
                      : "border-[var(--border)] bg-[var(--surface)]"
                  }`}
                >
                  {note.title && (
                    <div className="text-[14px] font-bold text-[var(--text-primary)] mb-1.5 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--info)] flex-shrink-0" />
                      {note.title}
                    </div>
                  )}

                  {/* Attached-message badge (if pinned to a specific message) — clickable */}
                  {attachedMessage && (
                    <div className="mb-2">
                      <button
                        onClick={() => {
                          setActiveTab("messages");
                          setTimeout(() => {
                            const msgEl = document.querySelector(`[data-message-id="${attachedMessage.id}"]`);
                            if (msgEl) msgEl.scrollIntoView({ behavior: "smooth", block: "center" });
                          }, 80);
                        }}
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border border-[var(--info)]/30 bg-[var(--info)]/10 text-[11px] font-medium text-[var(--info)] hover:bg-[var(--info)]/20 transition-colors"
                        title="Jump to the message this note is about"
                      >
                        <Link2 size={10} />
                        <span className="truncate max-w-[300px]">
                          On message #{attachedIdx + 1} from {attachedMessage.from_name || attachedMessage.from_email || "Unknown"}
                        </span>
                      </button>
                    </div>
                  )}

                  <div className="flex items-center gap-2 mb-2">
                    {author ? (
                      <Avatar initials={author.initials} color={author.color} size={20} />
                    ) : (
                      <div className="w-5 h-5 rounded-full bg-[#30363D]" />
                    )}
                    <div className="text-[12px]">
                      <span
                        className="font-semibold"
                        style={{ color: author?.color || "var(--text-primary)" }}
                      >
                        {author?.name || "Unknown"}
                      </span>
                      <span className="text-[var(--text-muted)] ml-2">
                        {note.created_at ? new Date(note.created_at).toLocaleString() : ""}
                      </span>
                    </div>
                  </div>
                  <div className="text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap">{note.text}</div>

                  {/* Retroactive attach/detach controls */}
                  {/* Retroactive attach/detach controls. The "Attach/Change message"
                      button drops the user into selection mode in the Messages tab,
                      same as the new-note flow — much easier than picking from a dropdown. */}
                  <div className="mt-3 pt-2 border-t border-[var(--border)]/50 flex items-center justify-end gap-2">
                    {attachedMessage && (
                      <button
                        onClick={() => handleAttachNoteToMessage(note.id, null)}
                        disabled={isPending}
                        className="text-[11px] text-[var(--text-muted)] hover:text-[var(--danger)] disabled:opacity-40"
                      >
                        {isPending ? "Detaching…" : "Detach from message"}
                      </button>
                    )}
                    <button
                      onClick={() => startPickingForExistingNote(note.id)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--info)] disabled:opacity-40"
                    >
                      <Link2 size={10} />
                      {attachedMessage ? "Change message" : "Attach to message"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "tasks" && (
          <div className="h-full overflow-y-auto pr-2 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">Thread Tasks</div>
              <div className="flex items-center gap-2">
                {selectedTaskIds.length > 0 && currentUser?.role === "admin" && (
                  <button
                    onClick={() => handleDeleteTasks(selectedTaskIds)}
                    disabled={deletingTasks}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[rgba(248,81,73,0.3)] bg-[rgba(248,81,73,0.08)] text-[11px] font-semibold text-[var(--danger)] hover:bg-[rgba(248,81,73,0.14)] disabled:opacity-50"
                  >
                    <Trash2 size={11} />
                    {deletingTasks ? "Deleting..." : `Delete (${selectedTaskIds.length})`}
                  </button>
                )}
                <button
                  onClick={() => setShowTaskInput((v) => !v)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--info)] hover:bg-[var(--surface-2)]"
                >
                  <Plus size={13} />
                  New task
                </button>
              </div>
            </div>

            {showTaskInput && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
                {/* Task template picker */}
                {taskTemplates.length > 0 && (
                  <div>
                    <button onClick={() => setShowTaskTemplates(!showTaskTemplates)}
                      className="flex items-center gap-1.5 text-[10px] text-[var(--info)] hover:text-[#79B8FF] font-semibold mb-1">
                      <FileText size={11} /> {showTaskTemplates ? "Hide templates" : "Use template"}
                    </button>
                    {showTaskTemplates && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {taskTemplates.map((tpl: any) => (
                          <button key={tpl.id} onClick={() => {
                            setNewTaskText(tpl.text || "");
                            if (tpl.category_id) setNewTaskCategoryId(tpl.category_id);
                            if (tpl.deadline_hours) setNewTaskDueTime(String(tpl.deadline_hours));
                            if (tpl.assignee_ids && Array.isArray(tpl.assignee_ids)) {
                              setNewTaskAssigneeIds(tpl.assignee_ids.filter((id: string) => assignableMembers.some((m) => m.id === id)));
                            }
                            setShowTaskTemplates(false);
                          }}
                            className="px-2.5 py-1 rounded-lg text-[10px] font-medium bg-[var(--bg)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent)]/30 transition-colors"
                          >
                            {tpl.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <textarea
                  value={newTaskText}
                  onChange={(e) => setNewTaskText(e.target.value)}
                  placeholder="What needs to be done?"
                  rows={3}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                />

                {/* Category picker */}
                {taskCategories.length > 0 && (
                  <div>
                    <div className="text-[10px] text-[var(--text-muted)] font-semibold mb-1.5">Category</div>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => setNewTaskCategoryId("")}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                          !newTaskCategoryId ? "bg-[var(--border)] text-[var(--text-primary)] ring-1 ring-[var(--accent)]" : "bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        None
                      </button>
                      {taskCategories.map((cat: any) => (
                        <button
                          key={cat.id}
                          onClick={() => setNewTaskCategoryId(cat.id)}
                          className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                            newTaskCategoryId === cat.id ? "ring-1 ring-[var(--accent)] bg-[var(--border)]" : "bg-[var(--bg)] border border-[var(--border)] hover:bg-[var(--border)]"
                          }`}
                        >
                          <span className="text-[13px]">{cat.icon}</span>
                          <span style={{ color: cat.color }}>{cat.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Date and Time */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <div className="text-[10px] text-[var(--text-muted)] font-semibold mb-1.5">Due Date</div>
                    <input
                      type="date"
                      value={newTaskDueDate}
                      onChange={(e) => setNewTaskDueDate(e.target.value)}
                      className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] [color-scheme:dark]"
                    />
                  </div>
                  <div className="w-36">
                    <div className="text-[10px] text-[var(--text-muted)] font-semibold mb-1.5">Start Within</div>
                    <select
                      value={newTaskDueTime}
                      onChange={(e) => setNewTaskDueTime(e.target.value)}
                      className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] [color-scheme:dark]"
                    >
                      <option value="">No limit</option>
                      <option value="1">1 hour</option>
                      <option value="2">2 hours</option>
                      <option value="3">3 hours</option>
                      <option value="4">4 hours</option>
                      <option value="6">6 hours</option>
                      <option value="8">8 hours (1 day)</option>
                      <option value="12">12 hours</option>
                      <option value="24">24 hours</option>
                      <option value="48">48 hours (2 days)</option>
                    </select>
                  </div>
                </div>

                {/* Assignees with Select All + Groups */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-[10px] text-[var(--text-muted)] font-semibold">Assign to</div>
                    <button
                      onClick={() => {
                        if (newTaskAssigneeIds.length === assignableMembers.length) {
                          setNewTaskAssigneeIds([]);
                        } else {
                          setNewTaskAssigneeIds(assignableMembers.map((m) => m.id));
                        }
                      }}
                      className="text-[10px] text-[var(--info)] hover:text-[#79B8FF] font-semibold"
                    >
                      {newTaskAssigneeIds.length === assignableMembers.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  {/* Group quick-select */}
                  {userGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {userGroups.map((g: any) => {
                        const memberIds = (g.user_group_members || []).map((m: any) => m.team_member_id);
                        const isSelected = memberIds.length > 0 && memberIds.every((id: string) => newTaskAssigneeIds.includes(id));
                        return (
                          <button key={g.id} onClick={() => {
                            if (isSelected) {
                              setNewTaskAssigneeIds((prev) => prev.filter((id) => !memberIds.includes(id)));
                            } else {
                              setNewTaskAssigneeIds((prev) => Array.from(new Set([...prev, ...memberIds])));
                            }
                          }}
                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
                              isSelected ? "ring-1 ring-[var(--accent)] bg-[rgba(74,222,128,0.1)]" : "bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--text-muted)]"
                            }`}>
                            <span className="text-[11px]">{g.icon}</span>
                            <span style={{ color: isSelected ? "var(--accent)" : g.color }}>{g.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-2 space-y-1 max-h-32 overflow-y-auto">
                    {assignableMembers
                      .map((member) => {
                        const checked = newTaskAssigneeIds.includes(member.id);
                        return (
                          <label key={member.id} className="flex items-center gap-2 text-[12px] text-[var(--text-primary)] px-1 py-0.5 rounded hover:bg-[var(--border)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                setNewTaskAssigneeIds((prev) =>
                                  e.target.checked
                                    ? [...prev, member.id]
                                    : prev.filter((id) => id !== member.id)
                                );
                              }}
                              className="accent-[var(--accent)]"
                            />
                            <Avatar initials={member.initials} color={member.color} size={16} />
                            <span>{member.name}</span>
                          </label>
                        );
                      })}
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setShowTaskInput(false);
                      setNewTaskText("");
                      setNewTaskAssigneeIds([]);
                      setNewTaskDueDate("");
                      setNewTaskDueTime("");
                      setNewTaskCategoryId("");
                    }}
                    className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-2)]"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddTaskInternal}
                    disabled={!newTaskText.trim()}
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold hover:bg-[var(--accent)] disabled:opacity-40"
                  >
                    Create task
                  </button>
                </div>
              </div>
            )}

            {tasks.length === 0 && (
              <div className="text-center py-10 text-[var(--text-muted)] text-sm">
                No tasks for this conversation
              </div>
            )}

            {tasks.map((task: any) => {
              const assignees = getTaskAssignees(task);

              if (editingTaskId === task.id) {
                return (
                  <div key={task.id} className="rounded-xl border border-[var(--accent)]/30 bg-[var(--surface)] p-4 space-y-3">
                    <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Edit Task</div>
                    <textarea
                      value={editTaskText}
                      onChange={(e) => setEditTaskText(e.target.value)}
                      rows={2}
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
                    />
                    {/* Category */}
                    {taskCategories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => setEditTaskCategoryId("")}
                          className={`px-2 py-1 rounded-lg text-[10px] font-medium ${!editTaskCategoryId ? "bg-[var(--border)] text-[var(--text-primary)] ring-1 ring-[var(--accent)]" : "bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]"}`}>
                          None
                        </button>
                        {taskCategories.map((cat: any) => (
                          <button key={cat.id} onClick={() => setEditTaskCategoryId(cat.id)}
                            className={`px-2 py-1 rounded-lg text-[10px] font-medium flex items-center gap-1 ${editTaskCategoryId === cat.id ? "ring-1 ring-[var(--accent)]" : "border border-[var(--border)]"}`}
                            style={{ background: `${cat.color}18`, color: cat.color }}>
                            <span>{cat.icon}</span> {cat.name}
                          </button>
                        ))}
                      </div>
                    )}
                    {/* Due date + hours */}
                    <div className="flex items-center gap-2">
                      <input type="date" value={editTaskDueDate} onChange={(e) => setEditTaskDueDate(e.target.value)}
                        className="px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
                      <select value={editTaskDueTime} onChange={(e) => setEditTaskDueTime(e.target.value)}
                        className="px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]">
                        <option value="">No time limit</option>
                        {[1,2,3,4,5,6,8,10,12,16,24,36,48].map((h) => (
                          <option key={h} value={String(h)}>{h}h</option>
                        ))}
                      </select>
                      {editTaskDueTime && editTaskDueTime.includes(":") && (
                        <span className="text-[10px] text-[var(--text-muted)]">Current: {editTaskDueTime.slice(0, 5)}</span>
                      )}
                    </div>
                    {/* Assignees */}
                    <div>
                      <div className="text-[10px] text-[var(--text-muted)] font-semibold mb-1.5">Assignees</div>
                      <div className="flex flex-wrap gap-1.5">
                        {/* Select all / Deselect all */}
                        <button
                          onClick={() => setEditTaskAssigneeIds(editTaskAssigneeIds.length === teamMembers.length ? [] : teamMembers.map((m) => m.id))}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--text-secondary)]"
                        >
                          {editTaskAssigneeIds.length === teamMembers.length ? "Deselect all" : "Select all"}
                        </button>
                        {/* User groups */}
                        {userGroups.map((g: any) => {
                          const gMembers = (g.user_group_members || []).map((gm: any) => gm.team_member_id);
                          return (
                            <button key={g.id} onClick={() => {
                              const allSelected = gMembers.every((id: string) => editTaskAssigneeIds.includes(id));
                              setEditTaskAssigneeIds(allSelected
                                ? editTaskAssigneeIds.filter((id) => !gMembers.includes(id))
                                : Array.from(new Set([...editTaskAssigneeIds, ...gMembers]))
                              );
                            }}
                              className="px-2 py-1 rounded-lg text-[10px] font-medium border border-[var(--border)] bg-[var(--bg)] hover:text-[var(--text-primary)]"
                              style={{ color: g.color }}>
                              {g.icon || "👥"} {g.name}
                            </button>
                          );
                        })}
                        {teamMembers.map((m) => {
                          const selected = editTaskAssigneeIds.includes(m.id);
                          return (
                            <button key={m.id} onClick={() => setEditTaskAssigneeIds(selected ? editTaskAssigneeIds.filter((id) => id !== m.id) : [...editTaskAssigneeIds, m.id])}
                              className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] transition-all ${selected ? "ring-1 ring-[var(--accent)]" : "border border-[var(--border)]"}`}
                              style={{ background: selected ? `${m.color}20` : "var(--bg)", color: selected ? m.color : "var(--text-secondary)" }}>
                              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-[var(--bg)]" style={{ background: m.color }}>{m.initials}</span>
                              {m.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex justify-end gap-2">
                      <button onClick={cancelEditTask}
                        className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-xs text-[var(--text-secondary)]">Cancel</button>
                      <button onClick={saveEditTask} disabled={!editTaskText.trim()}
                        className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-xs font-semibold disabled:opacity-40">Save</button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={task.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 group/task">
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={selectedTaskIds.includes(task.id)}
                      onChange={(e) => {
                        setSelectedTaskIds((prev) =>
                          e.target.checked ? [...prev, task.id] : prev.filter((id) => id !== task.id)
                        );
                      }}
                      className="mt-1 accent-[var(--accent)]"
                    />
                    <button
                      onClick={async () => {
                        if (assignees.length > 1 && currentUser) {
                          // Multi-assignee: toggle current user's completion
                          try {
                            await fetch("/api/tasks", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ task_id: task.id, toggle_assignee_id: currentUser.id }),
                            });
                            await refetchDetail();
                          } catch (e) { console.error(e); }
                        } else {
                          // Single assignee: toggle whole task
                          onToggleTask(task.id, !(task.status === "completed" || task.is_done));
                        }
                      }}
                      title={assignees.length > 1 ? "Mark my part as done" : "Toggle task completion"}
                      className="mt-0.5"
                    >
                      {(() => {
                        if (task.status === "dismissed") return <Ban size={18} className="text-[var(--warning)] opacity-60" />;
                        if (assignees.length > 1 && currentUser) {
                          const myEntry = assignees.find((a: any) => a.id === currentUser.id);
                          const allDone = assignees.every((a: any) => a.is_done);
                          if (allDone) return <CheckCircle size={18} className="text-[var(--accent)]" />;
                          if (myEntry?.is_done) return <CheckCircle size={18} className="text-[var(--info)]" />;
                          return <Circle size={18} className="text-[var(--text-secondary)]" />;
                        }
                        return (task.status === "completed" || task.is_done)
                          ? <CheckCircle size={18} className="text-[var(--accent)]" />
                          : <Circle size={18} className="text-[var(--text-secondary)]" />;
                      })()}
                    </button>

                    <div className="flex-1 min-w-0">
                      <div
                        className={`text-sm font-medium ${
                          task.status === "dismissed"
                            ? "text-[var(--warning)] italic opacity-70"
                            : task.status === "completed" || task.is_done
                            ? "text-[var(--text-secondary)] line-through"
                            : "text-[var(--text-primary)]"
                        }`}
                      >
                        {task.status === "dismissed" && <Ban size={12} className="inline mr-1 -mt-0.5" />}
                        {task.text}
                      </div>

                      {/* Dismiss reason */}
                      {task.status === "dismissed" && task.dismiss_reason && (
                        <div className="mt-1 px-2 py-1 rounded bg-[rgba(240,136,62,0.08)] border border-[rgba(240,136,62,0.15)]">
                          <span className="text-[10px] text-[var(--warning)] font-semibold">Dismissed: </span>
                          <span className="text-[10px] text-[var(--text-secondary)]">{task.dismiss_reason}</span>
                          {task.dismissed_at && (
                            <span className="text-[10px] text-[var(--text-muted)] ml-2">
                              {new Date(task.dismissed_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Progress for multi-assignee tasks */}
                      {assignees.length > 1 && (() => {
                        const doneCount = assignees.filter((a: any) => a.is_done).length;
                        return (
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 h-1.5 rounded-full bg-[var(--border)] max-w-[120px]">
                              <div className="h-full rounded-full transition-all" style={{
                                width: `${(doneCount / assignees.length) * 100}%`,
                                background: doneCount === assignees.length ? "var(--accent)" : "var(--info)",
                              }} />
                            </div>
                            <span className="text-[10px] text-[var(--text-muted)]">{doneCount}/{assignees.length} done</span>
                          </div>
                        );
                      })()}

                      <div className="flex flex-wrap gap-2 mt-2">
                        {/* Category badge */}
                        {task.category_id && (() => {
                          const cat = taskCategories.find((c: any) => c.id === task.category_id);
                          return cat ? (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                              style={{ background: `${cat.color}18`, color: cat.color }}>
                              <span className="text-[12px]">{cat.icon}</span> {cat.name}
                            </span>
                          ) : null;
                        })()}

                        {assignees.length > 1 ? (
                          <select
                            value={(() => {
                              if (!currentUser) return "todo";
                              const myEntry = assignees.find((a: any) => a.id === currentUser.id);
                              return (myEntry as any)?.personal_status || (myEntry?.is_done ? "completed" : "todo");
                            })()}
                            onChange={async (e) => {
                              if (!currentUser) return;
                              try {
                                await fetch("/api/tasks", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    task_id: task.id,
                                    toggle_assignee_id: currentUser.id,
                                    assignee_status: e.target.value,
                                  }),
                                });
                                await refetchDetail();
                              } catch (e2) { console.error(e2); }
                            }}
                            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text-primary)] outline-none"
                          >
                            <option value="todo">📋 To do</option>
                            <option value="in_progress">🔄 In progress</option>
                            <option value="completed">✅ Done (me)</option>
                          </select>
                        ) : (
                          <select
                            value={task.status || (task.is_done ? "completed" : "todo")}
                            onChange={(e) =>
                              onUpdateTask(task.id, { status: e.target.value as any })
                            }
                            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none"
                          >
                            <option value="todo">To do</option>
                            <option value="in_progress">In progress</option>
                            <option value="completed">Completed</option>
                          </select>
                        )}

                        {task.due_date && (
                          <>
                            <span className="inline-flex items-center rounded-full px-2 py-1 text-[11px] bg-[var(--highlight-bg)] text-[var(--highlight)]">
                              Start by: {task.due_date}{task.due_time ? ` ${task.due_time.slice(0, 5)}` : ""}
                            </span>
                            <TaskCountdown
                              dueDate={task.due_date}
                              dueTime={task.due_time}
                              isCompleted={task.status === "completed" || task.status === "dismissed" || task.is_done}
                            />
                          </>
                        )}

                        {/* Reset SLA Timer — only available once the task is actually
                            being worked on. While the task is still in "to do" the
                            timer is the pressure to start; resetting it then would
                            defeat its purpose. Once someone has marked themselves
                            "in progress", a reset is fair game (supplier didn't
                            answer, callback rescheduled, etc.).
                            "In progress" is true if EITHER:
                              • task.status === "in_progress" (single-assignee mode), OR
                              • any assignee has personal_status === "in_progress" (multi-assignee mode). */}
                        {task.due_date && task.status !== "completed" && task.status !== "dismissed" && !task.is_done && (() => {
                          const overallInProgress = task.status === "in_progress";
                          const anyAssigneeInProgress = (task.assignees || []).some(
                            (a: any) => a?.personal_status === "in_progress"
                          );
                          if (!overallInProgress && !anyAssigneeInProgress) return null;
                          const taskRef = task;
                          return (
                            <SlaResetPanel
                              task={taskRef}
                              convo={convo!}
                              onAddNote={onAddNote}
                              onUpdateTask={onUpdateTask}
                              onDone={refetchDetail}
                            />
                          );
                        })()}

                        {assignees.map((member: any) => (
                          <button
                            key={member.id}
                            onClick={async () => {
                              try {
                                await fetch("/api/tasks", {
                                  method: "PATCH",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ task_id: task.id, toggle_assignee_id: member.id }),
                                });
                                await refetchDetail();
                              } catch (e) { console.error(e); }
                            }}
                            title={member.is_done ? `${member.name} — completed. Click to undo` : `${member.name} — click to mark done`}
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] transition-all ${
                              member.is_done ? "line-through opacity-60" : ""
                            }`}
                            style={{
                              background: member.is_done ? "rgba(74,222,128,0.15)" : `${member.color}20`,
                              color: member.is_done ? "var(--accent)" : member.color,
                            }}
                          >
                            {member.is_done ? (
                              <CheckCircle size={14} className="text-[var(--accent)]" />
                            ) : (
                              <Avatar initials={member.initials} color={member.color} size={16} />
                            )}
                            {member.name}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => startEditTask(task)}
                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--info)] hover:bg-[rgba(88,166,255,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                      title="Edit task"
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      onClick={() => setShowFormModal({ taskId: task.id, categoryId: task.category_id || undefined })}
                      className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[rgba(74,222,128,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                      title="Fill out form"
                    >
                      <ClipboardCheck size={13} />
                    </button>
                    {task.status === "dismissed" ? (
                      <button
                        onClick={async () => {
                          try {
                            await fetch("/api/tasks", {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ task_id: task.id, status: "todo" }),
                            });
                            if (convo) await onAddNote(convo.id, `🔄 Task reopened: "${task.text.slice(0, 50)}"`);
                            await refetchDetail();
                          } catch (e) { console.error(e); }
                        }}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[rgba(74,222,128,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                        title="Reopen this task"
                      >
                        <RotateCcw size={13} />
                      </button>
                    ) : (
                      task.status !== "completed" && !task.is_done && (
                        <button
                          onClick={async () => {
                            const reason = prompt("Why is this task no longer needed?\n(e.g., supplier responded via email, issue resolved, duplicate task)");
                            if (!reason || !reason.trim()) return;
                            try {
                              await fetch("/api/tasks", {
                                method: "PATCH",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  task_id: task.id,
                                  status: "dismissed",
                                  dismiss_reason: reason.trim(),
                                  dismissed_by: currentUser?.id || null,
                                }),
                              });
                              if (convo) await onAddNote(convo.id, `🚫 Task dismissed: "${task.text.slice(0, 50)}"\nReason: ${reason.trim()}`);
                              await refetchDetail();
                            } catch (e) { console.error(e); }
                          }}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--warning)] hover:bg-[rgba(240,136,62,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                          title="Dismiss — no longer needed"
                        >
                          <Ban size={13} />
                        </button>
                      )
                    )}
                    {currentUser?.role === "admin" && (
                      <button
                        onClick={() => handleDeleteTasks([task.id])}
                        className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[rgba(248,81,73,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                        title="Delete task"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "activity" && (
          <ActivityList
            activities={activities}
            teamMembers={teamMembers}
            conversationLabels={convo.labels || []}
          />
        )}

        {activeTab === "related" && (
          <div className="h-full overflow-y-auto pr-2">
            {summary && (
              <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-sm font-semibold text-[var(--text-primary)] mb-2">Supplier Contact</div>
                <div className="text-xs text-[var(--text-secondary)] mb-3">{externalEmail}</div>

                <div className="flex flex-wrap gap-3 text-xs">
                  <span className="px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)]">
                    Threads: {summary.total_threads}
                  </span>
                  <span className="px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-[var(--accent)]">
                    Open: {summary.open_threads}
                  </span>
                  <span className="px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)] text-[#F87171]">
                    Closed: {summary.closed_threads}
                  </span>
                  {summary.last_activity && (
                    <span className="px-2 py-1 rounded bg-[var(--surface)] border border-[var(--border)]">
                      Last activity:{" "}
                      {new Date(summary.last_activity).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-primary)]">
                    <GitBranch size={14} className="text-[var(--info)]" />
                    Related threads in this shared account
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                    {externalEmail
                      ? `Showing threads where the outside contact is ${externalEmail}`
                      : "We could not determine the outside contact for this thread."}
                  </div>
                </div>

                {externalEmail && (
                  <a
                    href={`/contacts/${encodeURIComponent(externalEmail)}?account=${convo.email_account_id || ""}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[12px] font-semibold text-[var(--info)] hover:bg-[var(--surface-2)] shrink-0"
                  >
                    <ExternalLink size={13} />
                    Command Center
                  </a>
                )}
              </div>
            </div>

            {/* Merged Threads */}
            {mergedThreads.length > 0 && (
              <div className="mb-3 rounded-xl border border-[#BC8CFF]/20 bg-[rgba(188,140,255,0.05)] p-4">
                <div className="flex items-center gap-2 mb-3 text-[12px] font-semibold text-[#BC8CFF]">
                  <GitMerge size={14} />
                  Merged Threads ({mergedThreads.length})
                </div>
                <div className="space-y-2">
                  {mergedThreads.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">{m.merged_conversation?.subject || "(No subject)"}</div>
                        <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
                          {m.merged_conversation?.from_name || m.merged_conversation?.from_email || "Unknown"} · Merged {new Date(m.merged_at).toLocaleDateString()}
                          {m.merged_by_user && <> by {m.merged_by_user.name}</>}
                        </div>
                      </div>
                      <button
                        disabled={unmergingId === m.id}
                        onClick={() => handleUnmerge(m.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--warning)]/30 bg-[rgba(240,136,62,0.08)] text-[10px] font-semibold text-[var(--warning)] hover:bg-[rgba(240,136,62,0.15)] disabled:opacity-50 shrink-0"
                      >
                        <GitBranch size={11} />
                        {unmergingId === m.id ? "Unmerging..." : "Unmerge"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {relatedThreadsLoading && (
              <div className="text-center py-10 text-[var(--text-muted)] text-sm">
                Loading related threads...
              </div>
            )}

            {!relatedThreadsLoading && relatedThreads.length === 0 && (
              <div className="text-center py-10 text-[var(--text-muted)] text-sm">
                No related threads found for this contact in this shared account
              </div>
            )}

            {!relatedThreadsLoading &&
              relatedThreads.map((thread: any) => {
                const sameSubject =
                  String(thread.subject || "").trim().toLowerCase() ===
                  String(convo.subject || "").trim().toLowerCase();

                const href = `/#conversation=${thread.id}&mailbox=${thread.email_account_id || ""}&folder=${thread.folder_id || ""}`;

                return (
                  <div
                    key={thread.id}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 mb-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          {thread.is_unread && (
                            <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />
                          )}
                          <div className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
                            {thread.subject || "(No subject)"}
                          </div>
                          {sameSubject && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-[var(--highlight-bg)] text-[var(--highlight)]">
                              Possible duplicate
                            </span>
                          )}
                        </div>

                        <div className="text-[11px] text-[var(--text-secondary)] mb-2 truncate">
                          {thread.preview || "No preview available"}
                        </div>

                        <div className="flex flex-wrap gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-1 text-[var(--text-secondary)] border border-[var(--border)]">
                            Status: {thread.status || "open"}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-1 text-[var(--text-secondary)] border border-[var(--border)]">
                            Folder: {thread.folder?.name || "Inbox"}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg)] px-2 py-1 text-[var(--text-secondary)] border border-[var(--border)]">
                            Last activity:{" "}
                            {thread.last_message_at
                              ? new Date(thread.last_message_at).toLocaleString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  hour: "numeric",
                                  minute: "2-digit",
                                })
                              : "Unknown"}
                          </span>
                        </div>

                        {(thread.labels || []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {thread.labels.map((cl: any) =>
                              cl.label ? (
                                <span
                                  key={`${thread.id}-${cl.label_id || cl.label?.id}`}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold"
                                  style={{
                                    background: cl.label.bg_color,
                                    color: cl.label.color,
                                  }}
                                >
                                  <span
                                    className="w-1.5 h-1.5 rounded-full"
                                    style={{ background: cl.label.color }}
                                  />
                                  {labelChipName(cl.label)}
                                </span>
                              ) : null
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col gap-1.5 shrink-0">
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[11px] font-semibold text-[var(--info)] hover:bg-[var(--surface-2)] shrink-0"
                        >
                          <ExternalLink size={13} />
                          Open
                        </a>
                        {thread.id !== convo.id && !thread.merged_into && (
                          <button
                            disabled={mergingThreadId === thread.id}
                            onClick={() => handleMerge(thread.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#BC8CFF]/30 bg-[rgba(188,140,255,0.08)] text-[11px] font-semibold text-[#BC8CFF] hover:bg-[rgba(188,140,255,0.15)] disabled:opacity-50 shrink-0"
                          >
                            <GitMerge size={11} />
                            {mergingThreadId === thread.id ? "Merging..." : "Merge"}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        )}

        {activeTab === "summary" && (
          <div className="h-full overflow-y-auto pr-2 pb-6">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Thread Summary</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  AI-generated review of this conversation
                </div>
              </div>

              <button
                type="button"
                onClick={() => generateSummary(true)}
                disabled={threadSummaryGenerating}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--info)] hover:bg-[var(--surface-2)] disabled:opacity-60"
              >
                {threadSummaryGenerating ? "Refreshing..." : "Refresh Summary"}
              </button>
            </div>

            {threadSummaryLoading && (
              <div className="text-center py-10 text-[var(--text-muted)] text-sm">Loading summary...</div>
            )}

            {!threadSummaryLoading && !threadSummary && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="text-sm text-[var(--text-primary)] mb-2">No summary yet for this thread</div>
                <div className="text-xs text-[var(--text-secondary)] mb-4">
                  Generate a cached AI summary with status, intent, action items, completed items,
                  and next step.
                </div>
                <button
                  type="button"
                  onClick={() => generateSummary(false)}
                  disabled={threadSummaryGenerating}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[12px] font-semibold hover:bg-[var(--accent)] disabled:opacity-60"
                >
                  {threadSummaryGenerating ? "Generating..." : "Generate Summary"}
                </button>
              </div>
            )}

            {!threadSummaryLoading && threadSummary?.summary && (
              <div className="space-y-3">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Overview
                  </div>
                  <div className="text-sm text-[var(--text-primary)] leading-6">
                    {threadSummary.summary.overview || "No overview available"}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Current Status
                  </div>
                  <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-[rgba(88,166,255,0.12)] text-[var(--info)]">
                    {threadSummary.summary.status || "Unknown"}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Supplier Intent
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-[var(--highlight-bg)] text-[var(--highlight)]">
                      {threadSummary.summary.intent
                        ? threadSummary.summary.intent.replace(/_/g, " ")
                        : "general inquiry"}
                    </span>

                    <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-[rgba(88,166,255,0.12)] text-[var(--info)]">
                      Confidence: {threadSummary.summary.confidence || "medium"}
                    </span>
                  </div>

                  {threadSummary.summary.secondary_intents?.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                        Secondary intents
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {threadSummary.summary.secondary_intents.map(
                          (intent: string, index: number) => (
                            <span
                              key={index}
                              className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[var(--bg)] border border-[var(--border)] text-[var(--text-primary)]"
                            >
                              {intent.replace(/_/g, " ")}
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Open Action Items
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">AI items synced with thread tasks</div>
                  </div>
                  {openActionItemStates.length > 0 ? (
                    <div className="space-y-2">
                      {openActionItemStates.map((item: OpenActionItemState) => {
                        const isCreating = creatingSuggestedTasks.includes(item.text);
                        return (
                          <div
                            key={item.id}
                            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="text-sm text-[var(--text-primary)]">{item.text}</div>
                                {item.taskMatch?.text && (
                                  <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                                    Matched task: {item.taskMatch.text}
                                  </div>
                                )}
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {item.state === "needs_task" && (
                                  <button
                                    type="button"
                                    onClick={() => createSuggestedTask(item.text)}
                                    disabled={isCreating}
                                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--highlight)] text-[var(--bg)] text-[11px] font-semibold hover:opacity-90 disabled:opacity-60"
                                  >
                                    {isCreating ? "Creating..." : "Create task"}
                                  </button>
                                )}

                                {item.state === "tracked" && (
                                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[rgba(88,166,255,0.12)] text-[var(--info)]">
                                    Tracked by task
                                  </span>
                                )}

                                {item.state === "completed" && (
                                  <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[rgba(74,222,128,0.12)] text-[var(--accent)]">
                                    Completed in tasks
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--text-secondary)]">No open action items detected</div>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Suggested Tasks
                    </div>

                    {pendingSuggestedTaskItems.length > 1 && (
                      <button
                        type="button"
                        onClick={createAllSuggestedTasks}
                        disabled={creatingAllSuggestedTasks}
                        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[11px] font-semibold text-[var(--accent)] hover:bg-[var(--surface-2)] disabled:opacity-60"
                      >
                        {creatingAllSuggestedTasks ? "Creating..." : "Create All"}
                      </button>
                    )}
                  </div>

                  {suggestedTaskItems.length > 0 ? (
                    <div className="space-y-2">
                      {suggestedTaskItems.map((item) => {
                        const isCreating = creatingSuggestedTasks.includes(item.text);

                        return (
                          <div
                            key={item.id}
                            className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-[var(--text-primary)]">{item.text}</div>
                              {item.alreadyCreated && (
                                <div className="mt-1 text-[11px] font-medium text-[var(--accent)]">
                                  Already created in thread tasks
                                </div>
                              )}
                            </div>

                            {item.alreadyCreated ? (
                              <div className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px] font-semibold text-[var(--accent)] shrink-0">
                                Created
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => createSuggestedTask(item.text)}
                                disabled={isCreating || creatingAllSuggestedTasks}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[11px] font-semibold hover:bg-[var(--accent)] disabled:opacity-60 shrink-0"
                              >
                                {isCreating ? "Creating..." : "Create"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--text-secondary)]">No suggested tasks generated</div>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                      Completed Items
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">AI items checked against task completion</div>
                  </div>
                  {completedItemStates.length > 0 ? (
                    <div className="space-y-2">
                      {completedItemStates.map((item: CompletedItemState) => (
                        <div
                          key={item.id}
                          className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-[var(--text-primary)] flex items-start gap-2">
                                <span className="mt-0.5 text-[var(--accent)]">✓</span>
                                <span>{item.text}</span>
                              </div>
                              {item.taskMatch?.text && (
                                <div className="mt-1 text-[11px] text-[var(--text-secondary)]">
                                  Matched task: {item.taskMatch.text}
                                </div>
                              )}
                            </div>

                            {item.state === "confirmed_completed" && (
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[rgba(74,222,128,0.12)] text-[var(--accent)] shrink-0">
                                Confirmed by task state
                              </span>
                            )}

                            {item.state === "still_open" && (
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[var(--highlight-bg)] text-[var(--highlight)] shrink-0">
                                Still open in tasks
                              </span>
                            )}

                            {item.state === "ai_only" && (
                              <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold bg-[var(--surface)] text-[var(--text-secondary)] border border-[var(--border)] shrink-0">
                                AI only
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-sm text-[var(--text-secondary)]">No completed items detected</div>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                    Next Step
                  </div>
                  <div className="text-sm text-[var(--text-primary)]">
                    {threadSummary.summary.next_step || "No next step identified"}
                  </div>
                </div>

                <div className="text-[11px] text-[var(--text-muted)] px-1">
                  Last generated:{" "}
                  {threadSummary.generated_at
                    ? new Date(threadSummary.generated_at).toLocaleString()
                    : "Unknown"}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {!isReviewTab && (
        <div className="px-4 py-2 border-t border-[var(--surface-2)] shrink-0">
          {!showReplyEditor ? (
            <div className="flex gap-2">
              <button
                onClick={() => setShowReplyEditor(true)}
                className="flex-1 px-4 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] text-[13px] text-left hover:border-[var(--accent)]/30 hover:text-[var(--text-secondary)] transition-all"
              >
                Write a reply...
              </button>
              <button
                onClick={() => setShowFormModal({})}
                title="Fill out a form"
                className="px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] hover:border-[var(--accent)]/30 hover:text-[var(--accent)] transition-all"
              >
                <ClipboardCheck size={16} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* Batch 11: Cc / Bcc toggle row */}
              {(!showReplyCc || !showReplyBcc) && (
                <div className="flex items-center gap-2 text-[10px]">
                  {!showReplyCc && (
                    <button
                      onClick={() => setShowReplyCc(true)}
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors uppercase font-semibold tracking-wider"
                    >
                      + Cc
                    </button>
                  )}
                  {!showReplyBcc && (
                    <button
                      onClick={() => setShowReplyBcc(true)}
                      className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors uppercase font-semibold tracking-wider"
                    >
                      + Bcc
                    </button>
                  )}
                </div>
              )}
              {showReplyCc && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-wider w-8 shrink-0">Cc</label>
                  <input
                    value={replyCc}
                    onChange={(e) => setReplyCc(e.target.value)}
                    placeholder="cc@example.com (comma-separated for multiple)"
                    className="flex-1 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]/40 placeholder:text-[var(--text-muted)]"
                  />
                  <button
                    onClick={() => { setReplyCc(""); setShowReplyCc(false); }}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors p-1"
                    title="Remove Cc"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              {showReplyBcc && (
                <div className="flex items-center gap-2">
                  <label className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-wider w-8 shrink-0">Bcc</label>
                  <input
                    value={replyBcc}
                    onChange={(e) => setReplyBcc(e.target.value)}
                    placeholder="bcc@example.com (comma-separated for multiple)"
                    className="flex-1 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]/40 placeholder:text-[var(--text-muted)]"
                  />
                  <button
                    onClick={() => { setReplyBcc(""); setShowReplyBcc(false); }}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors p-1"
                    title="Remove Bcc"
                  >
                    <X size={12} />
                  </button>
                </div>
              )}
              <RichTextEditor
                value={replyText}
                onChange={setReplyText}
                placeholder="Write a reply..."
                compact
                minHeight={50}
                autoFocus
                signature={replySignature}
                onAttach={() => replyFileInputRef.current?.click()}
                onDrive={() => openReplyDrivePicker()}
                onTemplate={() => openReplyTemplatePicker()}
                onAIDraft={() => setShowAIDraftModal(true)}
              />
              {/* Reply attachments */}
              <input ref={replyFileInputRef} type="file" multiple onChange={async (e) => {
                const files = e.target.files;
                if (!files) return;
                const newAtts: { name: string; size: number; type: string; data: string }[] = [];
                for (let i = 0; i < files.length; i++) {
                  const file = files[i];
                  if (file.size > 25 * 1024 * 1024) continue;
                  const data = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve((reader.result as string).split(",")[1]);
                    reader.readAsDataURL(file);
                  });
                  newAtts.push({ name: file.name, size: file.size, type: file.type || "application/octet-stream", data });
                }
                setReplyAttachments((prev) => [...prev, ...newAtts]);
                if (replyFileInputRef.current) replyFileInputRef.current.value = "";
              }} className="hidden" />
              {replyAttachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 py-1">
                  {replyAttachments.map((att, i) => (
                    <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[10px]">
                      <Paperclip size={10} className="text-[var(--info)]" />
                      <span className="text-[var(--text-primary)] max-w-[120px] truncate">{att.name}</span>
                      <button onClick={() => setReplyAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                        className="text-[var(--text-muted)] hover:text-[var(--danger)]"><X size={10} /></button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setShowReplyEditor(false); setReplyText(""); setReplyAttachments([]); setReplyCc(""); setReplyBcc(""); setShowReplyCc(false); setShowReplyBcc(false); }}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    Collapse
                  </button>
                  {loadedDraftId && (
                    <button
                      onClick={async () => {
                        await fetch(`/api/drafts?id=${loadedDraftId}`, { method: "DELETE" }).catch(() => {});
                        setLoadedDraftId(null);
                        setReplyText("");
                        setShowReplyEditor(false);
                        setReplyAttachments([]);
                      }}
                      className="text-[11px] text-[var(--danger)] hover:text-[#FF8E88] transition-colors"
                    >
                      Discard draft
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {loadedDraftId && (
                    <span className="text-[9px] text-[var(--warning)] font-semibold px-1.5 py-0.5 rounded bg-[var(--warning)]/10 border border-[var(--warning)]/20">Draft</span>
                  )}
                  <button
                    onClick={handleSendReplyInternal}
                    disabled={sending || (!replyText.replace(/<[^>]*>/g, "").trim() && replyAttachments.length === 0)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] disabled:opacity-40 transition-all text-[11px] font-bold"
                  >
                    <Send size={12} />
                    {sending ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>

              {/* Reply Template Picker Modal */}
              {showReplyTemplateModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowReplyTemplateModal(false)}>
                  <div className="w-full max-w-lg bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-[var(--text-primary)]">Insert Template</div>
                        <div className="text-[10px] text-[var(--text-muted)]">Click a template to insert into reply</div>
                      </div>
                      <button onClick={() => setShowReplyTemplateModal(false)} className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="max-h-[400px] overflow-y-auto">
                      {replyTemplates.length === 0 ? (
                        <div className="text-center py-8 text-[var(--text-muted)] text-[12px]">No templates yet. Create them in Settings.</div>
                      ) : (
                        <div className="p-2 space-y-0.5">
                          {["organization", "personal"].map((scope) => {
                            const scopeTemplates = replyTemplates.filter((t: any) => t.scope === scope);
                            if (scopeTemplates.length === 0) return null;
                            return (
                              <div key={scope}>
                                <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest px-3 pt-2 pb-1">
                                  {scope === "organization" ? "🏢 Organization" : "👤 Personal"}
                                </div>
                                {scopeTemplates.map((tpl: any) => (
                                  <button key={tpl.id} onClick={() => { setReplyText(tpl.body); setShowReplyTemplateModal(false); }}
                                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[var(--border)] text-left transition-colors">
                                    <div className="flex-1 min-w-0">
                                      <div className="text-[12px] font-semibold text-[var(--text-primary)]">{tpl.name}</div>
                                      <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">
                                        {tpl.body.replace(/<[^>]*>/g, "").slice(0, 80)}...
                                      </div>
                                    </div>
                                    {tpl.category && (
                                      <span className="px-1.5 py-0.5 rounded text-[9px] bg-[rgba(88,166,255,0.12)] text-[var(--info)] shrink-0">{tpl.category}</span>
                                    )}
                                  </button>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Reply Drive Picker Modal */}
              {showReplyDrive && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowReplyDrive(false)}>
                  <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
                    <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
                      <div>
                        <div className="text-sm font-bold text-[var(--text-primary)]">Insert from Google Drive</div>
                        <div className="text-[10px] text-[var(--text-muted)]">Click a file to attach it</div>
                      </div>
                      <button onClick={() => setShowReplyDrive(false)} className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center">
                        <X size={16} />
                      </button>
                    </div>
                    <div className="p-4 max-h-[400px] overflow-y-auto">
                      {replyDrivePath.length > 0 && (
                        <div className="flex items-center gap-1 mb-3 text-[11px] flex-wrap">
                          {replyDrivePath.map((fp, i) => (
                            <span key={fp.id} className="flex items-center gap-1">
                              {i > 0 && <span className="text-[var(--text-muted)]">/</span>}
                              <button onClick={() => navigateReplyDrivePath(i)} className="text-[var(--info)] hover:underline">{fp.name}</button>
                            </span>
                          ))}
                        </div>
                      )}
                      {replyDriveLoading ? (
                        <div className="text-center py-6 text-[var(--text-muted)] text-[12px]">Loading...</div>
                      ) : (
                        <div className="space-y-0.5">
                          {replyDriveFolders.map((f) => (
                            <button key={f.id} onClick={() => navigateReplyDriveFolder(f)}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--border)] text-left transition-colors">
                              <FolderOpen size={14} className="text-[var(--warning)]" />
                              <span className="text-[12px] text-[var(--text-primary)]">{f.name}</span>
                            </button>
                          ))}
                          {replyDriveFiles.map((f) => (
                            <button key={f.id} onClick={() => { attachReplyDriveFile(f); setShowReplyDrive(false); }}
                              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[rgba(74,222,128,0.08)] text-left transition-colors">
                              <FileText size={14} className="text-[var(--info)]" />
                              <span className="text-[12px] text-[var(--text-primary)] flex-1 truncate">{f.name}</span>
                            </button>
                          ))}
                          {replyDriveFolders.length === 0 && replyDriveFiles.length === 0 && (
                            <div className="text-[11px] text-[var(--text-muted)] py-4 text-center">No files in this folder</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!isReviewTab && (
        <TeamChat
          conversationId={convo.id}
          currentUser={currentUser}
          teamMembers={teamMembers}
        />
      )}

      {showForwardModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
    <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl flex flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 shrink-0">
        <div>
          <div className="text-sm font-semibold text-[var(--text-primary)]">Forward Message</div>
          <div className="text-xs text-[var(--text-secondary)]">
            Send this conversation content to another recipient
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowForwardModal(false)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
          title="Close"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">To</label>
          <input
            type="text"
            value={forwardTo}
            onChange={(e) => setForwardTo(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Cc</label>
          <input
            type="text"
            value={forwardCc}
            onChange={(e) => setForwardCc(e.target.value)}
            placeholder="optional cc recipients"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Subject</label>
          <input
            type="text"
            value={forwardSubject}
            onChange={(e) => setForwardSubject(e.target.value)}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Message</label>
          <textarea
            value={forwardBody}
            onChange={(e) => setForwardBody(e.target.value)}
            rows={14}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-y"
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4 shrink-0 bg-[var(--surface)]">
        <div className="text-[11px] text-[var(--text-secondary)]">
          Save draft is not wired yet in this forward flow.
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowForwardModal(false)}
            className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-2)]"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={handleSendForward}
            disabled={
              forwardSending ||
              !forwardTo.trim() ||
              !forwardSubject.trim() ||
              !forwardBody.trim()
            }
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold hover:bg-[var(--accent)] disabled:opacity-50"
          >
            <Send size={14} />
            {forwardSending ? "Sending..." : "Send Forward"}
          </button>
        </div>
      </div>
    </div>
  </div>
)}

      {/* Reply Modal — full-form reply with editable To / Cc / Bcc / Subject / Body.
          Threads into the existing conversation via /api/send's reply mode. */}
      {showReplyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-3xl max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl flex flex-col">
            <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4 shrink-0">
              <div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">Reply</div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Edit recipients and subject before sending. The reply will thread into this conversation.
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowReplyModal(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">To</label>
                <input
                  type="text"
                  value={replyModalTo}
                  onChange={(e) => setReplyModalTo(e.target.value)}
                  placeholder="recipient@example.com"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Cc</label>
                <input
                  type="text"
                  value={replyModalCc}
                  onChange={(e) => setReplyModalCc(e.target.value)}
                  placeholder="optional cc recipients"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Bcc</label>
                <input
                  type="text"
                  value={replyModalBcc}
                  onChange={(e) => setReplyModalBcc(e.target.value)}
                  placeholder="optional bcc recipients"
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Subject</label>
                <input
                  type="text"
                  value={replyModalSubject}
                  onChange={(e) => setReplyModalSubject(e.target.value)}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">Message</label>
                <textarea
                  value={replyModalBody}
                  onChange={(e) => setReplyModalBody(e.target.value)}
                  placeholder="Type your reply..."
                  rows={14}
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none resize-y"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4 shrink-0 bg-[var(--surface)]">
              <button
                type="button"
                onClick={() => setShowReplyModal(false)}
                className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-2)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSendReplyModal}
                disabled={
                  replyModalSending ||
                  !replyModalTo.trim() ||
                  !replyModalSubject.trim() ||
                  !replyModalBody.trim()
                }
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold hover:bg-[var(--accent)] disabled:opacity-50"
              >
                <Send size={14} />
                {replyModalSending ? "Sending..." : "Send Reply"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showFormModal && (
        <FormModal
          conversationId={convo.id}
          taskId={showFormModal.taskId}
          taskCategoryId={showFormModal.categoryId}
          submittedBy={currentUser?.id}
          onClose={() => setShowFormModal(null)}
          onSubmitted={() => {
            // Trigger notes refresh by calling onAddNote with empty to force parent refetch
            window.location.hash = `#conversation=${convo.id}`;
          }}
        />
      )}

      {/* AI Draft Modal — Tenkara workflow assistant.
          Auto-fills from the latest inbound message + conversation metadata. */}
      <AIDraftModal
        open={showAIDraftModal}
        onClose={() => setShowAIDraftModal(false)}
        initialSupplierCompany={(() => {
          // Try to derive a supplier company name from the from_email domain
          const email = convo.from_email || "";
          const domain = email.split("@")[1] || "";
          if (!domain) return convo.from_name || "";
          // Drop common TLDs and prettify (e.g. "acme-corp.com" -> "Acme Corp")
          const root = domain.split(".")[0];
          return root
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (m) => m.toUpperCase());
        })()}
        initialContactName={convo.from_name || ""}
        initialEmailSubject={convo.subject || ""}
        initialIncomingMessage={(() => {
          const latestInbound =
            [...messages].reverse().find((msg: any) => !msg.is_outbound) ||
            messages[messages.length - 1];
          if (!latestInbound) return "";
          // Strip HTML tags if there's no plain-text body
          const raw = latestInbound.body_text ||
            (latestInbound.body_html
              ? latestInbound.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")
              : "") ||
            latestInbound.snippet || "";
          return String(raw).trim();
        })()}
        organizationName="Tenkara"
        onInsert={(text) => {
          // Convert plain-text (with \n line breaks) into HTML that contentEditable
          // will render correctly. Setting innerHTML with raw \n collapses them to
          // single spaces — losing the AI's paragraph spacing.
          // Each paragraph is followed by an empty <p></p> for visible breathing
          // room between paragraphs (matches how the AI's output looks in the modal).
          const htmlToInsert = String(text || "")
            .split(/\n{2,}/)
            .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p><p><br></p>`)
            .join("");
          // Insert into the reply editor — preserve any existing draft by appending
          if (replyText && replyText.trim()) {
            setReplyText(replyText + "<p></p>" + htmlToInsert);
          } else {
            setReplyText(htmlToInsert);
          }
          setShowReplyEditor(true);
        }}
      />

    </div>
  );
}