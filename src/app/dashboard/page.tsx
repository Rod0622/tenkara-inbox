"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Loader2, Users, CheckCircle2, AlertTriangle,
  ListTodo, Mail, CalendarClock, Send, ChevronDown, X,
  ExternalLink, Inbox, Eye, Download, FileSpreadsheet, FileJson, FileText,
  UserMinus, Trash2, Clock, Phone
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";
import CallsView from "@/components/calls/CallsView";
import {
  getBusinessHoursRemaining as sharedGetBusinessHoursRemaining,
  getBusinessHoursElapsed as sharedGetBusinessHoursElapsed,
  formatBusinessTime as sharedFormatBusinessTime,
  type SupplierHours,
} from "@/lib/business-hours";

// Lazy-init supabase client (avoid module-level call that breaks static generation)
let _supabase: ReturnType<typeof createBrowserClient> | null = null;
function getSupabase() {
  if (!_supabase) _supabase = createBrowserClient();
  return _supabase;
}

// ── Types ─────────────────────────────────────────────

interface UserStats {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  role: string;
  department: string;
  tasks: { total: number; todo: number; in_progress: number; completed: number; dismissed: number; overdue: number; dueSoon: number };
  conversations: { assigned: number; unread: number };
  sentEmails: number;
}

interface TaskDetail {
  id: string;
  text: string;
  due_date: string | null;
  due_time: string | null;
  status: string;
  dismiss_reason?: string | null;
  created_at: string;
  conversation_subject: string;
  conversation_id: string;
  assignees: { name: string; initials: string; color: string; is_done: boolean; status: string }[];
  category_name: string | null;
  category_color: string | null;
}

interface ConversationDetail {
  id: string;
  subject: string;
  from_name: string;
  from_email: string;
  preview: string;
  status: string;
  is_unread: boolean;
  last_message_at: string;
  assignee_id: string | null;
  email_account_name: string;
  folder_name: string | null;
  reply_status: "awaiting_our_reply" | "awaiting_supplier_reply" | "internal" | "unknown";
  waiting_hours: number;
}

interface SentEmail {
  id: string;
  subject: string;
  to_addresses: string;
  sent_at: string;
  conversation_id: string;
  from_email: string;
}

type ViewMode = "overview" | "critical" | "all-tasks" | "user-detail" | "sla" | "export" | "removals" | "calls" | "offboarded";

// ── Helpers ───────────────────────────────────────────

// Business hours now use shared utility from @/lib/business-hours
// These wrappers maintain the same call signatures used throughout the dashboard
function getBusinessHoursRemaining(dueDate: string): number {
  return sharedGetBusinessHoursRemaining(dueDate);
}

function getBusinessHoursElapsed(dueDate: string): number {
  return sharedGetBusinessHoursElapsed(dueDate);
}

function formatBusinessTime(hours: number): string {
  return sharedFormatBusinessTime(hours);
}

function formatDueDate(date: string | null): string {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  
  if (d < now) {
    const bh = getBusinessHoursElapsed(date);
    if (bh < 11) return bh + "h overdue";
    const days = Math.floor(bh / 11);
    return days + "d " + (bh % 11) + "h overdue";
  }
  
  const bh = getBusinessHoursRemaining(date);
  if (bh === 0) return "Due now";
  if (bh < 11) return "Due in " + bh + "h";
  const days = Math.floor(bh / 11);
  const remHours = bh % 11;
  if (remHours === 0) return "Due in " + days + "d";
  return "Due in " + days + "d " + remHours + "h";
}

function getDueColor(date: string | null): string {
  if (!date) return "var(--text-muted)";
  const d = new Date(date);
  if (d < new Date()) return "var(--danger)"; // overdue
  const bh = getBusinessHoursRemaining(date);
  if (bh <= 11) return "var(--danger)"; // less than 1 business day
  if (bh <= 22) return "var(--warning)"; // less than 2 business days
  return "var(--info)";
}

function getPresetDates(preset: string): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  switch (preset) {
    case "today": return { from: fmt(today), to: fmt(today) };
    case "yesterday": {
      const y = new Date(today); y.setDate(y.getDate() - 1);
      return { from: fmt(y), to: fmt(y) };
    }
    case "this_week": {
      const start = new Date(today); start.setDate(start.getDate() - start.getDay());
      return { from: fmt(start), to: fmt(today) };
    }
    case "last_week": {
      const end = new Date(today); end.setDate(end.getDate() - end.getDay() - 1);
      const start = new Date(end); start.setDate(start.getDate() - 6);
      return { from: fmt(start), to: fmt(end) };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: fmt(start), to: fmt(today) };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: fmt(start), to: fmt(end) };
    }
    default: return { from: "", to: "" };
  }
}

