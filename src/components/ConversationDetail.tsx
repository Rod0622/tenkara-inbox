"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  AlarmClock,
  Archive,
  Ban,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
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
  MoreHorizontal,
  Paperclip,
  Phone,
  PhoneOutgoing,
  Pencil,
  Plus,
  Printer,
  Reply,
  RotateCcw,
  Search,
  Send,
  Star,
  Tag,
  Trash2,
  User,
  UserMinus,
  Users,
  X,
  ClipboardCheck,
  Link2,
  StickyNote,
  Pin,
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
import RichTextEditor, { type RichTextEditorHandle } from "@/components/RichTextEditor";
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
import MessageBody from "./ConversationDetail/MessageBody";
import WatchToggle from "./WatchToggle";
import SupplierStatusBadge from "./SupplierStatusBadge";
import CallTimelineEntry, { type CallEntry } from "./ConversationDetail/CallTimelineEntry";
import QuickCallModal from "./QuickCallModal";
import type { SuggestedTaskItem, OpenActionItemState, CompletedItemState } from "./ConversationDetail/types";
import { normalizeSuggestedTaskText, getNormalizedTokens, getTaskMatchMeta } from "./ConversationDetail/utils";

// Convert a domain root like "wholesalesuppliesplus" into a human-readable
// supplier name "Wholesale Supplies Plus". Best-effort — used as a default
// when auto-creating a supplier from a participant's email. The user can
// rename the supplier later in the command center.
//
// Approach: greedy left-to-right split. Walks the lowercase domain and
// inserts a space before any capitalizable chunk, using a dictionary of
// common English words to find break points. Falls back to title-case of
// the whole token if no breaks are found.
function humanizeDomainRoot(root: string): string {
  if (!root) return "";
  const cleaned = String(root).toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!cleaned) return root;

  // Small dictionary of common business/supplier words. Order matters — longer
  // first so "supplies" matches before "supp", "plus" before "plu", etc.
  const dict = [
    "wholesale", "supplies", "supply", "company", "industries", "industrial",
    "international", "global", "natural", "naturals", "nutrition", "ingredients",
    "ingredient", "products", "product", "biotechnology", "biotech", "chemicals",
    "chemical", "foods", "food", "labs", "laboratory", "laboratories", "lab",
    "essentials", "essence", "organics", "organic", "organica", "vita",
    "premium", "pharma", "trading", "trade", "ltd", "inc", "corp", "co",
    "the", "and", "of", "for", "plus", "pro", "max", "tech", "group",
  ];

  const parts: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    let matched = "";
    for (const word of dict) {
      if (cleaned.slice(i, i + word.length) === word && word.length > matched.length) {
        matched = word;
      }
    }
    if (matched) {
      parts.push(matched);
      i += matched.length;
    } else {
      // Take a single character until the next dictionary match
      let chunk = "";
      while (i < cleaned.length) {
        chunk += cleaned[i];
        i += 1;
        const remaining = cleaned.slice(i);
        const lookahead = dict.find((w) => remaining.startsWith(w));
        if (lookahead) break;
      }
      if (chunk) parts.push(chunk);
    }
  }

  return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}

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

// Extract email addresses from a comma-separated header string.
// Handles both raw addresses ("alice@x.com, bob@y.com") and the
// "Name <email>" format ("Alice <alice@x.com>, Bob <bob@y.com>").
// Returns lowercase, deduplicated, trimmed strings. Empty input -> [].
// Repair address strings stored in a broken shape. Early agent drafts were
// written with to_addresses as a JS ARRAY into a text column, which
// serialized to JSON — ["\"'Name'\" <a@b.com>"] — and rendered raw in the
// To field. Unwraps that shape and strips quote/escape noise; clean
// strings pass through unchanged.
function normalizeAddressList(raw: string | null | undefined): string {
  if (!raw) return "";
  let s = String(raw).trim();
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      if (Array.isArray(arr)) s = arr.map((x) => String(x)).join(", ");
    } catch {
      /* not JSON — fall through and clean as-is */
    }
  }
  return s.replace(/\\+/g, "").replace(/["']/g, "").trim();
}

function extractEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const parts = String(raw).split(",");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const angled = part.match(/<([^>]+)>/);
    const candidate = (angled ? angled[1] : part).trim().toLowerCase();
    if (!candidate) continue;
    // Sanity check: must contain "@"
    if (!candidate.includes("@")) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

// Compute Reply All recipients from the message thread.
//   primaryTo:    address that goes in the To: field (always one address)
//   ccList:       additional addresses for the Cc: field (everyone else, dedup'd, sans ourselves)
//   hasMultiple:  true when there's at least one Cc candidate — UI uses this to
//                 decide whether to show the Reply All toggle/button at all.
//
// Semantics:
//   • If the latest message was sent BY us (outbound), preserve its To/Cc.
//   • If the latest message was received, To = its sender, Cc = all of its
//     remaining To + Cc participants, minus ourselves.
//   • The account's own email is always stripped — we never email ourselves.
function computeReplyAllRecipients(
  messages: any[],
  accountEmail: string,
  convoFromEmail: string | null | undefined,
): { primaryTo: string; ccList: string[]; hasMultiple: boolean } {
  const ownEmail = (accountEmail || "").toLowerCase();
  // Find the message we'd be replying to: latest inbound, else latest message.
  const latestInbound = [...messages].reverse().find((m: any) => !m.is_outbound);
  const target = latestInbound || messages[messages.length - 1] || null;

  if (!target) {
    // No messages — fall back to convo.from_email if we have it.
    const fallback = (convoFromEmail || "").trim().toLowerCase();
    return {
      primaryTo: fallback,
      ccList: [],
      hasMultiple: false,
    };
  }

  const isOutbound = !!target.is_outbound;
  const targetFrom = (target.from_email || "").trim().toLowerCase();
  const toEmails = extractEmails(target.to_addresses);
  const ccEmails = extractEmails(target.cc_addresses);

  let primaryTo = "";
  let candidates: string[] = [];

  if (isOutbound) {
    // We sent this one. Reply All = same To + same Cc (we're already the sender).
    primaryTo = toEmails[0] || "";
    candidates = [...toEmails.slice(1), ...ccEmails];
  } else {
    // We received this one. Reply All = sender, plus everyone else who got it.
    primaryTo = targetFrom;
    candidates = [...toEmails, ...ccEmails];
  }

  // Strip ourselves and the primary recipient from the Cc list, then dedup.
  const seen = new Set<string>();
  if (primaryTo) seen.add(primaryTo);
  if (ownEmail) seen.add(ownEmail);
  const ccList: string[] = [];
  for (const e of candidates) {
    if (!e) continue;
    if (seen.has(e)) continue;
    seen.add(e);
    ccList.push(e);
  }

  return {
    primaryTo,
    ccList,
    hasMultiple: ccList.length > 0,
  };
}

// Collect every unique participant email across all messages in the thread.
// Used by Forward's "pre-fill all participants" convenience. Strips ourselves
// (the connected account) so we don't forward to our own inbox.
function collectAllParticipants(
  messages: any[],
  accountEmail: string,
): string[] {
  const ownEmail = (accountEmail || "").toLowerCase();
  const seen = new Set<string>();
  if (ownEmail) seen.add(ownEmail);
  const out: string[] = [];
  for (const msg of messages || []) {
    const fromE = (msg.from_email || "").trim().toLowerCase();
    if (fromE && !seen.has(fromE) && fromE.includes("@")) {
      seen.add(fromE);
      out.push(fromE);
    }
    for (const addr of [...extractEmails(msg.to_addresses), ...extractEmails(msg.cc_addresses)]) {
      if (!seen.has(addr)) {
        seen.add(addr);
        out.push(addr);
      }
    }
  }
  return out;
}

export default function ConversationDetail({
  conversation: convo,
  currentUser,
  teamMembers,
  emailAccounts,
  onAddNote,
  onToggleTask,
  onAddTask,
  onUpdateTask,
  onAssign,
  onSendReply,
  onMoveToFolder,
  globalSearchQuery,
  onLabelsChange,
}: ConversationDetailProps) {
  const [replyText, setReplyText] = useState("");
  // Editable To and Subject for the inline reply. Auto-populated when the
  // reply editor opens (To = auto-picked recipient, Subject = "Re: <convo subject>")
  // but the user can override either before sending. Both are passed to
  // /api/send and saved on the draft.
  const [replyTo, setReplyTo] = useState("");
  const [replySubject, setReplySubject] = useState("");
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
  // Persistent (accumulated) quotes for this conversation, read from the
  // supplier_quotes store and filtered to this thread. The Summary tab renders
  // these instead of the per-extraction snapshot, so quotes already gathered
  // are never lost when a later refresh re-extracts from a smaller message
  // window. Refresh still re-extracts + auto-promotes (adding/filling the
  // store); the display just reads the durable, accumulated rows.
  const [persistedQuotes, setPersistedQuotes] = useState<any[]>([]);
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
  // Actual number of highlighted <mark> elements currently in the DOM. This is
  // the source of truth for navigation and the "N/M" counter — the plain-text
  // match count can diverge from what the HTML highlighter actually marks, which
  // made the arrows land on the wrong match. Updated by the scroll effect.
  const [domMatchCount, setDomMatchCount] = useState(0);
  const matchRefs = useRef<(HTMLElement | null)[]>([]);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  // Synchronous locks to prevent double-submit task creation. React state
  // (creatingSuggestedTasks / creatingAllSuggestedTasks) is async/batched,
  // so a fast double-click can fire createSuggestedTask twice before the
  // disabled prop takes effect. Refs update synchronously — guarding the
  // function body with these prevents the duplicate.
  const creatingSuggestedTaskLockRef = useRef<Set<string>>(new Set());
  const creatingAllSuggestedTasksLockRef = useRef(false);
  // Same lock for the in-conversation Tasks tab "Create task" button — the
  // button previously had NO saving guard at all, so spam-clicking would
  // POST the same task multiple times.
  const addTaskInternalLockRef = useRef(false);
  const [savingNewTask, setSavingNewTask] = useState(false);

  // Scroll to current match.
  //
  // The match <mark> elements are created by MessageBody's DOM highlighter,
  // which runs asynchronously AFTER the message HTML renders — and re-runs when
  // inline images resolve (changing the body HTML). A fixed delay races that,
  // and a one-shot scroll gets wiped when the highlighter regenerates the marks.
  //
  // So instead of polling once, we watch the message container with a
  // MutationObserver: any time marks are added/removed/replaced, we re-apply the
  // active-match emphasis and re-scroll. This survives late highlighting and
  // image-load re-renders, and keeps the counter in sync with the real marks.
  useEffect(() => {
    if (!threadSearchActive || !threadSearch) return;
    const container = messagesScrollRef.current;
    if (!container) return;

    let scrollTimer: ReturnType<typeof setTimeout> | null = null;

    const applyHighlightAndScroll = () => {
      const marks = container.querySelectorAll("mark[data-match-idx]");
      if (marks.length === 0) return;
      // Keep the counter in sync with the marks actually rendered.
      setDomMatchCount((prev) => (prev === marks.length ? prev : marks.length));
      const idx = ((currentMatchIndex % marks.length) + marks.length) % marks.length;
      // Base highlight on all, stronger highlight on the active match.
      marks.forEach((m) => (m as HTMLElement).style.background = "color-mix(in srgb, var(--highlight) 40%, transparent)");
      const target = marks[idx] as HTMLElement;
      if (target) {
        target.style.background = "color-mix(in srgb, var(--highlight) 80%, transparent)";
        target.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };

    // Debounced runner — a burst of DOM mutations (e.g. several messages
    // highlighting at once) collapses into a single scroll.
    const schedule = () => {
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(applyHighlightAndScroll, 60);
    };

    // Run once now (marks may already be present), then watch for changes.
    schedule();

    const observer = new MutationObserver((mutations) => {
      // Only react when marks (or their container subtree) actually change, to
      // avoid needless work on unrelated DOM updates.
      const touchesMarks = mutations.some((m) =>
        m.type === "childList" && (m.addedNodes.length > 0 || m.removedNodes.length > 0)
      );
      if (touchesMarks) schedule();
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (scrollTimer) clearTimeout(scrollTimer);
    };
  }, [currentMatchIndex, threadSearch, threadSearchActive]);

  // Reset search when conversation changes
  useEffect(() => {
    setThreadSearch("");
    setThreadSearchActive(false);
    setCurrentMatchIndex(0);
    matchRefs.current = [];
  }, [convo?.id]);

  // Scroll to top (newest message) on conversation open.
  // With descending sort, the newest message is at the top of the timeline,
  // so this lands the user on the most recent content.
  useEffect(() => {
    if (!convo?.id) return;
    // Small timeout so the messages have a chance to render
    const t = setTimeout(() => {
      const container = messagesScrollRef.current;
      if (container) container.scrollTop = 0;
    }, 50);
    return () => clearTimeout(t);
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
  // Reply MODAL (the popout for Reply All / expanded reply) has its own
  // attachment list independent from the inline reply. Same shape as above.
  const [replyModalAttachments, setReplyModalAttachments] = useState<{ name: string; size: number; type: string; data: string }[]>([]);
  const replyModalFileInputRef = useRef<HTMLInputElement>(null);
  // Forward modal attachments — same shape, separate list.
  const [forwardAttachments, setForwardAttachments] = useState<{ name: string; size: number; type: string; data: string }[]>([]);
  const forwardFileInputRef = useRef<HTMLInputElement>(null);
  const [showReplyDrive, setShowReplyDrive] = useState(false);
  const [replyDriveFolders, setReplyDriveFolders] = useState<any[]>([]);
  const [replyDriveFiles, setReplyDriveFiles] = useState<any[]>([]);
  const [replyDrivePath, setReplyDrivePath] = useState<{ id: string; name: string }[]>([]);
  const [replyDriveLoading, setReplyDriveLoading] = useState(false);
  const [replyDriveDefaultFolder, setReplyDriveDefaultFolder] = useState<string | null>(null);
  const [showReplyTemplateModal, setShowReplyTemplateModal] = useState(false);
  const [replyTemplates, setReplyTemplates] = useState<any[]>([]);
  // Where to insert when a template (or Drive file) is picked. Toggled when
  // the picker opens so the click handler knows which editor to write into.
  // - "inline":  the small inline reply at the bottom of the conversation
  // - "modal":   the expanded Reply / Reply All popout modal
  // - "forward": the Forward Message modal
  const [replyInsertTarget, setReplyInsertTarget] = useState<"inline" | "modal" | "forward">("inline");
  // Refs to all three RichTextEditor instances so pickers can call
  // insertHTML(html) at the saved cursor position rather than blowing away
  // the buffer with set*Text setters.
  const inlineReplyEditorRef = useRef<RichTextEditorHandle | null>(null);
  const modalReplyEditorRef = useRef<RichTextEditorHandle | null>(null);
  const forwardEditorRef = useRef<RichTextEditorHandle | null>(null);
  // Inline create-template form state — shown when the user clicks
  // "+ New template" inside the picker. Avoids forcing them into Settings
  // (which non-admins can't access).
  const [showCreateTemplateForm, setShowCreateTemplateForm] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateScope, setNewTemplateScope] = useState<"personal" | "organization">("personal");
  const [newTemplateBody, setNewTemplateBody] = useState("");
  const [newTemplateSaving, setNewTemplateSaving] = useState(false);
  const [showAIDraftModal, setShowAIDraftModal] = useState(false);
  // Tracks which compose surface opened the AI Draft modal so we know
  // where to insert the generated text. Set right before opening AIDraft.
  // Defaults to "inline" (the threaded reply composer below messages).
  const [aiDraftTarget, setAiDraftTarget] = useState<"inline" | "replyModal" | "forwardModal">("inline");
  const [showReplyEditor, setShowReplyEditor] = useState(false);
  const [showFormModal, setShowFormModal] = useState<{ taskId?: string; categoryId?: string } | null>(null);
  const [replySignature, setReplySignature] = useState("");
  // Current connected account's email address. Used by Reply All to exclude
  // ourselves from the recipient list (don't email yourself).
  const [accountEmail, setAccountEmail] = useState<string>("");
  const [accountName, setAccountName] = useState<string>("");
  const [loadedDraftId, setLoadedDraftId] = useState<string | null>(null);
  // Agent-created draft metadata. Populated when the draft loaded into the
  // inline reply editor was created via the external API (e.g. Sammy's bot).
  // null when the draft is a normal operator draft.
  const [loadedDraftMeta, setLoadedDraftMeta] = useState<{
    created_by_agent: string | null;
    requires_sender_selection: boolean;
    email_account_id: string | null;
  } | null>(null);

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
            // CROSS-SUPPLIER SAFETY: a draft saved before the state-leak
            // fix went live can have a to_addresses pointing at a TOTALLY
            // unrelated supplier (state from a prior conversation's reply
            // editor was leaked into this conversation's auto-save). We
            // validate the draft's primary recipient against this
            // conversation's known participants before preloading it.
            //
            // Rule: the recipient's email DOMAIN must match the convo's
            // from_email OR primary_contact_email domain. Cross-domain
            // drafts are treated as contaminated — body still loads (so
            // the user can see what they wrote), but To/Cc/Bcc are dropped
            // so the auto-init effect below repopulates them from the
            // conversation's actual participants.
            //
            // Same-domain drafts (e.g. supplier sent from sales@x.com,
            // user replies to ericyang@x.com — same company, different
            // contact) are preserved.
            const draftEmails = myDraft.to_addresses
              ? extractEmails(normalizeAddressList(myDraft.to_addresses))
              : [];
            const primary = draftEmails[0] || "";
            const primaryDomain = primary.split("@")[1] || "";

            const convoAnchors: string[] = [];
            if (convo?.from_email && convo.from_email !== "internal") {
              convoAnchors.push(...extractEmails(convo.from_email));
            }
            const pcRaw = (convo as any)?.primary_contact_email;
            if (pcRaw) convoAnchors.push(String(pcRaw).toLowerCase());

            // If we have nothing to compare against (e.g. internal/team
            // conversations with from_email === "internal"), skip validation
            // and accept the draft's recipient. The reply UI isn't the
            // normal path for those anyway.
            const canValidate = convoAnchors.length > 0 && primaryDomain.length > 0;
            const recipientDomainMatches = canValidate
              ? convoAnchors.some((a) => {
                  const d = a.split("@")[1] || "";
                  return d && d === primaryDomain;
                })
              : true;

            if (canValidate && !recipientDomainMatches) {
              // Contaminated draft detected. Log for visibility — useful
              // for catching any subsequent bugs that re-introduce leaks.
              console.warn(
                `[draft-load] dropping suspicious recipient on draft ${myDraft.id}: ` +
                `primary="${primary}" but conv anchors=${JSON.stringify(convoAnchors)}`
              );
            }

            setReplyText(myDraft.body_html || myDraft.body_text || "");
            // Preload edited To/Subject from the draft if they were customized
            // last time AND the recipient passes the validation above.
            // Empty values fall back to the auto-init effect below.
            if (myDraft.to_addresses && recipientDomainMatches) setReplyTo(normalizeAddressList(myDraft.to_addresses));
            if (myDraft.subject) setReplySubject(myDraft.subject);
            if (myDraft.cc_addresses && recipientDomainMatches) { setReplyCc(normalizeAddressList(myDraft.cc_addresses)); setShowReplyCc(true); }
            if (myDraft.bcc_addresses && recipientDomainMatches) { setReplyBcc(normalizeAddressList(myDraft.bcc_addresses)); setShowReplyBcc(true); }
            setLoadedDraftId(myDraft.id);
            // Track agent metadata so the inline editor can show a badge and
            // force the operator to pick a sender before Send.
            setLoadedDraftMeta({
              created_by_agent: myDraft.created_by_agent || null,
              requires_sender_selection: !!myDraft.requires_sender_selection,
              email_account_id: myDraft.email_account_id || null,
            });
            setShowReplyEditor(true);
          } else {
            setLoadedDraftId(null);
            setLoadedDraftMeta(null);
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
        setLoadedDraftMeta(null);
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
            to_addresses: replyTo || convo.from_email,
            cc_addresses: replyCc.trim() || undefined,
            bcc_addresses: replyBcc.trim() || undefined,
            subject: replySubject || `Re: ${convo.subject}`,
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
  }, [replyText, replyTo, replySubject, replyCc, replyBcc, convo?.id, showReplyEditor]);

  // (Modal auto-save effect moved further down — see "Auto-save Reply modal
  // draft" below — to be declared AFTER the modal state.)

  // Fetch account signature for replies. Also pulls the account's email so
  // Reply All can exclude it from recipient lists (otherwise we'd email ourselves).
  useEffect(() => {
    if (convo?.email_account_id) {
      Promise.resolve().then(() => {
        const sb = createBrowserClient();
        sb.from("email_accounts")
          .select("name, email, signature, signature_enabled")
          .eq("id", convo.email_account_id)
          .single()
          .then(({ data }: any) => {
            setAccountEmail((data?.email || "").toLowerCase());
            setAccountName(data?.name || "");
            if (data?.signature_enabled && data?.signature) {
              setReplySignature(data.signature);
            } else {
              setReplySignature("");
            }
          });
      });
    } else {
      setAccountEmail("");
      setAccountName("");
      setReplySignature("");
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
  // Tracks which participant email was just copied to clipboard, so the
  // badge can flash a "Copied!" confirmation briefly.
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  // Primary contact dropdown (the "Name <email>" line below the subject).
  // Open state + the latest list of selectable external participants.
  const [primaryContactMenuOpen, setPrimaryContactMenuOpen] = useState(false);

  // Per-badge action menu — keyed by email so only one menu is open at a time.
  const [badgeMenuEmail, setBadgeMenuEmail] = useState<string | null>(null);

  // Supplier picker modal — opened when user clicks "Add as contact" on a
  // participant badge but the conversation has no supplier_contact_id yet.
  const [addContactPending, setAddContactPending] = useState<{
    name: string;
    email: string;
  } | null>(null);
  const [supplierPickerResults, setSupplierPickerResults] = useState<any[]>([]);
  const [supplierPickerQuery, setSupplierPickerQuery] = useState("");

  // Toast for "Added as contact" / "Set as primary contact" feedback. Keeps
  // the UI consistent with copy-feedback elsewhere in the header.
  const [contactToast, setContactToast] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setContactToast(msg);
    setTimeout(() => setContactToast((cur) => (cur === msg ? null : cur)), 2200);
  };

  // Close primary-contact dropdown and badge menus on outside click.
  // Inner buttons use data-contact-menu to prevent closing on their own clicks.
  useEffect(() => {
    if (!primaryContactMenuOpen && !badgeMenuEmail) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.("[data-contact-menu]")) return;
      setPrimaryContactMenuOpen(false);
      setBadgeMenuEmail(null);
    };
    const t = setTimeout(() => document.addEventListener("click", onDocClick), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDocClick);
    };
  }, [primaryContactMenuOpen, badgeMenuEmail]);

  // Supplier picker search — when the "Add to which supplier?" modal is open
  // and the user types a query, search supplier_contacts by name.
  useEffect(() => {
    if (!addContactPending) return;
    const q = supplierPickerQuery.trim();
    if (!q) { setSupplierPickerResults([]); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const supabase = createBrowserClient();
        const { data } = await supabase
          .from("supplier_contacts")
          .select("id, name")
          .ilike("name", `%${q}%`)
          .order("name")
          .limit(10);
        if (!cancelled) setSupplierPickerResults(data || []);
      } catch {
        if (!cancelled) setSupplierPickerResults([]);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(t); };
  }, [supplierPickerQuery, addContactPending]);

  // Notes by id → DOM element, used to scroll-to-note when clicking a marker
  const noteRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Which note is currently in the "pick a message to attach" mode (for retroactive attaching)
  const [attachingNoteId, setAttachingNoteId] = useState<string | null>(null);
  // Loading state during retroactive attach/detach
  const [attachingPending, setAttachingPending] = useState<string | null>(null);
  // Note editing — which note is in inline edit mode + its draft text/title +
  // save-in-flight flag + delete-in-flight flag.
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [editingNoteTitle, setEditingNoteTitle] = useState("");
  const [savingNoteEdit, setSavingNoteEdit] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
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
  // Messenger-style send indicator for the reply box: transient confirmation of
  // the send outcome. "sending" while in flight, "sent" flashes briefly on
  // success, "failed" persists (with retry) until the user sends again. Not
  // persisted to the DB — it's an in-the-moment confirmation, like Messenger's
  // checkmark. null = idle (nothing shown).
  const [replySendStatus, setReplySendStatus] = useState<null | "sending" | "sent" | "failed">(null);
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
  // The FROM account in the reply modal is ALWAYS the conversation's original
  // email_account_id. We fetch the account's display info (name, email, icon)
  // via /api/email-accounts/sendable so we can show it in the modal without
  // querying email_accounts directly from the client. The fetched list may
  // contain other accounts the user has send access to — we only render the
  // conversation's one. (Earlier design briefly supported a FROM picker; that
  // was removed by Rod to avoid send-from-wrong-account mistakes.)
  const [replyModalSendableAccounts, setReplyModalSendableAccounts] = useState<Array<{
    id: string;
    name: string;
    email: string;
    icon: string | null;
    color: string | null;
    signature: string | null;
    signature_enabled: boolean;
    is_conversation_account: boolean;
  }>>([]);
  // Reply All toggle for the top-bar Reply modal. When enabled, To stays as
  // the primary sender and Cc auto-fills with the rest of the participants.
  // We remember the computed Cc list separately so toggling off then back on
  // restores it without re-walking the messages array.
  const [replyModalReplyAll, setReplyModalReplyAll] = useState(false);
  const [replyModalReplyAllCcList, setReplyModalReplyAllCcList] = useState<string[]>([]);
  // Draft persistence for the Reply modal. Shares the same email_drafts row
  // as the inline reply (one draft per conversation+author) so a single
  // in-progress reply isn't fragmented across two UIs. When the modal opens,
  // we preload from the inline reply's loadedDraftId (if any). Body changes
  // auto-save after 3 sec pause. Close (Cancel/X) does a synchronous save.
  // Send deletes the draft.
  const replyModalAutoSaveSkipRef = useRef(true);
  const [trashingConversation, setTrashingConversation] = useState(false);
  const [markingSpam, setMarkingSpam] = useState(false);

  // Subject inline-edit state. The header subject becomes editable when the
  // user clicks it. Saved via /api/conversations/subject on Enter or blur.
  const [editingSubject, setEditingSubject] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [savingSubject, setSavingSubject] = useState(false);

  // Overflow (⋯) menu on the conversation header. Holds the Copy Link
  // action — and is the natural home for future secondary actions that
  // shouldn't crowd the primary toolbar.
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [copiedConversationLink, setCopiedConversationLink] = useState(false);

  // Merge-by-link: lets the user paste a conversation URL and merge that
  // conversation INTO the current one. Complements the existing related-thread
  // picker (which only surfaces same-supplier threads). Useful when you want
  // to consolidate two threads with different participants.
  const [showMergeLinkModal, setShowMergeLinkModal] = useState(false);
  const [mergeLinkInput, setMergeLinkInput] = useState("");
  const [mergeLinkError, setMergeLinkError] = useState<string | null>(null);
  const [mergeLinkBusy, setMergeLinkBusy] = useState(false);

  // Auto-save Reply modal draft when user stops typing for 3 seconds.
  // Mirrors the inline reply auto-save above. Both UIs share the same
  // email_drafts row (one per conversation+author), so writes here update
  // the same record the inline reply preloads from.
  useEffect(() => {
    if (!convo?.id || !currentUser?.id || !showReplyModal) return;
    // Skip the very first tick after opening — the body was just preloaded
    // and writing it again would be a wasted round-trip.
    if (replyModalAutoSaveSkipRef.current) {
      replyModalAutoSaveSkipRef.current = false;
      return;
    }
    const plainText = (replyModalBody || "").replace(/<[^>]*>/g, "").trim();
    // Empty body → delete the draft if one exists, then skip.
    if (!plainText) {
      if (loadedDraftId) {
        fetch(`/api/drafts?id=${loadedDraftId}`, { method: "DELETE" }).catch(() => {});
        setLoadedDraftId(null);
        setLoadedDraftMeta(null);
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
            to_addresses: replyModalTo,
            cc_addresses: replyModalCc,
            bcc_addresses: replyModalBcc,
            subject: replyModalSubject,
            body_html: replyModalBody,
            is_reply: true,
            source: "manual",
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.draft?.id) {
            setLoadedDraftId(data.draft.id);
            // Mirror the body into the inline-reply state so closing the
            // modal hands the draft back seamlessly.
            setReplyText(replyModalBody);
          }
        }
      } catch { /* silent */ }
    }, 3000);
    return () => clearTimeout(timer);
  }, [
    replyModalBody,
    replyModalTo,
    replyModalCc,
    replyModalBcc,
    replyModalSubject,
    convo?.id,
    currentUser?.id,
    showReplyModal,
  ]);

  // Fetch the list of email_accounts this user can send FROM in this
  // conversation. Returns the conversation's original account plus any others
  // with explicit account_access.can_send=true. Re-runs when the modal opens
  // (so a fresh ACL is loaded every time) and when the conversation changes.
  // Fetch the conversation's account display info (name, email, icon) so the
  // reply modal can show a read-only FROM line. The endpoint returns multiple
  // accounts (the user's sendable list), but we only render the one matching
  // the conversation.
  useEffect(() => {
    if (!showReplyModal || !convo?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/email-accounts/sendable?conversation_id=${convo.id}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setReplyModalSendableAccounts(data.accounts || []);
      } catch (e: any) {
        console.warn("[reply-modal] account info fetch failed:", e?.message);
      }
    })();
    return () => { cancelled = true; };
  }, [showReplyModal, convo?.id]);

  const {
    notes,
    tasks,
    messages,
    activities,
    refetch: refetchDetail,
  } = useConversationDetail(convo?.id || null);
  // ─── Primary contact + badge action handlers ──────────────────────────

  // Set the primary contact (manual mode). Closes any open menus + toasts.
  const setPrimaryContact = async (name: string, email: string) => {
    if (!convo?.id) return;
    try {
      await fetch("/api/conversations/primary-contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: convo.id, name, email, actor_id: currentUser?.id }),
      });
      showToast(`Primary contact set to ${name || email}`);
      setPrimaryContactMenuOpen(false);
      setBadgeMenuEmail(null);
      // Optimistic local update so the line updates instantly
      if (convo) {
        (convo as any).primary_contact_name = name;
        (convo as any).primary_contact_email = email.toLowerCase();
        (convo as any).primary_contact_is_manual = true;
      }
    } catch (error) {
      console.error("Failed to set primary contact:", error);
    }
  };

  // Revert to auto mode — the next inbound message will repopulate the
  // primary contact from the sync layer.
  const resetPrimaryContactToAuto = async () => {
    if (!convo?.id) return;
    try {
      await fetch(`/api/conversations/primary-contact?conversation_id=${convo.id}&actor_id=${currentUser?.id || ""}`, {
        method: "DELETE",
      });
      showToast("Reset to auto");
      setPrimaryContactMenuOpen(false);
      if (convo) {
        (convo as any).primary_contact_name = null;
        (convo as any).primary_contact_email = null;
        (convo as any).primary_contact_is_manual = false;
      }
    } catch (error) {
      console.error("Failed to reset primary contact:", error);
    }
  };

  // Add a participant as a supplier contact person. Resolution waterfall:
  //   1. If convo.supplier_contact_id is set → use it directly.
  //   2. Exact match: look up supplier_contacts by the conversation's external
  //      email. If found, back-link the conversation and use it.
  //   3. Domain match: look up supplier_contacts where the email domain
  //      matches the conversation's external email domain (e.g. any supplier
  //      contact with @wholesalesuppliesplus.com). If found, use the first
  //      match (most recent by updated_at) and back-link the conversation.
  //   4. Auto-create: derive a supplier name from the email domain (e.g.
  //      "Wholesale Supplies Plus" from "wholesalesuppliesplus.com") and
  //      create a new supplier_contacts row. Back-link the conversation.
  //
  // The supplier picker modal is the absolute last resort and shouldn't be
  // reached under normal circumstances.
  const addAsContact = async (name: string, email: string) => {
    setBadgeMenuEmail(null);
    // (1) Conversation already linked to a supplier — fast path
    if (convo?.supplier_contact_id) {
      await doAddContact(convo.supplier_contact_id, name, email);
      return;
    }
    if (!convo?.id) return;

    try {
      const sb = createBrowserClient();
      // The "anchor" external email used to resolve the supplier.
      // Prefer primary_contact_email (current display) then from_email.
      const anchorEmail = (
        (convo as any).primary_contact_email ||
        convo.from_email ||
        ""
      ).toLowerCase().trim();

      if (!anchorEmail || !anchorEmail.includes("@") || anchorEmail === "internal") {
        // Can't resolve a supplier without an external email anchor.
        // Open the picker as a last resort.
        setAddContactPending({ name, email });
        return;
      }

      const anchorDomain = anchorEmail.split("@")[1] || "";

      // (2) Exact-email match
      const { data: exactMatch } = await sb
        .from("supplier_contacts")
        .select("id, name, email")
        .eq("email", anchorEmail)
        .maybeSingle();
      if (exactMatch?.id) {
        await backLinkAndAdd(sb, convo.id, exactMatch.id, name, email);
        return;
      }

      // (3) Domain match — find any supplier_contacts row whose email lives
      // on the same domain. Prefer the most-recently-updated.
      if (anchorDomain) {
        const { data: domainMatches } = await sb
          .from("supplier_contacts")
          .select("id, name, email, updated_at")
          .ilike("email", `%@${anchorDomain}`)
          .order("updated_at", { ascending: false })
          .limit(1);
        const domainMatch = domainMatches?.[0];
        if (domainMatch?.id) {
          await backLinkAndAdd(sb, convo.id, domainMatch.id, name, email);
          return;
        }
      }

      // (4) Auto-create supplier from the domain.
      // Name guess: titleize the domain root. "wholesalesuppliesplus.com"
      // → "Wholesale Supplies Plus" (best-effort; user can rename later in
      // the supplier command center).
      const domainRoot = anchorDomain.split(".")[0] || anchorDomain || anchorEmail;
      const guessedSupplierName = humanizeDomainRoot(domainRoot);

      const { data: newSupplier, error: createErr } = await sb
        .from("supplier_contacts")
        .insert({
          email: anchorEmail,
          name: guessedSupplierName || anchorEmail,
        })
        .select("id, name")
        .single();
      if (createErr || !newSupplier?.id) {
        // Creation failed (e.g. unique constraint, RLS) — fall through to
        // the picker so the user can pick manually.
        console.error("Supplier auto-create failed:", createErr?.message);
        setAddContactPending({ name, email });
        return;
      }
      await backLinkAndAdd(sb, convo.id, newSupplier.id, name, email);
      // Toast already fired inside doAddContact, but also let the user know
      // a new supplier was created (replaces the previous toast).
      showToast(`Added to new supplier "${newSupplier.name}"`);
    } catch (e: any) {
      console.error("Auto supplier lookup/create failed:", e?.message);
      // Final fallback — show the picker.
      setAddContactPending({ name, email });
    }
  };

  // Helper: back-link the conversation to the supplier (silently, fire & forget)
  // then add the contact person. Used by all three resolution paths above.
  const backLinkAndAdd = async (
    sb: any,
    conversationId: string,
    supplierId: string,
    contactName: string,
    contactEmail: string
  ) => {
    // Fire-and-forget back-link so future "Add as contact" calls take the fast path
    sb.from("conversations")
      .update({ supplier_contact_id: supplierId })
      .eq("id", conversationId)
      .then(() => { /* ignore */ });
    if (convo) (convo as any).supplier_contact_id = supplierId;
    await doAddContact(supplierId, contactName, contactEmail);
  };

  const doAddContact = async (supplierContactId: string, name: string, email: string) => {
    try {
      const res = await fetch("/api/contact-command-center/persons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_contact_id: supplierContactId,
          name: name || email.split("@")[0],
          email: email.toLowerCase(),
        }),
      });
      if (res.ok) {
        showToast(`Added ${name || email} as contact`);
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(`Error: ${err?.error || "Failed to add"}`);
      }
    } catch (error: any) {
      showToast(`Error: ${error?.message || "Failed to add"}`);
    } finally {
      setAddContactPending(null);
      setSupplierPickerQuery("");
      setSupplierPickerResults([]);
    }
  };

  // Build the list of external participants on this thread, used for the
  // primary-contact dropdown. Excludes:
  //   - team_member emails (our internal staff)
  //   - email_accounts emails (our connected mailboxes — Bobber Labs, Vita
  //     Organica, etc. These are us, not external contacts.)
  const externalParticipants = useMemo(() => {
    if (!messages || messages.length === 0) return [] as { name: string; email: string }[];
    const ownEmails = new Set<string>();
    for (const tm of (teamMembers || [])) {
      if ((tm as any)?.email) ownEmails.add((tm as any).email.toLowerCase());
    }
    for (const acct of (emailAccounts || [])) {
      if ((acct as any)?.email) ownEmails.add((acct as any).email.toLowerCase());
    }

    const stripQuotes = (s: string) => s.trim().replace(/^["'\s]+|["'\s]+$/g, "");
    const parsePart = (raw: string): { name: string; email: string } | null => {
      const part = raw.trim();
      if (!part) return null;
      const m = part.match(/^(.*?)\s*<\s*([^<>]+?)\s*>\s*$/);
      if (m) {
        const email = stripQuotes(m[2]).toLowerCase();
        if (!email.includes("@")) return null;
        let name = stripQuotes(m[1]);
        if (!name || name.toLowerCase() === email) name = email.split("@")[0];
        return { name, email };
      }
      const bare = stripQuotes(part).toLowerCase();
      if (!bare.includes("@")) return null;
      return { name: bare.split("@")[0], email: bare };
    };

    const seen = new Set<string>();
    const out: { name: string; email: string }[] = [];
    const add = (name: string, email: string) => {
      const e = (email || "").toLowerCase();
      if (!e || !e.includes("@") || seen.has(e)) return;
      if (ownEmails.has(e)) return; // skip internal team members
      seen.add(e);
      out.push({ name: name || e.split("@")[0], email: e });
    };

    for (const msg of messages) {
      if (msg.from_email) add(msg.from_name || "", msg.from_email);
      for (const raw of String((msg as any).to_addresses || "").split(",")) {
        const p = parsePart(raw);
        if (p) add(p.name, p.email);
      }
      for (const raw of String((msg as any).cc_addresses || "").split(",")) {
        const p = parsePart(raw);
        if (p) add(p.name, p.email);
      }
    }
    return out;
  }, [messages, teamMembers, emailAccounts]);

  // ── Quo calls linked to this conversation ────────────────
  // Fetched separately from useConversationDetail to keep blast radius small.
  // Returns hydrated call rows (with supplier/person/member names) plus a
  // Set of call IDs that currently have an active follow-up.
  const [calls, setCalls] = useState<CallEntry[]>([]);
  const [activeFollowUps, setActiveFollowUps] = useState<Set<string>>(new Set());
  // QuickCallModal opened from the toolbar Dial button (separate from the
  // sidebar's "Make a call" — this one always pre-links to the current conv).
  const [showDialModal, setShowDialModal] = useState(false);

  const refetchCalls = useCallback(async () => {
    if (!convo?.id) {
      setCalls([]);
      setActiveFollowUps(new Set());
      return;
    }
    try {
      const res = await fetch(`/api/calls?conversation_id=${convo.id}&limit=100`);
      if (!res.ok) {
        setCalls([]);
        setActiveFollowUps(new Set());
        return;
      }
      const data = await res.json();
      setCalls(Array.isArray(data.calls) ? data.calls : []);
      setActiveFollowUps(new Set(Array.isArray(data.active_follow_ups) ? data.active_follow_ups : []));
    } catch {
      setCalls([]);
      setActiveFollowUps(new Set());
    }
  }, [convo?.id]);

  useEffect(() => {
    refetchCalls();
  }, [refetchCalls]);

  // Generate a draft email from a call and pre-fill the inline composer.
  // Doesn't send — just populates the reply text. User can then edit and
  // hit Send. Falls back gracefully if the call has no AI summary (Starter
  // plan on non-Sona calls).
  const handleDraftFromCall = useCallback(async (callId: string) => {
    try {
      const res = await fetch("/api/calls/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_id: callId, tone: "professional" }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert("Failed to generate draft: " + (data?.error || "unknown"));
        return;
      }
      // Drop the draft into the reply composer + open it
      setReplyText(data.body || "");
      setReplySubject(data.subject || "");
      setShowReplyEditor(true);
    } catch (e: any) {
      alert("Draft failed: " + (e?.message || "network error"));
    }
  }, []);

  // Toggle a follow-up (redial reminder) for a call. POST to create, DELETE to cancel.
  // Refetches after each change so the bell icon updates.
  const handleToggleCallFollowUp = useCallback(async (callId: string, enable: boolean) => {
    try {
      const res = await fetch(`/api/calls/${callId}/follow-up`, {
        method: enable ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: enable ? JSON.stringify({}) : undefined,
      });
      if (!res.ok && res.status !== 409) {
        const data = await res.json().catch(() => ({}));
        alert("Failed to update follow-up: " + (data?.error || res.statusText));
      }
      await refetchCalls();
    } catch (e: any) {
      alert("Follow-up toggle failed: " + (e?.message || "network error"));
    }
  }, [refetchCalls]);

  // Auto-activate thread search when opening a conversation from global search.
  //
  // Important: only fires when `convo?.id` changes (i.e., user opens a new
  // conversation). NOT on `globalSearchQuery` changes — otherwise every
  // keystroke in the main search bar would re-trigger this effect, which
  // re-applies autoFocus to the in-thread search input and steals focus
  // from whatever the user was actually typing in.
  //
  // We use a ref to read the CURRENT global query at the moment the convo
  // opens, without making it a dependency of the effect.
  const globalSearchQueryRef = useRef<string>(globalSearchQuery || "");
  useEffect(() => {
    globalSearchQueryRef.current = globalSearchQuery || "";
  }, [globalSearchQuery]);

  useEffect(() => {
    const q = globalSearchQueryRef.current;
    if (q && convo?.id) {
      setThreadSearch(q);
      setThreadSearchActive(true);
      setCurrentMatchIndex(0);
      matchRefs.current = [];
      setActiveTab("messages");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convo?.id]);

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

  // Auto-init To/Subject for the inline reply editor when it opens.
  // Runs only when both are still empty AND the editor just opened OR
  // conversation just changed. Drafts that pre-populated To/Subject win
  // because they set replyTo/replySubject before this effect runs.
  useEffect(() => {
    if (!convo || !showReplyEditor) return;
    if (!replyTo) {
      // Prefer primary_contact_email (explicitly the counterparty — set by
      // the agent API and the contact picker) over from_email, because
      // historical agent conversations stored our OWN account address in
      // from_email. Belt-and-braces: if the computed To still equals the
      // account's own email, leave it blank — an empty To the operator
      // fills in is better than auto-addressing ourselves.
      const counterparty =
        (convo as any).primary_contact_email || convo.from_email;
      const { primaryTo } = computeReplyAllRecipients(messages, accountEmail, counterparty);
      if (primaryTo && primaryTo.toLowerCase() !== (accountEmail || "").toLowerCase()) {
        setReplyTo(primaryTo);
      }
    }
    if (!replySubject) {
      const base = (convo.subject || "").trim();
      const prefixed = base.match(/^re:\s*/i) ? base : `Re: ${base}`;
      setReplySubject(prefixed);
    }
  // intentionally excluding replyTo / replySubject from deps — we only want
  // to set defaults when the editor opens / convo changes, not loop on the
  // setters we just called.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReplyEditor, convo?.id, messages.length, accountEmail]);

  // (The former "re-scroll when messages load" effect was removed — the
  // MutationObserver in the "Scroll to current match" effect above already
  // catches marks appearing when messages/highlights render, so a second
  // timer-based scroll here was redundant and could compete with it.)

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

  // Sort label badges into a consistent hierarchy:
  //   1. The email account's own label (e.g. "Bobber Labs") — always leftmost
  //   2. Other top-level labels (parent_label_id IS NULL), alphabetical
  //   3. Child labels (parent_label_id IS NOT NULL), sorted by parent then child
  // This gives users a predictable read order: "where it lives → categories →
  // subcategories" instead of whatever order Postgres happened to return.
  const sortLabelsForBadges = (labels: any[]): any[] => {
    const acctName = (accountName || "").trim().toLowerCase();
    const priority = (cl: any): number => {
      const lbl = cl?.label;
      if (!lbl) return 9;
      const isAccountLabel = acctName && (lbl.name || "").trim().toLowerCase() === acctName;
      if (isAccountLabel) return 0;
      if (!lbl.parent_label_id) return 1; // top-level
      return 2; // child
    };
    return [...labels].sort((a, b) => {
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      // Same tier: alpha by the rendered chip name so parent/child labels sort
      // by their full "Parent / Child" string (groups siblings under same parent).
      const na = labelChipName(a?.label).toLowerCase();
      const nb = labelChipName(b?.label).toLowerCase();
      return na.localeCompare(nb);
    });
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
        // The API returns a detailed `message` for known cases (e.g. an
        // untracked merge whose messages can't be auto-restored); prefer it
        // over the short error code so the user sees what to do next.
        alert("Unmerge failed: " + (err.message || err.error || "Unknown error"));
      }
    } catch (e: any) { alert("Unmerge failed: " + e.message); }
    setUnmergingId(null);
  };

  // ── Subject inline edit ────────────────────────────────────────────────
  const startEditingSubject = () => {
    setSubjectDraft(convo?.subject || "");
    setEditingSubject(true);
  };

  const cancelEditingSubject = () => {
    setEditingSubject(false);
    setSubjectDraft("");
  };

  const saveSubject = async () => {
    if (!convo?.id) return;
    const trimmed = subjectDraft.trim();
    if (!trimmed) {
      // Empty subject — cancel rather than save (we don't allow blank).
      cancelEditingSubject();
      return;
    }
    if (trimmed === (convo.subject || "").trim()) {
      // No change — just exit edit mode.
      cancelEditingSubject();
      return;
    }
    setSavingSubject(true);
    try {
      const res = await fetch("/api/conversations/subject", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          subject: trimmed,
          actor_id: currentUser?.id,
        }),
      });
      if (res.ok) {
        // Refetch so the header (and reply auto-init) pick up the new subject.
        await refetchDetail();
        cancelEditingSubject();
      } else {
        const err = await res.json().catch(() => ({}));
        alert("Could not rename: " + (err.error || res.statusText));
      }
    } catch (e: any) {
      alert("Could not rename: " + (e?.message || "network error"));
    }
    setSavingSubject(false);
  };

  // ── Copy conversation link ─────────────────────────────────────────────
  // Builds a hash-based URL the team can share. Anyone with access to this
  // conversation can paste it back into the merge-link dialog or open the
  // conversation directly.
  // The app's URL parser reads `window.location.hash` (see parseHash in
  // page.tsx) — must use `#conversation=X` not `?conversation=X` for the
  // link to actually navigate to the conversation when pasted into a new tab.
  const copyConversationLink = async () => {
    if (!convo?.id) return;
    const url = `${window.location.origin}/#conversation=${convo.id}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Fallback for older browsers / insecure contexts
      try {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch { /* give up */ }
    }
    setCopiedConversationLink(true);
    setTimeout(() => setCopiedConversationLink(false), 1500);
    setShowOverflowMenu(false);
  };

  // ── Merge by pasting a link ────────────────────────────────────────────
  // Accepts any URL/hash/ID that contains a UUID and merges that conversation
  // INTO the current one. The same /api/merge endpoint as the picker.
  const extractConversationIdFromLink = (input: string): string | null => {
    if (!input) return null;
    // Match a UUIDv4-ish pattern anywhere in the input
    const match = input.match(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    );
    return match ? match[0].toLowerCase() : null;
  };

  const handleMergeByLink = async () => {
    if (!convo?.id) return;
    setMergeLinkError(null);
    const sourceId = extractConversationIdFromLink(mergeLinkInput);
    if (!sourceId) {
      setMergeLinkError("Couldn't find a conversation ID in that link. Paste a conversation URL or its ID.");
      return;
    }
    if (sourceId === convo.id) {
      setMergeLinkError("That's this same conversation. Pick a different one to merge in.");
      return;
    }
    if (!confirm(`Merge that conversation into this one?\n\nAll its messages, tasks, notes, and activity will be moved here. The other conversation will become a merged shell and can be unmerged later from Related Threads.`)) {
      return;
    }
    setMergeLinkBusy(true);
    try {
      const res = await fetch("/api/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primary_id: convo.id,
          merge_ids: [sourceId],
          actor_id: currentUser?.id,
        }),
      });
      if (res.ok) {
        await refetchDetail();
        setMergeDataLoaded(false);
        setShowMergeLinkModal(false);
        setMergeLinkInput("");
      } else {
        const err = await res.json().catch(() => ({}));
        setMergeLinkError(err.error || "Merge failed");
      }
    } catch (e: any) {
      setMergeLinkError(e?.message || "Network error");
    }
    setMergeLinkBusy(false);
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
    // FIX: also clear loadedDraftId on conversation change. Otherwise the auto-save
    // effect's empty-text branch can fire with a stale draft id from the previous
    // conversation (replyText is cleared synchronously here, but loadedDraftId
    // would otherwise linger until the new conv's load-draft effect resolves
    // asynchronously). The load-draft effect below this re-populates it correctly
    // for the new conversation, if a draft exists.
    setLoadedDraftId(null);
    setLoadedDraftMeta(null);
    // CROSS-SUPPLIER FIX: clear all inline-reply state on conversation
    // change. Without this, replyTo/replySubject/replyCc/replyBcc/
    // replyAttachments leak from the previous conversation. The auto-init
    // effect's `if (!replyTo)` gate would then skip re-initialization
    // because the stale value is truthy, and the user's next reply would
    // be sent to the OLD conversation's recipient — even though they're
    // now viewing a different supplier's thread. Two users hit this in
    // production before the fix.
    setReplyTo("");
    setReplySubject("");
    setReplyCc("");
    setReplyBcc("");
    setShowReplyCc(false);
    setShowReplyBcc(false);
    setReplyAttachments([]);
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
    { id: "calls", label: "Calls", count: (calls || []).length },
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

  // ─── Call-skillset gating ────────────────────────────────────────────
  // When the task's category name contains "call", only team members with
  // has_call_skillset=true should be selectable. The skillset flag is set
  // in Settings → Team and is meant to identify who's trained to make
  // outbound calls. Without this gate, the flag is meaningless because the
  // picker shows everyone regardless of category.
  //
  // We accept any category whose name includes "call" (case-insensitive) so
  // workspaces with names like "Call", "Phone Call", "Customer Call" all
  // trigger the filter. Match-by-name is consistent with how /api/conversations/close
  // identifies the call task category.
  const isCallCategory = (categoryId: string | null | undefined): boolean => {
    if (!categoryId) return false;
    const cat = taskCategories.find((c: any) => c.id === categoryId);
    if (!cat || !cat.name) return false;
    return String(cat.name).toLowerCase().includes("call");
  };

  // Filtered version of assignableMembers used by the NEW task form. When
  // the picked category is a call category, drops anyone without the call
  // skillset.
  const newTaskAssignableMembers = useMemo(() => {
    if (!isCallCategory(newTaskCategoryId)) return assignableMembers;
    return assignableMembers.filter((m: any) => m.has_call_skillset === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignableMembers, newTaskCategoryId, taskCategories]);

  // Same idea for the EDIT task form (separate state).
  const editTaskAssignableMembers = useMemo(() => {
    if (!isCallCategory(editTaskCategoryId)) return assignableMembers;
    return assignableMembers.filter((m: any) => m.has_call_skillset === true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignableMembers, editTaskCategoryId, taskCategories]);

  // When the category changes, prune any currently-selected assignees who are
  // no longer eligible (e.g. switching to a Call category drops anyone without
  // the call skillset). Prevents silently submitting a task with a now-invalid
  // assignee list. Runs for both NEW and EDIT pickers via their own effects.
  useEffect(() => {
    const allowedIds = new Set(newTaskAssignableMembers.map((m: any) => m.id));
    setNewTaskAssigneeIds((prev) => prev.filter((id) => allowedIds.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newTaskCategoryId]);

  useEffect(() => {
    const allowedIds = new Set(editTaskAssignableMembers.map((m: any) => m.id));
    setEditTaskAssigneeIds((prev) => prev.filter((id) => allowedIds.has(id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editTaskCategoryId]);

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
        body: JSON.stringify({ note_id: noteId, message_id: messageId, actor_id: currentUser?.id }),
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

  // Note edit/delete helpers — added in the "you can edit your own notes now" turn.
  const startEditingNote = (note: any) => {
    setEditingNoteId(note.id);
    setEditingNoteText(note.text || "");
    setEditingNoteTitle(note.title || "");
  };
  const cancelEditingNote = () => {
    setEditingNoteId(null);
    setEditingNoteText("");
    setEditingNoteTitle("");
  };
  const saveEditedNote = async () => {
    if (!editingNoteId) return;
    const trimmed = editingNoteText.trim();
    if (!trimmed) return;
    setSavingNoteEdit(true);
    try {
      const res = await fetch("/api/conversations/notes", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note_id: editingNoteId,
          text: trimmed,
          title: editingNoteTitle.trim(),
          actor_id: currentUser?.id,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || "Failed to save note");
        return;
      }
      cancelEditingNote();
      await refetchDetail();
    } finally {
      setSavingNoteEdit(false);
    }
  };
  const deleteNote = async (noteId: string) => {
    if (!confirm("Delete this note? This can't be undone.")) return;
    setDeletingNoteId(noteId);
    try {
      const res = await fetch(`/api/conversations/notes?note_id=${noteId}&actor_id=${currentUser?.id || ""}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err?.error || "Failed to delete note");
        return;
      }
      await refetchDetail();
    } finally {
      setDeletingNoteId(null);
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

    // Synchronous lock — prevents the duplicate / triplicate POST that was
    // happening when users rapid-click "Create task". Setting React state
    // (savingNewTask) below is async, so a second click can fire before the
    // disabled prop takes effect. The ref lock is checked instantly.
    if (addTaskInternalLockRef.current) return;
    addTaskInternalLockRef.current = true;
    setSavingNewTask(true);

    try {
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
    } finally {
      setSavingNewTask(false);
      addTaskInternalLockRef.current = false;
    }
  };

  const handleDeleteTasks = async (taskIds: string[]) => {
    if (taskIds.length === 0) return;
    if (!confirm(`Delete ${taskIds.length} task${taskIds.length !== 1 ? "s" : ""}? This removes the task for all assignees.`)) return;
    setDeletingTasks(true);
    try {
      await fetch("/api/tasks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_ids: taskIds, actor_id: currentUser?.id }),
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
          actor_id: currentUser?.id,
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

  const openReplyTemplatePicker = async (target: "inline" | "modal" | "forward" = "inline") => {
    setReplyInsertTarget(target);
    setShowReplyTemplateModal(true);
    // Always re-fetch so newly created templates (or scope changes) show
    // up without a page refresh. Filter to:
    //   • Organization-scoped templates (visible to everyone)
    //   • Personal templates owned by the current user (mine only)
    // Other users' personal templates are excluded.
    Promise.resolve().then(() => {
      const sb = createBrowserClient();
      const myId = currentUser?.id || "";
      // The .or() filter is a Postgrest expression — quotes around the UUID
      // are required for the equality check.
      sb.from("email_templates")
        .select("*")
        .eq("is_active", true)
        .or(`scope.eq.organization,and(scope.eq.personal,owner_id.eq.${myId})`)
        .order("scope")
        .order("sort_order")
        .then(({ data }) => setReplyTemplates(data || []));
    });
  };

  const openReplyDrivePicker = async (target: "inline" | "modal" | "forward" = "inline") => {
    setReplyInsertTarget(target);
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
      const attachment = {
        name: file.name, size: file.size || 0,
        type: file.mimeType || "application/octet-stream", data,
      };
      // Route to the right attachment list. replyInsertTarget tells us which
      // compose surface opened the Drive picker.
      if (replyInsertTarget === "modal") {
        setReplyModalAttachments((prev) => [...prev, attachment]);
      } else if (replyInsertTarget === "forward") {
        setForwardAttachments((prev) => [...prev, attachment]);
      } else {
        setReplyAttachments((prev) => [...prev, attachment]);
      }
    } catch (e) { console.error(e); }
  };

  // ── Pre-send checks ──

  // Cross-supplier safety net. Returns a warning string if the primary
  // To recipient doesn't match anyone associated with this conversation —
  // either no message ever came from / to that address AND it isn't the
  // primary contact AND it isn't our own account email.
  //
  // This catches:
  //   • State that leaked across a conversation switch (the recent bug
  //     where replyTo carried over from a previous supplier's thread)
  //   • The user manually mistyping a recipient who has no relationship
  //     to this thread
  //
  // It does NOT block legitimate Cc additions — only checks the first
  // address in the To field. Adding a colleague to Cc is fine; sending
  // the reply itself to the wrong supplier is not.
  //
  // Returns null when the primary recipient is recognized.
  const checkSuspiciousRecipient = (toStr: string): string | null => {
    if (!toStr || !toStr.trim()) return null; // empty handled by other checks
    const targets = extractEmails(toStr);
    if (targets.length === 0) return null; // not parseable; let server reject
    const primary = targets[0];

    // Build the set of emails legitimately attached to this conversation.
    const known = new Set<string>();
    if (convo?.from_email && convo.from_email !== "internal") {
      known.add(convo.from_email.toLowerCase());
    }
    const pcEmail = (convo as any)?.primary_contact_email;
    if (pcEmail) known.add(String(pcEmail).toLowerCase());
    for (const msg of messages || []) {
      if (msg.from_email) known.add(String(msg.from_email).toLowerCase());
      for (const e of extractEmails(msg.to_addresses)) known.add(e);
      for (const e of extractEmails(msg.cc_addresses)) known.add(e);
    }
    // Our own account is always allowed (e.g. quick self-cc patterns).
    if (accountEmail) known.add(accountEmail.toLowerCase());

    if (known.has(primary)) return null;

    // What does this conversation EXPECT? Used in the warning text so the
    // user can quickly see whether they meant to send to the convo's
    // primary contact or to whoever they typed.
    const expected = pcEmail || convo?.from_email || "(no recorded contact)";
    return (
      `⚠️ This reply is going to ${primary}, but this conversation is ` +
      `with ${expected}.\n\n` +
      `Sending will email ${primary} — not the supplier above.\n\n` +
      `Send anyway?`
    );
  };

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

    // Cross-supplier safety check. Fires when the primary To recipient
    // doesn't match anyone associated with this conversation.
    const recipientWarning = checkSuspiciousRecipient(replyTo);
    if (recipientWarning && !confirm(recipientWarning)) return;

    // Check for missing attachments
    const warning = checkMissingAttachments(replyText, replyAttachments.length);
    if (warning && !confirm(warning + "\n\nSend anyway?")) return;

    setSending(true);
    setReplySendStatus("sending");
    try {
      // Batch 11: pass cc/bcc through. The hook → /api/send already supports them.
      // Inline reply: pass the user-edited To and Subject too — both are
      // editable in the reply header. /api/send respects them when isReply.
      await onSendReply(
        convo.id,
        replyText,
        replyAttachments.length > 0 ? replyAttachments : undefined,
        replyCc.trim() || undefined,
        replyBcc.trim() || undefined,
        replyTo.trim() || undefined,
        replySubject.trim() || undefined,
      );
      // Success — clear the box and flash the ✓ Sent indicator briefly.
      setReplyText("");
      setReplyAttachments([]);
      setReplyCc("");
      setReplyBcc("");
      setReplyTo("");
      setReplySubject("");
      setShowReplyCc(false);
      setShowReplyBcc(false);
      // Delete draft if one was loaded
      if (loadedDraftId) {
        fetch(`/api/drafts?id=${loadedDraftId}`, { method: "DELETE" }).catch(() => {});
        setLoadedDraftId(null);
        setLoadedDraftMeta(null);
      }
      await refetchDetail();
      setReplySendStatus("sent");
      showToast("✓ Message sent");
      // Auto-clear the ✓ after a moment (Messenger-style transient confirmation).
      setTimeout(() => setReplySendStatus((s) => (s === "sent" ? null : s)), 3000);
    } catch (err: any) {
      // FAILURE — do NOT clear the reply box or delete the draft; the user's
      // message is preserved so they can retry. Show a persistent ✗ indicator.
      console.error("[send] reply failed:", err?.message || err);
      setReplySendStatus("failed");
      showToast("Message not sent — check your connection and try again.");
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

    // Pre-compute the Reply All cc list so the toggle inside the modal can
    // flip it on without recomputing. We always START with Reply All OFF,
    // even if there are multiple participants — explicit opt-in is safer
    // (prevents accidentally CC'ing whole supplier teams).
    const { ccList } = computeReplyAllRecipients(messages, accountEmail, convo.from_email);

    setReplyModalReplyAll(false);
    setReplyModalReplyAllCcList(ccList);
    setReplyModalTo(replyTo);
    setReplyModalCc("");
    setReplyModalBcc("");
    setReplyModalSubject(replySubject);
    // Preload draft body from the inline reply's loadedDraftId, which is
    // populated when the conversation loads. Both UIs share the same draft
    // row (one draft per conversation+author). If there's no current draft,
    // body stays empty.
    setReplyModalBody(replyText || "");
    // Skip the next auto-save tick so opening the modal doesn't immediately
    // re-save the preloaded body (would be a no-op write, but still wasteful).
    replyModalAutoSaveSkipRef.current = true;
    setShowReplyModal(true);
  };

  const handleSendReplyModal = async () => {
    if (!convo) return;
    if (!replyModalTo.trim() || !replyModalSubject.trim() || !replyModalBody.trim()) return;

    // Cross-supplier safety check (same rules as inline reply).
    const recipientWarning = checkSuspiciousRecipient(replyModalTo);
    if (recipientWarning && !confirm(recipientWarning)) return;

    // Pass the attachment count to checkMissingAttachments so the "you said
    // attached but didn't attach anything" warning doesn't false-positive
    // when there ARE attachments.
    const warning = checkMissingAttachments(replyModalBody, replyModalAttachments.length);
    if (warning && !confirm(warning + "\n\nSend anyway?")) return;

    try {
      setReplyModalSending(true);

      // Use /api/send in REPLY mode (conversation_id present) so the message
      // threads correctly into this conversation. The endpoint accepts
      // overrides for `to` and `subject`, plus an `attachments` array of
      // { name, size, type, data: base64 } objects.
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          // FROM is always the conversation's original account.
          account_id: convo.email_account_id,
          to: replyModalTo.trim(),
          cc: replyModalCc.trim(),
          bcc: replyModalBcc.trim(),
          subject: replyModalSubject.trim(),
          body: replyModalBody,
          attachments: replyModalAttachments.length > 0 ? replyModalAttachments : undefined,
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
      setReplyModalAttachments([]);
      setReplyModalSendableAccounts([]);
      // Successful send → delete the draft (we just persisted it as a real
      // message). Also clear the inline reply state since they share storage.
      if (loadedDraftId) {
        fetch(`/api/drafts?id=${loadedDraftId}`, { method: "DELETE" }).catch(() => {});
        setLoadedDraftId(null);
        setLoadedDraftMeta(null);
      }
      setReplyText("");
      showToast("✓ Message sent");
    } catch (error: any) {
      console.error("Reply (modal) failed:", error);
      alert(error?.message || "Failed to send reply");
    } finally {
      setReplyModalSending(false);
    }
  };

  // Close the Reply modal. If there's content, save it as a draft FIRST
  // (synchronously) so the user doesn't lose work on close. Mirrors the
  // body into the inline reply state so the same draft is offered when
  // they next open the conversation. Empty body → delete any existing draft.
  const handleCloseReplyModal = async () => {
    setShowReplyModal(false);
    // Attachments aren't persisted with drafts — clear them so they don't
    // appear next time the modal opens.
    setReplyModalAttachments([]);
    if (!convo?.id || !currentUser?.id) {
      // Edge case: missing state; just close.
      return;
    }
    const plainText = (replyModalBody || "").replace(/<[^>]*>/g, "").trim();
    if (!plainText) {
      // Empty close → delete existing draft (if any), clear inline reply too.
      if (loadedDraftId) {
        await fetch(`/api/drafts?id=${loadedDraftId}`, { method: "DELETE" }).catch(() => {});
        setLoadedDraftId(null);
        setLoadedDraftMeta(null);
      }
      setReplyText("");
      return;
    }
    // Non-empty close → save the draft synchronously before exiting.
    try {
      const res = await fetch("/api/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          email_account_id: convo.email_account_id,
          author_id: currentUser.id,
          to_addresses: replyModalTo,
          cc_addresses: replyModalCc,
          bcc_addresses: replyModalBcc,
          subject: replyModalSubject,
          body_html: replyModalBody,
          is_reply: true,
          source: "manual",
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.draft?.id) setLoadedDraftId(data.draft.id);
      }
    } catch { /* silent */ }
    // Hand the draft body off to the inline reply state so it's
    // available there next time the user opens the conversation.
    setReplyText(replyModalBody);
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

    // Pre-fill the To field with every unique participant in the thread
    // (excluding the connected account's own email). Forward is usually
    // routing this thread to someone NEW, so this is just a convenience —
    // there's a "Clear" link in the modal to wipe it in one click.
    const participants = collectAllParticipants(messages, accountEmail);

    setForwardTo(participants.join(", "));
    setForwardCc("");
    setForwardSubject(
      convo.subject?.toLowerCase().startsWith("fwd:")
        ? convo.subject
        : `Fwd: ${convo.subject || "(No subject)"}`
    );
    setForwardBody(formattedForward);
    setShowForwardModal(true);
  };

  // Save a new template directly from inside the picker. Non-admins can't
  // reach Settings → Email Templates, so this is their only path to create
  // their own templates. Admin can use it too (faster than navigating to
  // Settings).
  //
  // Scope:
  //   - personal    → owner_id = current user, visible only to them
  //   - organization → visible to everyone in the workspace
  //
  // owner_id is set in both cases so we know who created the template
  // (useful for audit / future "my templates" filters).
  const saveNewTemplate = async () => {
    if (!newTemplateName.trim() || !newTemplateBody.trim()) {
      alert("Name and body are required.");
      return;
    }
    if (!currentUser?.id) {
      alert("Couldn't determine your user account. Try refreshing.");
      return;
    }
    try {
      setNewTemplateSaving(true);
      const sb = createBrowserClient();
      const { error } = await sb.from("email_templates").insert({
        name: newTemplateName.trim(),
        body: newTemplateBody,
        scope: newTemplateScope,
        owner_id: currentUser.id,
        is_active: true,
      });
      if (error) {
        alert("Failed to save template: " + error.message);
        return;
      }
      // Reset form + reload list so the new template appears immediately.
      setNewTemplateName("");
      setNewTemplateBody("");
      setNewTemplateScope("personal");
      setShowCreateTemplateForm(false);
      const myId = currentUser.id;
      const { data } = await sb
        .from("email_templates")
        .select("*")
        .eq("is_active", true)
        .or(`scope.eq.organization,and(scope.eq.personal,owner_id.eq.${myId})`)
        .order("scope")
        .order("sort_order");
      setReplyTemplates(data || []);
    } catch (e: any) {
      console.error("Save template failed:", e);
      alert("Failed to save template. Please try again.");
    } finally {
      setNewTemplateSaving(false);
    }
  };

  const handleSendForward = async () => {
    if (!convo) return;
    if (!forwardTo.trim() || !forwardSubject.trim() || !forwardBody.trim()) return;

    // Pass attachment count so the missing-attachment warning is accurate.
    const warning = checkMissingAttachments(forwardBody, forwardAttachments.length);
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
          attachments: forwardAttachments.length > 0 ? forwardAttachments : undefined,
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
      setForwardAttachments([]);
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

  // Restore a trashed conversation back to "open" — reuses the trash spinner
  // since the user can't do both at once and we want the trash button
  // disabled while the restore is in flight.
  const handleRestoreFromTrash = async () => {
    if (!convo) return;
    if (trashingConversation) return;

    try {
      setTrashingConversation(true);

      const res = await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          status: "open",
          actor_id: currentUser?.id || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json?.error || "Failed to restore from trash");
      }

      window.location.reload();
    } catch (error: any) {
      console.error("Restore from trash failed:", error);
      alert("Restore from trash failed: " + (error?.message || "Unknown error"));
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
        showToast("✓ Message sent");
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

  // ─── Personal pin (per-user) ──────────────────────────────────────────
  // Pin is a per-user concept (vs Star which is shared/team). Each user has
  // their own set of pinned conversations stored in inbox.conversation_pins.
  // The pin button is only shown when the conversation is assigned to the
  // current user — per design, you only pin things on your plate.
  const [isPinned, setIsPinned] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  useEffect(() => {
    if (!convo?.id || !currentUser?.id) {
      setIsPinned(false);
      return;
    }
    let cancelled = false;
    fetch(`/api/conversations/pin?user_id=${currentUser.id}&conversation_id=${convo.id}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setIsPinned(!!data?.pinned); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [convo?.id, currentUser?.id]);

  const handleTogglePin = async () => {
    if (!convo?.id || !currentUser?.id || pinBusy) return;
    setPinBusy(true);
    // Optimistic flip
    const nextPinned = !isPinned;
    setIsPinned(nextPinned);
    try {
      await fetch("/api/conversations/pin", {
        method: nextPinned ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: currentUser.id, conversation_id: convo.id }),
      });
      // Tell parent so the sidebar Pinned count + ConversationList badges update
      window.dispatchEvent(new CustomEvent("pins:changed"));
    } catch (error) {
      console.error("Toggle pin failed:", error);
      setIsPinned(!nextPinned); // Revert on failure
    } finally {
      setPinBusy(false);
    }
  };

  const existingTaskTextSet = useMemo(() => {
    return new Set(
      tasks
        .map((task) => normalizeSuggestedTaskText(task?.text || ""))
        .filter(Boolean)
    );
  }, [tasks]);

  // Load accumulated quotes for this conversation's supplier, filtered to this
  // thread. Reused on mount, on conversation change, and after a summary
  // refresh (auto-promote may have added rows).
  const loadPersistedQuotes = useCallback(async () => {
    const supplierId = (convo as any)?.supplier_contact_id;
    const convoId = convo?.id;
    if (!supplierId || !convoId) {
      setPersistedQuotes([]);
      return;
    }
    try {
      const res = await fetch(`/api/supplier-quotes?supplier_contact_id=${supplierId}`);
      if (!res.ok) return;
      const json = await res.json();
      const all: any[] = Array.isArray(json.quotes) ? json.quotes : [];
      // Scope to THIS conversation only. The Summary tab is a per-conversation
      // view, so it shows just the quotes captured from this thread. The full
      // per-supplier rollup lives in the supplier command center.
      const scoped = all.filter((q) => q.source_conversation_id === convoId);
      setPersistedQuotes(scoped);
    } catch {
      /* best-effort; leave whatever we had */
    }
  }, [convo]);

  useEffect(() => {
    loadPersistedQuotes();
  }, [loadPersistedQuotes, threadSummary?.generated_at]);

  // Accumulated quotes mapped into the display shape, shared by the Summary
  // tab render and the CSV/PDF exports so all three show the same data.
  const displayQuotes = useMemo(() => {
    return (persistedQuotes || []).map((q: any) => ({
      material_name: q.material_name,
      inci_trade_name: q.inci_trade_name,
      grade: q.grade,
      price: q.price_raw,
      price_qty: q.price_qty,
      price_unit: q.price_unit,
      case_width: q.case_width,
      case_height: q.case_height,
      case_length: q.case_length,
      case_pack_size: q.pack_size || q.case_size || q.case_weight,
      quote_provided_date: q.quote_provided_date,
      quote_expiry: q.quote_expiry,
      lead_time: q.lead_time,
      moq: q.moq,
      max_inventory: q.max_inventory,
      hazardous: q.hazardous,
      refrigerated: q.refrigerated,
      equipment_accessorials: q.equipment_accessorials,
      material_id: q.material_id,
      docs_supplied: { coa: q.doc_coa === true, sds: q.doc_sds === true, tds: q.doc_tds === true },
      sample_handling: q.sample_handling,
      other_notes: q.other_notes,
    }));
  }, [persistedQuotes]);

  // ── Summary exports ──────────────────────────────────────────────────
  // CSV = the quotes table (one row per material). PDF = the full summary
  // rendered as a printable document (browser "Save as PDF"). Both are
  // client-side, built from the already-loaded threadSummary; no server call.
  const exportSummaryCsv = () => {
    const s = threadSummary?.summary;
    const quotes: any[] = displayQuotes;
    const subj = (convo?.subject || "summary").replace(/[^\w.-]+/g, "_").slice(0, 60);

    const cols: { key: string; label: string }[] = [
      { key: "material_name", label: "Material" },
      { key: "inci_trade_name", label: "INCI/Trade Name" },
      { key: "grade", label: "Grade" },
      { key: "price", label: "Price" },
      { key: "price_qty", label: "Price Qty" },
      { key: "price_unit", label: "Price Unit" },
      { key: "case_width", label: "Case Width" },
      { key: "case_height", label: "Case Height" },
      { key: "case_length", label: "Case Length" },
      { key: "case_pack_size", label: "Case / Pack Size" },
      { key: "quote_provided_date", label: "Quote Provided" },
      { key: "quote_expiry", label: "Quote Expiry/Valid Until" },
      { key: "lead_time", label: "Lead Time" },
      { key: "moq", label: "MOQ" },
      { key: "max_inventory", label: "Max Inventory" },
      { key: "hazardous", label: "Hazardous" },
      { key: "refrigerated", label: "Refrigerated" },
      { key: "equipment_accessorials", label: "Equipment Accessorials" },
      { key: "material_id", label: "Material ID" },
      { key: "sample_handling", label: "Sample Handling" },
      { key: "other_notes", label: "Notes" },
    ];

    const esc = (v: any) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "boolean") return v ? "Yes" : "No";
      const str = String(v);
      // Quote-wrap and escape embedded quotes if the cell needs it.
      return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
    };

    const headerRow = cols.map((c) => c.label).join(",");
    const docCols = ",COA,SDS,TDS";
    const rows = quotes.map((q) => {
      const base = cols
        .map((c) => {
          if (c.key === "price") return esc(q.price);
          if (c.key === "case_pack_size") return esc(q.case_pack_size || q.pack_size || q.case_size || q.case_weight);
          return esc(q[c.key]);
        })
        .join(",");
      const docs = q.docs_supplied || {};
      return base + "," + [docs.coa, docs.sds, docs.tds].map((d) => (d === true ? "Yes" : "No")).join(",");
    });

    const csv = [headerRow + docCols, ...rows].join("\r\n");
    // BOM so Excel reads UTF-8 correctly.
    const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${subj}_quotes.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportSummaryPdf = () => {
    const s = threadSummary?.summary;
    if (!s) return;
    const subject = convo?.subject || "Thread Summary";
    const esc = (v: any) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const dash = (v: any) => (v === null || v === undefined || v === "" ? "—" : esc(v));
    const yn = (v: any) => (v === true ? "Yes" : v === false ? "No" : "—");

    const list = (arr: any) =>
      Array.isArray(arr) && arr.length
        ? `<ul>${arr.map((x: any) => `<li>${esc(typeof x === "string" ? x : x?.text || "")}</li>`).join("")}</ul>`
        : `<p class="muted">None</p>`;

    const si = s.supplier_information || {};
    const acc = si.accessorial_charges || {};
    const payInfo = si.payment_information || {};
    const payTerms = si.payment_terms || {};
    const siRow = (label: string, val: any) =>
      `<tr><td class="lbl">${esc(label)}</td><td>${dash(val)}</td></tr>`;

    const quotes: any[] = displayQuotes;
    const quoteBlocks = quotes.length
      ? quotes
          .map((q) => {
            const docs = q.docs_supplied || {};
            const f = (label: string, val: any) =>
              `<tr><td class="lbl">${esc(label)}</td><td>${dash(val)}</td></tr>`;
            return `<div class="quote">
              <h4>${dash(q.material_name)}</h4>
              <table>
                ${f("INCI/Trade Name", q.inci_trade_name)}
                ${f("Grade(s)", q.grade)}
                ${f("Price", q.price)}
                ${f("Price Qty / Unit", `${dash(q.price_qty)} / ${dash(q.price_unit)}`)}
                ${f("Case W/H/L", `${dash(q.case_width)} / ${dash(q.case_height)} / ${dash(q.case_length)}`)}
                ${f("Case / Pack Size", q.case_pack_size || q.pack_size || q.case_size || q.case_weight)}
                ${f("Quote Provided", q.quote_provided_date)}
                ${f("Quote Expiry / Valid Until", q.quote_expiry)}
                ${f("Lead Time", q.lead_time)}
                ${f("MOQ", q.moq)}
                ${f("Max Inventory", q.max_inventory)}
                ${f("Hazardous", yn(q.hazardous))}
                ${f("Refrigerated", yn(q.refrigerated))}
                ${f("Equipment Accessorials", q.equipment_accessorials)}
                ${f("Material ID", q.material_id)}
                ${f("Docs", `COA ${docs.coa ? "✓" : "—"} · SDS ${docs.sds ? "✓" : "—"} · TDS ${docs.tds ? "✓" : "—"}`)}
                ${f("Sample Handling", q.sample_handling)}
                ${f("Notes", q.other_notes)}
              </table>
            </div>`;
          })
          .join("")
      : `<p class="muted">No quotes extracted from this thread.</p>`;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(subject)} — Summary</title>
      <style>
        * { box-sizing: border-box; }
        body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #15140f; margin: 32px; line-height: 1.5; }
        h1 { font-size: 20px; margin: 0 0 4px; }
        h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .05em; color: #5a544a; margin: 22px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        h4 { font-size: 13px; margin: 0 0 6px; }
        .meta { color: #5a544a; font-size: 12px; margin-bottom: 8px; }
        .muted { color: #8a8478; }
        p { margin: 4px 0; font-size: 13px; }
        ul { margin: 4px 0; padding-left: 20px; font-size: 13px; }
        li { margin: 2px 0; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 4px 0; }
        td { padding: 3px 6px; vertical-align: top; border-bottom: 1px solid #f0eee8; word-break: break-word; }
        td.lbl { width: 38%; color: #5a544a; font-weight: 600; }
        .quote { border: 1px solid #e5e2da; border-radius: 8px; padding: 10px 12px; margin: 10px 0; page-break-inside: avoid; }
        .grid td.lbl { width: 30%; }
      </style></head><body>
      <h1>${esc(subject)}</h1>
      <div class="meta">Thread summary${threadSummary?.generated_at ? " · generated " + esc(new Date(threadSummary.generated_at).toLocaleString()) : ""}</div>

      <h2>Overview</h2><p>${dash(s.overview)}</p>
      <h2>Current Status</h2><p>${dash(s.status)}</p>
      <h2>Supplier Intent</h2><p>${dash(s.intent)}${s.confidence ? ` (confidence: ${esc(s.confidence)})` : ""}</p>
      <h2>Open Action Items</h2>${list(s.open_action_items)}
      <h2>Suggested Tasks</h2>${list(s.suggested_tasks)}
      <h2>Completed Items</h2>${list(s.completed_items)}
      <h2>Next Step</h2><p>${dash(s.next_step)}</p>

      <h2>Supplier Information</h2>
      <table class="grid">
        ${siRow("Type", si.type ? String(si.type).replace(/_/g, " ") : null)}
        ${siRow("Website", si.website)}
        ${siRow("Pick-up Address", si.pickup_address)}
        ${siRow("Purchasing Thresholds", si.purchasing_thresholds)}
        ${siRow("Contact Name", si.contact_name)}
        ${siRow("Contact Email", si.contact_email)}
        ${siRow("Contact Phone", si.contact_phone)}
        ${siRow("Additional Contacts", si.additional_contacts)}
        ${siRow("Shipping Terms", si.shipping_terms)}
        ${siRow("Shipping Email", si.shipping_email)}
        ${siRow("Billing Email", si.billing_email)}
        ${siRow("Hazmat Handling Rate", acc.hazmat_handling_rate)}
        ${siRow("Temp-Controlled Storage Rate", acc.temperature_controlled_storage_rate)}
        ${siRow("Liftgate Service Rate", acc.liftgate_service_rate)}
        ${siRow("Special Packaging Rate", acc.special_packaging_rate)}
        ${siRow("Other Accessorials", acc.other)}
        ${siRow("Payment Method", payInfo.method)}
        ${siRow("Payment Details", payInfo.details)}
        ${siRow("Payment Terms", payTerms.type)}
        ${siRow("Payment Terms Details", payTerms.details)}
        ${siRow("Facility Certifications", si.facility_certifications_compliances)}
        ${siRow("Other Notes", si.other_notes)}
      </table>

      <h2>Quotes (${quotes.length})</h2>
      ${quoteBlocks}

      <script>window.onload = function(){ window.print(); }</script>
      </body></html>`;

    const w = window.open("", "_blank");
    if (!w) {
      alert("Please allow pop-ups to export the PDF.");
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
  };

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

    // Synchronous lock — prevents duplicate creation when user double-clicks
    // faster than React can update `creatingSuggestedTasks` state.
    if (creatingSuggestedTaskLockRef.current.has(taskText)) return;
    creatingSuggestedTaskLockRef.current.add(taskText);

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
      creatingSuggestedTaskLockRef.current.delete(taskText);
    }
  };

  const createAllSuggestedTasks = async () => {
    if (!convo) return;

    const tasksToCreate = pendingSuggestedTaskItems.map((item) => item.text);

    if (tasksToCreate.length === 0) return;

    // Synchronous lock — same rationale as createSuggestedTask.
    if (creatingAllSuggestedTasksLockRef.current) return;
    creatingAllSuggestedTasksLockRef.current = true;

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
      creatingAllSuggestedTasksLockRef.current = false;
    }
  };

  if (!convo) {
    return (
      <div className="w-full h-full flex items-center justify-center flex-col gap-4 text-[var(--text-muted)] bg-[var(--bg)]">
        <div className="w-16 h-16 rounded-2xl bg-[var(--surface)] flex items-center justify-center">
          <Mail size={24} />
        </div>
        <div className="text-[15px] font-medium">Select a conversation</div>
        <div className="text-xs">Choose from the list to view details</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full flex flex-col bg-[var(--bg)] overflow-hidden">
      <div className="px-5 py-3 border-b border-[var(--border)] flex flex-col 2xl:flex-row 2xl:items-start gap-3">
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
            {editingSubject ? (
              <input
                type="text"
                value={subjectDraft}
                onChange={(e) => setSubjectDraft(e.target.value)}
                onBlur={saveSubject}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveSubject();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditingSubject();
                  }
                }}
                disabled={savingSubject}
                autoFocus
                className="w-full bg-transparent border-b border-[var(--accent)] outline-none text-xl font-normal font-serif text-[var(--text-primary)] tracking-tight disabled:opacity-50"
                placeholder="Enter subject"
                maxLength={500}
              />
            ) : (
              <button
                type="button"
                onClick={startEditingSubject}
                title="Click to rename"
                className="text-left w-full truncate hover:bg-[var(--surface-2)] rounded px-1 -mx-1 transition-colors cursor-text"
              >
                {convo.subject || <span className="text-[var(--text-muted)] italic">(no subject)</span>}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            {/* Primary contact display — clickable dropdown.
                Shows manual override if set, otherwise the original sender. */}
            {(() => {
              // Display precedence for the conversation's contact label:
              //   1. A manually-set / per-conversation primary contact name.
              //   2. The live sender on this thread (from_name) — the person
              //      we're actually corresponding with in this conversation.
              //   3. The linked supplier's company name (fallback only).
              //   4. The supplier's stored contact name (last resort).
              // Display precedence for the conversation's contact label:
              //   1. A manually-set / per-conversation primary contact name.
              //   2. The latest INBOUND message's sender name — the person/party
              //      we're actually corresponding with right now (live).
              //   3. The conversation's stored from_name (fallback).
              //   4. The linked supplier's company / contact name (last resort).
              const supplierCompany =
                (convo as any).supplier_contact?.company ||
                (convo as any).supplier_contact?.name ||
                null;
              const latestInboundName = Array.isArray(messages)
                ? ([...messages].reverse().find((m: any) => !m.is_outbound)?.from_name || null)
                : null;
              const displayName =
                (convo as any).primary_contact_name ||
                latestInboundName ||
                convo.from_name ||
                supplierCompany;
              const displayEmail = (convo as any).primary_contact_email || convo.from_email;
              const isManual = (convo as any).primary_contact_is_manual === true;
              return (
                <div data-contact-menu className="relative inline-flex items-center">
                  <button
                    type="button"
                    onClick={() => setPrimaryContactMenuOpen((o) => !o)}
                    title={isManual ? "Manually set — click to change" : "Auto-updates to latest external reply — click to change"}
                    className="inline-flex items-center gap-1 px-1 -mx-1 rounded hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
                  >
                    <span className="text-[var(--text-secondary)]">{displayName}</span>
                    <span className="text-[var(--text-muted)]">&lt;{displayEmail}&gt;</span>
                    {isManual && (
                      <span
                        title="Manual override — won't auto-update on new replies"
                        className="text-[9px] px-1 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] font-semibold ml-0.5"
                      >
                        manual
                      </span>
                    )}
                    <ChevronDown size={10} className="text-[var(--text-muted)] ml-0.5" />
                  </button>
                  {primaryContactMenuOpen && (
                    <div className="absolute top-full left-0 mt-1 z-30 min-w-[260px] max-w-[340px] py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-lg">
                      <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">
                        Set primary contact
                      </div>
                      {externalParticipants.length === 0 ? (
                        <div className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
                          No external participants found
                        </div>
                      ) : (
                        externalParticipants.map((p) => {
                          const isCurrent = (displayEmail || "").toLowerCase() === p.email;
                          return (
                            <button
                              key={p.email}
                              onClick={() => setPrimaryContact(p.name, p.email)}
                              className={`w-full px-3 py-1.5 text-left text-[12px] flex items-center justify-between gap-2 hover:bg-[var(--surface-2)] ${
                                isCurrent ? "text-[var(--accent)] font-semibold" : "text-[var(--text-primary)]"
                              }`}
                            >
                              <span className="truncate">
                                <span>{p.name}</span>
                                <span className="text-[var(--text-muted)]"> &lt;{p.email}&gt;</span>
                              </span>
                              {isCurrent && <span className="text-[10px]">●</span>}
                            </button>
                          );
                        })
                      )}
                      {isManual && (
                        <>
                          <div className="border-t border-[var(--border)] my-1" />
                          <button
                            onClick={resetPrimaryContactToAuto}
                            className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                          >
                            ↻ Reset to auto-update
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
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
            // Dedup keyed by EMAIL ONLY (not raw display string). Quoted display
            // names, mixed display names for the same address ('"info" <x>' vs
            // '"Rove Essentials" <x>'), and weird Foxmail-style quoting were
            // previously creating duplicate chips for the same person.
            const seen = new Set<string>();
            const participants: { name: string; email: string }[] = [];

            // Strip surrounding single/double quotes and trim whitespace.
            // Foxmail and some webmail clients wrap addresses in quotes.
            const stripQuotes = (s: string) =>
              s.trim().replace(/^["'\s]+|["'\s]+$/g, "");

            // Parse one "raw" recipient part into {name, email}. Returns null
            // if no email can be extracted at all.
            const parsePart = (raw: string): { name: string; email: string } | null => {
              const part = raw.trim();
              if (!part) return null;
              // "Name <email@host>" — most common
              const m = part.match(/^(.*?)\s*<\s*([^<>]+?)\s*>\s*$/);
              if (m) {
                const email = stripQuotes(m[2]).toLowerCase();
                if (!email.includes("@")) return null;
                let name = stripQuotes(m[1]);
                // If the display name is just the same email in quotes, use the
                // local-part as the visible name instead.
                if (!name || name.toLowerCase() === email) name = email.split("@")[0];
                return { name, email };
              }
              // Bare email — no angle brackets
              const bare = stripQuotes(part).toLowerCase();
              if (!bare.includes("@")) return null;
              return { name: bare.split("@")[0], email: bare };
            };

            const tryAdd = (raw: string | null | undefined, fallbackName?: string) => {
              if (!raw) return;
              for (const piece of raw.split(",")) {
                const parsed = parsePart(piece);
                if (!parsed) continue;
                if (seen.has(parsed.email)) continue;
                seen.add(parsed.email);
                participants.push({
                  name: fallbackName || parsed.name,
                  email: parsed.email,
                });
              }
            };

            for (const msg of (messages || [])) {
              // From
              if (msg.from_email) {
                const fromEmail = msg.from_email.trim().toLowerCase();
                if (fromEmail && !seen.has(fromEmail)) {
                  seen.add(fromEmail);
                  participants.push({
                    name: msg.from_name || fromEmail.split("@")[0],
                    email: fromEmail,
                  });
                }
              }
              // To + CC
              tryAdd(msg.to_addresses);
              tryAdd(msg.cc_addresses);
            }
            if (participants.length <= 1) return null;
            const MAX_SHOW = 5;
            const shown = participants.slice(0, MAX_SHOW);
            const extra = participants.length - MAX_SHOW;
            return (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Users size={11} className="text-[var(--text-muted)] shrink-0" />
                {shown.map((p, i) => {
                  const wasCopied = copiedEmail === p.email;
                  const menuOpen = badgeMenuEmail === p.email;
                  const handleCopy = async () => {
                    try {
                      await navigator.clipboard.writeText(p.email);
                      setCopiedEmail(p.email);
                      // Clear feedback after 1.5s.
                      setTimeout(() => {
                        setCopiedEmail((cur) => (cur === p.email ? null : cur));
                      }, 1500);
                    } catch {
                      // Clipboard API can fail in older browsers or insecure
                      // contexts. Fall back to a hidden textarea + execCommand.
                      try {
                        const ta = document.createElement("textarea");
                        ta.value = p.email;
                        ta.style.position = "fixed";
                        ta.style.opacity = "0";
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand("copy");
                        document.body.removeChild(ta);
                        setCopiedEmail(p.email);
                        setTimeout(() => {
                          setCopiedEmail((cur) => (cur === p.email ? null : cur));
                        }, 1500);
                      } catch { /* give up silently */ }
                    }
                  };
                  return (
                    <div key={p.email} data-contact-menu className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Toggle dropdown for this badge
                          setBadgeMenuEmail((cur) => (cur === p.email ? null : p.email));
                        }}
                        onContextMenu={(e) => {
                          // Right-click → copy email (preserves prior behavior)
                          e.preventDefault();
                          handleCopy();
                        }}
                        title={wasCopied ? "Copied!" : `${p.name || p.email} — click for options, right-click to copy email`}
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] max-w-[160px] truncate transition-colors ${
                          wasCopied
                            ? "bg-[var(--accent)]/15 border-[var(--accent)] text-[var(--accent)]"
                            : "bg-[var(--surface)] border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:border-[var(--accent)]/40 cursor-pointer"
                        }`}
                      >
                        <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[7px] font-bold text-white shrink-0"
                          style={{ background: i === 0 ? "var(--info)" : i === 1 ? "var(--accent)" : i === 2 ? "#BC8CFF" : i === 3 ? "var(--warning)" : "var(--highlight)" }}>
                          {(p.name || "?").slice(0, 2).toUpperCase()}
                        </span>
                        <span className="truncate">
                          {wasCopied ? "Copied!" : (p.name || p.email)}
                        </span>
                      </button>
                      {menuOpen && (
                        <div className="absolute left-0 top-full mt-1 z-30 min-w-[200px] py-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-lg">
                          <div className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] truncate">
                            {p.email}
                          </div>
                          <div className="border-t border-[var(--border)] my-1" />
                          <button
                            onClick={() => addAsContact(p.name, p.email)}
                            className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
                          >
                            + Add as contact
                          </button>
                          <button
                            onClick={() => { setPrimaryContact(p.name, p.email); }}
                            className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
                          >
                            ★ Set as primary contact
                          </button>
                          <button
                            onClick={() => { handleCopy(); setBadgeMenuEmail(null); }}
                            className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                          >
                            📋 Copy email
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
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
            {sortLabelsForBadges(convo.labels || []).map(
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
              onToggle={() => { onLabelsChange?.(); }}
            />

            {onMoveToFolder && (
              <MoveToFolderDropdown
                conversationId={convo.id}
                currentFolderId={convo.folder_id}
                accountId={convo.email_account_id}
                onMove={onMoveToFolder}
              />
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end order-first 2xl:order-none 2xl:shrink-0 2xl:flex-nowrap">
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

          {/* Dial — opens QuickCallModal pre-filled with this conversation's supplier */}
          <button
            onClick={() => setShowDialModal(true)}
            title="Dial this supplier via Quo"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[11px] font-semibold text-[var(--text-secondary)] hover:text-[var(--info)] hover:bg-[var(--surface-2)] transition-all"
          >
            <PhoneOutgoing size={12} />
            Dial
          </button>

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

          {/* Supplier status badge (Batch 4) — manual workflow status for this
              (supplier × email_account) pair. Visible in the header alongside
              the conversation Open/Closed status, click to change. */}
          <SupplierStatusBadge
            supplierContactId={convo.supplier_contact_id || null}
            emailAccountId={convo.email_account_id || null}
            actorId={currentUser?.id || null}
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

            {/* Pin (personal) — only visible for the assignee; their personal "watch list" */}
            {currentUser?.id && convo.assignee_id === currentUser.id && (
              <button
                onClick={handleTogglePin}
                disabled={pinBusy}
                title={isPinned ? "Unpin (remove from your Pinned view)" : "Pin to your personal Pinned view"}
                className={`w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-50 ${
                  isPinned ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
                }`}
              >
                <Pin size={15} fill={isPinned ? "var(--accent)" : "none"} />
              </button>
            )}

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
              onClick={convo.status === "trash" ? handleRestoreFromTrash : handleTrashConversation}
              title={convo.status === "trash" ? "Restore from trash" : "Trash"}
              disabled={trashingConversation}
              className={
                convo.status === "trash"
                  ? "px-2 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[10px] font-bold text-[var(--accent)] flex items-center gap-1 hover:bg-[var(--surface-2)] disabled:opacity-50"
                  : "w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] flex items-center justify-center hover:bg-[var(--surface-2)] disabled:opacity-50"
              }
            >
              {convo.status === "trash" ? (
                <>
                  <RotateCcw size={12} />
                  Restore
                </>
              ) : (
                <Trash2 size={16} />
              )}
            </button>

            {/* Overflow (⋯) menu — secondary actions. Currently houses
                "Copy link" and "Merge by link". A click outside the menu
                closes it; menu items close it themselves after firing. */}
            <div className="relative">
              <button
                onClick={() => setShowOverflowMenu((v) => !v)}
                title="More actions"
                className="w-8 h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] flex items-center justify-center hover:bg-[var(--surface-2)]"
              >
                <MoreHorizontal size={16} />
              </button>
              {showOverflowMenu && (
                <>
                  {/* Backdrop to close on outside click */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowOverflowMenu(false)}
                  />
                  <div className="absolute right-0 top-full mt-1 z-50 w-56 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shadow-2xl shadow-black/40 py-1">
                    <button
                      onClick={copyConversationLink}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] text-left"
                    >
                      {copiedConversationLink ? (
                        <>
                          <Check size={13} className="text-[var(--accent)]" />
                          <span className="text-[var(--accent)]">Link copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy size={13} className="text-[var(--text-secondary)]" />
                          <span>Copy conversation link</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setShowOverflowMenu(false);
                        setMergeLinkInput("");
                        setMergeLinkError(null);
                        setShowMergeLinkModal(true);
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] text-left"
                    >
                      <GitMerge size={13} className="text-[var(--text-secondary)]" />
                      <span>Merge another conversation by link</span>
                    </button>
                    {/* ── Print / Save as PDF ── Three modes, each opens
                        /conversations/[id]/print?content=... in a new tab.
                        The print page auto-fires the browser's print dialog
                        once data loads; user picks "Save as PDF" from the
                        dialog or sends to a physical printer. */}
                    <div className="my-1 h-px bg-[var(--border)]" />
                    <button
                      onClick={() => {
                        if (!convo?.id) return;
                        setShowOverflowMenu(false);
                        window.open(
                          `/conversations/${convo.id}/print?content=conversation`,
                          "_blank",
                          "noopener=1"
                        );
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] text-left"
                    >
                      <Printer size={13} className="text-[var(--text-secondary)]" />
                      <span>Print conversation</span>
                    </button>
                    <button
                      onClick={() => {
                        if (!convo?.id) return;
                        setShowOverflowMenu(false);
                        window.open(
                          `/conversations/${convo.id}/print?content=full`,
                          "_blank",
                          "noopener=1"
                        );
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] text-left"
                    >
                      <Printer size={13} className="text-[var(--text-secondary)]" />
                      <span>Print conversation + notes</span>
                    </button>
                    <button
                      onClick={() => {
                        if (!convo?.id) return;
                        setShowOverflowMenu(false);
                        window.open(
                          `/conversations/${convo.id}/print?content=notes`,
                          "_blank",
                          "noopener=1"
                        );
                      }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] text-left"
                    >
                      <StickyNote size={13} className="text-[var(--text-secondary)]" />
                      <span>Print notes only</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex border-b border-[var(--surface-2)] px-5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); if (tab.id === "tasks" || tab.id === "notes") refetchDetail(); if (tab.id === "calls") refetchCalls(); }}
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
          isReviewTab ? "flex-1 min-h-0 overflow-hidden px-5 py-4" : "flex-1 min-h-0 overflow-y-auto px-5 py-4"
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
                const plainMatches = sq ? messages.reduce((count: number, msg: any) => {
                  const bt = msg.body_text || (msg.body_html ? msg.body_html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ") : "") || msg.snippet || "";
                  return count + (bt.toLowerCase().split(sq).length - 1);
                }, 0) : 0;
                // Prefer the real count of highlighted marks in the DOM; fall back
                // to the plain-text estimate until the highlighter has run.
                const totalMatches = domMatchCount > 0 ? domMatchCount : plainMatches;
                const safeIndex = totalMatches > 0 ? ((currentMatchIndex % totalMatches) + totalMatches) % totalMatches : 0;

                return (
                  <div className="sticky top-0 z-20 flex items-center gap-2 mb-3 px-3 py-2 rounded-xl border border-[var(--accent)]/30 bg-[var(--surface)] shadow-sm backdrop-blur supports-[backdrop-filter]:bg-[var(--surface)]/95">
                    <Search size={14} className="text-[var(--text-muted)] flex-shrink-0" />
                    <input
                      value={threadSearch}
                      onChange={(e) => { setThreadSearch(e.target.value); setCurrentMatchIndex(0); setDomMatchCount(0); matchRefs.current = []; }}
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

              // ── Merge messages and Quo calls chronologically ──
              // Sorted DESCENDING by timestamp (newest first, oldest last) per
              // the user preference. Drop-cap still attaches to the ORIGINAL
              // first message (idx === 0 within messages), which now appears
              // visually at the bottom — the drop cap marks "where the
              // conversation started," not "what you see first."
              // Calls now live in their own "Calls" tab, so the Messages
              // timeline shows email messages only (keeps this tab uncrowded).
              type Item =
                | { kind: "message"; m: any; idx: number; t: number }
                | { kind: "call"; c: CallEntry; t: number };

              const msgItems: Item[] = (messages || []).map((m: any, idx: number) => ({
                kind: "message" as const,
                m,
                idx,
                t: new Date(m.sent_at || m.created_at || 0).getTime() || 0,
              }));
              const timelineItems: Item[] = [...msgItems].sort((a, b) => b.t - a.t);

              return timelineItems.map((item) => {
                // ── Call entry ──
                if (item.kind === "call") {
                  return (
                    <CallTimelineEntry
                      key={`call-${item.c.id}`}
                      call={item.c}
                      onDraft={handleDraftFromCall}
                      onToggleFollowUp={handleToggleCallFollowUp}
                      hasFollowUp={activeFollowUps.has(item.c.id)}
                    />
                  );
                }
                // ── Message entry (existing logic) ──
                const msg = item.m;
                const idx = item.idx;
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
                  {msg.body_html ? (
                    <MessageBody
                      messageId={msg.id}
                      bodyHtml={msg.body_html}
                      searchQuery={searchQ || undefined}
                      matchStartIndex={msgStartIdx}
                      className="prose prose-sm prose-invert max-w-none [&_p]:my-2.5 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--border)] [&_td]:p-2 [&_th]:border [&_th]:border-[var(--border)] [&_th]:p-2 [&_th]:bg-[var(--surface-2)] [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded [&_img]:my-2 [&_a]:text-[var(--info)] [&_a]:underline [&_a]:break-all [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-secondary)] [&_pre]:bg-[var(--surface-2)] [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_hr]:border-[var(--border)] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_ul_ul]:list-[circle] [&_ul_ul_ul]:list-[square]"
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

            {messages.length === 0 && calls.length === 0 && (
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
                    autoFocus
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

        {activeTab === "calls" && (
          <div className="h-full overflow-y-auto pr-2 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-[var(--text-primary)]">Call Log</div>
            </div>
            {(calls || []).length === 0 ? (
              <div className="text-[13px] text-[var(--text-muted)] py-8 text-center">
                No calls logged yet for this conversation.
              </div>
            ) : (
              [...(calls || [])]
                .sort(
                  (a, b) =>
                    (new Date(b.started_at || b.created_at || 0).getTime() || 0) -
                    (new Date(a.started_at || a.created_at || 0).getTime() || 0)
                )
                .map((c) => (
                  <CallTimelineEntry
                    key={`call-${c.id}`}
                    call={c}
                    onDraft={handleDraftFromCall}
                    onToggleFollowUp={handleToggleCallFollowUp}
                    hasFollowUp={activeFollowUps.has(c.id)}
                  />
                ))
            )}
          </div>
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
                  {editingNoteId === note.id ? (
                    // Inline edit mode — title + textarea + save/cancel
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={editingNoteTitle}
                        onChange={(e) => setEditingNoteTitle(e.target.value)}
                        placeholder="Title (optional)"
                        className="w-full px-2 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                      />
                      <textarea
                        value={editingNoteText}
                        onChange={(e) => setEditingNoteText(e.target.value)}
                        rows={4}
                        placeholder="Note text"
                        className="w-full px-2 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[13px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)] resize-y"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          onClick={saveEditedNote}
                          disabled={savingNoteEdit || !editingNoteText.trim()}
                          className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-[var(--accent)] text-[var(--bg)] text-[11px] font-semibold hover:bg-[var(--accent-strong)] disabled:opacity-50"
                        >
                          {savingNoteEdit ? "Saving…" : "Save"}
                        </button>
                        <button
                          onClick={cancelEditingNote}
                          disabled={savingNoteEdit}
                          className="px-3 py-1 rounded-md border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface)] disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-[13px] text-[var(--text-secondary)] whitespace-pre-wrap">{note.text}</div>
                  )}

                  {/* Retroactive attach/detach controls */}
                  {/* Retroactive attach/detach controls. The "Attach/Change message"
                      button drops the user into selection mode in the Messages tab,
                      same as the new-note flow — much easier than picking from a dropdown. */}
                  <div className="mt-3 pt-2 border-t border-[var(--border)]/50 flex items-center justify-end gap-2 flex-wrap">
                    {/* Edit + Delete — hidden while this note is already in edit mode */}
                    {editingNoteId !== note.id && (
                      <>
                        <button
                          onClick={() => startEditingNote(note)}
                          disabled={isPending || deletingNoteId === note.id}
                          title="Edit note"
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--info)] disabled:opacity-40"
                        >
                          <Pencil size={10} />
                          Edit
                        </button>
                        <button
                          onClick={() => deleteNote(note.id)}
                          disabled={isPending || deletingNoteId === note.id}
                          title="Delete note"
                          className="inline-flex items-center gap-1 text-[11px] text-[var(--text-muted)] hover:text-[var(--danger)] disabled:opacity-40"
                        >
                          <Trash2 size={10} />
                          {deletingNoteId === note.id ? "Deleting…" : "Delete"}
                        </button>
                      </>
                    )}
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
                    <div className="text-[10px] text-[var(--text-muted)] font-semibold flex items-center gap-1.5">
                      <span>Assign to</span>
                      {/* When this is a call task, the picker is filtered to
                          call-skilled members only. Show a tiny hint so the
                          operator knows why someone might be missing. */}
                      {isCallCategory(newTaskCategoryId) && (
                        <span className="text-[9px] font-normal text-[var(--text-muted)] italic">
                          📞 call-skilled only
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        if (newTaskAssigneeIds.length === newTaskAssignableMembers.length) {
                          setNewTaskAssigneeIds([]);
                        } else {
                          setNewTaskAssigneeIds(newTaskAssignableMembers.map((m) => m.id));
                        }
                      }}
                      className="text-[10px] text-[var(--info)] hover:text-[#79B8FF] font-semibold"
                    >
                      {newTaskAssigneeIds.length === newTaskAssignableMembers.length ? "Deselect all" : "Select all"}
                    </button>
                  </div>
                  {/* Group quick-select */}
                  {userGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-2">
                      {userGroups.map((g: any) => {
                        // Filter to active team_members only — deactivated users shouldn't
                        // appear in group quick-selects. Also apply the call-skillset
                        // filter when the picked category is a call category, so the
                        // group quick-select can't bypass the gate.
                        const activeIds = new Set(
                          teamMembers.filter((tm) => tm.is_active !== false).map((tm) => tm.id)
                        );
                        const callSkilledIds = new Set(
                          teamMembers.filter((tm: any) => tm.is_active !== false && tm.has_call_skillset === true).map((tm) => tm.id)
                        );
                        const gateIds = isCallCategory(newTaskCategoryId) ? callSkilledIds : activeIds;
                        const memberIds = (g.user_group_members || [])
                          .map((m: any) => m.team_member_id)
                          .filter((id: string) => gateIds.has(id));
                        if (memberIds.length === 0) return null;
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
                    {newTaskAssignableMembers
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
                    disabled={!newTaskText.trim() || savingNewTask}
                    className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold hover:bg-[var(--accent)] disabled:opacity-40"
                  >
                    {savingNewTask ? "Creating..." : "Create task"}
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
                      <div className="text-[10px] text-[var(--text-muted)] font-semibold mb-1.5 flex items-center gap-1.5">
                        <span>Assignees</span>
                        {isCallCategory(editTaskCategoryId) && (
                          <span className="text-[9px] font-normal text-[var(--text-muted)] italic">
                            📞 call-skilled only
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {/* Select all / Deselect all — counts vs the filtered pool */}
                        <button
                          onClick={() => setEditTaskAssigneeIds(
                            editTaskAssigneeIds.length === editTaskAssignableMembers.length
                              ? []
                              : editTaskAssignableMembers.map((m: any) => m.id)
                          )}
                          className="px-2 py-1 rounded-lg text-[10px] font-medium bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--text-secondary)]"
                        >
                        {editTaskAssigneeIds.length === editTaskAssignableMembers.length ? "Deselect all" : "Select all"}
                        </button>
                        {/* User groups — filter to active team_members only AND
                            apply call-skillset gate when category is Call. */}
                        {userGroups.map((g: any) => {
                          const activeIds = new Set(
                            teamMembers.filter((tm) => tm.is_active !== false).map((tm) => tm.id)
                          );
                          const callSkilledIds = new Set(
                            teamMembers.filter((tm: any) => tm.is_active !== false && tm.has_call_skillset === true).map((tm) => tm.id)
                          );
                          const gateIds = isCallCategory(editTaskCategoryId) ? callSkilledIds : activeIds;
                          const gMembers = (g.user_group_members || [])
                            .map((gm: any) => gm.team_member_id)
                            .filter((id: string) => gateIds.has(id));
                          if (gMembers.length === 0) return null;
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
                        {/* Individual assignee picker — filtered by call skillset
                            when the category is Call. */}
                        {editTaskAssignableMembers.map((m: any) => {
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
                        className={`text-sm font-medium whitespace-pre-wrap ${
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
                      task.status !== "completed" && !task.is_done && currentUser && (
                        <button
                          onClick={async () => {
                            const callerIsAssigned = assignees.some((a: any) => a.id === currentUser.id);
                            if (!callerIsAssigned) {
                              alert("You're not assigned to this task.");
                              return;
                            }
                            const willSoleDelete = assignees.length <= 1;
                            const promptText = willSoleDelete
                              ? "You're the only assignee. Removing yourself will remove this task from the board.\n\nWhy are you removing this task?\n(e.g., supplier already responded, duplicate, no longer relevant)"
                              : `Remove yourself from this task? The other ${assignees.length - 1} assignee${assignees.length - 1 === 1 ? "" : "s"} will continue.\n\nWhy are you removing yourself?\n(e.g., not the right owner, already handled by someone else)`;
                            const reason = prompt(promptText);
                            if (!reason || !reason.trim()) return;
                            try {
                              const res = await fetch("/api/tasks/remove-me", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  task_id: task.id,
                                  removed_by: currentUser.id,
                                  reason: reason.trim(),
                                }),
                              });
                              if (!res.ok) {
                                const err = await res.json().catch(() => ({}));
                                alert("Could not remove you from this task: " + (err.error || res.status));
                                return;
                              }
                              // Add a thread note for context. Wording differs
                              // based on whether the whole task was removed
                              // or only the current user.
                              if (convo) {
                                const noteBody = willSoleDelete
                                  ? `🗑️ Task removed: "${task.text.slice(0, 50)}"\nReason: ${reason.trim()}`
                                  : `👋 Removed self from task: "${task.text.slice(0, 50)}"\nReason: ${reason.trim()}`;
                                await onAddNote(convo.id, noteBody);
                              }
                              await refetchDetail();
                            } catch (e) { console.error(e); }
                          }}
                          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--warning)] hover:bg-[rgba(240,136,62,0.08)] opacity-0 group-hover/task:opacity-100 transition-all mt-0.5 shrink-0"
                          title="Remove me from this task"
                        >
                          <UserMinus size={13} />
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
                            {sortLabelsForBadges(thread.labels).map((cl: any) =>
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

              <div className="flex items-center gap-2">
                {threadSummary?.summary && (
                  <>
                    <button
                      type="button"
                      onClick={exportSummaryPdf}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                      title="Export the full summary as a PDF"
                    >
                      Export PDF
                    </button>
                    <button
                      type="button"
                      onClick={exportSummaryCsv}
                      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                      title="Export the quotes table as a CSV"
                    >
                      Export CSV
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => generateSummary(true)}
                  disabled={threadSummaryGenerating}
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[12px] font-semibold text-[var(--info)] hover:bg-[var(--surface-2)] disabled:opacity-60"
                >
                  {threadSummaryGenerating ? "Refreshing..." : "Refresh Summary"}
                </button>
              </div>
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

                {/* ── Supplier Information (extracted from this thread) ── */}
                {(() => {
                  const si = threadSummary.summary.supplier_information || {};
                  const dash = (v: any) =>
                    v === null || v === undefined || v === "" ? "—" : String(v);
                  const Field = ({ label, value }: { label: string; value: any }) => (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        {label}
                      </span>
                      <span className="text-sm text-[var(--text-primary)] break-words [overflow-wrap:anywhere]">{dash(value)}</span>
                    </div>
                  );
                  const acc = si.accessorial_charges || {};
                  const payInfo = si.payment_information || {};
                  const payTerms = si.payment_terms || {};
                  return (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          Supplier Information
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Extracted from this thread — review before relying on it
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 mt-3">
                        <Field label="Type" value={si.type ? String(si.type).replace(/_/g, " ") : "unknown"} />
                        <Field label="Website" value={si.website} />
                        <Field label="Pick-up Address" value={si.pickup_address} />
                        <Field label="Purchasing Thresholds" value={si.purchasing_thresholds} />
                        <Field label="Contact Name" value={si.contact_name} />
                        <Field label="Contact Email" value={si.contact_email} />
                        <Field label="Contact Phone" value={si.contact_phone} />
                        <Field label="Additional Contacts" value={si.additional_contacts} />
                        <Field label="Shipping Terms" value={si.shipping_terms} />
                        <Field label="Shipping Email" value={si.shipping_email} />
                        <Field label="Billing Email" value={si.billing_email} />
                        <Field label="Facility Certifications / Compliances" value={si.facility_certifications_compliances} />
                      </div>

                      <div className="mt-4 pt-3 border-t border-[var(--border)]">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                          Accessorial Charges
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          <Field label="Hazmat Handling Rate" value={acc.hazmat_handling_rate} />
                          <Field label="Temp-Controlled Storage Rate" value={acc.temperature_controlled_storage_rate} />
                          <Field label="Liftgate Service Rate" value={acc.liftgate_service_rate} />
                          <Field label="Special Packaging Rate" value={acc.special_packaging_rate} />
                          <Field label="Other" value={acc.other} />
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-[var(--border)]">
                        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                          <Field label="Payment Method" value={payInfo.method} />
                          <Field label="Payment Details" value={payInfo.details} />
                          <Field label="Payment Terms" value={payTerms.type} />
                          <Field label="Payment Terms Details" value={payTerms.details} />
                        </div>
                      </div>

                      {si.other_notes && (
                        <div className="mt-4 pt-3 border-t border-[var(--border)]">
                          <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
                            Other Notes
                          </div>
                          <div className="text-sm text-[var(--text-primary)]">{si.other_notes}</div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Quotes (accumulated from this thread, durable store) ── */}
                {(() => {
                  // Render the persistent, accumulated quotes for this thread
                  // (scope B). These never disappear on refresh.
                  const quotes = displayQuotes;
                  const dash = (v: any) =>
                    v === null || v === undefined || v === "" ? "—" : String(v);
                  const yn = (v: any) => (v === true ? "Yes" : v === false ? "No" : "—");
                  const Field = ({ label, value }: { label: string; value: any }) => (
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                        {label}
                      </span>
                      <span className="text-sm text-[var(--text-primary)] break-words [overflow-wrap:anywhere]">{value}</span>
                    </div>
                  );
                  const DocChip = ({ label, on }: { label: string; on: boolean }) => (
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold " +
                        (on
                          ? "bg-[rgba(74,222,128,0.12)] text-[var(--accent)]"
                          : "bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]")
                      }
                    >
                      {label} {on ? "✓" : "—"}
                    </span>
                  );
                  return (
                    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                          Quotes ({quotes.length})
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Extracted from this thread — review before relying on it
                        </div>
                      </div>
                      {quotes.length === 0 ? (
                        <div className="text-sm text-[var(--text-secondary)]">
                          No quote information available in this thread
                        </div>
                      ) : (
                      <div className="space-y-3">
                        {quotes.map((q: any, qi: number) => {
                          const docs = q.docs_supplied || {};
                          const priceLine = [q.price, q.price_qty, q.price_unit].some(
                            (x) => x !== null && x !== undefined && x !== ""
                          )
                            ? `${dash(q.price)} / ${dash(q.price_qty)} / ${dash(q.price_unit)}`
                            : "—";
                          return (
                            <div
                              key={qi}
                              className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3"
                            >
                              <div className="text-sm font-semibold text-[var(--text-primary)] mb-2">
                                {dash(q.material_name)}
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                                <Field label="INCI / Trade Name" value={dash(q.inci_trade_name)} />
                                <Field label="Grade(s)" value={dash(q.grade)} />
                                <Field label="Price / Qty / Unit" value={priceLine} />
                                <Field label="Material ID" value={dash(q.material_id)} />
                                <Field
                                  label="Case W / H / L"
                                  value={`${dash(q.case_width)} / ${dash(q.case_height)} / ${dash(q.case_length)}`}
                                />
                                <Field label="Case / Pack Size" value={dash(q.case_pack_size || q.pack_size || q.case_size || q.case_weight)} />
                                <Field label="Quote Provided" value={dash(q.quote_provided_date)} />
                                <Field label="Quote Expiry / Valid Until" value={dash(q.quote_expiry)} />
                                <Field label="Lead Time" value={dash(q.lead_time)} />
                                <Field label="MOQ" value={dash(q.moq)} />
                                <Field label="Max Inventory" value={dash(q.max_inventory)} />
                                <Field label="Hazardous" value={yn(q.hazardous)} />
                                <Field label="Refrigerated" value={yn(q.refrigerated)} />
                                <Field label="Equipment Accessorials" value={dash(q.equipment_accessorials)} />
                                <Field label="Sample Handling" value={dash(q.sample_handling)} />
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                                  Docs Supplied
                                </span>
                                <DocChip label="COA" on={docs.coa === true} />
                                <DocChip label="SDS" on={docs.sds === true} />
                                <DocChip label="TDS" on={docs.tds === true} />
                              </div>
                              {q.other_notes && (
                                <div className="mt-2 text-[11px] text-[var(--text-secondary)]">
                                  {q.other_notes}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  );
                })()}

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
        <div className={showReplyEditor
          ? "px-4 py-2 border-t border-[var(--surface-2)] flex flex-col min-h-0 flex-shrink basis-auto max-h-[60vh]"
          : "px-4 py-2 border-t border-[var(--surface-2)] shrink-0"
        }>
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
            <div className="flex flex-col gap-1.5 min-h-0 flex-1">
              {/* Scrollable inner region. When the reply form content (headers,
                  Cc/Bcc, RichTextEditor, attachments) grows past viewport — or
                  the user zooms in — this section becomes vertically scrollable
                  so the user can reach all fields. The Send/Collapse footer
                  below remains pinned and always visible. */}
              <div className="flex flex-col gap-1.5 overflow-y-auto pr-1 flex-1 min-h-0">
              {/* Reply header: From, editable To, editable Subject, plus Cc/Bcc
                  display when present. From stays read-only because it's tied
                  to the email_account we send from (changing it would mean
                  switching accounts, which isn't supported inline). To and
                  Subject are editable so users can correct an auto-picked
                  recipient or tweak the subject before sending. */}
              {(() => {
                const fromDisplay = accountName ? `${accountName} <${accountEmail}>` : accountEmail;
                return (
                  <div className="rounded-md bg-[var(--bg)] border border-[var(--border)] px-2.5 py-1.5 text-[11px] leading-snug">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider w-12 shrink-0">From</span>
                      <span className="text-[var(--text-primary)] truncate">{fromDisplay || "—"}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <label htmlFor="reply-to-input" className="text-[var(--text-muted)] font-semibold uppercase tracking-wider w-12 shrink-0 cursor-text">To</label>
                      <input
                        id="reply-to-input"
                        type="text"
                        value={replyTo}
                        onChange={(e) => setReplyTo(e.target.value)}
                        placeholder="recipient@example.com"
                        className="flex-1 min-w-0 bg-transparent outline-none border-none text-[var(--text-primary)] text-[11px] py-0.5"
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <label htmlFor="reply-subject-input" className="text-[var(--text-muted)] font-semibold uppercase tracking-wider w-12 shrink-0 cursor-text">Subject</label>
                      <input
                        id="reply-subject-input"
                        type="text"
                        value={replySubject}
                        onChange={(e) => setReplySubject(e.target.value)}
                        placeholder={convo.subject ? `Re: ${convo.subject}` : "Subject"}
                        className="flex-1 min-w-0 bg-transparent outline-none border-none text-[var(--text-primary)] text-[11px] py-0.5"
                      />
                    </div>
                    {replyCc.trim() && (
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider w-12 shrink-0">Cc</span>
                        <span className="text-[var(--text-primary)] truncate">{replyCc.trim()}</span>
                      </div>
                    )}
                    {replyBcc.trim() && (
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-[var(--text-muted)] font-semibold uppercase tracking-wider w-12 shrink-0">Bcc</span>
                        <span className="text-[var(--text-primary)] truncate">{replyBcc.trim()}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
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
              {/* Agent-drafted banner. Renders when the loaded draft was
                  created via the external API (e.g. Sammy's bot). The badge
                  identifies the agent; if requires_sender_selection is true,
                  a sender picker is shown inline and the Send button is
                  blocked below (handled at the Send-action site). */}
              {loadedDraftMeta?.created_by_agent && (
                <div className="mb-2 p-2.5 rounded-lg border border-[#A855F7]/30 bg-[#A855F7]/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[14px]">🤖</span>
                    <span className="text-[11px] font-semibold text-[#A855F7]">
                      Drafted by {loadedDraftMeta.created_by_agent}
                    </span>
                    {loadedDraftMeta.requires_sender_selection && (
                      <span className="ml-auto px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--warning)]/15 text-[var(--warning)]">
                        SENDER REQUIRED
                      </span>
                    )}
                  </div>
                  {loadedDraftMeta.requires_sender_selection && (
                    <div className="mt-1.5">
                      <div className="text-[10px] text-[var(--text-secondary)] mb-1">
                        This agent draft didn't specify a sending account. Pick which mailbox to send from:
                      </div>
                      <select
                        value={loadedDraftMeta.email_account_id || ""}
                        onChange={async (e) => {
                          const newAccountId = e.target.value || null;
                          if (!newAccountId || !loadedDraftId) return;
                          // Patch the draft on the server so the flag clears
                          // and email_account_id sticks across reloads. The
                          // backend's normal POST flow clears requires_sender_selection
                          // when an email_account_id is provided by a session-authed user.
                          try {
                            await fetch("/api/drafts", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({
                                conversation_id: convo?.id,
                                email_account_id: newAccountId,
                                author_id: currentUser?.id,
                                to_addresses: replyTo,
                                cc_addresses: showReplyCc ? replyCc : "",
                                bcc_addresses: showReplyBcc ? replyBcc : "",
                                subject: replySubject,
                                body_html: replyText,
                              }),
                            });
                          } catch { /* best-effort */ }
                          // Update local UI immediately so Send unlocks.
                          setLoadedDraftMeta((prev) =>
                            prev ? { ...prev, email_account_id: newAccountId, requires_sender_selection: false } : prev
                          );
                        }}
                        className="w-full px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--info)]/50"
                      >
                        <option value="">— Pick an account —</option>
                        {(emailAccounts || []).map((a: any) => (
                          <option key={a.id} value={a.id}>{a.name || a.email}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}
              <RichTextEditor
                ref={inlineReplyEditorRef}
                value={replyText}
                onChange={setReplyText}
                placeholder="Write a reply..."
                compact
                minHeight={50}
                autoFocus
                signature={replySignature}
                onAttach={() => replyFileInputRef.current?.click()}
                onDrive={() => openReplyDrivePicker("inline")}
                onTemplate={() => openReplyTemplatePicker("inline")}
                onAIDraft={() => { setAiDraftTarget("inline"); setShowAIDraftModal(true); }}
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
              </div>
              {/* Pinned footer row — stays visible regardless of how much
                  scrollable content is above it. Holds Collapse, Discard
                  draft, Reply All, and Send. */}
              <div className="flex justify-between items-center shrink-0 pt-1.5 border-t border-[var(--surface-2)]">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setShowReplyEditor(false); setReplyText(""); setReplyAttachments([]); setReplyCc(""); setReplyBcc(""); setReplyTo(""); setReplySubject(""); setShowReplyCc(false); setShowReplyBcc(false); }}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    Collapse
                  </button>
                  {loadedDraftId && (
                    <button
                      onClick={async () => {
                        await fetch(`/api/drafts?id=${loadedDraftId}`, { method: "DELETE" }).catch(() => {});
                        setLoadedDraftId(null);
                        setLoadedDraftMeta(null);
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
                  {/* Reply All — only shown when there are additional participants to add.
                      Auto-fills the inline Cc field and opens it. Does nothing once the
                      Cc field already contains the auto-fill (button hides itself). */}
                  {(() => {
                    const { ccList } = computeReplyAllRecipients(messages, accountEmail, convo.from_email);
                    if (ccList.length === 0) return null;
                    const existing = extractEmails(replyCc);
                    const allPresent = ccList.every((e) => existing.includes(e));
                    if (allPresent) return null;
                    return (
                      <button
                        onClick={() => {
                          // Merge with anything the user already typed in Cc
                          const merged = [...existing];
                          for (const e of ccList) {
                            if (!merged.includes(e)) merged.push(e);
                          }
                          setReplyCc(merged.join(", "));
                          setShowReplyCc(true);
                        }}
                        title={`Reply All — add Cc: ${ccList.join(", ")}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--info)] hover:bg-[var(--surface-2)] transition-all text-[11px] font-semibold"
                      >
                        <Reply size={11} />
                        Reply All ({ccList.length})
                      </button>
                    );
                  })()}
                  <button
                    onClick={handleSendReplyInternal}
                    disabled={
                      sending ||
                      (!replyText.replace(/<[^>]*>/g, "").trim() && replyAttachments.length === 0) ||
                      // Block Send when an agent draft hasn't had a sender
                      // account picked yet. The banner above shows a picker;
                      // until they pick, this stays disabled.
                      !!loadedDraftMeta?.requires_sender_selection
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] disabled:opacity-40 transition-all text-[11px] font-bold"
                    title={loadedDraftMeta?.requires_sender_selection ? "Pick a sending account above before sending" : undefined}
                  >
                    <Send size={12} />
                    {sending ? "Sending..." : "Send"}
                  </button>
                  {/* Messenger-style send indicator */}
                  {replySendStatus === "sent" && (
                    <span className="flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-strong)] animate-in fade-in">
                      <CheckCircle size={13} /> Sent
                    </span>
                  )}
                  {replySendStatus === "failed" && (
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--danger)]">
                      Not sent
                      <button
                        onClick={handleSendReplyInternal}
                        disabled={sending}
                        className="underline hover:no-underline disabled:opacity-40"
                      >
                        Retry
                      </button>
                    </span>
                  )}
                </div>
              </div>

              {/* Reply Template Picker Modal */}
              {/* Template picker + Drive picker are rendered at component
                  root (further down) so they work from inline reply, reply
                  modal, AND forward modal — not just inline. */}

              {/* Reply Drive Picker Modal — moved to component root, see below */}
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

      {/* ── Unified Template Picker (works from inline reply, reply modal,
             AND forward modal). Previously these pickers were rendered
             inside the inline reply branch which meant clicking template/
             Drive from the modal popouts did nothing because the picker JSX
             wasn't mounted. Lifting them to the component root fixes that. */}
      {showReplyTemplateModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setShowReplyTemplateModal(false); setShowCreateTemplateForm(false); }}>
          <div className="w-full max-w-lg bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[var(--text-primary)]">
                  {showCreateTemplateForm ? "Create Template" : "Insert Template"}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  {showCreateTemplateForm
                    ? "Save text you'll reuse — personal (just you) or shared (everyone)"
                    : "Click a template to insert at your cursor"}
                </div>
              </div>
              <button onClick={() => { setShowReplyTemplateModal(false); setShowCreateTemplateForm(false); }} className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center">
                <X size={16} />
              </button>
            </div>

            {showCreateTemplateForm ? (
              // ─── CREATE FORM ────────────────────────────────────────────
              // Lets non-admins make templates without needing /settings access.
              <div className="p-4 space-y-3">
                <div>
                  <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Name</div>
                  <input
                    autoFocus
                    value={newTemplateName}
                    onChange={(e) => setNewTemplateName(e.target.value)}
                    placeholder="e.g. Quote follow-up"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[13px] text-[var(--text-primary)] outline-none focus:border-[var(--info)]/50 placeholder:text-[var(--text-muted)]"
                  />
                </div>
                <div>
                  <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1">Who can use this template</div>
                  <div className="flex gap-1.5">
                    {(["personal", "organization"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() => setNewTemplateScope(s)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                          newTemplateScope === s
                            ? "bg-[var(--border)] text-[var(--text-primary)] ring-1 ring-[var(--accent)]"
                            : "bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--text-secondary)]"
                        }`}
                      >
                        {s === "personal" ? "👤 Personal (just me)" : "🏢 Shared (everyone)"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Body</div>
                    {/* Quick fill from whatever they're currently composing.
                        Saves them re-typing if they want to template their
                        current draft. */}
                    <button
                      onClick={() => {
                        const draftBody = replyInsertTarget === "modal" ? replyModalBody
                          : replyInsertTarget === "forward" ? forwardBody
                          : replyText;
                        if (draftBody && draftBody.trim()) {
                          setNewTemplateBody(draftBody);
                        }
                      }}
                      className="text-[10px] text-[var(--info)] hover:underline font-semibold"
                      title="Copy what you've already typed into this template"
                    >
                      Use current draft
                    </button>
                  </div>
                  <textarea
                    value={newTemplateBody}
                    onChange={(e) => setNewTemplateBody(e.target.value)}
                    placeholder="Template body — supports basic HTML. Plain text works fine too."
                    rows={6}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--info)]/50 placeholder:text-[var(--text-muted)] resize-none font-mono"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 pt-1">
                  <button
                    onClick={() => setShowCreateTemplateForm(false)}
                    className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-[12px] hover:bg-[var(--bg)]"
                  >
                    Back
                  </button>
                  <button
                    onClick={saveNewTemplate}
                    disabled={newTemplateSaving || !newTemplateName.trim() || !newTemplateBody.trim()}
                    className="px-4 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[12px] font-semibold disabled:opacity-40"
                  >
                    {newTemplateSaving ? "Saving…" : "Save template"}
                  </button>
                </div>
              </div>
            ) : (
              // ─── BROWSE TEMPLATES ───────────────────────────────────────
              <div className="max-h-[400px] overflow-y-auto">
                {replyTemplates.length === 0 ? (
                  <div className="text-center py-8 text-[var(--text-muted)] text-[12px]">
                    No templates yet.
                    <div className="mt-2">
                      <button
                        onClick={() => setShowCreateTemplateForm(true)}
                        className="text-[var(--info)] hover:underline font-semibold"
                      >
                        Create your first one →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-2 space-y-0.5">
                    {["organization", "personal"].map((scope) => {
                      const scopeTemplates = replyTemplates.filter((t: any) => t.scope === scope);
                      if (scopeTemplates.length === 0) return null;
                      return (
                        <div key={scope}>
                          <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest px-3 pt-2 pb-1">
                            {scope === "organization" ? "🏢 Shared (all users)" : "👤 Personal (just me)"}
                          </div>
                          {scopeTemplates.map((tpl: any) => (
                            <button key={tpl.id} onClick={() => {
                              // Insert at cursor in whichever editor opened the picker.
                              const editorRef = replyInsertTarget === "modal"
                                ? modalReplyEditorRef
                                : replyInsertTarget === "forward"
                                ? forwardEditorRef
                                : inlineReplyEditorRef;
                              if (editorRef.current) {
                                editorRef.current.insertHTML(tpl.body);
                              } else if (replyInsertTarget === "modal") {
                                setReplyModalBody((prev) => (prev ? prev + "<p></p>" + tpl.body : tpl.body));
                              } else if (replyInsertTarget === "forward") {
                                setForwardBody((prev) => (prev ? prev + "<p></p>" + tpl.body : tpl.body));
                              } else {
                                setReplyText((prev) => (prev ? prev + "<p></p>" + tpl.body : tpl.body));
                              }
                              setShowReplyTemplateModal(false);
                            }}
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
            )}

            {/* Footer — only shown in browse mode, hidden during create form */}
            {!showCreateTemplateForm && (
              <div className="px-5 py-2 border-t border-[var(--border)] flex items-center justify-between">
                <span className="text-[10px] text-[var(--text-muted)]">
                  Templates insert at your cursor position
                </span>
                <button
                  onClick={() => {
                    // Prefill body with current draft if anything's typed
                    const draftBody = replyInsertTarget === "modal" ? replyModalBody
                      : replyInsertTarget === "forward" ? forwardBody
                      : replyText;
                    if (draftBody && draftBody.trim() && !newTemplateBody) {
                      setNewTemplateBody(draftBody);
                    }
                    setShowCreateTemplateForm(true);
                  }}
                  className="text-[10px] text-[var(--info)] hover:underline font-semibold"
                >
                  + New template
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Unified Drive Picker (works from inline reply, reply modal,
             AND forward modal). */}
      {showReplyDrive && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowReplyDrive(false)}>
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
          <div className="mb-1 flex items-center justify-between gap-2">
            <label className="block text-[12px] font-semibold text-[var(--text-secondary)]">To</label>
            {/* Show a "Clear all" link whenever the To field has any content,
                since Forward auto-fills with every thread participant — users
                routing the thread to someone NEW want a one-click wipe. */}
            {forwardTo.trim().length > 0 && (
              <button
                type="button"
                onClick={() => setForwardTo("")}
                className="text-[10px] text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
                title="Clear the To field (pre-filled with all thread participants)"
              >
                Clear
              </button>
            )}
          </div>
          <input
            type="text"
            value={forwardTo}
            onChange={(e) => setForwardTo(e.target.value)}
            placeholder="recipient@example.com"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none"
          />
          <div className="mt-1 text-[10px] text-[var(--text-muted)]">
            Pre-filled with all thread participants. Edit or clear as needed.
          </div>
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
          <RichTextEditor
            ref={forwardEditorRef}
            value={forwardBody}
            onChange={setForwardBody}
            placeholder="Type your message..."
            minHeight={260}
            autoFocus
            signature={replySignature}
            onAttach={() => forwardFileInputRef.current?.click()}
            onDrive={() => openReplyDrivePicker("forward")}
            onTemplate={() => openReplyTemplatePicker("forward")}
            onAIDraft={() => { setAiDraftTarget("forwardModal"); setShowAIDraftModal(true); }}
          />
          {/* Hidden file input for forward */}
          <input
            ref={forwardFileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={async (e) => {
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
              setForwardAttachments((prev) => [...prev, ...newAtts]);
              if (forwardFileInputRef.current) forwardFileInputRef.current.value = "";
            }}
          />
          {/* Forward attachment chips */}
          {forwardAttachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {forwardAttachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[10px]">
                  <Paperclip size={10} className="text-[var(--info)]" />
                  <span className="text-[var(--text-primary)] max-w-[180px] truncate">{att.name}</span>
                  <button
                    onClick={() => setForwardAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
                onClick={handleCloseReplyModal}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
                title="Close"
              >
                <X size={15} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
              {/* Reply All toggle — only shown when there are other participants to add.
                  Toggling ON auto-fills the Cc field with the rest of the thread's
                  participants (already excludes the primary recipient + the connected
                  account's own email). Toggling OFF clears the Cc again. */}
              {replyModalReplyAllCcList.length > 0 && (
                <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
                      <Reply size={12} />
                      Reply All
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)] mt-0.5 truncate">
                      {replyModalReplyAll
                        ? `Cc'ing ${replyModalReplyAllCcList.length} other participant${replyModalReplyAllCcList.length === 1 ? "" : "s"}`
                        : `${replyModalReplyAllCcList.length} other participant${replyModalReplyAllCcList.length === 1 ? "" : "s"} available to Cc`}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={replyModalReplyAll}
                    onClick={() => {
                      const next = !replyModalReplyAll;
                      setReplyModalReplyAll(next);
                      if (next) {
                        // Merge into existing Cc rather than overwriting any
                        // addresses the user might have typed manually.
                        const existing = extractEmails(replyModalCc);
                        const merged = [...existing];
                        for (const e of replyModalReplyAllCcList) {
                          if (!merged.includes(e)) merged.push(e);
                        }
                        setReplyModalCc(merged.join(", "));
                      } else {
                        // Remove only the auto-added addresses; preserve user-typed ones.
                        const existing = extractEmails(replyModalCc);
                        const remaining = existing.filter((e) => !replyModalReplyAllCcList.includes(e));
                        setReplyModalCc(remaining.join(", "));
                      }
                    }}
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      replyModalReplyAll ? "bg-[var(--accent)]" : "bg-[var(--border)]"
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                        replyModalReplyAll ? "translate-x-5" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              )}

              {/* FROM — always the conversation's original email account.
                  Shown as a read-only field so the user knows which account
                  the reply will send from. No picker by design — avoids the
                  send-from-wrong-account foot-gun. */}
              <div>
                <label className="mb-1 block text-[12px] font-semibold text-[var(--text-secondary)]">From</label>
                <div className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text-secondary)]">
                  {(() => {
                    const a = replyModalSendableAccounts.find((x) => x.is_conversation_account)
                      || replyModalSendableAccounts[0];
                    if (!a) return <span className="italic text-[var(--text-muted)]">Loading…</span>;
                    return (
                      <span>
                        {a.icon ? `${a.icon} ` : ""}{a.name} &lt;{a.email}&gt;
                      </span>
                    );
                  })()}
                </div>
              </div>

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
                <RichTextEditor
                  ref={modalReplyEditorRef}
                  value={replyModalBody}
                  onChange={setReplyModalBody}
                  placeholder="Type your reply..."
                  minHeight={260}
                  autoFocus
                  signature={replySignature}
                  onAttach={() => replyModalFileInputRef.current?.click()}
                  onDrive={() => openReplyDrivePicker("modal")}
                  onTemplate={() => openReplyTemplatePicker("modal")}
                  onAIDraft={() => { setAiDraftTarget("replyModal"); setShowAIDraftModal(true); }}
                />
                {/* Hidden file input for the modal — separate from the inline
                    reply's so attachment lists don't cross-contaminate. */}
                <input
                  ref={replyModalFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={async (e) => {
                    const files = e.target.files;
                    if (!files) return;
                    const newAtts: { name: string; size: number; type: string; data: string }[] = [];
                    for (let i = 0; i < files.length; i++) {
                      const file = files[i];
                      // 25MB per file cap, same as inline reply.
                      if (file.size > 25 * 1024 * 1024) continue;
                      const data = await new Promise<string>((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve((reader.result as string).split(",")[1]);
                        reader.readAsDataURL(file);
                      });
                      newAtts.push({ name: file.name, size: file.size, type: file.type || "application/octet-stream", data });
                    }
                    setReplyModalAttachments((prev) => [...prev, ...newAtts]);
                    if (replyModalFileInputRef.current) replyModalFileInputRef.current.value = "";
                  }}
                />
                {/* Attachment chips for the modal */}
                {replyModalAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {replyModalAttachments.map((att, i) => (
                      <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[10px]">
                        <Paperclip size={10} className="text-[var(--info)]" />
                        <span className="text-[var(--text-primary)] max-w-[180px] truncate">{att.name}</span>
                        <button
                          onClick={() => setReplyModalAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                          className="text-[var(--text-muted)] hover:text-[var(--danger)]"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-4 shrink-0 bg-[var(--surface)]">
              <button
                type="button"
                onClick={handleCloseReplyModal}
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

      {/* Merge-by-link modal */}
      {showMergeLinkModal && (
        <div
          className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
          onClick={() => !mergeLinkBusy && setShowMergeLinkModal(false)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl w-full max-w-lg overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--border)] shrink-0">
              <div className="flex items-center gap-2">
                <GitMerge size={18} className="text-[var(--info)]" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  Merge by link
                </span>
              </div>
              <button
                onClick={() => !mergeLinkBusy && setShowMergeLinkModal(false)}
                disabled={mergeLinkBusy}
                className="p-1 rounded-md hover:bg-[var(--border)] text-[var(--text-secondary)] disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-[12px] text-[var(--text-secondary)] leading-relaxed">
                Paste a conversation link (or just its ID). That conversation will
                be merged INTO this one — its messages, tasks, notes, and activity
                will move here, and the source becomes a merged shell that can be
                unmerged later from Related Threads.
              </p>
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-1">
                  Conversation link or ID
                </label>
                <input
                  type="text"
                  value={mergeLinkInput}
                  onChange={(e) => { setMergeLinkInput(e.target.value); setMergeLinkError(null); }}
                  placeholder="https://app.tenkara.com/#conversation=abc-123... or paste the ID"
                  autoFocus
                  disabled={mergeLinkBusy}
                  className="w-full px-3 py-2 text-[12px] rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50 font-mono"
                />
                {mergeLinkError && (
                  <div className="mt-2 text-[11px] text-[var(--danger)]">{mergeLinkError}</div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-5 py-3.5 shrink-0 bg-[var(--surface)]">
              <button
                type="button"
                onClick={() => setShowMergeLinkModal(false)}
                disabled={mergeLinkBusy}
                className="px-3 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] text-sm hover:bg-[var(--surface-2)] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMergeByLink}
                disabled={mergeLinkBusy || !mergeLinkInput.trim()}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-semibold text-sm hover:bg-[var(--accent-strong)] disabled:opacity-50 inline-flex items-center gap-2"
              >
                {mergeLinkBusy && <Loader2 size={14} className="animate-spin" />}
                {mergeLinkBusy ? "Merging..." : "Merge"}
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

      {/* Supplier picker modal — opens when "Add as contact" is clicked on
          a participant badge but the conversation has no supplier link yet. */}
      {addContactPending && (
        <div
          className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
          onClick={() => setAddContactPending(null)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-2xl w-full max-w-md flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <div className="text-[13px] font-bold text-[var(--text-primary)]">
                Add to which supplier?
              </div>
              <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Adding {addContactPending.name || addContactPending.email}
              </div>
            </div>
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <input
                value={supplierPickerQuery}
                onChange={(e) => setSupplierPickerQuery(e.target.value)}
                placeholder="Search suppliers by name…"
                autoFocus
                className="w-full px-3 py-2 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
              />
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {supplierPickerQuery.trim() === "" ? (
                <div className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
                  Start typing to search suppliers
                </div>
              ) : supplierPickerResults.length === 0 ? (
                <div className="px-3 py-4 text-center text-[11px] text-[var(--text-muted)]">
                  No suppliers match &ldquo;{supplierPickerQuery}&rdquo;
                </div>
              ) : (
                supplierPickerResults.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => doAddContact(s.id, addContactPending.name, addContactPending.email)}
                    className="w-full text-left px-3 py-2 rounded-md text-[12px] text-[var(--text-primary)] hover:bg-[var(--surface-2)]"
                  >
                    {s.name}
                  </button>
                ))
              )}
            </div>
            <div className="px-4 py-3 border-t border-[var(--border)] flex justify-end">
              <button
                onClick={() => setAddContactPending(null)}
                className="px-3 py-1.5 rounded text-[12px] text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating toast for contact-related feedback */}
      {contactToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[70] px-4 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] shadow-lg text-[12px] text-[var(--text-primary)] animate-fade-in">
          {contactToast}
        </div>
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
        accountName={accountName}
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

          // Route to whichever compose surface opened the AI Draft modal.
          // Each surface preserves any existing draft by appending to it.
          if (aiDraftTarget === "replyModal") {
            if (replyModalBody && replyModalBody.trim()) {
              setReplyModalBody(replyModalBody + "<p></p>" + htmlToInsert);
            } else {
              setReplyModalBody(htmlToInsert);
            }
          } else if (aiDraftTarget === "forwardModal") {
            if (forwardBody && forwardBody.trim()) {
              setForwardBody(forwardBody + "<p></p>" + htmlToInsert);
            } else {
              setForwardBody(htmlToInsert);
            }
          } else {
            // Default: inline reply composer
            if (replyText && replyText.trim()) {
              setReplyText(replyText + "<p></p>" + htmlToInsert);
            } else {
              setReplyText(htmlToInsert);
            }
            setShowReplyEditor(true);
          }
        }}
      />

      {/* Dial modal — pre-filled with this conversation's context */}
      <QuickCallModal
        isOpen={showDialModal}
        onClose={() => setShowDialModal(false)}
        conversationContext={
          convo
            ? {
                conversation_id: convo.id,
                supplier_contact_id: (convo as any).supplier_contact_id || null,
                subject: convo.subject || null,
                from_name: convo.from_name || null,
              }
            : null
        }
        onCallPlaced={() => {
          // We're already inside this conversation. Refetch calls so the new
          // stub timeline entry appears immediately.
          refetchCalls();
        }}
      />

    </div>
  );
}