// ── Main Component ────────────────────────────────────

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [loading, setLoading] = useState(true);
  const [userStats, setUserStats] = useState<UserStats[]>([]);
  const [criticalTasks, setCriticalTasks] = useState<TaskDetail[]>([]);
  const [allTasks, setAllTasks] = useState<TaskDetail[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("overview");

  // User detail drill-down
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userTasks, setUserTasks] = useState<TaskDetail[]>([]);
  const [userConversations, setUserConversations] = useState<ConversationDetail[]>([]);
  const [userSentEmails, setUserSentEmails] = useState<SentEmail[]>([]);
  const [userDetailTab, setUserDetailTab] = useState<"tasks" | "emails" | "unread" | "sent">("tasks");
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  // Date filter
  const [datePreset, setDatePreset] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Selected user filter for all-tasks view
  const [taskFilterUser, setTaskFilterUser] = useState<string | null>(null);
  const [dashTaskSearch, setDashTaskSearch] = useState("");

  // ── Task Removals audit (admin-only "Removals" tab) ──────────────────
  // Data shape mirrors GET /api/admin/task-removals: { rows, summary }.
  // Filters: date range (preset window 7/30/90/all) + user filter +
  // sole-only toggle. Re-fetched whenever any filter changes.
  const [removals, setRemovals] = useState<any[]>([]);
  const [removalSummary, setRemovalSummary] = useState<any>(null);
  const [removalsLoading, setRemovalsLoading] = useState(false);
  const [removalsWindow, setRemovalsWindow] = useState<"7d" | "30d" | "90d" | "all">("30d");
  const [removalsUserFilter, setRemovalsUserFilter] = useState<string | null>(null);
  const [removalsSoleOnly, setRemovalsSoleOnly] = useState(false);
  const [removalsSearch, setRemovalsSearch] = useState("");

  // SLA/KPI metrics
  const [slaData, setSlaData] = useState<any>(null);
  const [slaLoading, setSlaLoading] = useState(false);
  const [slaRecordsLoading, setSlaRecordsLoading] = useState(false);
  const [slaSubTab, setSlaSubTab] = useState<"response-times" | "supplier-responsiveness" | "awaiting-ours" | "awaiting-supplier">("response-times");
  const [supplierRtData, setSupplierRtData] = useState<any[]>([]);
  const [userRtData, setUserRtData] = useState<any[]>([]);
  const [rtAccountFilter, setRtAccountFilter] = useState<string>("all");
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [supplierSearch, setSupplierSearch] = useState("");
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  useEffect(() => { loadDashboardData(); }, [dateFrom, dateTo]);

  // Load SLA data when switching to SLA tab or when dates change
  useEffect(() => {
    if (viewMode === "sla") loadSlaData();
    if (viewMode === "removals") loadRemovals();
  }, [viewMode, dateFrom, dateTo]);

  async function loadSlaData() {
    setSlaLoading(true);
    setSlaRecordsLoading(true);
    try {
      // Batch 33: Two-phase loading.
      //
      // Phase 1 (fast): /api/metrics + /api/response-times?summary=true.
      // Together these give us the cards (avg, total, awaiting counts) and the
      // awaiting-reply lists. Both endpoints are small/fast. We unblock the UI
      // (setSlaLoading(false)) as soon as these return.
      //
      // Phase 2 (slow): /api/response-times (no summary) returns ALL response
      // time records — historically several MB. Used only for the per-supplier
      // and per-user breakdown tables. Loaded in the background; the relevant
      // sub-tabs show their own loading state until records arrive.
      let url = "/api/metrics?";
      if (effectiveDateFrom) url += "date_from=" + effectiveDateFrom + "&";
      if (effectiveDateTo) url += "date_to=" + effectiveDateTo + "&";

      let rtUrl = "/api/response-times?summary=true";
      if (effectiveDateFrom) rtUrl += "&date_from=" + effectiveDateFrom;
      if (effectiveDateTo) rtUrl += "&date_to=" + effectiveDateTo;

      // Phase 1: fast pair in parallel
      const [metricsRes, rtRes] = await Promise.all([
        fetch(url).catch(() => null),
        fetch(rtUrl).catch(() => null),
      ]);

      const metricsJson = metricsRes && metricsRes.ok ? await metricsRes.json() : null;
      const rtJson = rtRes && rtRes.ok ? await rtRes.json() : null;

      const teamOverall = rtJson?.team_responsiveness?.overall || { avg_minutes: 0, total: 0 };
      const merged = {
        overall: {
          avg_response_hours: teamOverall.avg_minutes ? Math.round((teamOverall.avg_minutes / 60) * 10) / 10 : 0,
          total_responses: teamOverall.total || 0,
          awaiting_our_reply: metricsJson?.overall?.awaiting_our_reply ?? null,
          awaiting_supplier_reply: metricsJson?.overall?.awaiting_supplier_reply ?? null,
        },
        awaiting_our_reply: metricsJson?.awaiting_our_reply || [],
        awaiting_supplier_reply: metricsJson?.awaiting_supplier_reply || [],
      };
      setSlaData(merged);
      setSlaLoading(false); // Cards + awaiting tabs are usable now

      // Phase 2: records + per-supplier / per-user aggregation. Run in the
      // background. The slow records fetch was the SLA tab's main bottleneck.
      //
      // Two-track fetch:
      //   - /api/response-times/by-user  → per-user roll-ups (tiny payload,
      //     includes ALL active team members even those with zero replies)
      //   - /api/response-times          → full records for the supplier
      //     responsiveness sub-tab (still needed there). Eventually we'll
      //     refactor that too, but not in this batch.
      const byUserUrlParams = new URLSearchParams();
      if (effectiveDateFrom) byUserUrlParams.set("date_from", effectiveDateFrom);
      if (effectiveDateTo) byUserUrlParams.set("date_to", effectiveDateTo);
      const byUserUrl = "/api/response-times/by-user" + (byUserUrlParams.toString() ? "?" + byUserUrlParams.toString() : "");

      let rtRecordsUrl = "/api/response-times?";
      if (effectiveDateFrom) rtRecordsUrl += "date_from=" + effectiveDateFrom + "&";
      if (effectiveDateTo) rtRecordsUrl += "date_to=" + effectiveDateTo + "&";

      // Fetch the per-user roll-up FIRST and show it. The bigger supplier-
      // records fetch runs in the background; users can already see the
      // Response Times by User table while it loads.
      const byUserRes = await fetch(byUserUrl).catch(() => null);
      const byUserJson = byUserRes && byUserRes.ok ? await byUserRes.json() : null;
      if (byUserJson?.users) {
        // Convert to the shape the existing render code expects: keep the
        // same fields (user_id, avg_minutes, fastest_minutes, slowest_minutes,
        // total) and add an empty suppliers array. Suppliers are lazy-loaded
        // when a row is expanded.
        setUserRtData(
          byUserJson.users.map((u: any) => ({
            user_id: u.user_id,
            avg_minutes: u.avg_minutes,
            fastest_minutes: u.fastest_minutes,
            slowest_minutes: u.slowest_minutes,
            total: u.total,
            supplier_count: u.supplier_count,
            suppliers: [], // populated lazily by loadUserSuppliers()
          }))
        );
        // Stop the table-level loading spinner as soon as we have user data —
        // the supplier sub-tab has its own spinner that stays up until the
        // background records fetch finishes.
        setSlaRecordsLoading(false);
      }

      // Records fetch — used by the SUPPLIER responsiveness sub-tab only,
      // not the per-user table. Kick it off WITHOUT await so the SLA tab is
      // immediately usable. The supplier sub-tab shows its own loading state
      // until this resolves.
      //
      // Wrapping in an IIFE keeps the rest of loadSlaData free of the heavy
      // wait. Errors are swallowed (best-effort); the supplier sub-tab will
      // just show empty data if this fails.
      (async () => {
        try {
          const recRes = await fetch(rtRecordsUrl);
          if (!recRes.ok) return;
          const recJson = await recRes.json();
          const records = recJson?.records || [];

          // Fetch conversation metadata for subjects and assignees
      const convoIds = Array.from(new Set(records.map((r: any) => r.conversation_id).filter(Boolean)));
      const convoMeta: Record<string, { subject: string; assignee_id: string | null }> = {};
      if (convoIds.length > 0) {
        // Batch 32: fetch chunks in parallel rather than serially. With ~7 chunks
        // of 200ms each, serial fetching cost ~1.4s. In parallel it's ~200ms total.
        const chunks: string[][] = [];
        for (let ci = 0; ci < convoIds.length; ci += 200) {
          chunks.push(convoIds.slice(ci, ci + 200) as string[]);
        }
        const results = await Promise.all(
          chunks.map((chunk) =>
            getSupabase()
              .from("conversations")
              .select("id, subject, assignee_id")
              .in("id", chunk)
              .then(({ data }) => data || [])
          )
        );
        for (const convos of results) {
          for (const c of convos) convoMeta[c.id] = { subject: c.subject, assignee_id: c.assignee_id };
        }
      }

      // Batch 10: fetch stored responsiveness scores from supplier_contacts.
      // Cron /api/cron/score-suppliers populates these every 6h.
      const scoreByEmail: Record<string, { score: number; tier: string; qualifying_exchanges: number; weighted_median_minutes: number | null; recent_median_minutes: number | null; all_time_median_minutes: number | null }> = {};
      try {
        const { data: scoredContacts } = await getSupabase()
          .from("supplier_contacts")
          .select("email, responsiveness_score, responsiveness_tier, qualifying_exchanges, weighted_median_minutes, recent_median_minutes, all_time_median_minutes")
          .not("responsiveness_score", "is", null);
        for (const sc of (scoredContacts || [])) {
          if (!sc.email) continue;
          scoreByEmail[String(sc.email).toLowerCase()] = {
            score: sc.responsiveness_score,
            tier: sc.responsiveness_tier,
            qualifying_exchanges: sc.qualifying_exchanges ?? 0,
            weighted_median_minutes: sc.weighted_median_minutes,
            recent_median_minutes: sc.recent_median_minutes,
            all_time_median_minutes: sc.all_time_median_minutes,
          };
        }
      } catch (_e) { /* non-critical — chip just won't show */ }

      // Helper: median of a number array (lower-mid, matches scoring lib)
      const medianMins = (arr: number[]): number | null => {
        if (arr.length === 0) return null;
        const s = arr.slice().sort((a, b) => a - b);
        return s[Math.floor(s.length / 2)];
      };

      // Aggregate suppliers (with assignee tracking and subjects)
      const suppMap: Record<string, { email: string; domain: string; supplier_replies: number[]; team_replies: number[]; accounts: Set<string>; assignees: Set<string>; subjects: Set<string> }> = {};
      for (const r of records) {
        if (!r.supplier_email) continue;
        if (!suppMap[r.supplier_email]) suppMap[r.supplier_email] = { email: r.supplier_email, domain: r.supplier_domain || "", supplier_replies: [], team_replies: [], accounts: new Set(), assignees: new Set(), subjects: new Set() };
        if (r.direction === "supplier_reply") suppMap[r.supplier_email].supplier_replies.push(r.response_minutes);
        else suppMap[r.supplier_email].team_replies.push(r.response_minutes);
        if (r.email_account_id) suppMap[r.supplier_email].accounts.add(r.email_account_id);
        // Track assignees and subjects from conversation metadata
        const cm = convoMeta[r.conversation_id];
        if (cm?.assignee_id) suppMap[r.supplier_email].assignees.add(cm.assignee_id);
        if (cm?.subject) suppMap[r.supplier_email].subjects.add(cm.subject);
      }
      const suppList = Object.values(suppMap).map(s => {
        const stored = scoreByEmail[s.email.toLowerCase()] || null;
        // Prefer stored weighted_median (from cron) when present and date filters are not narrowing the data;
        // otherwise compute median from records currently loaded.
        const recordsMedian = medianMins(s.supplier_replies);
        const supplier_median = stored && stored.weighted_median_minutes !== null && !effectiveDateFrom && !effectiveDateTo
          ? stored.weighted_median_minutes
          : recordsMedian;
        return {
          ...s,
          accounts: Array.from(s.accounts),
          assignee_ids: Array.from(s.assignees),
          subjects: Array.from(s.subjects),
          supplier_avg: s.supplier_replies.length > 0 ? Math.round(s.supplier_replies.reduce((a, b) => a + b, 0) / s.supplier_replies.length) : null,
          team_avg: s.team_replies.length > 0 ? Math.round(s.team_replies.reduce((a, b) => a + b, 0) / s.team_replies.length) : null,
          supplier_median,
          team_median: medianMins(s.team_replies),
          total: s.supplier_replies.length + s.team_replies.length,
          tier_score: stored?.score ?? null,
          tier: stored?.tier ?? null,
          tier_qualifying_exchanges: stored?.qualifying_exchanges ?? null,
        };
      }).sort((a, b) => {
        // Sort: tier desc (excellent first), then total desc
        const aScore = a.tier_score ?? -1;
        const bScore = b.tier_score ?? -1;
        if (bScore !== aScore) return bScore - aScore;
        return b.total - a.total;
      });
      setSupplierRtData(suppList);

      // Aggregate user response times — handled by /api/response-times/by-user
      // earlier in this function. We don't need to re-aggregate from records
      // here. The supplier breakdown is loaded lazily when the user expands
      // a row in the dashboard (see loadUserSuppliers).
      //
      // NOTE: The old block built `userRtData` with per-supplier breakdowns
      // inline. That worked but forced us to fetch every response_times row
      // and join with conversation metadata up front, which made the SLA
      // tab slow. The new flow shows the per-user table immediately and
      // only fetches supplier details when a row is expanded.
        } catch (e: any) {
          // Background records fetch failed — non-fatal. The per-user table
          // is already shown. Supplier sub-tab will show empty data.
          console.error("[loadSlaData] background records fetch failed:", e?.message);
        } finally {
          setSlaRecordsLoading(false);
        }
      })(); // end of background IIFE — fire-and-forget, NOT awaited

    } catch (_e) {
      console.error("Failed to load SLA metrics");
    } finally {
      setSlaLoading(false);
      // NOTE: setSlaRecordsLoading(false) is called inside the IIFE when
      // user data arrives, and again in the IIFE's finally for safety.
    }
  }

  // Lazy-load the per-supplier breakdown for a single user. Called when the
  // user clicks to expand a row in the Response Times by User table. We cache
  // results on the userRtData row itself (suppliers array) so subsequent
  // expansions don't refetch.
  const [loadingSuppliersFor, setLoadingSuppliersFor] = useState<string | null>(null);
  async function loadUserSuppliers(userId: string) {
    // If we already have suppliers cached for this user, no-op
    const existing = userRtData.find((u: any) => u.user_id === userId);
    if (existing && existing.suppliers && existing.suppliers.length > 0) return;
    if (loadingSuppliersFor === userId) return;
    setLoadingSuppliersFor(userId);
    try {
      const params = new URLSearchParams();
      if (effectiveDateFrom) params.set("date_from", effectiveDateFrom);
      if (effectiveDateTo) params.set("date_to", effectiveDateTo);
      const url = `/api/response-times/by-user/${userId}/suppliers` + (params.toString() ? "?" + params.toString() : "");
      const res = await fetch(url);
      if (!res.ok) return;
      const json = await res.json();
      setUserRtData((prev: any[]) =>
        prev.map((u: any) =>
          u.user_id === userId ? { ...u, suppliers: json.suppliers || [] } : u
        )
      );
    } catch (e) {
      console.error("Failed to load supplier breakdown:", e);
    } finally {
      setLoadingSuppliersFor(null);
    }
  }

  // Reload user detail when dates change
  useEffect(() => {
    if (selectedUserId && viewMode === "user-detail") {
      loadUserDetail(selectedUserId);
    }
  }, [dateFrom, dateTo]);

  const effectiveDateFrom = dateFrom || null;
  const effectiveDateTo = dateTo ? dateTo + "T23:59:59.999Z" : null;

  async function loadDashboardData() {
    setLoading(true);

    const { data: members } = await getSupabase()
      .from("team_members")
      .select("id, name, email, initials, color, role, department")
      .eq("is_active", true)
      .order("name");

    // Fetch email accounts for filters
    const { data: accts } = await getSupabase().from("email_accounts").select("id, name, email").eq("is_active", true);
    setEmailAccounts(accts || []);

    // Tasks query with optional date filter
    let tasksQuery = getSupabase()
      .from("tasks")
      .select("id, text, due_date, due_time, status, is_done, dismiss_reason, created_at, conversation_id, category_id, conversation:conversations(id, subject), task_assignees(team_member_id, is_done, status, team_member:team_members(name, initials, color)), category:task_categories(name, color)")
      .order("due_date", { ascending: true });

    if (effectiveDateFrom) tasksQuery = tasksQuery.gte("created_at", effectiveDateFrom);
    if (effectiveDateTo) tasksQuery = tasksQuery.lte("created_at", effectiveDateTo);

    const { data: tasks } = await tasksQuery;

    // Conversations — paginate to get ALL (Supabase caps at 1000 rows per request)
    let conversations: any[] = [];
    let convoOffset = 0;
    const CONVO_PAGE = 999;
    while (true) {
      let convosQuery = getSupabase().from("conversations").select("id, assignee_id, is_unread, status, email_account_id").neq("status", "trash").range(convoOffset, convoOffset + CONVO_PAGE - 1);
      if (effectiveDateFrom) convosQuery = convosQuery.gte("last_message_at", effectiveDateFrom);
      if (effectiveDateTo) convosQuery = convosQuery.lte("last_message_at", effectiveDateTo);
      const { data: batch } = await convosQuery;
      if (!batch || batch.length === 0) break;
      conversations = conversations.concat(batch);
      if (batch.length < CONVO_PAGE) break; // last page
      convoOffset += CONVO_PAGE;
    }
    console.log(`[dashboard-debug] Paginated conversations: ${conversations.length} total (${Math.ceil(conversations.length / CONVO_PAGE)} pages)`);

    // Sent emails — count by sent_by_user_id (most accurate), fallback to account_access
    let outboundQuery = getSupabase()
      .from("messages")
      .select("id, conversation_id, sent_at, sent_by_user_id")
      .eq("is_outbound", true);
    if (effectiveDateFrom) outboundQuery = outboundQuery.gte("sent_at", effectiveDateFrom);
    if (effectiveDateTo) outboundQuery = outboundQuery.lte("sent_at", effectiveDateTo);
    const { data: outboundMessages } = await outboundQuery;

    // Map conversation_id -> email_account_id for fallback attribution
    const convoToAccount: Record<string, string> = {};
    for (const c of (conversations || [])) {
      if ((c as any).email_account_id) convoToAccount[c.id] = (c as any).email_account_id;
    }

    // Get account_access for fallback
    const { data: accessData } = await getSupabase().from("account_access").select("team_member_id, email_account_id");
    const accountToUsers: Record<string, string[]> = {};
    for (const row of (accessData || [])) {
      if (!accountToUsers[row.email_account_id]) accountToUsers[row.email_account_id] = [];
      accountToUsers[row.email_account_id].push(row.team_member_id);
    }

    // Count sent per user
    const sentByUser: Record<string, number> = {};
    const unattributed: Record<string, number> = {}; // per account, for messages without sent_by_user_id

    for (const msg of (outboundMessages || [])) {
      if (msg.sent_by_user_id) {
        // Attributed to a specific user
        sentByUser[msg.sent_by_user_id] = (sentByUser[msg.sent_by_user_id] || 0) + 1;
      } else {
        // Unattributed — count per account for fallback display
        const accId = convoToAccount[msg.conversation_id];
        if (accId) unattributed[accId] = (unattributed[accId] || 0) + 1;
      }
    }

    const now = new Date();
    const in48Hours = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const stats: UserStats[] = (members || []).map((member) => {
      const memberTasks = (tasks || []).filter((t: any) =>
        (t.task_assignees || []).some((a: any) => a.team_member_id === member.id)
      );
      const getStatus = (task: any) => {
        // Dismissed is a task-level status that overrides per-assignee status
        if (task.status === "dismissed") return "dismissed";
        const a = (task.task_assignees || []).find((a: any) => a.team_member_id === member.id);
        return a?.status || (a?.is_done ? "completed" : "todo");
      };
      const todo = memberTasks.filter((t: any) => getStatus(t) === "todo").length;
      const inProgress = memberTasks.filter((t: any) => getStatus(t) === "in_progress").length;
      const completed = memberTasks.filter((t: any) => getStatus(t) === "completed").length;
      const dismissed = memberTasks.filter((t: any) => getStatus(t) === "dismissed").length;
      const overdue = memberTasks.filter((t: any) => getStatus(t) !== "completed" && getStatus(t) !== "dismissed" && t.due_date && new Date(t.due_date) < now).length;
      const dueSoon = memberTasks.filter((t: any) => {
        const s = getStatus(t);
        if (s === "completed" || s === "dismissed" || !t.due_date) return false;
        const d = new Date(t.due_date);
        return d >= now && d <= in48Hours;
      }).length;

      const assignedConvos = (conversations || []).filter((c: any) => c.assignee_id === member.id);
      const unreadCount = assignedConvos.filter((c: any) => c.is_unread).length;

      // Debug log for Rod
      if (member.email === "rod@trytenkara.com") {
        console.log(`[dashboard-debug] Rod: ${conversations.length} total convos loaded, ${assignedConvos.length} assigned, ${unreadCount} unread`);
      }

      // Sent count: attributed (sent_by_user_id) + share of unattributed from accessible accounts
      const attributedSent = sentByUser[member.id] || 0;
      const sentCount = attributedSent;

      return {
        id: member.id, name: member.name, email: member.email,
        initials: member.initials || member.name?.slice(0, 2).toUpperCase(),
        color: member.color || "var(--accent)", role: member.role,
        department: member.department || "Uncategorized",
        tasks: { total: memberTasks.length, todo, in_progress: inProgress, completed, dismissed, overdue, dueSoon },
        conversations: { assigned: assignedConvos.length, unread: assignedConvos.filter((c: any) => c.is_unread).length },
        sentEmails: sentCount,
      };
    });

    const mapTask = (t: any): TaskDetail => ({
      id: t.id, text: t.text, due_date: t.due_date, due_time: t.due_time,
      status: t.status || "todo", dismiss_reason: t.dismiss_reason || null, created_at: t.created_at,
      conversation_subject: t.conversation?.subject || "Unknown",
      conversation_id: t.conversation?.id || t.conversation_id,
      assignees: (t.task_assignees || []).map((a: any) => ({
        name: a.team_member?.name || "Unknown", initials: a.team_member?.initials || "?",
        color: a.team_member?.color || "var(--text-secondary)", is_done: a.is_done,
        status: a.status || (a.is_done ? "completed" : "todo"),
      })),
      category_name: t.category?.name || null, category_color: t.category?.color || null,
    });

    const critical = (tasks || [])
      .filter((t: any) => !t.is_done && t.status !== "completed" && t.status !== "dismissed" && !(t.task_assignees || []).every((a: any) => a.is_done) && t.due_date && new Date(t.due_date) <= in48Hours)
      .map(mapTask).sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));

    const all = (tasks || [])
      .filter((t: any) => !(t.task_assignees || []).every((a: any) => a.is_done) && t.status !== "completed" && t.status !== "dismissed" && !t.is_done)
      .map(mapTask).sort((a, b) => (a.due_date || "z").localeCompare(b.due_date || "z"));

    setUserStats(stats);
    setCriticalTasks(critical);
    setAllTasks(all);
    setLoading(false);
  }

  async function loadUserDetail(userId: string) {
    setSelectedUserId(userId);
    setViewMode("user-detail");
    setUserDetailTab("tasks");
    setUserDetailLoading(true);

    const user = userStats.find((u) => u.id === userId);

    // Fetch user's tasks WITH date filter
    let tasksQuery = getSupabase()
      .from("task_assignees")
      .select("task_id, is_done, status, task:tasks(id, text, due_date, due_time, status, is_done, dismiss_reason, created_at, conversation_id, conversation:conversations(id, subject), task_assignees(team_member_id, is_done, status, team_member:team_members(name, initials, color)), category:task_categories(name, color))")
      .eq("team_member_id", userId);

    const { data: assigneeRows } = await tasksQuery;

    let uTasks: TaskDetail[] = (assigneeRows || [])
      .filter((r: any) => r.task)
      .map((r: any) => {
        const t = r.task;
        // Dismissed is task-level, overrides per-assignee status
        const taskStatus = t.status === "dismissed" ? "dismissed" : (r.status || (r.is_done ? "completed" : "todo"));
        return {
          id: t.id, text: t.text, due_date: t.due_date, due_time: t.due_time,
          status: taskStatus, dismiss_reason: t.dismiss_reason || null, created_at: t.created_at,
          conversation_subject: t.conversation?.subject || "Unknown",
          conversation_id: t.conversation?.id || t.conversation_id,
          assignees: (t.task_assignees || []).map((a: any) => ({
            name: a.team_member?.name || "Unknown", initials: a.team_member?.initials || "?",
            color: a.team_member?.color || "var(--text-secondary)", is_done: a.is_done,
            status: a.status || (a.is_done ? "completed" : "todo"),
          })),
          category_name: t.category?.name || null, category_color: t.category?.color || null,
        };
      })
      .sort((a: TaskDetail, b: TaskDetail) => (a.due_date || "z").localeCompare(b.due_date || "z"));

    // Apply date filter on tasks
    if (effectiveDateFrom) {
      uTasks = uTasks.filter((t) => t.created_at >= effectiveDateFrom!);
    }
    if (effectiveDateTo) {
      uTasks = uTasks.filter((t) => t.created_at <= effectiveDateTo!);
    }

    // Fetch user's assigned conversations WITH date filter
    let convosQuery = getSupabase()
      .from("conversations")
      .select("id, subject, from_name, from_email, preview, status, is_unread, last_message_at, assignee_id, email_account_id, folder_id, email_account:email_accounts(name), folder:folders(name)")
      .eq("assignee_id", userId)
      .neq("status", "trash")
      .order("last_message_at", { ascending: false })
      .limit(50);

    if (effectiveDateFrom) convosQuery = convosQuery.gte("last_message_at", effectiveDateFrom);
    if (effectiveDateTo) convosQuery = convosQuery.lte("last_message_at", effectiveDateTo);

    const { data: convos } = await convosQuery;

    // Fetch last message per conversation to determine reply status
    const convoIds = (convos || []).map((c: any) => c.id);
    let lastMsgMap: Record<string, { is_outbound: boolean; sent_at: string }> = {};
    if (convoIds.length > 0) {
      for (let i = 0; i < convoIds.length; i += 50) {
        const batch = convoIds.slice(i, i + 50);
        const { data: msgs } = await getSupabase()
          .from("messages")
          .select("conversation_id, is_outbound, sent_at")
          .in("conversation_id", batch)
          .order("sent_at", { ascending: false });
        // Keep only the latest message per conversation
        for (const msg of (msgs || [])) {
          if (!lastMsgMap[msg.conversation_id]) {
            lastMsgMap[msg.conversation_id] = { is_outbound: msg.is_outbound, sent_at: msg.sent_at };
          }
        }
      }
    }

    const now = new Date();
    const uConvos: ConversationDetail[] = (convos || []).map((c: any) => {
      const lastMsg = lastMsgMap[c.id];
      let replyStatus: ConversationDetail["reply_status"] = "unknown";
      let waitingHours = 0;

      if (c.from_email === "internal") {
        replyStatus = "internal";
      } else if (lastMsg) {
        const msgTime = new Date(lastMsg.sent_at);
        waitingHours = Math.round((now.getTime() - msgTime.getTime()) / (1000 * 60 * 60) * 10) / 10;
        replyStatus = lastMsg.is_outbound ? "awaiting_supplier_reply" : "awaiting_our_reply";
      }

      return {
        id: c.id, subject: c.subject, from_name: c.from_name, from_email: c.from_email,
        preview: c.preview || "", status: c.status, is_unread: c.is_unread,
        last_message_at: c.last_message_at, assignee_id: c.assignee_id,
        email_account_name: c.email_account?.name || "", folder_name: c.folder?.name || null,
        reply_status: replyStatus, waiting_hours: waitingHours,
      };
    });

    // Fetch sent emails — filter by sent_by_user_id for accurate per-user tracking
    let sentQuery = getSupabase()
      .from("messages")
      .select("id, subject, to_addresses, sent_at, conversation_id, from_email, sent_by_user_id")
      .eq("is_outbound", true)
      .eq("sent_by_user_id", userId)
      .order("sent_at", { ascending: false })
      .limit(100);

    if (effectiveDateFrom) sentQuery = sentQuery.gte("sent_at", effectiveDateFrom);
    if (effectiveDateTo) sentQuery = sentQuery.lte("sent_at", effectiveDateTo);

    const { data: sentMsgs } = await sentQuery;

    const uSent: SentEmail[] = (sentMsgs || []).map((msg: any) => ({
      id: msg.id,
      subject: msg.subject || "Unknown",
      to_addresses: msg.to_addresses || "",
      sent_at: msg.sent_at,
      conversation_id: msg.conversation_id,
      from_email: msg.from_email || "",
    }));

    setUserTasks(uTasks);
    setUserConversations(uConvos);
    setUserSentEmails(uSent);
    setUserDetailLoading(false);
  }

  const totals = useMemo(() => {
    return userStats.reduce((acc, u) => ({
      totalTasks: acc.totalTasks + u.tasks.total,
      todo: acc.todo + u.tasks.todo,
      inProgress: acc.inProgress + u.tasks.in_progress,
      completed: acc.completed + u.tasks.completed,
      overdue: acc.overdue + u.tasks.overdue,
      dueSoon: acc.dueSoon + u.tasks.dueSoon,
      totalConvos: acc.totalConvos + u.conversations.assigned,
      unreadConvos: acc.unreadConvos + u.conversations.unread,
      totalSent: acc.totalSent + u.sentEmails,
    }), { totalTasks: 0, todo: 0, inProgress: 0, completed: 0, overdue: 0, dueSoon: 0, totalConvos: 0, unreadConvos: 0, totalSent: 0 });
  }, [userStats]);

  const filteredAllTasks = useMemo(() => {
    let filtered = allTasks;
    if (taskFilterUser) {
      filtered = filtered.filter((t) => t.assignees.some((a) => a.name === userStats.find((u) => u.id === taskFilterUser)?.name));
    }
    if (dashTaskSearch.trim()) {
      const q = dashTaskSearch.toLowerCase();
      filtered = filtered.filter((t) =>
        t.text.toLowerCase().includes(q) ||
        t.conversation_subject.toLowerCase().includes(q) ||
        t.assignees.some((a) => a.name.toLowerCase().includes(q)) ||
        (t.category_name || "").toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allTasks, taskFilterUser, dashTaskSearch, userStats]);

  const selectedUser = userStats.find((u) => u.id === selectedUserId);

  // Loader for the Removals audit tab. Builds query params from current
  // filter state and hits /api/admin/task-removals (admin-gated).
  const loadRemovals = useCallback(async () => {
    const myId = (session as any)?.teamMember?.id;
    if (!myId) return;
    setRemovalsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("actor_id", myId);
      // Date window — translate the preset into a "since" param.
      const now = new Date();
      if (removalsWindow !== "all") {
        const days = removalsWindow === "7d" ? 7 : removalsWindow === "30d" ? 30 : 90;
        const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
        params.set("since", since.toISOString());
      }
      if (removalsUserFilter) params.set("removed_by", removalsUserFilter);
      if (removalsSoleOnly) params.set("sole_only", "true");
      const res = await fetch(`/api/admin/task-removals?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setRemovals(json.rows || []);
        setRemovalSummary(json.summary || null);
      } else {
        console.error("Failed to load removals:", json?.error);
        setRemovals([]);
        setRemovalSummary(null);
      }
    } catch (e) {
      console.error("loadRemovals error:", e);
      setRemovals([]);
      setRemovalSummary(null);
    } finally {
      setRemovalsLoading(false);
    }
  }, [session, removalsWindow, removalsUserFilter, removalsSoleOnly]);

  // Refetch whenever filters change while on the Removals tab.
  useEffect(() => {
    if (viewMode === "removals") loadRemovals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, removalsWindow, removalsUserFilter, removalsSoleOnly]);

  // Client-side search filter on top of server-fetched rows.
  const filteredRemovals = useMemo(() => {
    const q = removalsSearch.trim().toLowerCase();
    if (!q) return removals;
    return removals.filter((r: any) =>
      (r.reason || "").toLowerCase().includes(q) ||
      (r.task_text || "").toLowerCase().includes(q) ||
      (r.remover?.name || "").toLowerCase().includes(q)
    );
  }, [removals, removalsSearch]);

  if (status === "loading" || loading) {
    return <div className="h-screen w-screen flex items-center justify-center bg-[var(--bg)]"><Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" /></div>;
  }
  if (!session) redirect("/login");
  if ((session as any)?.teamMember?.role !== "admin") redirect("/");

  function handleDatePreset(preset: string) {
    setDatePreset(preset);
    if (preset === "all") { setDateFrom(""); setDateTo(""); return; }
    if (preset === "custom") return;
    const { from, to } = getPresetDates(preset);
    setDateFrom(from);
    setDateTo(to);
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-[var(--bg)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="border-b border-[var(--border)] px-6 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><ArrowLeft size={18} /></Link>
          <div>
            <h1 className="text-2xl font-normal font-serif tracking-tight">Team Dashboard</h1>
            <p className="text-[10px] text-[var(--text-muted)]">Performance overview &amp; task monitoring</p>
          </div>
        </div>

        {/* Date Filter — Dropdown */}
        <div className="flex items-center gap-2">
          <CalendarClock size={14} className="text-[var(--text-muted)]" />
          <select
            value={datePreset}
            onChange={(e) => handleDatePreset(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="this_week">This Week</option>
            <option value="last_week">Last Week</option>
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="custom">Custom Range</option>
          </select>
          {datePreset === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                className="px-2 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
              <span className="text-[var(--text-muted)] text-[10px]">to</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                className="px-2 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" />
            </div>
          )}
        </div>
      </div>

      {/* View Tabs */}
      <div className="border-b border-[var(--border)] px-6 py-1.5 flex items-center gap-1 flex-shrink-0">
        {([
          { id: "overview", label: "Team Overview" },
          { id: "critical", label: "Critical Tasks (" + criticalTasks.length + ")" },
          { id: "all-tasks", label: "All Tasks (" + allTasks.length + ")" },
          { id: "sla", label: "SLA / Response Times" },
          { id: "calls", label: "Calls" },
          { id: "removals", label: "Removals" },
          { id: "offboarded", label: "Offboarded Users" },
          { id: "export", label: "Export Data" },
        ] as { id: ViewMode; label: string }[]).map((tab) => (
          <button key={tab.id} onClick={() => { setViewMode(tab.id); setSelectedUserId(null); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              viewMode === tab.id ? "bg-[var(--border)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
          >{tab.label}</button>
        ))}
        {viewMode === "user-detail" && selectedUser && (
          <div className="flex items-center gap-2 ml-2 px-3 py-1.5 rounded-lg bg-[var(--border)]">
            <div className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-[var(--bg)]" style={{ background: selectedUser.color }}>{selectedUser.initials}</div>
            <span className="text-xs font-medium">{selectedUser.name}</span>
            <button onClick={() => setViewMode("overview")} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={12} /></button>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="px-6 py-3 grid grid-cols-6 gap-3 flex-shrink-0">
        <SummaryCard icon={<Users size={14} />} label="Team Members" value={userStats.length} color="var(--text-muted)" />
        <SummaryCard icon={<ListTodo size={14} />} label="Open Tasks" value={totals.todo + totals.inProgress} sub={totals.completed + " completed"} color="var(--text-muted)" />
        <SummaryCard icon={<AlertTriangle size={14} />} label="Overdue" value={totals.overdue} sub={totals.dueSoon + " due within 48h"} color="var(--danger)" />
        <SummaryCard icon={<Mail size={14} />} label="Assigned Emails" value={totals.totalConvos} sub={totals.unreadConvos + " unread"} color="var(--text-muted)" />
        <SummaryCard icon={<Eye size={14} />} label="Total Unread" value={totals.unreadConvos} color="var(--warning)" />
        <SummaryCard icon={<Send size={14} />} label="Emails Sent" value={totals.totalSent} color="var(--accent)" />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 pb-6">

        {/* ── TEAM OVERVIEW ─── */}
        {viewMode === "overview" && (
          <div className="space-y-1">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
              <span>Team Member</span><span className="text-center">To Do</span><span className="text-center">In Progress</span>
              <span className="text-center">Completed</span><span className="text-center">Dismissed</span><span className="text-center">Overdue</span>
              <span className="text-center">Due Soon</span><span className="text-center">Emails</span><span className="text-center">Sent</span>
            </div>
            {userStats.map((user) => (
              <button key={user.id} onClick={() => loadUserDetail(user.id)}
                className={`w-full grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 rounded-xl border bg-[var(--surface)] hover:border-[var(--accent)]/30 transition-all items-center text-left ${
                  user.conversations.unread >= 5 ? "border-[var(--danger)]/30" : "border-[var(--border)]"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="relative">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-[var(--bg)] flex-shrink-0" style={{ background: user.color }}>{user.initials}</div>
                    {user.conversations.unread >= 5 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[var(--danger)] text-[7px] font-bold text-white flex items-center justify-center border border-[var(--surface)]">{user.conversations.unread > 99 ? "99" : user.conversations.unread}</span>
                    )}
                  </div>
                  <div>
                    <div className="text-[13px] font-semibold">{user.name}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{user.department}</div>
                    {user.conversations.unread >= 5 && (
                      <div className="text-[9px] font-semibold text-[var(--danger)] mt-0.5">{user.conversations.unread} unread emails need attention</div>
                    )}
                  </div>
                </div>
                <div className="text-center text-sm font-semibold text-[var(--info)]">{user.tasks.todo}</div>
                <div className="text-center text-sm font-semibold text-[var(--highlight)]">{user.tasks.in_progress}</div>
                <div className="text-center text-sm font-semibold text-[var(--accent)]">{user.tasks.completed}</div>
                <div className="text-center text-sm font-semibold text-[var(--warning)]">{user.tasks.dismissed}</div>
                <div className="text-center text-sm font-semibold" style={{ color: user.tasks.overdue > 0 ? "var(--danger)" : "var(--text-muted)" }}>{user.tasks.overdue}</div>
                <div className="text-center text-sm font-semibold" style={{ color: user.tasks.dueSoon > 0 ? "var(--warning)" : "var(--text-muted)" }}>{user.tasks.dueSoon}</div>
                <div className="text-center"><span className="text-sm font-semibold">{user.conversations.assigned}</span>{user.conversations.unread > 0 && <span className="ml-1 text-[10px] text-[var(--warning)]">({user.conversations.unread})</span>}</div>
                <div className="text-center text-sm font-semibold text-[var(--accent)]">{user.sentEmails}</div>
              </button>
            ))}
            {/* Quick-glance Calls widget — recent calls + active follow-ups */}
            <CallsOverviewWidget onOpenCallsTab={() => setViewMode("calls")} />
          </div>
        )}

        {/* ── CRITICAL TASKS ─── */}
        {viewMode === "critical" && (
          <div className="space-y-2">
            <div className="text-sm text-[var(--danger)] font-semibold mb-3 flex items-center gap-2"><AlertTriangle size={16} /> Overdue or due within 48 hours</div>
            {criticalTasks.length === 0 ? <Empty text="No critical tasks" /> : criticalTasks.map((t) => <TaskRow key={t.id} task={t} />)}
          </div>
        )}

        {/* ── ALL TASKS ─── */}
        {viewMode === "all-tasks" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs text-[var(--text-muted)]">Filter:</span>
              <FilterPill active={!taskFilterUser} onClick={() => setTaskFilterUser(null)} label={"All (" + allTasks.length + ")"} />
              {userStats.map((u) => (
                <FilterPill key={u.id} active={taskFilterUser === u.id} onClick={() => setTaskFilterUser(taskFilterUser === u.id ? null : u.id)}
                  label={u.name.split(" ")[0]} avatar={{ initials: u.initials, color: u.color }} />
              ))}
              <div className="ml-auto relative">
                <input
                  value={dashTaskSearch}
                  onChange={(e) => setDashTaskSearch(e.target.value)}
                  placeholder="Search tasks..."
                  className="w-56 pl-3 pr-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                />
              </div>
            </div>
            {filteredAllTasks.length === 0 ? <Empty text="No open tasks" /> : filteredAllTasks.map((t) => <TaskRow key={t.id} task={t} />)}
          </div>
        )}

        {/* ── USER DETAIL ─── */}
        {viewMode === "user-detail" && selectedUser && (
          <div>
            {/* User header */}
            <div className="flex items-center gap-4 mb-4 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <div className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-[var(--bg)]" style={{ background: selectedUser.color }}>{selectedUser.initials}</div>
              <div className="flex-1">
                <div className="text-lg font-bold">{selectedUser.name}</div>
                <div className="text-xs text-[var(--text-muted)]">{selectedUser.email} · {selectedUser.department} · {selectedUser.role}</div>
              </div>
              <div className="grid grid-cols-7 gap-4 text-center">
                <div><div className="text-xl font-bold text-[var(--info)]">{selectedUser.tasks.todo + selectedUser.tasks.in_progress}</div><div className="text-[10px] text-[var(--text-muted)]">Open Tasks</div></div>
                <div><div className="text-xl font-bold text-[var(--accent)]">{selectedUser.tasks.completed}</div><div className="text-[10px] text-[var(--text-muted)]">Completed</div></div>
                <div><div className="text-xl font-bold text-[var(--warning)]">{selectedUser.tasks.dismissed}</div><div className="text-[10px] text-[var(--text-muted)]">Dismissed</div></div>
                <div><div className="text-xl font-bold" style={{ color: selectedUser.tasks.overdue > 0 ? "var(--danger)" : "var(--text-muted)" }}>{selectedUser.tasks.overdue}</div><div className="text-[10px] text-[var(--text-muted)]">Overdue</div></div>
                <div><div className="text-xl font-bold text-[var(--accent)]">{selectedUser.sentEmails}</div><div className="text-[10px] text-[var(--text-muted)]">Sent</div></div>
                <div><div className="text-xl font-bold text-[var(--warning)]">{selectedUser.conversations.unread}</div><div className="text-[10px] text-[var(--text-muted)]">Unread</div></div>
                <div><div className="text-xl font-bold text-[var(--danger)]">{userConversations.filter((c) => c.reply_status === "awaiting_our_reply").length}</div><div className="text-[10px] text-[var(--text-muted)]">Need Reply</div></div>
                <div><div className="text-xl font-bold text-[var(--warning)]">{userConversations.filter((c) => c.reply_status === "awaiting_supplier_reply").length}</div><div className="text-[10px] text-[var(--text-muted)]">Waiting Supplier</div></div>
              </div>
            </div>

            {/* Completed tasks by category breakdown */}
            {(() => {
              const completedTasks = userTasks.filter((t) => t.status === "completed");
              if (completedTasks.length === 0) return null;
              const byCategory: Record<string, { count: number; color: string }> = {};
              for (const t of completedTasks) {
                const cat = t.category_name || "Uncategorized";
                if (!byCategory[cat]) byCategory[cat] = { count: 0, color: t.category_color || "var(--text-secondary)" };
                byCategory[cat].count++;
              }
              const sorted = Object.entries(byCategory).sort((a, b) => b[1].count - a[1].count);
              return (
                <div className="mb-4 p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                  <div className="text-xs font-semibold text-[var(--text-secondary)] mb-3 flex items-center gap-2">
                    <CheckCircle2 size={13} className="text-[var(--accent)]" />
                    Completed Tasks by Category ({completedTasks.length} total)
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {sorted.map(([cat, data]) => (
                      <div key={cat} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: data.color }} />
                        <span className="text-xs text-[var(--text-primary)] font-medium">{cat}</span>
                        <span className="text-sm font-bold" style={{ color: data.color }}>{data.count}</span>
                      </div>
                    ))}
                  </div>
                  {/* Progress bar */}
                  <div className="mt-3 flex h-2 rounded-full overflow-hidden bg-[var(--border)]">
                    {sorted.map(([cat, data]) => (
                      <div key={cat} title={`${cat}: ${data.count}`} style={{ width: `${(data.count / completedTasks.length) * 100}%`, background: data.color }} />
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Sub-tabs */}
            <div className="flex items-center gap-1 mb-3">
              {([
                { id: "tasks" as const, label: "Tasks (" + userTasks.length + ")", icon: <ListTodo size={13} /> },
                { id: "emails" as const, label: "Assigned Emails (" + userConversations.length + ")", icon: <Inbox size={13} /> },
                { id: "unread" as const, label: "Unread (" + userConversations.filter((c) => c.is_unread).length + ")", icon: <Eye size={13} /> },
                { id: "sent" as const, label: "Sent (" + userSentEmails.length + ")", icon: <Send size={13} /> },
              ]).map((tab) => (
                <button key={tab.id} onClick={() => setUserDetailTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    userDetailTab === tab.id ? "bg-[var(--border)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  }`}
                >{tab.icon} {tab.label}</button>
              ))}
            </div>

            {userDetailLoading ? (
              <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin text-[var(--accent)] mx-auto" /></div>
            ) : (
              <>
                {userDetailTab === "tasks" && (
                  <div className="space-y-2">
                    {userTasks.length === 0 ? <Empty text="No tasks assigned" /> : userTasks.map((t) => <TaskRow key={t.id} task={t} />)}
                  </div>
                )}

                {userDetailTab === "emails" && (
                  <div className="space-y-1">
                    {userConversations.length === 0 ? <Empty text="No assigned conversations" /> : userConversations.map((c) => (
                      <Link key={c.id} href={"/#conversation=" + c.id}
                        className={`flex items-center gap-3 px-4 py-3 rounded-xl border bg-[var(--surface)] hover:border-[var(--info)]/30 transition-all ${
                          c.reply_status === "awaiting_our_reply" && c.waiting_hours > 24 ? "border-[var(--danger)]/30" : "border-[var(--border)]"
                        }`}
                      >
                        {/* Status indicator */}
                        <div className="flex-shrink-0 w-2.5">
                          {c.is_unread ? (
                            <div className="w-2 h-2 rounded-full bg-[var(--info)]" />
                          ) : c.reply_status === "awaiting_our_reply" ? (
                            <div className="w-2 h-2 rounded-full bg-[var(--danger)]" title="Awaiting our reply" />
                          ) : c.reply_status === "awaiting_supplier_reply" ? (
                            <div className="w-2 h-2 rounded-full bg-[var(--warning)]" title="Awaiting supplier reply" />
                          ) : (
                            <div className="w-2 h-2 rounded-full bg-transparent" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium truncate">{c.subject}</div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">{c.from_name} &lt;{c.from_email}&gt;</div>
                        </div>

                        {/* Reply status badge */}
                        <div className="flex-shrink-0">
                          {c.reply_status === "awaiting_our_reply" ? (
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                              c.waiting_hours > 24 ? "bg-[var(--danger)]/15 text-[var(--danger)]" : "bg-[var(--danger)]/10 text-[var(--danger)]"
                            }`}>
                              Needs reply · {formatBusinessTime(c.waiting_hours)}
                            </span>
                          ) : c.reply_status === "awaiting_supplier_reply" ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[var(--warning)]/10 text-[var(--warning)]">
                              Waiting supplier · {formatBusinessTime(c.waiting_hours)}
                            </span>
                          ) : null}
                        </div>

                        <div className="text-[10px] text-[var(--text-muted)] flex-shrink-0">{c.email_account_name}</div>
                        <div className="text-[10px] text-[var(--text-muted)] flex-shrink-0">{new Date(c.last_message_at).toLocaleDateString()}</div>
                        <ExternalLink size={12} className="text-[var(--text-muted)]" />
                      </Link>
                    ))}
                  </div>
                )}

                {userDetailTab === "unread" && (
                  <div className="space-y-1">
                    {userConversations.filter((c) => c.is_unread).length === 0 ? <Empty text="No unread emails" /> : userConversations.filter((c) => c.is_unread).map((c) => (
                      <Link key={c.id} href={"/#conversation=" + c.id}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--warning)]/20 bg-[var(--surface)] hover:border-[var(--warning)]/40 transition-all"
                      >
                        <div className="flex-shrink-0 w-2.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-[var(--warning)]" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-semibold truncate">{c.subject}</div>
                          <div className="text-[11px] text-[var(--text-secondary)] truncate">{c.from_name} &lt;{c.from_email}&gt;</div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{c.preview}</div>
                        </div>
                        <div className="flex flex-col items-end flex-shrink-0 gap-1">
                          <div className="text-[10px] text-[var(--text-muted)]">{c.email_account_name}</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{new Date(c.last_message_at).toLocaleDateString()} {new Date(c.last_message_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                          {c.reply_status === "awaiting_our_reply" && (
                            <span className="text-[9px] font-semibold text-[var(--danger)] bg-[var(--danger)]/10 px-1.5 py-0.5 rounded">Needs reply · {c.waiting_hours < 24 ? Math.round(c.waiting_hours) + "h" : Math.round(c.waiting_hours / 24) + "d"}</span>
                          )}
                        </div>
                        <ExternalLink size={12} className="text-[var(--text-muted)] flex-shrink-0" />
                      </Link>
                    ))}
                  </div>
                )}

                {userDetailTab === "sent" && (
                  <div className="space-y-1">
                    {userSentEmails.length === 0 ? <Empty text="No sent emails in this period" /> : userSentEmails.map((s) => (
                      <Link key={s.id} href={"/#conversation=" + s.conversation_id}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/30 transition-all"
                      >
                        <Send size={14} className="text-[var(--accent)] flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-medium truncate">{s.subject}</div>
                          <div className="text-[11px] text-[var(--text-muted)] truncate">To: {s.to_addresses}</div>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] flex-shrink-0">{s.from_email}</div>
                        <div className="text-[10px] text-[var(--text-muted)] flex-shrink-0">{new Date(s.sent_at).toLocaleDateString()} {new Date(s.sent_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                        <ExternalLink size={12} className="text-[var(--text-muted)]" />
                      </Link>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── SLA / RESPONSE TIMES ─── */}
        {viewMode === "sla" && (
          <div>
            {slaLoading ? (
              <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[var(--accent)] mx-auto" /></div>
            ) : slaData ? (
              <>
                {/* KPI Summary Cards */}
                <div className="grid grid-cols-4 gap-3 mb-4">
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1">Avg Response Time</div>
                    <div className="text-2xl font-bold text-[var(--accent)] font-mono tabular-nums">{formatBusinessTime(slaData.overall.avg_response_hours)}</div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-1">wall-clock</div>
                  </div>
                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="text-[10px] text-[var(--text-muted)] uppercase font-semibold mb-1">Total Responses</div>
                    <div className="text-2xl font-bold text-[var(--text-primary)] font-mono tabular-nums">{slaData.overall.total_responses}</div>
                  </div>
                  <div className="rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/5 p-4">
                    <div className="text-[10px] text-[var(--danger)] uppercase font-semibold mb-1">Awaiting Our Reply</div>
                    <div className="text-2xl font-bold text-[var(--danger)] font-mono tabular-nums">{slaData.overall.awaiting_our_reply ?? "—"}</div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-1">supplier waiting on us</div>
                  </div>
                  <div className="rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/5 p-4">
                    <div className="text-[10px] text-[var(--warning)] uppercase font-semibold mb-1">Awaiting Supplier Reply</div>
                    <div className="text-2xl font-bold text-[var(--warning)] font-mono tabular-nums">{slaData.overall.awaiting_supplier_reply ?? "—"}</div>
                    <div className="text-[10px] text-[var(--text-muted)] mt-1">we sent last message</div>
                  </div>
                </div>

                {/* Sub tabs */}
                <div className="flex items-center gap-1 mb-3">
                  {([
                    { id: "response-times" as const, label: "Response Times by User" },
                    { id: "supplier-responsiveness" as const, label: "Supplier Response Times" },
                    { id: "awaiting-ours" as const, label: "Awaiting Our Reply (" + (slaData.overall.awaiting_our_reply ?? "—") + ")" },
                    { id: "awaiting-supplier" as const, label: "Awaiting Supplier Reply (" + (slaData.overall.awaiting_supplier_reply ?? "—") + ")" },
                  ]).map((t) => (
                    <button key={t.id} onClick={() => setSlaSubTab(t.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        slaSubTab === t.id ? "bg-[var(--border)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                      }`}
                    >{t.label}</button>
                  ))}
                </div>

                {/* Response Times by User (from response_times table) */}
                {slaSubTab === "response-times" && (
                  slaRecordsLoading && userRtData.length === 0 ? (
                    <div className="text-center py-12 text-[var(--text-muted)] text-xs">
                      <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)] mx-auto mb-2" />
                      Loading response time records…
                    </div>
                  ) : (
                  <div className="space-y-1">
                    <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                      <span>Team Member</span><span className="text-center">Avg Response</span><span className="text-center">Fastest</span><span className="text-center">Slowest</span><span className="text-center">Responses</span>
                    </div>
                    {userRtData.map((stat: any) => {
                      const user = userStats.find((u) => u.id === stat.user_id);
                      const fmtM = (m: number | null | undefined): string => {
                        if (m === null || m === undefined) return "—";
                        if (m < 60) return m + "m";
                        if (m < 1440) return Math.round(m / 60 * 10) / 10 + "h";
                        return Math.round(m / 1440 * 10) / 10 + "d";
                      };
                      const isExpanded = expandedUserId === stat.user_id;
                      const hasData = stat.total > 0;
                      const supplierCount = stat.supplier_count ?? stat.suppliers?.length ?? 0;
                      return (
                        <div key={stat.user_id}>
                          <div onClick={() => {
                            const newExpanded = isExpanded ? null : stat.user_id;
                            setExpandedUserId(newExpanded);
                            // Lazy-load supplier breakdown on first expansion.
                            // Skip if user has no data (no suppliers to load).
                            if (newExpanded && hasData) loadUserSuppliers(stat.user_id);
                          }}
                            className={`grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 rounded-xl border items-center cursor-pointer transition-colors ${isExpanded ? "border-[var(--info)]/30 bg-[var(--surface)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--info)]/20"} ${!hasData ? "opacity-60" : ""}`}>
                            <div className="flex items-center gap-3">
                              {user ? (
                                <>
                                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-[var(--bg)]" style={{ background: user.color }}>{user.initials}</div>
                                  <div>
                                    <div className="text-[13px] font-semibold">{user.name}</div>
                                    <div className="text-[10px] text-[var(--text-muted)]">
                                      {user.department}
                                      {hasData ? ` · ${supplierCount} supplier${supplierCount === 1 ? "" : "s"}` : " · no replies in period"}
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div className="text-[13px] text-[var(--text-muted)]">Unassigned</div>
                              )}
                            </div>
                            {hasData ? (
                              <>
                                <div className="text-center text-sm font-semibold" style={{ color: stat.avg_minutes <= 240 ? "var(--accent)" : stat.avg_minutes <= 660 ? "var(--warning)" : "var(--danger)" }}>
                                  {fmtM(stat.avg_minutes)}
                                </div>
                                <div className="text-center text-sm text-[var(--accent)]">{fmtM(stat.fastest_minutes)}</div>
                                <div className="text-center text-sm text-[var(--warning)]">{fmtM(stat.slowest_minutes)}</div>
                                <div className="text-center text-sm text-[var(--text-primary)]">{stat.total}</div>
                              </>
                            ) : (
                              <>
                                <div className="text-center text-sm text-[var(--text-muted)]">—</div>
                                <div className="text-center text-sm text-[var(--text-muted)]">—</div>
                                <div className="text-center text-sm text-[var(--text-muted)]">—</div>
                                <div className="text-center text-sm text-[var(--text-muted)]">0</div>
                              </>
                            )}
                          </div>
                          {/* Expanded: per-supplier breakdown */}
                          {isExpanded && hasData && (
                            <div className="ml-11 mt-1 mb-2 space-y-1">
                              <div className="grid grid-cols-[2fr_1fr_1fr_2fr] gap-3 px-4 py-1.5 text-[9px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                                <span>Supplier</span><span className="text-center">Avg Response</span><span className="text-center">Replies</span><span>Materials / Subjects</span>
                              </div>
                              {loadingSuppliersFor === stat.user_id && (!stat.suppliers || stat.suppliers.length === 0) && (
                                <div className="text-center py-4 text-[11px] text-[var(--text-muted)]">
                                  <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)] mx-auto mb-1" />
                                  Loading supplier breakdown…
                                </div>
                              )}
                              {(stat.suppliers || []).map((sup: any) => {
                                const sc = sup.avg_minutes <= 240 ? "var(--accent)" : sup.avg_minutes <= 660 ? "var(--warning)" : "var(--danger)";
                                return (
                                  <a key={sup.email} href={"/contacts/" + encodeURIComponent(sup.email)}
                                    className="grid grid-cols-[2fr_1fr_1fr_2fr] gap-3 px-4 py-2 rounded-lg border border-[var(--border)]/50 bg-[var(--bg)] items-center hover:border-[var(--info)]/20 transition-colors">
                                    <div className="text-[11px] text-[#C9D1D9] truncate">{sup.email}</div>
                                    <div className="text-center text-[11px] font-semibold" style={{ color: sc }}>{fmtM(sup.avg_minutes)}</div>
                                    <div className="text-center text-[11px] text-[var(--text-secondary)]">{sup.total}</div>
                                    <div className="text-[10px] text-[var(--text-muted)] truncate">{sup.subjects?.slice(0, 2).join("; ") || "—"}{sup.subjects?.length > 2 ? " +" + (sup.subjects.length - 2) + " more" : ""}</div>
                                  </a>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {userRtData.length === 0 && <Empty text="No response data yet" />}
                  </div>
                  )
                )}

                {/* Supplier Response Times */}
                {slaSubTab === "supplier-responsiveness" && (
                  slaRecordsLoading && supplierRtData.length === 0 ? (
                    <div className="text-center py-12 text-[var(--text-muted)] text-xs">
                      <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)] mx-auto mb-2" />
                      Loading supplier response data…
                    </div>
                  ) : (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <select value={rtAccountFilter} onChange={(e) => setRtAccountFilter(e.target.value)}
                        className="px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none">
                        <option value="all">All Accounts</option>
                        {emailAccounts.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <input type="text" placeholder="Search suppliers..." value={supplierSearch} onChange={(e) => setSupplierSearch(e.target.value)}
                        className="px-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none flex-1 max-w-xs" />
                      <span className="text-[10px] text-[var(--text-muted)] ml-auto">
                        {supplierRtData.filter((s: any) => (rtAccountFilter === "all" || s.accounts.includes(rtAccountFilter)) && (!supplierSearch || s.email.toLowerCase().includes(supplierSearch.toLowerCase()) || s.domain.toLowerCase().includes(supplierSearch.toLowerCase()))).length} suppliers
                      </span>
                    </div>
                    <div className="space-y-1">
                      <div className="grid grid-cols-[1fr_2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-2 text-[10px] text-[var(--text-muted)] uppercase tracking-wider font-semibold">
                        <span>Tier</span><span>Supplier</span><span className="text-center">Their Median</span><span className="text-center">Our Median</span><span className="text-center">Exchanges</span><span className="text-center">Assigned To</span><span className="text-center">Domain</span>
                      </div>
                      {supplierRtData
                        .filter((s: any) => rtAccountFilter === "all" || s.accounts.includes(rtAccountFilter))
                        .filter((s: any) => !supplierSearch || s.email.toLowerCase().includes(supplierSearch.toLowerCase()) || s.domain.toLowerCase().includes(supplierSearch.toLowerCase()))
                        .map((s: any) => {
                          const fmtM = (m: number | null) => m === null ? "—" : m < 60 ? m + "m" : m < 1440 ? Math.round(m / 60 * 10) / 10 + "h" : Math.round(m / 1440 * 10) / 10 + "d";
                          const sColor = s.supplier_median === null ? "var(--text-muted)" : s.supplier_median <= 240 ? "var(--accent)" : s.supplier_median <= 720 ? "var(--highlight)" : s.supplier_median <= 1440 ? "var(--warning)" : "var(--danger)";
                          const tColor = s.team_median === null ? "var(--text-muted)" : s.team_median <= 240 ? "var(--accent)" : s.team_median <= 720 ? "var(--highlight)" : s.team_median <= 1440 ? "var(--warning)" : "var(--danger)";
                          const assignees = (s.assignee_ids || []).map((id: string) => userStats.find(u => u.id === id)).filter(Boolean);
                          // Tier chip — Batch 10
                          const tier = s.tier as string | null;
                          const tierColors: Record<string, string> = { excellent: "var(--accent)", good: "var(--info)", fair: "var(--warning)", low: "var(--danger)", no_response: "var(--text-muted)" };
                          const tierBg: Record<string, string> = { excellent: "rgba(74,222,128,0.10)", good: "rgba(88,166,255,0.10)", fair: "rgba(240,136,62,0.10)", low: "rgba(248,81,73,0.10)", no_response: "rgba(72,79,88,0.10)" };
                          const tierLabels: Record<string, string> = { excellent: "Excellent", good: "Good", fair: "Fair", low: "Low", no_response: "No response" };
                          const tColorChip = tier ? tierColors[tier] || "var(--text-muted)" : "var(--text-muted)";
                          const tBgChip = tier ? tierBg[tier] || "rgba(72,79,88,0.10)" : "rgba(72,79,88,0.10)";
                          const tLabelChip = tier ? tierLabels[tier] || "—" : "—";
                          return (
                            <a key={s.email} href={"/contacts/" + encodeURIComponent(s.email)}
                              className="grid grid-cols-[1fr_2fr_1fr_1fr_1fr_1fr_1fr] gap-3 px-4 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] items-center hover:border-[var(--info)]/30 transition-colors cursor-pointer">
                              <div>
                                {tier ? (
                                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold border" style={{ color: tColorChip, background: tBgChip, borderColor: tColorChip + "40" }} title={`Score ${s.tier_score}/4 · ${s.tier_qualifying_exchanges ?? 0} exchanges`}>
                                    <span className="w-1.5 h-1.5 rounded-full" style={{ background: tColorChip }} />
                                    {tLabelChip}
                                  </span>
                                ) : (
                                  <span className="text-[10px] text-[var(--text-muted)]">—</span>
                                )}
                              </div>
                              <div className="truncate">
                                <div className="text-[13px] font-medium truncate">{s.email}</div>
                                {s.subjects && s.subjects.length > 0 && <div className="text-[10px] text-[var(--text-muted)] truncate mt-0.5">{s.subjects[0]}{s.subjects.length > 1 ? ` +${s.subjects.length - 1} more` : ""}</div>}
                              </div>
                              <div className="text-center text-sm font-semibold" style={{ color: sColor }}>{fmtM(s.supplier_median)}</div>
                              <div className="text-center text-sm font-semibold" style={{ color: tColor }}>{fmtM(s.team_median)}</div>
                              <div className="text-center text-sm text-[var(--text-primary)]">{s.total}</div>
                              <div className="text-center">
                                {assignees.length > 0 ? (
                                  <div className="flex items-center justify-center gap-1 flex-wrap">
                                    {assignees.slice(0, 2).map((u: any) => (
                                      <div key={u.id} className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-[var(--bg)]" style={{ background: u.color }} title={u.name}>{u.initials}</div>
                                    ))}
                                    {assignees.length > 2 && <span className="text-[9px] text-[var(--text-muted)]">+{assignees.length - 2}</span>}
                                  </div>
                                ) : <span className="text-[10px] text-[var(--text-muted)]">—</span>}
                              </div>
                              <div className="text-center text-[11px] text-[var(--text-muted)]">{s.domain}</div>
                            </a>
                          );
                        })}
                      {supplierRtData.length === 0 && <Empty text="No supplier response data yet. Run the backfill first." />}
                    </div>
                  </div>
                  )
                )}

                {/* Awaiting Our Reply */}
                {slaSubTab === "awaiting-ours" && (
                  <div className="space-y-1">
                    {slaData.awaiting_our_reply.length === 0 ? <Empty text="No emails awaiting our reply" /> : (
                      slaData.awaiting_our_reply.map((item: any) => {
                        const assignee = userStats.find((u) => u.id === item.assignee_id);
                        return (
                          <a key={item.conversation_id} href={"/#conversation=" + item.conversation_id}
                            className={`block rounded-xl border bg-[var(--surface)] p-4 hover:border-[var(--danger)]/30 transition-all ${item.waiting_business_hours > 11 ? "border-[var(--danger)]/30" : "border-[var(--border)]"}`}>
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium mb-1">{item.subject}</div>
                                <div className="text-[11px] text-[var(--text-muted)]">{item.from_name} &lt;{item.from_email}&gt;</div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                {assignee && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-[var(--bg)]" style={{ background: assignee.color }}>{assignee.initials}</div>
                                    <span className="text-[10px] text-[var(--text-muted)]">{assignee.name.split(" ")[0]}</span>
                                  </div>
                                )}
                                <div className="text-right">
                                  <div className="text-xs font-semibold" style={{ color: item.waiting_business_hours > 11 ? "var(--danger)" : item.waiting_business_hours > 4 ? "var(--warning)" : "var(--info)" }}>
                                    {formatBusinessTime(item.waiting_business_hours)} waiting
                                  </div>
                                  <div className="text-[10px] text-[var(--text-muted)]">since {new Date(item.last_message_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                                </div>
                              </div>
                            </div>
                          </a>
                        );
                      })
                    )}
                  </div>
                )}

                {/* Awaiting Supplier Reply */}
                {slaSubTab === "awaiting-supplier" && (
                  <div className="space-y-1">
                    {slaData.awaiting_supplier_reply.length === 0 ? <Empty text="No emails awaiting supplier reply" /> : (
                      slaData.awaiting_supplier_reply.map((item: any) => {
                        const assignee = userStats.find((u) => u.id === item.assignee_id);
                        return (
                          <a key={item.conversation_id} href={"/#conversation=" + item.conversation_id}
                            className="block rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 hover:border-[var(--warning)]/30 transition-all">
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-medium mb-1">{item.subject}</div>
                                <div className="text-[11px] text-[var(--text-muted)]">{item.from_name} &lt;{item.from_email}&gt;</div>
                              </div>
                              <div className="flex items-center gap-3 flex-shrink-0">
                                {assignee && (
                                  <div className="flex items-center gap-1.5">
                                    <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-[var(--bg)]" style={{ background: assignee.color }}>{assignee.initials}</div>
                                    <span className="text-[10px] text-[var(--text-muted)]">{assignee.name.split(" ")[0]}</span>
                                  </div>
                                )}
                                <div className="text-right">
                                  <div className="text-xs font-semibold text-[var(--warning)]">
                                    {formatBusinessTime(item.waiting_business_hours)} waiting
                                  </div>
                                  <div className="text-[10px] text-[var(--text-muted)]">since {new Date(item.last_message_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                                </div>
                              </div>
                            </div>
                          </a>
                        );
                      })
                    )}
                  </div>
                )}
              </>
            ) : (
              <Empty text="No SLA data available" />
            )}
          </div>
        )}

        {/* ── EXPORT DATA ─── */}
        {/* ── REMOVALS AUDIT ── */}
        {viewMode === "removals" && (
          <div className="space-y-4">
            {/* Summary strip */}
            <div className="grid grid-cols-4 gap-3">
              <SummaryCard
                icon={<UserMinus size={14} />}
                label="Total Removals"
                value={removalSummary?.total || 0}
                color="var(--warning)"
              />
              <SummaryCard
                icon={<Trash2 size={14} />}
                label="Sole-Assignee (task removed)"
                value={removalSummary?.sole || 0}
                color="var(--danger)"
              />
              <SummaryCard
                icon={<Clock size={14} />}
                label="Last 7 Days"
                value={removalSummary?.in_window || 0}
                color="var(--info)"
              />
              <SummaryCard
                icon={<AlertTriangle size={14} />}
                label="Short Reasons (≤10 chars)"
                value={removalSummary?.short_reason || 0}
                sub="Possible abuse signal"
                color="var(--danger)"
              />
            </div>

            {/* Filter bar */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">Window:</span>
              {(["7d", "30d", "90d", "all"] as const).map((w) => (
                <FilterPill
                  key={w}
                  active={removalsWindow === w}
                  onClick={() => setRemovalsWindow(w)}
                  label={w === "all" ? "All time" : "Last " + w}
                />
              ))}
              <span className="text-xs text-[var(--text-muted)] ml-2">User:</span>
              <FilterPill
                active={!removalsUserFilter}
                onClick={() => setRemovalsUserFilter(null)}
                label="All"
              />
              {(removalSummary?.by_user || []).slice(0, 8).map((u: any) => (
                <FilterPill
                  key={u.id}
                  active={removalsUserFilter === u.id}
                  onClick={() => setRemovalsUserFilter(removalsUserFilter === u.id ? null : u.id)}
                  label={u.name.split(" ")[0] + " (" + u.count + ")"}
                />
              ))}
              <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] ml-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={removalsSoleOnly}
                  onChange={(e) => setRemovalsSoleOnly(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                Sole-assignee only
              </label>
              <div className="ml-auto flex items-center gap-2">
                <input
                  value={removalsSearch}
                  onChange={(e) => setRemovalsSearch(e.target.value)}
                  placeholder="Search reason, task, user..."
                  className="w-64 pl-3 pr-3 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                />
                <button
                  type="button"
                  onClick={() => {
                    // CSV export of the currently-filtered rows.
                    const headers = ["removed_at","remover","task_text","reason","was_sole_assignee","task_status","conversation_id"];
                    const escape = (v: any) => {
                      const s = v == null ? "" : String(v);
                      // Quote if contains comma, quote, or newline; double internal quotes.
                      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                    };
                    const lines = [headers.join(",")];
                    for (const r of filteredRemovals) {
                      lines.push([
                        r.removed_at || "",
                        r.remover?.name || "",
                        r.task_text || "",
                        r.reason || "",
                        r.was_sole_assignee ? "yes" : "no",
                        r.task_status || "",
                        r.conversation_id || "",
                      ].map(escape).join(","));
                    }
                    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `task-removals-${new Date().toISOString().slice(0, 10)}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  Export CSV
                </button>
              </div>
            </div>

            {/* Removals list */}
            {removalsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin text-[var(--accent)]" />
              </div>
            ) : filteredRemovals.length === 0 ? (
              <Empty text="No removals match these filters" />
            ) : (
              <div className="space-y-2">
                {filteredRemovals.map((r: any) => {
                  const isShortReason = (r.reason || "").trim().length <= 10;
                  return (
                    <div
                      key={r.id}
                      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"
                    >
                      <div className="flex items-start gap-3">
                        {/* Avatar of the remover */}
                        {r.remover ? (
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-bold text-[var(--bg)] shrink-0"
                            style={{ background: r.remover.color }}
                            title={r.remover.name}
                          >
                            {r.remover.initials}
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[var(--border)] shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          {/* Header row: name + when + tags */}
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="text-sm font-semibold text-[var(--text-primary)]">
                              {r.remover?.name || "Unknown user"}
                            </span>
                            <span className="text-[10px] text-[var(--text-muted)]">
                              {r.removed_at ? new Date(r.removed_at).toLocaleString() : ""}
                            </span>
                            {r.was_sole_assignee && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(248,81,73,0.10)] text-[var(--danger)] font-bold">
                                Task removed (sole assignee)
                              </span>
                            )}
                            {!r.was_sole_assignee && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--border)] text-[var(--text-secondary)] font-bold">
                                Left task
                              </span>
                            )}
                            {isShortReason && (
                              <span
                                title="Short reason — possible abuse signal"
                                className="text-[10px] px-1.5 py-0.5 rounded-full bg-[rgba(240,136,62,0.10)] text-[var(--warning)] font-bold"
                              >
                                Short reason
                              </span>
                            )}
                          </div>
                          {/* Task snapshot text */}
                          <div className="text-[12px] text-[var(--text-secondary)] mb-1.5 truncate">
                            {r.task_text || <span className="italic">No task text saved</span>}
                          </div>
                          {/* Reason block */}
                          <div className="rounded bg-[var(--bg)] border border-[var(--border)] px-2 py-1.5">
                            <span className="text-[10px] text-[var(--text-muted)] font-semibold uppercase tracking-wider mr-1">
                              Reason:
                            </span>
                            <span className="text-[12px] text-[var(--text-primary)]">
                              {r.reason || <span className="italic text-[var(--text-muted)]">(empty)</span>}
                            </span>
                          </div>
                        </div>
                        {/* Jump-to-conversation link */}
                        {r.conversation_id && (
                          <a
                            href={`/#conversation=${r.conversation_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 inline-flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--info)] hover:bg-[var(--surface-2)]"
                          >
                            <ExternalLink size={11} /> Thread
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {viewMode === "calls" && (
          // CallsView manages its own internal scroll. We escape the
          // parent's overflow with a negative-margin trick so the view
          // fills the remaining vertical space cleanly.
          <div className="-mx-6 h-full">
            <CallsView
              onOpenConversation={(conversationId) => {
                // From the dashboard, route back to the main app's inbox
                // with the conversation hash so it auto-opens
                window.location.href = `/#conversation=${conversationId}`;
              }}
            />
          </div>
        )}

        {viewMode === "offboarded" && (
          <OffboardedUsersPanel onJump={(viewMode) => setViewMode(viewMode as any)} />
        )}

        {viewMode === "export" && (
          <ExportPanel dateFrom={effectiveDateFrom} dateTo={effectiveDateTo} />
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────

function SummaryCard({ icon, label, value, sub, color }: { icon: React.ReactNode; label: string; value: number; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-center gap-2 text-xs mb-2" style={{ color }}>{icon} {label}</div>
      <div className="text-2xl font-bold" style={{ color: color === "var(--text-muted)" ? "var(--text-primary)" : color }}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-muted)] mt-1">{sub}</div>}
    </div>
  );
}

function FilterPill({ active, onClick, label, avatar }: { active: boolean; onClick: () => void; label: string; avatar?: { initials: string; color: string } }) {
  return (
    <button onClick={onClick}
      className={`px-2.5 py-1 rounded-lg text-xs transition-colors flex items-center gap-1.5 ${
        active ? "bg-[var(--accent)] text-[var(--bg)] font-semibold" : "bg-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
    >
      {avatar && <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-[var(--bg)]" style={{ background: avatar.color }}>{avatar.initials}</div>}
      {label}
    </button>
  );
}

function TaskRow({ task }: { task: TaskDetail }) {
  const completedCount = task.assignees.filter((a) => a.is_done).length;
  const totalCount = task.assignees.length;
  const isDismissed = task.status === "dismissed";
  const isCompleted = task.status === "completed" || (totalCount > 0 && completedCount === totalCount);
  const isOverdue = !isDismissed && !isCompleted && task.due_date && new Date(task.due_date) < new Date();

  return (
    <Link href={"/#conversation=" + task.conversation_id}
      className={`block rounded-xl border bg-[var(--surface)] p-4 hover:border-[var(--info)]/30 transition-all cursor-pointer ${
        isDismissed ? "border-[var(--warning)]/20 opacity-70" : isCompleted ? "border-[var(--accent)]/20 opacity-80" : isOverdue ? "border-[var(--danger)]/30" : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            {isDismissed && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[rgba(240,136,62,0.12)] text-[var(--warning)]"
                title={task.dismiss_reason ? "Reason: " + task.dismiss_reason : "No reason provided"}>
                Dismissed
              </span>
            )}
            {isCompleted && !isDismissed && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[rgba(74,222,128,0.12)] text-[var(--accent)]">
                Completed
              </span>
            )}
            <div className={`text-[13px] font-medium ${isDismissed ? "italic text-[var(--text-secondary)]" : isCompleted ? "line-through text-[var(--text-secondary)]" : ""}`}>{task.text}</div>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-[var(--text-muted)]">
            <span className="truncate max-w-[300px]">{task.conversation_subject}</span>
            {task.category_name && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: (task.category_color || "var(--border)") + "20", color: task.category_color || "var(--text-secondary)" }}>{task.category_name}</span>
            )}
          </div>
          {isDismissed && task.dismiss_reason && (
            <div className="mt-1 text-[11px] text-[var(--warning)] italic">
              Reason: {task.dismiss_reason}
            </div>
          )}
        </div>
        {task.due_date && !isDismissed && (
          <div className="flex items-center gap-1 text-[11px] font-medium flex-shrink-0" style={{ color: isCompleted ? "var(--accent)" : getDueColor(task.due_date) }}>
            <CalendarClock size={12} /> {isCompleted ? "Done" : formatDueDate(task.due_date)}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <div className="flex items-center gap-1">
          {task.assignees.map((a, i) => (
            <div key={i} className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-bold text-[var(--bg)] relative ${a.is_done ? "opacity-50" : ""}`}
              style={{ background: a.color }} title={a.name + (a.is_done ? " (done)" : "")}>
              {a.initials}
              {a.is_done && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-[var(--accent)] rounded-full flex items-center justify-center"><CheckCircle2 size={8} className="text-[var(--bg)]" /></div>}
            </div>
          ))}
        </div>
        {!isDismissed && (
          <>
            <span className="text-[10px] text-[var(--text-muted)]">{completedCount}/{totalCount} done</span>
            <div className="w-16 h-1.5 rounded-full bg-[var(--border)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: totalCount > 0 ? (completedCount / totalCount * 100) + "%" : "0%" }} />
            </div>
          </>
        )}
      </div>
    </Link>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-center py-16 text-[var(--text-muted)] text-sm">{text}</div>;
}

// ── Export Panel ──────────────────────────────────────

const DATASETS = [
  { id: "conversations", label: "Conversations", desc: "All email threads with assignee, account, status" },
  { id: "messages", label: "Messages", desc: "Individual emails with sender, recipient, timestamps" },
  { id: "tasks", label: "Tasks", desc: "All tasks with assignees, categories, due dates, completion" },
  { id: "team_members", label: "Team Members", desc: "User profiles, roles, departments" },
  { id: "sla", label: "SLA Metrics", desc: "Response times, waiting times, reply status per conversation" },
  { id: "user_performance", label: "User Performance", desc: "Per-user task breakdown, completion rates, categories, conversation SLA & response times" },
  { id: "supplier_responsiveness", label: "Supplier Response Times", desc: "Per-supplier avg response time, our team response time, total exchanges" },
  { id: "activity", label: "Activity Log", desc: "All actions: assignments, replies, status changes" },
] as const;

function ExportPanel({ dateFrom, dateTo }: { dateFrom: string | null; dateTo: string | null }) {
  const [exportMode, setExportMode] = useState<"single" | "unified">("single");
  const [selectedDataset, setSelectedDataset] = useState<string>("conversations");
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv" | "json" | "pdf">("xlsx");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Data + columns
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [perfSubSheet, setPerfSubSheet] = useState<"task_summary" | "task_details" | "conversation_performance" | "all_details">("all_details");

  // Fetch data when mode or dataset changes
  useEffect(() => {
    if (exportMode === "single") loadSingleData();
    else loadUnifiedData();
  }, [selectedDataset, exportMode, perfSubSheet]);

  async function loadSingleData() {
    setPreviewLoading(true);
    try {
      let url = "/api/export?dataset=" + selectedDataset;
      if (dateFrom) url += "&date_from=" + dateFrom;
      if (dateTo) url += "&date_to=" + dateTo;
      const res = await fetch(url);
      const data = await res.json();

      let rows: any[];
      if (selectedDataset === "user_performance") {
        const perfData = data.user_performance || {};
        if (perfSubSheet === "all_details") {
          // Combine task details + conversation performance into one flat table per user
          const taskRows = (perfData.task_details || []).map((r: any) => ({
            user_name: r.user_name,
            user_email: r.user_email,
            record_type: "Task",
            title: r.task_text,
            status: r.task_status,
            category: r.category,
            due_date: r.due_date,
            is_overdue: r.is_overdue,
            dismiss_reason: r.dismiss_reason,
            dismissed_at: r.dismissed_at,
            reply_status: "",
            waiting_hours: "",
            inbound_count: "",
            outbound_count: "",
            user_replies: "",
            first_response_hours: "",
            avg_response_hours: "",
            conversation_subject: r.conversation_subject,
            conversation_id: r.conversation_id,
            created_at: r.created_at,
            link: r.conversation_id ? "https://tenkara-inbox-nine.vercel.app/#conversation=" + r.conversation_id : "",
          }));
          const convoRows = (perfData.conversation_performance || []).map((r: any) => ({
            user_name: r.user_name,
            user_email: r.user_email,
            record_type: "Conversation",
            title: r.conversation_subject,
            status: r.conversation_status,
            category: "",
            due_date: "",
            is_overdue: "",
            dismiss_reason: "",
            dismissed_at: "",
            reply_status: r.reply_status,
            waiting_hours: r.waiting_hours,
            inbound_count: r.inbound_count,
            outbound_count: r.outbound_count,
            user_replies: r.user_replies,
            first_response_hours: r.first_response_hours,
            avg_response_hours: r.avg_response_hours,
            conversation_subject: r.conversation_subject,
            conversation_id: r.conversation_id,
            created_at: r.conversation_created_at,
            link: r.conversation_id ? "https://tenkara-inbox-nine.vercel.app/#conversation=" + r.conversation_id : "",
          }));
          rows = [...taskRows, ...convoRows].sort((a, b) => (a.user_name || "").localeCompare(b.user_name || ""));
        } else {
          rows = perfData[perfSubSheet] || [];
        }
      } else if (selectedDataset === "supplier_responsiveness") {
        rows = data.supplier_responsiveness || [];
      } else {
        rows = data[selectedDataset] || [];
      }

      setPreviewData(rows);
      if (rows.length > 0) {
        const cols = Object.keys(rows[0]);
        setAllColumns(cols);
        setSelectedColumns(new Set(cols));
      } else { setAllColumns([]); setSelectedColumns(new Set()); }
    } catch (_e) { setPreviewData([]); setAllColumns([]); }
    finally { setPreviewLoading(false); }
  }

  async function loadUnifiedData() {
    setPreviewLoading(true);
    setPreviewData(null);
    try {
      let url = "/api/export/unified?x=1";
      if (dateFrom) url += "&date_from=" + dateFrom;
      if (dateTo) url += "&date_to=" + dateTo;
      const res = await fetch(url);
      const text = await res.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch (_e) {
        console.error("Unified API returned non-JSON:", text.slice(0, 500));
        setPreviewData([]);
        setAllColumns([]);
        setPreviewLoading(false);
        return;
      }

      if (data.error) {
        console.error("Unified export API error:", data.error);
      }

      const rows = data.rows || [];
      setPreviewData(rows);

      const UNIFIED_COLUMNS = [
        "conversation_id", "conversation_subject", "conversation_status", "conversation_from_name", "conversation_from_email",
        "conversation_is_unread", "conversation_is_starred", "conversation_created_at", "conversation_last_message_at",
        "account_name", "account_email", "folder_name",
        "conversation_assignee_name", "conversation_assignee_email", "conversation_assignee_department", "conversation_assignee_role",
        "total_messages", "inbound_messages", "outbound_messages", "reply_status", "waiting_hours",
        "first_response_hours", "first_response_by",
        "latest_inbound_from", "latest_inbound_email", "latest_inbound_date", "latest_inbound_snippet",
        "latest_outbound_to", "latest_outbound_date", "latest_outbound_by", "latest_outbound_snippet",
        "has_attachments",
        "task_id", "task_text", "task_status", "task_category", "task_due_date", "task_due_time", "task_created_at",
        "task_assignee_name", "task_assignee_email", "task_assignee_department", "task_assignee_status", "task_assignee_done",
        "task_total_assignees", "task_completed_count",
      ];

      const cols = rows.length > 0 ? Object.keys(rows[0]) : UNIFIED_COLUMNS;
      setAllColumns(cols);
      setSelectedColumns(new Set()); // Start empty so admin picks what they want
    } catch (_e) {
      console.error("Unified load failed:", _e);
      setPreviewData([]);
      setAllColumns([]);
    }
    finally { setPreviewLoading(false); }
  }

  function toggleColumn(col: string) {
    setSelectedColumns((prev) => { const n = new Set(prev); if (n.has(col)) n.delete(col); else n.add(col); return n; });
  }

  // Group columns by prefix for unified mode display
  const columnGroups = useMemo(() => {
    if (exportMode !== "unified") return {};
    const groups: Record<string, string[]> = {};
    for (const col of allColumns) {
      let group = "Other";
      if (col.startsWith("conversation_")) group = "Conversation";
      else if (col.startsWith("account_")) group = "Account";
      else if (col.startsWith("folder_")) group = "Folder";
      else if (col.startsWith("task_")) group = "Task";
      else if (col.startsWith("latest_inbound_")) group = "Latest Inbound Message";
      else if (col.startsWith("latest_outbound_")) group = "Latest Outbound Message";
      else if (["total_messages", "inbound_messages", "outbound_messages", "reply_status", "waiting_hours", "first_response_hours", "first_response_by", "has_attachments"].includes(col)) group = "SLA Metrics";

      if (!groups[group]) groups[group] = [];
      groups[group].push(col);
    }
    return groups;
  }, [allColumns, exportMode]);

  // Filter rows based on which column groups are selected
  const filteredRows = useMemo(() => {
    if (exportMode !== "unified" || !previewData) return previewData;

    const selectedCols = Array.from(selectedColumns);
    const hasTaskCols = selectedCols.some((c) => c.startsWith("task_"));
    const hasConvoCols = selectedCols.some((c) =>
      c.startsWith("conversation_") || c.startsWith("account_") || c.startsWith("folder_") ||
      c.startsWith("assignee_") || c.startsWith("latest_") ||
      ["total_messages", "inbound_messages", "outbound_messages", "reply_status", "waiting_hours", "first_response_hours", "first_response_by", "has_attachments"].includes(c)
    );

    return previewData.filter((row) => {
      // If task columns are selected, only include rows that have task data
      if (hasTaskCols && !hasConvoCols) {
        return row.task_id && row.task_id !== "";
      }
      // If only conversation columns selected, deduplicate (one row per conversation)
      // But for unified this is handled below
      return true;
    });
  }, [previewData, selectedColumns, exportMode]);

  // Deduplicate conversation-only exports (one row per conversation when no task columns)
  const exportRows = useMemo(() => {
    if (exportMode !== "unified" || !filteredRows) return filteredRows;

    const selectedCols = Array.from(selectedColumns);
    const hasTaskCols = selectedCols.some((c) => c.startsWith("task_"));

    if (!hasTaskCols) {
      // No task columns selected — deduplicate by conversation_id
      const seen = new Set<string>();
      return filteredRows.filter((row) => {
        if (seen.has(row.conversation_id)) return false;
        seen.add(row.conversation_id);
        return true;
      });
    }

    return filteredRows;
  }, [filteredRows, selectedColumns, exportMode]);

  async function handleExport() {
    const sourceRows = exportMode === "unified" ? exportRows : previewData;
    if (!sourceRows || selectedColumns.size === 0) return;
    setLoading(true);
    try {
      const cols = allColumns.filter((c) => selectedColumns.has(c));
      const filtered = sourceRows.map((row: any) => {
        const obj: any = {};
        for (const c of cols) obj[c] = row[c] ?? "";
        return obj;
      });
      const filename = exportMode === "unified"
        ? "tenkara_full_report_" + new Date().toISOString().slice(0, 10)
        : "tenkara_" + selectedDataset + "_" + new Date().toISOString().slice(0, 10);

      if (exportFormat === "json") downloadJSON(filtered, filename);
      else if (exportFormat === "csv") downloadCSV(filtered, cols, filename);
      else if (exportFormat === "xlsx") await downloadXLSX(filtered, cols, filename, exportMode === "unified" ? "Full Report" : selectedDataset);
      else if (exportFormat === "pdf") downloadPDFTable(filtered, cols, filename, exportMode === "unified" ? "Full Report" : selectedDataset);
    } catch (e) {
      console.error("Export failed:", e);
      alert("Export failed: " + (e as any)?.message);
    } finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      {/* Mode switcher */}
      <div className="flex items-center gap-2">
        <button onClick={() => setExportMode("single")}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${exportMode === "single" ? "bg-[var(--accent)] text-[var(--bg)]" : "bg-[var(--surface)] text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)]"}`}
        >Single Dataset</button>
        <button onClick={() => setExportMode("unified")}
          className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${exportMode === "unified" ? "bg-[var(--accent)] text-[var(--bg)]" : "bg-[var(--surface)] text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)]"}`}
        >Unified Report (All Data Joined)</button>
      </div>

      {/* Single dataset picker */}
      {exportMode === "single" && (
        <>
        <div className="grid grid-cols-3 gap-2">
          {DATASETS.map((ds) => (
            <button key={ds.id} onClick={() => setSelectedDataset(ds.id)}
              className={`p-3 rounded-xl border text-left transition-all ${selectedDataset === ds.id ? "border-[var(--accent)]/40 bg-[var(--accent)]/5" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]/20"}`}
            >
              <div className="text-xs font-semibold text-[var(--text-primary)]">{ds.label}</div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{ds.desc}</div>
            </button>
          ))}
        </div>

        {/* Sub-sheet selector for User Performance */}
        {selectedDataset === "user_performance" && (
          <div className="flex items-center gap-2 mt-2">
            <span className="text-[10px] text-[var(--text-muted)]">View:</span>
            {([
              { id: "all_details" as const, label: "All Details (Combined)" },
              { id: "task_summary" as const, label: "Task Summary" },
              { id: "task_details" as const, label: "Task Details" },
              { id: "conversation_performance" as const, label: "Conversation Performance" },
            ]).map((sheet) => (
              <button key={sheet.id} onClick={() => { setPerfSubSheet(sheet.id); }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                  perfSubSheet === sheet.id ? "bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)]"
                }`}
              >{sheet.label}</button>
            ))}
          </div>
        )}
        </>
      )}

      {/* Unified mode description */}
      {exportMode === "unified" && !previewLoading && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-xs text-[var(--text-secondary)]">
            All data joined through conversations. {exportRows ? exportRows.length + " rows" : previewData ? previewData.length + " rows loaded." : "Loading..."} {exportRows && previewData && exportRows.length !== previewData.length ? `(filtered from ${previewData.length} total)` : ""}
          </div>
          {previewData && previewData.length === 0 && allColumns.length > 0 && (
            <div className="text-[11px] text-[var(--warning)] mt-1">No data found for the selected date range. Columns are still available — try changing the date filter or select "All Time".</div>
          )}
        </div>
      )}

      {previewLoading ? (
        <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin text-[var(--accent)] mx-auto" /></div>
      ) : (
        <>
          {/* Column picker */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="text-xs font-bold text-[var(--text-primary)]">Select Columns</div>
                <div className="text-[10px] text-[var(--text-muted)]">{selectedColumns.size} of {allColumns.length} selected · {exportMode === "unified" ? (exportRows?.length || 0) : (previewData?.length || 0)} rows</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedColumns(new Set(allColumns))} className="text-[10px] text-[var(--info)] hover:text-[var(--info)]">Select all</button>
                <span className="text-[var(--border)]">|</span>
                <button onClick={() => setSelectedColumns(new Set())} className="text-[10px] text-[var(--info)] hover:text-[var(--info)]">Deselect all</button>
              </div>
            </div>

            {/* Grouped columns for unified mode */}
            {exportMode === "unified" ? (
              <div className="space-y-3">
                {Object.entries(columnGroups).map(([group, cols]) => (
                  <div key={group}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase">{group}</span>
                      <div className="flex gap-2">
                        <button onClick={() => { const n = new Set(selectedColumns); cols.forEach((c) => n.add(c)); setSelectedColumns(n); }} className="text-[9px] text-[var(--info)]">all</button>
                        <button onClick={() => { const n = new Set(selectedColumns); cols.forEach((c) => n.delete(c)); setSelectedColumns(n); }} className="text-[9px] text-[var(--info)]">none</button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {cols.map((col) => (
                        <button key={col} onClick={() => toggleColumn(col)}
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${selectedColumns.has(col) ? "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30" : "bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--text-secondary)]"}`}
                        >{col.replace(/_/g, " ")}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {allColumns.map((col) => (
                  <button key={col} onClick={() => toggleColumn(col)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${selectedColumns.has(col) ? "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30" : "bg-[var(--surface)] text-[var(--text-muted)] border border-[var(--border)] hover:text-[var(--text-secondary)]"}`}
                  >{col.replace(/_/g, " ")}</button>
                ))}
              </div>
            )}
          </div>

          {/* Preview table */}
          {(() => {
            const previewSource = exportMode === "unified" ? exportRows : previewData;
            return previewSource && previewSource.length > 0 && selectedColumns.size > 0 && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
              <div className="px-4 py-2 border-b border-[var(--border)] text-[10px] text-[var(--text-muted)]">Preview (first 5 rows)</div>
              <div className="overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead><tr className="border-b border-[var(--border)]">
                    {allColumns.filter((c) => selectedColumns.has(c)).map((col) => (
                      <th key={col} className="px-3 py-2 text-left text-[10px] text-[var(--text-muted)] font-semibold uppercase whitespace-nowrap">{col.replace(/_/g, " ")}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {previewSource.slice(0, 5).map((row: any, i: number) => (
                      <tr key={i} className="border-b border-[var(--border)]/50">
                        {allColumns.filter((c) => selectedColumns.has(c)).map((col) => (
                          <td key={col} className="px-3 py-2 text-[var(--text-secondary)] whitespace-nowrap max-w-[200px] truncate">
                            {col === "link" && row[col] ? (
                              <a href={String(row[col])} target="_blank" rel="noopener noreferrer" className="text-[var(--info)] hover:underline">Open →</a>
                            ) : String(row[col] ?? "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
          })()}

          {/* Export format + button */}
          <div className="flex items-center justify-between p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">Format:</span>
              {([
                { id: "xlsx" as const, label: "Excel (.xlsx)", icon: <FileSpreadsheet size={14} /> },
                { id: "csv" as const, label: "CSV", icon: <FileText size={14} /> },
                { id: "json" as const, label: "JSON", icon: <FileJson size={14} /> },
                { id: "pdf" as const, label: "PDF", icon: <FileText size={14} /> },
              ]).map((fmt) => (
                <button key={fmt.id} onClick={() => setExportFormat(fmt.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    exportFormat === fmt.id ? "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30" : "bg-[var(--surface)] text-[var(--text-secondary)] border border-[var(--border)] hover:text-[var(--text-primary)]"
                  }`}
                >{fmt.icon} {fmt.label}</button>
              ))}
            </div>
            <button
              onClick={handleExport}
              disabled={loading || selectedColumns.size === 0 || !(exportMode === "unified" ? exportRows?.length : previewData?.length)}
              className="flex items-center gap-2 px-5 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-xs font-semibold hover:bg-[var(--accent)] disabled:opacity-50 transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {loading ? "Exporting..." : `Export ${exportMode === "unified" ? (exportRows?.length || 0) : (previewData?.length || 0)} rows`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Export helpers ─────────────────────────────────────

function downloadJSON(data: any[], filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  triggerDownload(blob, filename + ".json");
}

function downloadCSV(data: any[], columns: string[], filename: string) {
  const header = columns.join(",");
  const rows = data.map((row) =>
    columns.map((col) => {
      const val = String(row[col] ?? "").replace(/"/g, '""');
      return val.includes(",") || val.includes('"') || val.includes("\n") ? `"${val}"` : val;
    }).join(",")
  );
  const csv = [header, ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, filename + ".csv");
}

async function downloadXLSX(data: any[], columns: string[], filename: string, sheetName: string) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(data, { header: columns });
  const colWidths = columns.map((col) => {
    const maxLen = Math.max(col.length, ...data.slice(0, 100).map((r) => String(r[col] ?? "").length));
    return { wch: Math.min(maxLen + 2, 50) };
  });
  ws["!cols"] = colWidths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  triggerDownload(blob, filename + ".xlsx");
}

function downloadPDFTable(data: any[], columns: string[], filename: string, title: string) {
  // Generate a simple HTML table and trigger print-to-PDF
  const headerCells = columns.map((c) => `<th style="border:1px solid #ccc;padding:4px 8px;background:#f0f0f0;font-size:10px;white-space:nowrap">${c.replace(/_/g, " ")}</th>`).join("");
  const bodyRows = data.map((row) =>
    "<tr>" + columns.map((c) => `<td style="border:1px solid #eee;padding:3px 6px;font-size:9px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${String(row[c] ?? "")}</td>`).join("") + "</tr>"
  ).join("");

  const html = `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:Arial,sans-serif;margin:20px}h1{font-size:16px;margin-bottom:8px}p{font-size:11px;color:#666;margin-bottom:16px}table{border-collapse:collapse;width:100%}</style></head><body><h1>Tenkara Inbox — ${title}</h1><p>Exported ${new Date().toLocaleString()} · ${data.length} rows</p><table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;

  const w = window.open("", "_blank");
  if (w) {
    w.document.write(html);
    w.document.close();
    setTimeout(() => w.print(), 500);
  }
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// ─────────────────────────────────────────────────────────
// CallsOverviewWidget — quick-glance summary on Team Overview
// ─────────────────────────────────────────────────────────
// Fetches a tiny slice of /api/calls/all to show:
//   - Active follow-ups count
//   - Last 7d call count
//   - 5 most recent calls needing a follow-up
// Click the widget header or any row → switches the dashboard
// to the "calls" tab where the full view lives.

function CallsOverviewWidget({ onOpenCallsTab }: { onOpenCallsTab: () => void }) {
  const [loading, setLoading] = useState(true);
  const [followUps, setFollowUps] = useState<any[]>([]);
  const [followUpCount, setFollowUpCount] = useState(0);
  const [last7dCount, setLast7dCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Parallel fetch: follow-ups slice (5 most recent) + 7d count
        const [fuRes, weekRes] = await Promise.all([
          fetch("/api/calls/all?has_follow_up=true&range=all&limit=5"),
          fetch("/api/calls/all?range=7d&limit=1"),
        ]);
        if (cancelled) return;
        if (fuRes.ok) {
          const fu = await fuRes.json();
          setFollowUps(fu.calls || []);
          setFollowUpCount(fu.stats?.total_filtered || 0);
        }
        if (weekRes.ok) {
          const w = await weekRes.json();
          setLast7dCount(w.stats?.total_filtered || 0);
        }
      } catch (_e) {
        /* non-fatal */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fmtTime = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}h ago`;
    return `${Math.floor(diffMin / (60 * 24))}d ago`;
  };

  return (
    <div className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <button
        onClick={onOpenCallsTab}
        className="w-full px-4 py-3 flex items-center justify-between border-b border-[var(--border)] hover:bg-[var(--bg)] transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)]/12 flex items-center justify-center">
            <Phone size={13} className="text-[var(--accent)]" />
          </div>
          <div>
            <div className="text-[13px] font-bold text-[var(--text-primary)]">Calls</div>
            <div className="text-[10px] text-[var(--text-muted)]">Open the Calls tab for filters + history</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-[18px] font-bold text-[var(--info)] leading-none">{followUpCount}</div>
            <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">follow-ups</div>
          </div>
          <div className="text-right">
            <div className="text-[18px] font-bold text-[var(--text-primary)] leading-none">{last7dCount}</div>
            <div className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">last 7 days</div>
          </div>
          <ChevronDown size={14} className="-rotate-90 text-[var(--text-muted)]" />
        </div>
      </button>

      {/* Recent follow-up rows preview */}
      <div className="divide-y divide-[var(--border)]">
        {loading ? (
          <div className="px-4 py-6 text-center text-[var(--text-muted)] text-[11px]">Loading…</div>
        ) : followUps.length === 0 ? (
          <div className="px-4 py-6 text-center text-[var(--text-muted)] text-[11px]">
            No active call follow-ups. Nice work.
          </div>
        ) : (
          followUps.map((c: any) => (
            <button
              key={c.id}
              onClick={onOpenCallsTab}
              className="w-full px-4 py-2 flex items-center gap-3 hover:bg-[var(--bg)] transition-colors text-left"
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                c.direction === "inbound" ? "bg-[var(--info)]/10 text-[var(--info)]" : "bg-[var(--accent)]/10 text-[var(--accent)]"
              }`}>
                <Phone size={10} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-[var(--text-primary)] font-medium truncate">
                  {c.supplier_name || c.person_name || (
                    <span className="italic text-[var(--text-muted)] font-normal">Unknown caller</span>
                  )}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] font-mono">{c.participant_phone || "—"}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] text-[var(--text-muted)]">{fmtTime(c.started_at)}</div>
                {(c.attributed_team_member_name || c.team_member_name) && (
                  <div className="text-[10px] text-[var(--text-secondary)]">
                    {c.attributed_team_member_name || c.team_member_name}
                  </div>
                )}
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// OffboardedUsersPanel — list deactivated users with workload
// counts and a bulk-reassign action per user.
// ─────────────────────────────────────────────────────────

interface OffboardedUser {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  deactivated_at: string | null;
  counts: {
    conversations: number;
    open_tasks: number;
    active_follow_ups: number;
    drafts: number;
    watched_threads: number;
    unread_notifications: number;
    total_outstanding: number;
  };
}

interface ActiveMember {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
}

function OffboardedUsersPanel({ onJump }: { onJump: (viewMode: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<OffboardedUser[]>([]);
  const [activeMembers, setActiveMembers] = useState<ActiveMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reassignTarget, setReassignTarget] = useState<OffboardedUser | null>(null);
  // When set, render the per-user drill-down detail view instead of the list
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/offboarded-users");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load");
      setUsers(data.users || []);
      setActiveMembers(data.active_team_members || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Detail view branch — render this instead of the list when a user is selected
  if (selectedUserId) {
    const selectedUser = users.find((u) => u.id === selectedUserId);
    return (
      <OffboardedUserDetailView
        userId={selectedUserId}
        userName={selectedUser?.name || "Unknown user"}
        userInitials={selectedUser?.initials || "?"}
        userColor={selectedUser?.color || "var(--text-muted)"}
        userEmail={selectedUser?.email || ""}
        counts={selectedUser?.counts}
        activeMembers={activeMembers}
        onBack={() => { setSelectedUserId(null); load(); }}
        onBulkReassign={() => {
          // Open the existing bulk modal for the speed case
          if (selectedUser) setReassignTarget(selectedUser);
        }}
      />
    );
  }

  if (loading) {
    return (
      <div className="py-12 flex items-center justify-center text-[var(--text-muted)] text-[12px]">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading offboarded users…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-2 mt-4 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-xs text-[var(--danger)] flex items-start gap-2">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span>{error}</span>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="py-16 flex flex-col items-center justify-center text-center">
        <div className="w-12 h-12 rounded-full bg-[var(--bg)] border border-[var(--border)] flex items-center justify-center mb-3">
          <UserMinus size={20} className="text-[var(--text-muted)]" />
        </div>
        <div className="text-[13px] font-semibold text-[var(--text-primary)] mb-1">No offboarded users</div>
        <div className="text-[11px] text-[var(--text-secondary)] max-w-sm">
          When you deactivate a team member from Settings → Team, they'll appear here with their pending workload so you can reassign or clean it up.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] text-[var(--text-secondary)] pb-2">
        Deactivated team members with outstanding work. Click <strong>Reassign</strong> on any row to transfer their workload in one go.
      </div>

      <div className="rounded-xl border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
        <table className="w-full text-[12px]">
          <thead className="bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
            <tr>
              <th className="text-left px-4 py-2.5">User</th>
              <th className="text-center px-2 py-2.5" title="Assigned conversations">Convos</th>
              <th className="text-center px-2 py-2.5" title="Open tasks (status not completed/dismissed)">Tasks</th>
              <th className="text-center px-2 py-2.5" title="Active call follow-ups">Follow-ups</th>
              <th className="text-center px-2 py-2.5" title="Conversation watchers">Watchers</th>
              <th className="text-center px-2 py-2.5" title="Email drafts (not auto-reassigned)">Drafts</th>
              <th className="text-center px-2 py-2.5" title="Unread notifications">Notifs</th>
              <th className="text-right px-4 py-2.5">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {users.map((u) => {
              const c = u.counts;
              const hasActionable = c.total_outstanding > 0;
              return (
                <tr key={u.id} className="hover:bg-[var(--bg)]/40">
                  <td className="px-4 py-3 align-middle">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-[var(--bg)] shrink-0 opacity-60"
                        style={{ background: u.color || "var(--text-muted)" }}
                      >
                        {u.initials}
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12px] font-medium text-[var(--text-primary)] truncate flex items-center gap-1.5">
                          <span className="line-through opacity-70">{u.name}</span>
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--text-muted)]/15 text-[var(--text-muted)]">
                            Deactivated
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--text-muted)] font-mono">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <CountCell n={c.conversations} highlight={c.conversations > 0} />
                  <CountCell n={c.open_tasks} highlight={c.open_tasks > 0} />
                  <CountCell n={c.active_follow_ups} highlight={c.active_follow_ups > 0} />
                  <CountCell n={c.watched_threads} highlight={c.watched_threads > 0} muted />
                  <CountCell n={c.drafts} highlight={false} muted />
                  <CountCell n={c.unread_notifications} highlight={false} muted />
                  <td className="px-4 py-3 align-middle text-right">
                    <div className="inline-flex items-center gap-1.5 justify-end">
                      <button
                        onClick={() => setSelectedUserId(u.id)}
                        className="px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--text-secondary)] text-[11px] font-medium hover:bg-[var(--bg)]"
                      >
                        View
                      </button>
                      {hasActionable || c.drafts > 0 || c.unread_notifications > 0 ? (
                        <button
                          onClick={() => setReassignTarget(u)}
                          className="px-2.5 py-1 rounded-md bg-[var(--accent)] text-[var(--bg)] text-[11px] font-semibold hover:bg-[var(--accent-strong)]"
                        >
                          Reassign all
                        </button>
                      ) : (
                        <span className="text-[10px] text-[var(--text-muted)] italic">No outstanding work</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-[10px] text-[var(--text-muted)]">
        <strong>Note on drafts:</strong> Email drafts are NOT auto-reassigned by default — drafts have personal voice and signatures. You can choose to delete them in the reassign dialog.
      </div>

      {reassignTarget && (
        <ReassignModal
          user={reassignTarget}
          activeMembers={activeMembers}
          onClose={() => setReassignTarget(null)}
          onComplete={() => { setReassignTarget(null); load(); }}
        />
      )}
    </div>
  );
}

function CountCell({ n, highlight, muted = false }: { n: number; highlight: boolean; muted?: boolean }) {
  return (
    <td className="px-2 py-3 align-middle text-center">
      <span className={`text-[13px] font-semibold ${
        n === 0 ? "text-[var(--text-muted)]" :
        muted ? "text-[var(--text-secondary)]" :
        highlight ? "text-[var(--warning)]" : "text-[var(--text-primary)]"
      }`}>
        {n}
      </span>
    </td>
  );
}

// ─────────────────────────────────────────────────────────
// ReassignModal — pick target + categories, apply, show results
// ─────────────────────────────────────────────────────────

function ReassignModal({
  user,
  activeMembers,
  onClose,
  onComplete,
}: {
  user: OffboardedUser;
  activeMembers: ActiveMember[];
  onClose: () => void;
  onComplete: () => void;
}) {
  const [targetId, setTargetId] = useState<string>("");
  const [doConversations, setDoConversations] = useState(true);
  const [doTasks, setDoTasks] = useState(true);
  const [doFollowUps, setDoFollowUps] = useState(true);
  const [watchersMode, setWatchersMode] = useState<"transfer" | "delete" | "skip">("transfer");
  const [draftsMode, setDraftsMode] = useState<"keep" | "delete">("keep");
  const [doMarkNotifsRead, setDoMarkNotifsRead] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any | null>(null);

  const needsTarget = doConversations || doTasks || doFollowUps || watchersMode === "transfer";

  const handleSubmit = async () => {
    if (needsTarget && !targetId) {
      setError("Pick a target team member to reassign to.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const categories: any = {};
      if (doConversations) categories.conversations = true;
      if (doTasks) categories.tasks = true;
      if (doFollowUps) categories.follow_ups = true;
      if (watchersMode !== "skip") categories.watchers = watchersMode;
      if (draftsMode === "delete") categories.drafts = "delete";
      if (doMarkNotifsRead) categories.notifications = "mark_read";

      const res = await fetch("/api/admin/offboarded-users/reassign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          from_user_id: user.id,
          to_user_id: targetId || null,
          categories,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Reassign failed");
      setResult(data.result);
    } catch (e: any) {
      setError(e?.message || "Reassign failed");
    } finally {
      setSubmitting(false);
    }
  };

  const target = activeMembers.find((m) => m.id === targetId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-xl max-h-[90vh] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div>
            <div className="text-sm font-bold text-[var(--text-primary)]">Reassign workload</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
              From <span className="font-semibold">{user.name}</span> (deactivated)
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {!result && (
            <>
              {/* Target */}
              <div>
                <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1.5">
                  Reassign to {needsTarget && <span className="text-[var(--danger)]">*</span>}
                </label>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                >
                  <option value="">— Pick a team member —</option>
                  {activeMembers.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.email})</option>
                  ))}
                </select>
              </div>

              {/* Categories */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  Categories to transfer
                </div>
                <div className="space-y-2">
                  <CategoryRow
                    enabled={doConversations}
                    onToggle={setDoConversations}
                    label="Assigned conversations"
                    count={user.counts.conversations}
                    requires_target
                    description={`Update assignee_id on ${user.counts.conversations} conversation${user.counts.conversations === 1 ? "" : "s"}.`}
                  />
                  <CategoryRow
                    enabled={doTasks}
                    onToggle={setDoTasks}
                    label="Open tasks"
                    count={user.counts.open_tasks}
                    requires_target
                    description={`Remove ${user.name} from ${user.counts.open_tasks} task assignment${user.counts.open_tasks === 1 ? "" : "s"} and add the target. Tasks with multiple assignees keep the others.`}
                  />
                  <CategoryRow
                    enabled={doFollowUps}
                    onToggle={setDoFollowUps}
                    label="Active call follow-ups"
                    count={user.counts.active_follow_ups}
                    requires_target
                    description={`Reassign ${user.counts.active_follow_ups} pending/in-progress call follow-up${user.counts.active_follow_ups === 1 ? "" : "s"}.`}
                  />

                  {/* Watchers — three-way choice */}
                  <div className="px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-[12px] font-medium text-[var(--text-primary)]">
                        Conversation watchers
                        <span className="ml-2 text-[10px] font-mono text-[var(--text-muted)]">{user.counts.watched_threads}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <ThreeWayChip value={watchersMode} option="transfer" label="Transfer to target" onChange={setWatchersMode} />
                      <ThreeWayChip value={watchersMode} option="delete" label="Just delete" onChange={setWatchersMode} />
                      <ThreeWayChip value={watchersMode} option="skip" label="Skip" onChange={setWatchersMode} />
                    </div>
                  </div>

                  {/* Drafts — keep or delete */}
                  <div className="px-3 py-2.5 rounded-lg border border-[var(--border)] bg-[var(--bg)]">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-[12px] font-medium text-[var(--text-primary)]">
                        Email drafts
                        <span className="ml-2 text-[10px] font-mono text-[var(--text-muted)]">{user.counts.drafts}</span>
                      </div>
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] mb-2">
                      Drafts aren't transferred — they have personal voice and signatures. You can keep them under {user.name} (read-only) or delete them.
                    </div>
                    <div className="flex items-center gap-1">
                      <ThreeWayChip value={draftsMode} option="keep" label="Keep" onChange={setDraftsMode} />
                      <ThreeWayChip value={draftsMode} option="delete" label="Delete all" onChange={setDraftsMode} />
                    </div>
                  </div>

                  {/* Notifications */}
                  <CategoryRow
                    enabled={doMarkNotifsRead}
                    onToggle={setDoMarkNotifsRead}
                    label="Unread notifications"
                    count={user.counts.unread_notifications}
                    requires_target={false}
                    description={`Mark ${user.counts.unread_notifications} unread notification${user.counts.unread_notifications === 1 ? "" : "s"} as read. They'll never see them anyway.`}
                  />
                </div>
              </div>

              {error && (
                <div className="px-3 py-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[11px] text-[var(--danger)] flex items-start gap-2">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="space-y-3">
              <div className="px-3 py-2 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-[12px] text-[var(--accent)] flex items-start gap-2">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                <span>
                  Reassignment complete{target ? ` — workload transferred to ${target.name}` : ""}.
                </span>
              </div>
              <ResultRow label="Conversations" attempted={result.conversations.attempted} ok={!result.conversations.error}
                detail={`Updated ${result.conversations.updated}`} error={result.conversations.error} />
              <ResultRow label="Tasks" attempted={result.tasks.attempted} ok={!result.tasks.error}
                detail={`Removed from ${result.tasks.removed} task${result.tasks.removed === 1 ? "" : "s"}` +
                  (result.tasks.added > 0 ? `, target added to ${result.tasks.added}` : "") +
                  (result.tasks.skipped_already_assigned > 0 ? `, ${result.tasks.skipped_already_assigned} already had target` : "")}
                error={result.tasks.error} />
              <ResultRow label="Call follow-ups" attempted={result.follow_ups.attempted} ok={!result.follow_ups.error}
                detail={`Updated ${result.follow_ups.updated}`} error={result.follow_ups.error} />
              <ResultRow label="Watchers" attempted={result.watchers.attempted} ok={!result.watchers.error}
                detail={result.watchers.transferred > 0 ? `Transferred ${result.watchers.transferred}` : `Deleted ${result.watchers.deleted}`}
                error={result.watchers.error} />
              <ResultRow label="Drafts" attempted={result.drafts.attempted} ok={!result.drafts.error}
                detail={`Deleted ${result.drafts.deleted}`} error={result.drafts.error} />
              <ResultRow label="Notifications" attempted={result.notifications.attempted} ok={!result.notifications.error}
                detail={`Marked ${result.notifications.marked_read} as read`} error={result.notifications.error} />
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-end gap-2 shrink-0">
          {!result ? (
            <>
              <button onClick={onClose} className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-3 py-1.5">
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold disabled:opacity-50 flex items-center gap-1.5"
              >
                {submitting ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
                {submitting ? "Reassigning…" : "Reassign"}
              </button>
            </>
          ) : (
            <button
              onClick={onComplete}
              className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CategoryRow({
  enabled,
  onToggle,
  label,
  count,
  requires_target,
  description,
}: {
  enabled: boolean;
  onToggle: (v: boolean) => void;
  label: string;
  count: number;
  requires_target: boolean;
  description: string;
}) {
  return (
    <button
      onClick={() => onToggle(!enabled)}
      className={`w-full px-3 py-2.5 rounded-lg border text-left transition-colors flex items-start gap-3 ${
        enabled ? "border-[var(--accent)]/40 bg-[var(--accent)]/8" : "border-[var(--border)] bg-[var(--bg)]"
      }`}
      type="button"
    >
      <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 mt-0.5 ${
        enabled ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--bg)]" : "border-[var(--text-muted)]"
      }`}>
        {enabled && <CheckCircle2 size={10} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-medium text-[var(--text-primary)]">
            {label}
            <span className="ml-2 text-[10px] font-mono text-[var(--text-muted)]">{count}</span>
            {requires_target && (
              <span className="ml-1.5 text-[9px] text-[var(--text-muted)] font-normal italic">requires target</span>
            )}
          </div>
        </div>
        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{description}</div>
      </div>
    </button>
  );
}

function ThreeWayChip({
  value,
  option,
  label,
  onChange,
}: {
  value: string;
  option: string;
  label: string;
  onChange: (v: any) => void;
}) {
  const selected = value === option;
  return (
    <button
      onClick={() => onChange(option)}
      className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
        selected ? "bg-[var(--accent)] text-[var(--bg)]" : "bg-[var(--surface)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      }`}
      type="button"
    >
      {label}
    </button>
  );
}

function ResultRow({
  label,
  attempted,
  ok,
  detail,
  error,
}: {
  label: string;
  attempted: boolean;
  ok: boolean;
  detail: string;
  error: string | null;
}) {
  if (!attempted) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
        <span className="w-3 h-3 rounded-full bg-[var(--text-muted)]/20" />
        <span className="font-medium w-32">{label}</span>
        <span className="italic">skipped</span>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className={`w-3 h-3 rounded-full ${ok ? "bg-[var(--accent)]" : "bg-[var(--danger)]"} mt-0.5 shrink-0`} />
      <span className="font-medium w-32 text-[var(--text-primary)] shrink-0">{label}</span>
      <span className={ok ? "text-[var(--text-secondary)]" : "text-[var(--danger)]"}>
        {ok ? detail : error}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// OffboardedUserDetailView — per-user drill-down with tabs
// ─────────────────────────────────────────────────────────

type DetailTab = "conversations" | "tasks" | "follow_ups" | "watchers" | "drafts";

function OffboardedUserDetailView({
  userId,
  userName,
  userInitials,
  userColor,
  userEmail,
  counts,
  activeMembers,
  onBack,
  onBulkReassign,
}: {
  userId: string;
  userName: string;
  userInitials: string;
  userColor: string;
  userEmail: string;
  counts: OffboardedUser["counts"] | undefined;
  activeMembers: ActiveMember[];
  onBack: () => void;
  onBulkReassign: () => void;
}) {
  const [activeTab, setActiveTab] = useState<DetailTab>("conversations");

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="px-2.5 py-1.5 rounded-md border border-[var(--border)] text-[var(--text-secondary)] text-[11px] font-medium hover:bg-[var(--bg)] inline-flex items-center gap-1"
          >
            <ArrowLeft size={11} />
            Back to list
          </button>
          <div className="flex items-center gap-2">
            <span
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-[var(--bg)] opacity-60"
              style={{ background: userColor }}
            >
              {userInitials}
            </span>
            <div>
              <div className="text-[14px] font-bold text-[var(--text-primary)] flex items-center gap-1.5">
                <span className="line-through opacity-70">{userName}</span>
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--text-muted)]/15 text-[var(--text-muted)]">
                  Deactivated
                </span>
              </div>
              <div className="text-[10px] text-[var(--text-muted)] font-mono">{userEmail}</div>
            </div>
          </div>
        </div>
        <button
          onClick={onBulkReassign}
          className="px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold hover:opacity-90"
        >
          Reassign everything →
        </button>
      </div>

      {/* Tab strip */}
      <div className="flex items-center gap-1 border-b border-[var(--border)] -mb-px overflow-x-auto">
        <DetailTabButton
          active={activeTab === "conversations"}
          onClick={() => setActiveTab("conversations")}
          label="Conversations"
          count={counts?.conversations ?? 0}
        />
        <DetailTabButton
          active={activeTab === "tasks"}
          onClick={() => setActiveTab("tasks")}
          label="Open Tasks"
          count={counts?.open_tasks ?? 0}
        />
        <DetailTabButton
          active={activeTab === "follow_ups"}
          onClick={() => setActiveTab("follow_ups")}
          label="Call Follow-ups"
          count={counts?.active_follow_ups ?? 0}
        />
        <DetailTabButton
          active={activeTab === "watchers"}
          onClick={() => setActiveTab("watchers")}
          label="Watchers"
          count={counts?.watched_threads ?? 0}
        />
        <DetailTabButton
          active={activeTab === "drafts"}
          onClick={() => setActiveTab("drafts")}
          label="Drafts"
          count={counts?.drafts ?? 0}
        />
      </div>

      {/* Tab content */}
      <div className="pt-2">
        {activeTab === "conversations" && <ConversationsTab userId={userId} activeMembers={activeMembers} />}
        {activeTab === "tasks" && <TasksTab userId={userId} activeMembers={activeMembers} />}
        {activeTab === "follow_ups" && <FollowUpsTab userId={userId} activeMembers={activeMembers} />}
        {activeTab === "watchers" && <WatchersTab userId={userId} activeMembers={activeMembers} />}
        {activeTab === "drafts" && <DraftsTab userId={userId} />}
      </div>
    </div>
  );
}

function DetailTabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-2 text-[11px] font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
        active
          ? "border-[var(--accent)] text-[var(--text-primary)]"
          : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
      }`}
    >
      {label}
      <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-mono ${
        active ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "bg-[var(--border)] text-[var(--text-muted)]"
      }`}>
        {count}
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────
// Generic tab plumbing — search box + sort dropdown +
// selection state + bulk action bar.
// ─────────────────────────────────────────────────────────

function useListLoader<T extends { id: string }>(
  userId: string,
  category: string,
  q: string,
  sort: string,
) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ category, q, sort, limit: "200" });
        const res = await fetch(`/api/admin/offboarded-users/${userId}/items?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data?.error || "Failed to load");
        setItems((data.items || []) as T[]);
        setTotal(data.total || 0);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, category, q, sort, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);
  return { items, total, loading, error, refresh };
}

function SelectionToolbar({
  count,
  onClearSelection,
  children,
}: {
  count: number;
  onClearSelection: () => void;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <div className="sticky top-0 z-10 -mx-1 px-3 py-2 mb-2 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[11px] text-[var(--text-primary)]">
        <span className="font-semibold">{count} selected</span>
        <button onClick={onClearSelection} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] underline">
          Clear
        </button>
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

function SearchAndSort({
  q,
  setQ,
  sort,
  setSort,
  sortOptions,
  totalLabel,
}: {
  q: string;
  setQ: (v: string) => void;
  sort: string;
  setSort: (v: string) => void;
  sortOptions: Array<{ value: string; label: string }>;
  totalLabel: string;
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search…"
        className="flex-1 px-2.5 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)]"
      />
      <select
        value={sort}
        onChange={(e) => setSort(e.target.value)}
        className="px-2 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
      >
        {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="text-[10px] text-[var(--text-muted)] font-mono whitespace-nowrap">{totalLabel}</span>
    </div>
  );
}

function MemberPicker({
  value,
  onChange,
  activeMembers,
  placeholder = "— Pick team member —",
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  activeMembers: ActiveMember[];
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`px-2 py-1.5 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] ${className}`}
    >
      <option value="">{placeholder}</option>
      {activeMembers.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  );
}

async function postAction(userId: string, body: any): Promise<{ ok: boolean; applied: number; error?: string }> {
  try {
    const res = await fetch(`/api/admin/offboarded-users/${userId}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { ok: false, applied: 0, error: data?.error || "Action failed" };
    return { ok: true, applied: data.applied || 0 };
  } catch (e: any) {
    return { ok: false, applied: 0, error: e?.message || "Action failed" };
  }
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 60000);
  if (diff < 60) return `${diff}m ago`;
  if (diff < 60 * 24) return `${Math.floor(diff / 60)}h ago`;
  if (diff < 60 * 24 * 30) return `${Math.floor(diff / (60 * 24))}d ago`;
  return d.toLocaleDateString();
}

// ─────────────────────────────────────────────────────────
// ConversationsTab
// ─────────────────────────────────────────────────────────

function ConversationsTab({ userId, activeMembers }: { userId: string; activeMembers: ActiveMember[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("default");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { items, total, loading, error, refresh } = useListLoader<any>(userId, "conversations", q, sort);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.id)));
  };

  const doBulk = async (action: "reassign_conversations" | "unassign_conversations") => {
    if (selected.size === 0) return;
    if (action === "reassign_conversations" && !bulkTarget) {
      setMsg("Pick a target team member first");
      return;
    }
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, {
      action,
      item_ids: Array.from(selected),
      to_user_id: action === "reassign_conversations" ? bulkTarget : null,
    });
    setWorking(false);
    if (r.ok) {
      setMsg(`${action === "unassign_conversations" ? "Sent to team inbox" : "Reassigned"}: ${r.applied} conversation${r.applied === 1 ? "" : "s"}`);
      setSelected(new Set());
      refresh();
    } else {
      setMsg(`Error: ${r.error}`);
    }
  };

  const doSingle = async (id: string, action: "reassign_conversations" | "unassign_conversations", targetId?: string) => {
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, { action, item_ids: [id], to_user_id: targetId || null });
    setWorking(false);
    if (r.ok) refresh();
    else setMsg(`Error: ${r.error}`);
  };

  return (
    <div>
      <SearchAndSort q={q} setQ={setQ} sort={sort} setSort={setSort}
        sortOptions={[
          { value: "default", label: "Newest message first" },
          { value: "last_message_at_asc", label: "Oldest message first" },
          { value: "subject", label: "Subject A → Z" },
        ]}
        totalLabel={`Showing ${items.length} of ${total}`}
      />

      <SelectionToolbar count={selected.size} onClearSelection={() => setSelected(new Set())}>
        <MemberPicker value={bulkTarget} onChange={setBulkTarget} activeMembers={activeMembers} />
        <button
          onClick={() => doBulk("reassign_conversations")}
          disabled={working || !bulkTarget}
          className="px-2 py-1 rounded text-[10px] font-bold bg-[var(--accent)] text-[var(--bg)] disabled:opacity-50"
        >
          Reassign selected
        </button>
        <button
          onClick={() => doBulk("unassign_conversations")}
          disabled={working}
          className="px-2 py-1 rounded text-[10px] font-bold border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg)] disabled:opacity-50"
        >
          ↩ Send to team inbox
        </button>
      </SelectionToolbar>

      {msg && (
        <div className={`mb-2 px-2 py-1.5 rounded text-[11px] ${msg.startsWith("Error") ? "bg-[var(--danger)]/10 text-[var(--danger)]" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
          {msg}
        </div>
      )}

      {loading ? <TabLoading /> : error ? <TabError msg={error} /> : items.length === 0 ? (
        <TabEmpty msg="No assigned conversations." />
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
              <tr>
                <th className="text-left px-3 py-2 w-[40px]">
                  <input type="checkbox" checked={items.length > 0 && selected.size === items.length}
                    onChange={toggleAll} className="cursor-pointer" />
                </th>
                <th className="text-left px-3 py-2">Subject</th>
                <th className="text-left px-3 py-2 w-[140px]">Account</th>
                <th className="text-left px-3 py-2 w-[120px]">Last message</th>
                <th className="text-right px-3 py-2 w-[140px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((c: any) => (
                <ConversationRow key={c.id}
                  conversation={c}
                  selected={selected.has(c.id)}
                  onToggle={() => toggle(c.id)}
                  activeMembers={activeMembers}
                  onReassign={(target) => doSingle(c.id, "reassign_conversations", target)}
                  onUnassign={() => doSingle(c.id, "unassign_conversations")}
                  working={working}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConversationRow({
  conversation, selected, onToggle, activeMembers, onReassign, onUnassign, working,
}: {
  conversation: any;
  selected: boolean;
  onToggle: () => void;
  activeMembers: ActiveMember[];
  onReassign: (targetId: string) => void;
  onUnassign: () => void;
  working: boolean;
}) {
  const [rowTarget, setRowTarget] = useState("");
  const c = conversation;
  return (
    <tr className="hover:bg-[var(--bg)]/40">
      <td className="px-3 py-2.5 align-top">
        <input type="checkbox" checked={selected} onChange={onToggle} className="cursor-pointer mt-0.5" />
      </td>
      <td className="px-3 py-2.5 align-top">
        <div className="text-[12px] font-medium text-[var(--text-primary)] truncate max-w-[400px]">{c.subject}</div>
        {c.from_name && <div className="text-[10px] text-[var(--text-muted)] truncate">from {c.from_name}</div>}
        {c.preview && <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[400px]">{c.preview}</div>}
      </td>
      <td className="px-3 py-2.5 align-top">
        {c.email_account_name && (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
            style={{
              background: `color-mix(in srgb, ${c.email_account_color || "var(--text-muted)"} 14%, transparent)`,
              color: c.email_account_color || "var(--text-secondary)",
            }}>
            {c.email_account_icon && <span>{c.email_account_icon}</span>}
            {c.email_account_name}
          </span>
        )}
      </td>
      <td className="px-3 py-2.5 align-top text-[10px] text-[var(--text-muted)]">
        {fmtRelative(c.last_message_at)}
      </td>
      <td className="px-3 py-2.5 align-top">
        <div className="flex items-center gap-1 justify-end">
          <select
            value={rowTarget}
            onChange={(e) => { setRowTarget(e.target.value); if (e.target.value) onReassign(e.target.value); }}
            disabled={working}
            className="px-1.5 py-1 rounded text-[10px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] outline-none"
          >
            <option value="">Reassign to…</option>
            {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button
            onClick={onUnassign}
            disabled={working}
            title="Send back to team inbox (unassign)"
            className="px-1.5 py-1 rounded text-[10px] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg)] disabled:opacity-50"
          >
            ↩
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────
// TasksTab
// ─────────────────────────────────────────────────────────

function TasksTab({ userId, activeMembers }: { userId: string; activeMembers: ActiveMember[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("default");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { items, total, loading, error, refresh } = useListLoader<any>(userId, "tasks", q, sort);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.id)));
  };

  const doBulk = async (action: "reassign_tasks" | "unassign_tasks") => {
    if (selected.size === 0) return;
    if (action === "reassign_tasks" && !bulkTarget) { setMsg("Pick a target team member first"); return; }
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, {
      action,
      item_ids: Array.from(selected),
      to_user_id: action === "reassign_tasks" ? bulkTarget : null,
    });
    setWorking(false);
    if (r.ok) {
      setMsg(`${action === "unassign_tasks" ? "Unassigned" : "Reassigned"}: ${r.applied} task${r.applied === 1 ? "" : "s"}`);
      setSelected(new Set());
      refresh();
    } else setMsg(`Error: ${r.error}`);
  };

  const doSingle = async (id: string, action: "reassign_tasks" | "unassign_tasks", targetId?: string) => {
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, { action, item_ids: [id], to_user_id: targetId || null });
    setWorking(false);
    if (r.ok) refresh();
    else setMsg(`Error: ${r.error}`);
  };

  return (
    <div>
      <SearchAndSort q={q} setQ={setQ} sort={sort} setSort={setSort}
        sortOptions={[
          { value: "default", label: "Due date (soonest)" },
          { value: "due_date_desc", label: "Due date (latest)" },
          { value: "created_at", label: "Newest first" },
        ]}
        totalLabel={`Showing ${items.length} of ${total}`}
      />

      <SelectionToolbar count={selected.size} onClearSelection={() => setSelected(new Set())}>
        <MemberPicker value={bulkTarget} onChange={setBulkTarget} activeMembers={activeMembers} />
        <button onClick={() => doBulk("reassign_tasks")} disabled={working || !bulkTarget}
          className="px-2 py-1 rounded text-[10px] font-bold bg-[var(--accent)] text-[var(--bg)] disabled:opacity-50">
          Reassign selected
        </button>
        <button onClick={() => doBulk("unassign_tasks")} disabled={working}
          className="px-2 py-1 rounded text-[10px] font-bold border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg)] disabled:opacity-50">
          Just remove from tasks
        </button>
      </SelectionToolbar>

      {msg && (
        <div className={`mb-2 px-2 py-1.5 rounded text-[11px] ${msg.startsWith("Error") ? "bg-[var(--danger)]/10 text-[var(--danger)]" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
          {msg}
        </div>
      )}

      {loading ? <TabLoading /> : error ? <TabError msg={error} /> : items.length === 0 ? (
        <TabEmpty msg="No open tasks assigned." />
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
              <tr>
                <th className="text-left px-3 py-2 w-[40px]">
                  <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} />
                </th>
                <th className="text-left px-3 py-2">Task</th>
                <th className="text-left px-3 py-2 w-[120px]">Status</th>
                <th className="text-left px-3 py-2 w-[120px]">Due</th>
                <th className="text-left px-3 py-2 w-[130px]">Also assigned to</th>
                <th className="text-right px-3 py-2 w-[140px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((t: any) => {
                const isOverdue = t.due_date && new Date(t.due_date) < new Date() && t.status !== "completed";
                return (
                  <tr key={t.id} className="hover:bg-[var(--bg)]/40">
                    <td className="px-3 py-2.5 align-top">
                      <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} className="mt-0.5" />
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="text-[12px] text-[var(--text-primary)] line-clamp-2">{t.text}</div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        t.status === "in_progress" ? "bg-[var(--highlight)]/15 text-[var(--highlight)]" :
                        "bg-[var(--info)]/15 text-[var(--info)]"
                      }`}>
                        {t.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {t.due_date ? (
                        <span className={`text-[10px] font-mono ${isOverdue ? "text-[var(--danger)]" : "text-[var(--text-secondary)]"}`}>
                          {new Date(t.due_date).toLocaleDateString()}{t.due_time ? ` ${t.due_time}` : ""}
                        </span>
                      ) : <span className="text-[10px] text-[var(--text-muted)] italic">no due date</span>}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      {t.co_assignees && t.co_assignees.length > 0 ? (
                        <div className="flex -space-x-1">
                          {t.co_assignees.slice(0, 3).map((m: any) => (
                            <span key={m.id} title={m.name}
                              className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-[var(--bg)] border border-[var(--surface)]"
                              style={{ background: m.color || "var(--text-muted)" }}>
                              {m.initials}
                            </span>
                          ))}
                        </div>
                      ) : <span className="text-[10px] text-[var(--text-muted)] italic">solo</span>}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center gap-1 justify-end">
                        <RowReassignSelect activeMembers={activeMembers} onPick={(id) => doSingle(t.id, "reassign_tasks", id)} disabled={working} />
                        <button onClick={() => doSingle(t.id, "unassign_tasks")} disabled={working}
                          title="Remove from this task (no replacement)"
                          className="px-1.5 py-1 rounded text-[10px] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg)] disabled:opacity-50">
                          ×
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Re-usable inline reassign select for table rows
function RowReassignSelect({ activeMembers, onPick, disabled }: { activeMembers: ActiveMember[]; onPick: (id: string) => void; disabled: boolean }) {
  return (
    <select
      onChange={(e) => { if (e.target.value) { onPick(e.target.value); e.target.value = ""; } }}
      disabled={disabled}
      className="px-1.5 py-1 rounded text-[10px] bg-[var(--surface)] border border-[var(--border)] text-[var(--text-primary)] outline-none"
    >
      <option value="">Reassign to…</option>
      {activeMembers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </select>
  );
}

// ─────────────────────────────────────────────────────────
// FollowUpsTab
// ─────────────────────────────────────────────────────────

function FollowUpsTab({ userId, activeMembers }: { userId: string; activeMembers: ActiveMember[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("default");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { items, total, loading, error, refresh } = useListLoader<any>(userId, "follow_ups", q, sort);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.id)));
  };

  const doBulk = async (action: "reassign_follow_ups" | "cancel_follow_ups") => {
    if (selected.size === 0) return;
    if (action === "reassign_follow_ups" && !bulkTarget) { setMsg("Pick a target team member first"); return; }
    if (action === "cancel_follow_ups" && !confirm(`Cancel ${selected.size} follow-up${selected.size === 1 ? "" : "s"}? This deletes the follow-up rows.`)) return;
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, {
      action,
      item_ids: Array.from(selected),
      to_user_id: action === "reassign_follow_ups" ? bulkTarget : null,
    });
    setWorking(false);
    if (r.ok) {
      setMsg(`${action === "cancel_follow_ups" ? "Cancelled" : "Reassigned"}: ${r.applied} follow-up${r.applied === 1 ? "" : "s"}`);
      setSelected(new Set());
      refresh();
    } else setMsg(`Error: ${r.error}`);
  };

  const doSingle = async (id: string, action: "reassign_follow_ups" | "cancel_follow_ups", targetId?: string) => {
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, { action, item_ids: [id], to_user_id: targetId || null });
    setWorking(false);
    if (r.ok) refresh();
    else setMsg(`Error: ${r.error}`);
  };

  return (
    <div>
      <SearchAndSort q={q} setQ={setQ} sort={sort} setSort={setSort}
        sortOptions={[
          { value: "default", label: "Next attempt (soonest)" },
          { value: "created_at_desc", label: "Newest first" },
        ]}
        totalLabel={`Showing ${items.length} of ${total}`}
      />

      <SelectionToolbar count={selected.size} onClearSelection={() => setSelected(new Set())}>
        <MemberPicker value={bulkTarget} onChange={setBulkTarget} activeMembers={activeMembers} />
        <button onClick={() => doBulk("reassign_follow_ups")} disabled={working || !bulkTarget}
          className="px-2 py-1 rounded text-[10px] font-bold bg-[var(--accent)] text-[var(--bg)] disabled:opacity-50">
          Reassign selected
        </button>
        <button onClick={() => doBulk("cancel_follow_ups")} disabled={working}
          className="px-2 py-1 rounded text-[10px] font-bold border border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger)]/8 disabled:opacity-50">
          Cancel follow-ups
        </button>
      </SelectionToolbar>

      {msg && (
        <div className={`mb-2 px-2 py-1.5 rounded text-[11px] ${msg.startsWith("Error") ? "bg-[var(--danger)]/10 text-[var(--danger)]" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
          {msg}
        </div>
      )}

      {loading ? <TabLoading /> : error ? <TabError msg={error} /> : items.length === 0 ? (
        <TabEmpty msg="No active call follow-ups." />
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
              <tr>
                <th className="text-left px-3 py-2 w-[40px]">
                  <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} />
                </th>
                <th className="text-left px-3 py-2">Supplier / Caller</th>
                <th className="text-left px-3 py-2 w-[110px]">Status</th>
                <th className="text-left px-3 py-2 w-[120px]">Next attempt</th>
                <th className="text-right px-3 py-2 w-[140px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((f: any) => (
                <tr key={f.id} className="hover:bg-[var(--bg)]/40">
                  <td className="px-3 py-2.5 align-top">
                    <input type="checkbox" checked={selected.has(f.id)} onChange={() => toggle(f.id)} className="mt-0.5" />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="text-[12px] font-medium text-[var(--text-primary)]">
                      {f.supplier_name || f.person_name || <span className="italic text-[var(--text-muted)]">Unknown</span>}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] font-mono">{f.participant_phone || "—"}</div>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[var(--info)]/15 text-[var(--info)]">
                      {f.status} · attempt {f.attempt_count || 1}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top text-[10px] text-[var(--text-muted)] font-mono">
                    {fmtRelative(f.next_attempt_after)}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex items-center gap-1 justify-end">
                      <RowReassignSelect activeMembers={activeMembers} onPick={(id) => doSingle(f.id, "reassign_follow_ups", id)} disabled={working} />
                      <button onClick={() => { if (confirm("Cancel this follow-up?")) doSingle(f.id, "cancel_follow_ups"); }} disabled={working}
                        title="Cancel follow-up (delete)"
                        className="px-1.5 py-1 rounded text-[10px] border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/8 disabled:opacity-50">
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// WatchersTab
// ─────────────────────────────────────────────────────────

function WatchersTab({ userId, activeMembers }: { userId: string; activeMembers: ActiveMember[] }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("default");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState("");
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { items, total, loading, error, refresh } = useListLoader<any>(userId, "watchers", q, sort);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.id)));
  };

  const doBulk = async (action: "transfer_watchers" | "delete_watchers") => {
    if (selected.size === 0) return;
    if (action === "transfer_watchers" && !bulkTarget) { setMsg("Pick a target team member first"); return; }
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, {
      action,
      item_ids: Array.from(selected),
      to_user_id: action === "transfer_watchers" ? bulkTarget : null,
    });
    setWorking(false);
    if (r.ok) {
      setMsg(`${action === "delete_watchers" ? "Deleted" : "Transferred"}: ${r.applied} watcher row${r.applied === 1 ? "" : "s"}`);
      setSelected(new Set());
      refresh();
    } else setMsg(`Error: ${r.error}`);
  };

  const doSingle = async (id: string, action: "transfer_watchers" | "delete_watchers", targetId?: string) => {
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, { action, item_ids: [id], to_user_id: targetId || null });
    setWorking(false);
    if (r.ok) refresh();
    else setMsg(`Error: ${r.error}`);
  };

  return (
    <div>
      <SearchAndSort q={q} setQ={setQ} sort={sort} setSort={setSort}
        sortOptions={[
          { value: "default", label: "Most active thread first" },
          { value: "last_message_at_asc", label: "Least active first" },
        ]}
        totalLabel={`Showing ${items.length} of ${total}`}
      />

      <SelectionToolbar count={selected.size} onClearSelection={() => setSelected(new Set())}>
        <MemberPicker value={bulkTarget} onChange={setBulkTarget} activeMembers={activeMembers} />
        <button onClick={() => doBulk("transfer_watchers")} disabled={working || !bulkTarget}
          className="px-2 py-1 rounded text-[10px] font-bold bg-[var(--accent)] text-[var(--bg)] disabled:opacity-50">
          Transfer to target
        </button>
        <button onClick={() => doBulk("delete_watchers")} disabled={working}
          className="px-2 py-1 rounded text-[10px] font-bold border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg)] disabled:opacity-50">
          Delete watcher rows
        </button>
      </SelectionToolbar>

      {msg && (
        <div className={`mb-2 px-2 py-1.5 rounded text-[11px] ${msg.startsWith("Error") ? "bg-[var(--danger)]/10 text-[var(--danger)]" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
          {msg}
        </div>
      )}

      {loading ? <TabLoading /> : error ? <TabError msg={error} /> : items.length === 0 ? (
        <TabEmpty msg="No watched conversations." />
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
              <tr>
                <th className="text-left px-3 py-2 w-[40px]">
                  <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} />
                </th>
                <th className="text-left px-3 py-2">Conversation</th>
                <th className="text-left px-3 py-2 w-[140px]">Account</th>
                <th className="text-left px-3 py-2 w-[120px]">Last activity</th>
                <th className="text-right px-3 py-2 w-[160px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((w: any) => (
                <tr key={w.id} className="hover:bg-[var(--bg)]/40">
                  <td className="px-3 py-2.5 align-top">
                    <input type="checkbox" checked={selected.has(w.id)} onChange={() => toggle(w.id)} className="mt-0.5" />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="text-[12px] font-medium text-[var(--text-primary)] truncate max-w-[400px]">{w.subject}</div>
                    {w.preview && <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[400px]">{w.preview}</div>}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {w.email_account_name && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{
                          background: `color-mix(in srgb, ${w.email_account_color || "var(--text-muted)"} 14%, transparent)`,
                          color: w.email_account_color || "var(--text-secondary)",
                        }}>
                        {w.email_account_icon && <span>{w.email_account_icon}</span>}
                        {w.email_account_name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top text-[10px] text-[var(--text-muted)]">{fmtRelative(w.last_message_at)}</td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="flex items-center gap-1 justify-end">
                      <RowReassignSelect activeMembers={activeMembers} onPick={(id) => doSingle(w.id, "transfer_watchers", id)} disabled={working} />
                      <button onClick={() => doSingle(w.id, "delete_watchers")} disabled={working}
                        title="Delete this watch entry"
                        className="px-1.5 py-1 rounded text-[10px] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg)] disabled:opacity-50">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// DraftsTab
// ─────────────────────────────────────────────────────────

function DraftsTab({ userId }: { userId: string }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("default");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { items, total, loading, error, refresh } = useListLoader<any>(userId, "drafts", q, sort);

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i: any) => i.id)));
  };

  const doBulkDelete = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} draft${selected.size === 1 ? "" : "s"}? This is permanent.`)) return;
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, { action: "delete_drafts", item_ids: Array.from(selected) });
    setWorking(false);
    if (r.ok) {
      setMsg(`Deleted ${r.applied} draft${r.applied === 1 ? "" : "s"}`);
      setSelected(new Set());
      refresh();
    } else setMsg(`Error: ${r.error}`);
  };

  const doSingleDelete = async (id: string) => {
    if (!confirm("Delete this draft?")) return;
    setWorking(true);
    setMsg(null);
    const r = await postAction(userId, { action: "delete_drafts", item_ids: [id] });
    setWorking(false);
    if (r.ok) refresh();
    else setMsg(`Error: ${r.error}`);
  };

  return (
    <div>
      <div className="text-[10px] text-[var(--text-muted)] mb-2">
        Drafts have personal voice and aren't transferable. You can review and delete the ones you don't want to keep.
      </div>

      <SearchAndSort q={q} setQ={setQ} sort={sort} setSort={setSort}
        sortOptions={[
          { value: "default", label: "Most recent first" },
          { value: "updated_at_asc", label: "Oldest first" },
        ]}
        totalLabel={`Showing ${items.length} of ${total}`}
      />

      <SelectionToolbar count={selected.size} onClearSelection={() => setSelected(new Set())}>
        <button onClick={doBulkDelete} disabled={working}
          className="px-2 py-1 rounded text-[10px] font-bold bg-[var(--danger)] text-[var(--bg)] disabled:opacity-50">
          Delete selected
        </button>
      </SelectionToolbar>

      {msg && (
        <div className={`mb-2 px-2 py-1.5 rounded text-[11px] ${msg.startsWith("Error") ? "bg-[var(--danger)]/10 text-[var(--danger)]" : "bg-[var(--accent)]/10 text-[var(--accent)]"}`}>
          {msg}
        </div>
      )}

      {loading ? <TabLoading /> : error ? <TabError msg={error} /> : items.length === 0 ? (
        <TabEmpty msg="No drafts." />
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-[12px]">
            <thead className="bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
              <tr>
                <th className="text-left px-3 py-2 w-[40px]">
                  <input type="checkbox" checked={items.length > 0 && selected.size === items.length} onChange={toggleAll} />
                </th>
                <th className="text-left px-3 py-2">Subject</th>
                <th className="text-left px-3 py-2">To</th>
                <th className="text-left px-3 py-2 w-[110px]">Updated</th>
                <th className="text-right px-3 py-2 w-[80px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((d: any) => (
                <tr key={d.id} className="hover:bg-[var(--bg)]/40">
                  <td className="px-3 py-2.5 align-top">
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} className="mt-0.5" />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <div className="text-[12px] font-medium text-[var(--text-primary)] truncate max-w-[300px]">{d.subject}</div>
                  </td>
                  <td className="px-3 py-2.5 align-top text-[11px] text-[var(--text-secondary)] truncate max-w-[260px] font-mono">
                    {d.to_addresses || <span className="italic text-[var(--text-muted)]">no recipients</span>}
                  </td>
                  <td className="px-3 py-2.5 align-top text-[10px] text-[var(--text-muted)] font-mono">{fmtRelative(d.updated_at)}</td>
                  <td className="px-3 py-2.5 align-top text-right">
                    <button onClick={() => doSingleDelete(d.id)} disabled={working}
                      className="px-1.5 py-1 rounded text-[10px] border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/8 disabled:opacity-50">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Tab utility components
// ─────────────────────────────────────────────────────────

function TabLoading() {
  return (
    <div className="py-8 flex items-center justify-center text-[var(--text-muted)] text-[11px]">
      <Loader2 size={14} className="animate-spin mr-2" /> Loading…
    </div>
  );
}

function TabError({ msg }: { msg: string }) {
  return (
    <div className="px-3 py-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[11px] text-[var(--danger)] flex items-start gap-2">
      <AlertTriangle size={12} className="mt-0.5 shrink-0" />
      <span>{msg}</span>
    </div>
  );
}

function TabEmpty({ msg }: { msg: string }) {
  return (
    <div className="py-12 text-center text-[var(--text-muted)] text-[12px]">{msg}</div>
  );
}