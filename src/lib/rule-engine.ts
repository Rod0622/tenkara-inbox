import { createServerClient } from "@/lib/supabase";
import crypto from "crypto";

// ── Types ──────────────────────────────────────────────────

interface Condition {
  field: string;
  operator: string;
  value: string;
  required?: boolean;
}

interface ConditionGroup {
  match_mode: "all" | "any" | "none";
  conditions: (Condition | ConditionGroup)[];
}

interface Action {
  type: string;
  value: string;
  task_description?: string;
  task_assignee_mode?: "all" | "assigned_users" | "specific" | "initiator";
  task_assignee_ids?: string[];
  task_due_days?: number;
  task_due_hours?: number;
  webhook_secret?: string;
  webhook_run_once?: boolean;
}

interface RuleRow {
  id: string;
  name: string;
  is_active: boolean;
  trigger_type: string;
  match_mode: "all" | "any" | "none";
  conditions: (Condition | ConditionGroup)[];
  actions: Action[];
  account_ids?: string[] | null;
  condition_field?: string;
  condition_operator?: string;
  condition_value?: string;
  action_type?: string;
  action_value?: string;
}

export interface MessageContext {
  conversation_id: string;
  message_id?: string;
  subject: string;
  from_email: string;
  from_name: string;
  to_addresses: string;
  cc_addresses?: string;
  bcc_addresses?: string;
  body_text: string;
  body_html?: string;
  email_account_id?: string;
  has_attachments?: boolean;
  sent_by_user_id?: string;
  headers?: Record<string, string>;
}

// Event-based trigger context (label changes, comments, assignment, status, team)
export interface RuleEvent {
  event_type:
    | "label_added"
    | "label_removed"
    | "new_comment"
    | "assignee_changed"
    | "conversation_closed"
    | "team_changed"
    | "conversation_reopened";
  conversation_id: string;
  initiator_user_id?: string | null;
  event_key: string;
  // Label change context
  label_id?: string;
  label_name?: string;
  // Comment context
  comment_text?: string;
  comment_type?: "note" | "task" | "comment";
  comment_id?: string;
  // Comment mentions (Batch 2): list of mentioned user IDs.
  // The special token "@everyone" is included as a literal string when @everyone was used.
  mentioned_user_ids?: string[];
  // Assignment context (assignee_changed)
  new_assignee_id?: string | null;
  old_assignee_id?: string | null;
  added_assignee_id?: string | null;     // Same as new when assignment changes; null on pure unassign
  removed_assignee_id?: string | null;   // Same as old; null on pure assign-from-empty
  // Status context (conversation_closed, conversation_reopened)
  new_status?: string;
  old_status?: string;
  // Team / folder context (team_changed)
  new_team_id?: string | null;
  old_team_id?: string | null;
  new_team_name?: string | null;
  old_team_name?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────

function isConditionGroup(item: any): item is ConditionGroup {
  return item && "match_mode" in item && "conditions" in item && Array.isArray(item.conditions);
}

function getFieldValue(msg: MessageContext | undefined, field: string, event?: RuleEvent): string {
  if (event) {
    switch (field) {
      case "added_label_name":
        return event.event_type === "label_added" ? event.label_name || "" : "";
      case "removed_label_name":
        return event.event_type === "label_removed" ? event.label_name || "" : "";
      case "comment_text":
        return event.comment_text || "";
      case "comment_type":
        return event.comment_type || "";
      case "action_initiator":
        return event.initiator_user_id || "";
    }
  } else {
    if (
      field === "added_label_name" ||
      field === "removed_label_name" ||
      field === "comment_text" ||
      field === "comment_type" ||
      field === "action_initiator"
    ) {
      return "";
    }
  }

  if (!msg) return "";

  switch (field) {
    case "subject": return msg.subject || "";
    case "from_email": return msg.from_email || "";
    case "sender_domain": return (msg.from_email || "").split("@")[1] || "";
    case "from_name": return msg.from_name || "";
    case "to_addresses": return msg.to_addresses || "";
    case "cc_addresses": return msg.cc_addresses || "";
    case "bcc_addresses": return msg.bcc_addresses || "";
    case "to_cc_bcc": return [msg.to_addresses, msg.cc_addresses, msg.bcc_addresses].filter(Boolean).join(", ");
    case "body_text": return msg.body_text || "";
    case "any_field": return [msg.from_email, msg.from_name, msg.to_addresses, msg.cc_addresses, msg.bcc_addresses, msg.subject, msg.body_text].filter(Boolean).join(" ");
    case "email_account": return msg.email_account_id || "";
    case "has_attachments": return msg.has_attachments ? "true" : "false";
    case "headers": return msg.headers ? Object.entries(msg.headers).map(([k, v]) => `${k}: ${v}`).join("\n") : "";
    default: return "";
  }
}

function evaluateCondition(fieldValue: string, operator: string, conditionValue: string): boolean {
  const field = (fieldValue || "").toLowerCase();
  const value = (conditionValue || "").toLowerCase();
  switch (operator) {
    case "contains": return field.includes(value);
    case "not_contains": return !field.includes(value);
    case "equals": case "is": return field === value;
    case "not_equals": case "is_not": return field !== value;
    case "starts_with": return field.startsWith(value);
    case "ends_with": return field.endsWith(value);
    case "is_true": return field === "true";
    case "is_false": return field === "false" || field === "";
    case "is_present": return field.length > 0;
    case "is_absent": return field.length === 0;
    case "greater_than": return parseFloat(field) > parseFloat(value);
    case "less_than": return parseFloat(field) < parseFloat(value);
    default: return false;
  }
}

function parseDelayToHours(value: string): number {
  const v = value.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v) * 24;
  let totalHours = 0;
  const dayMatch = v.match(/(\d+)\s*d/);
  const hourMatch = v.match(/(\d+)\s*h/);
  const minMatch = v.match(/(\d+)\s*m/);
  if (dayMatch) totalHours += parseInt(dayMatch[1]) * 24;
  if (hourMatch) totalHours += parseInt(hourMatch[1]);
  if (minMatch) totalHours += parseInt(minMatch[1]) / 60;
  return totalHours || parseFloat(v) * 24;
}

interface LazyContext {
  supabase: any;
  conversationId: string;
  msg?: MessageContext;
  event?: RuleEvent;
  _convo: any;
  _labels: string[] | null;
  _msgCount: number | null;
}

async function getConvo(ctx: LazyContext) {
  if (!ctx._convo) {
    const { data } = await ctx.supabase.from("conversations").select("status, assignee_id, folder_id, created_at").eq("id", ctx.conversationId).maybeSingle();
    ctx._convo = data || {};
  }
  return ctx._convo;
}

async function getLabels(ctx: LazyContext) {
  if (ctx._labels === null) {
    const { data } = await ctx.supabase.from("conversation_labels").select("label_id").eq("conversation_id", ctx.conversationId);
    ctx._labels = (data || []).map((r: any) => r.label_id);
  }
  return ctx._labels!;
}

async function getMsgCount(ctx: LazyContext) {
  if (ctx._msgCount === null) {
    const { count } = await ctx.supabase.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", ctx.conversationId);
    ctx._msgCount = count || 0;
  }
  return ctx._msgCount!;
}

async function resolveLabelIdFromValue(supabase: any, value: string): Promise<string | null> {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) {
    return trimmed;
  }
  const { data } = await supabase.from("labels").select("id").ilike("name", trimmed).limit(1).maybeSingle();
  return data?.id || null;
}

async function evaluateSingleCondition(ctx: LazyContext, c: Condition): Promise<boolean> {
  const { supabase, conversationId } = ctx;

  if (c.field === "added_label_name" || c.field === "removed_label_name") {
    const eventMatches =
      (c.field === "added_label_name" && ctx.event?.event_type === "label_added") ||
      (c.field === "removed_label_name" && ctx.event?.event_type === "label_removed");
    if (!eventMatches) return false;
    const labelName = ctx.event?.label_name || "";
    const labelId = ctx.event?.label_id || "";
    const target = (c.value || "").trim();
    if (!target) return c.operator === "is_present" ? !!labelName : false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target)) {
      return evaluateCondition(labelId, c.operator, target);
    }
    return evaluateCondition(labelName, c.operator, target);
  }

  if (c.field === "comment_text") {
    return evaluateCondition(ctx.event?.comment_text || "", c.operator, c.value);
  }
  if (c.field === "comment_type") {
    return evaluateCondition(ctx.event?.comment_type || "", c.operator, c.value);
  }
  if (c.field === "action_initiator") {
    const initiator = ctx.event?.initiator_user_id || "";
    if (c.operator === "is_present") return initiator.length > 0;
    if (c.operator === "is_absent") return initiator.length === 0;
    return evaluateCondition(initiator, c.operator, c.value);
  }

  // Comment mention condition (Batch 2): only meaningful for new_comment events
  if (c.field === "comment_mention") {
    if (ctx.event?.event_type !== "new_comment") return false;
    const mentions = ctx.event?.mentioned_user_ids || [];

    // is_present: any mention at all (including @everyone)
    if (c.operator === "is_present") return mentions.length > 0;
    // is_absent: no mentions
    if (c.operator === "is_absent") return mentions.length === 0;

    // is / is_not / equals / etc — check if the value (a user ID or "@everyone")
    // is in the mentioned_user_ids list. Special handling: an @everyone mention
    // matches any specific-user check too, since @everyone implies the user was notified.
    const target = c.value;
    if (!target) return false;

    const directMatch = mentions.includes(target);
    const everyoneIncludes = mentions.includes("@everyone") && target !== "@everyone";

    const matched = directMatch || everyoneIncludes;
    if (c.operator === "is" || c.operator === "equals") return matched;
    if (c.operator === "is_not" || c.operator === "not_equals") return !matched;
    return matched;
  }

  // ── Team change conditions (only meaningful for team_changed event) ──
  if (c.field === "new_team") {
    if (ctx.event?.event_type !== "team_changed") return false;
    const teamId = ctx.event?.new_team_id || "";
    if (c.operator === "is_present") return teamId.length > 0;
    if (c.operator === "is_absent") return teamId.length === 0;
    return evaluateCondition(teamId, c.operator, c.value);
  }
  if (c.field === "previous_team") {
    if (ctx.event?.event_type !== "team_changed") return false;
    const teamId = ctx.event?.old_team_id || "";
    if (c.operator === "is_present") return teamId.length > 0;
    if (c.operator === "is_absent") return teamId.length === 0;
    return evaluateCondition(teamId, c.operator, c.value);
  }

  // ── Assignee change conditions (only meaningful for assignee_changed event) ──
  if (c.field === "added_assignee") {
    if (ctx.event?.event_type !== "assignee_changed") return false;
    const assigneeId = ctx.event?.added_assignee_id || "";
    if (c.operator === "is_present") return assigneeId.length > 0;
    if (c.operator === "is_absent") return assigneeId.length === 0;
    return evaluateCondition(assigneeId, c.operator, c.value);
  }
  if (c.field === "removed_assignee") {
    if (ctx.event?.event_type !== "assignee_changed") return false;
    const assigneeId = ctx.event?.removed_assignee_id || "";
    if (c.operator === "is_present") return assigneeId.length > 0;
    if (c.operator === "is_absent") return assigneeId.length === 0;
    return evaluateCondition(assigneeId, c.operator, c.value);
  }

  if (c.field === "conversation_status") {
    const convo = await getConvo(ctx);
    return evaluateCondition(convo.status || "open", c.operator, c.value);
  }
  if (c.field === "assignee") {
    const convo = await getConvo(ctx);
    return evaluateCondition(convo.assignee_id || "", c.operator, c.value === "__unassigned__" ? "" : c.value);
  }
  if (c.field === "assignee_is_ooo") {
    const convo = await getConvo(ctx);
    if (!convo.assignee_id) {
      // No assignee → not OOO (vacuously); is_true returns false, is_false returns true
      if (c.operator === "is_true") return false;
      if (c.operator === "is_false") return true;
      return false;
    }
    try {
      const { data, error } = await ctx.supabase.rpc("is_user_ooo", { p_user_id: convo.assignee_id });
      if (error) return false;
      const isOOO = data === true;
      if (c.operator === "is_true") return isOOO;
      if (c.operator === "is_false") return !isOOO;
      return isOOO;
    } catch {
      return false;
    }
  }
  if (c.field === "watching_user") {
    // Checks if a specific user (c.value) is watching this conversation.
    // c.operator: is / is_not (or is_present / is_absent for "anyone watching" check)
    if (c.operator === "is_present" || c.operator === "is_absent") {
      const { count } = await ctx.supabase
        .from("conversation_watchers")
        .select("user_id", { count: "exact", head: true })
        .eq("conversation_id", ctx.conversationId);
      const has = (count || 0) > 0;
      return c.operator === "is_present" ? has : !has;
    }
    if (!c.value) return false;
    const { data } = await ctx.supabase
      .from("conversation_watchers")
      .select("user_id")
      .eq("conversation_id", ctx.conversationId)
      .eq("user_id", c.value)
      .maybeSingle();
    const isWatching = !!data;
    if (c.operator === "is" || c.operator === "equals") return isWatching;
    if (c.operator === "is_not" || c.operator === "not_equals") return !isWatching;
    return isWatching;
  }
  if (c.field === "folder") {
    const convo = await getConvo(ctx);
    return evaluateCondition(convo.folder_id || "", c.operator, c.value);
  }
  if (c.field === "has_label") {
    const lbls = await getLabels(ctx);
    const labelId = await resolveLabelIdFromValue(supabase, c.value);
    if (!labelId) {
      if (c.operator === "is_not" || c.operator === "not_equals") return true;
      return false;
    }
    if (c.operator === "equals" || c.operator === "is") return lbls.includes(labelId);
    if (c.operator === "not_equals" || c.operator === "is_not") return !lbls.includes(labelId);
    return lbls.includes(labelId);
  }
  if (c.field === "message_count") {
    const count = await getMsgCount(ctx);
    return evaluateCondition(count.toString(), c.operator, c.value);
  }
  if (c.field === "has_reply") {
    const { count } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("is_outbound", true);
    return c.operator === "is_true" ? (count || 0) > 0 : (count || 0) === 0;
  }
  if (c.field === "time_since_created") {
    const convo = await getConvo(ctx);
    if (!convo.created_at) return false;
    const hours = (Date.now() - new Date(convo.created_at).getTime()) / (1000 * 60 * 60);
    return evaluateCondition(hours.toString(), c.operator, c.value);
  }
  if (c.field === "delay") {
    const convo = await getConvo(ctx);
    if (!convo.created_at) return false;
    const elapsed = (Date.now() - new Date(convo.created_at).getTime()) / (1000 * 60 * 60);
    return elapsed >= parseDelayToHours(c.value);
  }
  if (c.field === "time_since_last_outbound") {
    const { data: lastOut } = await supabase.from("messages").select("sent_at").eq("conversation_id", conversationId).eq("is_outbound", true).order("sent_at", { ascending: false }).limit(1).maybeSingle();
    if (!lastOut) return false;
    const hours = (Date.now() - new Date(lastOut.sent_at).getTime()) / (1000 * 60 * 60);
    return evaluateCondition(hours.toString(), c.operator, c.value);
  }

  return evaluateCondition(getFieldValue(ctx.msg, c.field, ctx.event), c.operator, c.value);
}

async function evaluateNode(ctx: LazyContext, node: Condition | ConditionGroup): Promise<boolean> {
  if (isConditionGroup(node)) return evaluateGroupNode(ctx, node);
  return evaluateSingleCondition(ctx, node as Condition);
}

async function evaluateGroupNode(ctx: LazyContext, group: ConditionGroup): Promise<boolean> {
  if (!group.conditions || group.conditions.length === 0) return false;
  const results: boolean[] = [];
  for (const item of group.conditions) {
    results.push(await evaluateNode(ctx, item));
  }
  switch (group.match_mode) {
    case "all": return results.every(Boolean);
    case "any": return results.some(Boolean);
    case "none": return results.every((r) => !r);
    default: return false;
  }
}

async function evaluateConditions(
  supabase: any, conversationId: string,
  msg: MessageContext | undefined, event: RuleEvent | undefined,
  conditions: (Condition | ConditionGroup)[], matchMode: "all" | "any" | "none"
): Promise<boolean> {
  if (conditions.length === 0) return false;
  const ctx: LazyContext = { supabase, conversationId, msg, event, _convo: null, _labels: null, _msgCount: null };

  if (conditions.some(isConditionGroup)) {
    return evaluateGroupNode(ctx, { match_mode: matchMode, conditions });
  }

  const flat = conditions as Condition[];
  const results: { required: boolean; result: boolean }[] = [];
  for (const c of flat) {
    results.push({ required: !!c.required, result: await evaluateSingleCondition(ctx, c) });
  }

  const req = results.filter((r) => r.required);
  const opt = results.filter((r) => !r.required);
  if (req.length > 0 && !req.every((r) => r.result)) return false;
  if (opt.length === 0) return req.length > 0 ? req.every((r) => r.result) : false;

  const optVals = opt.map((r) => r.result);
  switch (matchMode) {
    case "all": return optVals.every(Boolean);
    case "any": return optVals.some(Boolean);
    case "none": return optVals.every((r) => !r);
    default: return false;
  }
}

async function executeAction(
  supabase: any, conversationId: string, action: Action,
  msg?: MessageContext, ruleId?: string, event?: RuleEvent
): Promise<string | null> {
  try {
    switch (action.type) {
      case "add_label": {
        if (!action.value) return null;
        await supabase.from("conversation_labels").upsert({ conversation_id: conversationId, label_id: action.value });
        return "Added label";
      }
      case "remove_label": {
        if (!action.value) return null;
        await supabase.from("conversation_labels").delete().eq("conversation_id", conversationId).eq("label_id", action.value);
        return "Removed label";
      }
      case "assign_to": {
        if (!action.value) return null;

        // Helper: check if a user is OOO right now via DB function.
        // Returns true if OOO, false otherwise. Errors fail open (treat as not OOO).
        const isUserOOO = async (uid: string): Promise<boolean> => {
          try {
            const { data, error } = await supabase.rpc("is_user_ooo", { p_user_id: uid });
            if (error) return false;
            return data === true;
          } catch { return false; }
        };

        if (action.value === "__initiator__") {
          const initiatorId = event?.initiator_user_id;
          if (!initiatorId) return null;
          if (await isUserOOO(initiatorId)) {
            return "Skipped: initiator is OOO";
          }
          await supabase.from("conversations").update({ assignee_id: initiatorId }).eq("id", conversationId);
          return "Assigned to initiator";
        }
        if (action.value.startsWith("auto:")) {
          const parts = action.value.split(":");
          const strategy = parts[1]; const pool = parts[2] || "all"; const extra = parts[3] || "all";
          let memberIds: string[] = [];
          if (pool === "all") {
            const { data } = await supabase.from("team_members").select("id").eq("is_active", true);
            memberIds = (data || []).map((m: any) => m.id);
          } else {
            const { data } = await supabase.from("user_group_members").select("team_member_id").eq("user_group_id", pool);
            memberIds = (data || []).map((m: any) => m.team_member_id);
          }
          if (memberIds.length === 0) return null;

          // Filter out OOO members BEFORE strategy selection.
          // Run all OOO checks in parallel for speed, then keep only non-OOO.
          const oooFlags = await Promise.all(memberIds.map((id) => isUserOOO(id)));
          const availableIds = memberIds.filter((_, idx) => !oooFlags[idx]);
          if (availableIds.length === 0) {
            return "Skipped: all candidates are OOO";
          }
          memberIds = availableIds;

          let chosenId: string;
          if (strategy === "random") { chosenId = memberIds[Math.floor(Math.random() * memberIds.length)]; }
          else if (strategy === "round_robin") {
            const { data: last } = await supabase.from("activity_log").select("details").eq("action", "rule_executed").not("details->auto_assigned_to", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
            const lastIdx = last?.details?.auto_assigned_to ? memberIds.indexOf(last.details.auto_assigned_to) : -1;
            chosenId = memberIds[(lastIdx + 1) % memberIds.length];
          } else if (strategy === "least_conversations") {
            const counts: { id: string; count: number }[] = [];
            for (const mid of memberIds) { const { count } = await supabase.from("conversations").select("id", { count: "exact", head: true }).eq("assignee_id", mid).eq("status", "open"); counts.push({ id: mid, count: count || 0 }); }
            counts.sort((a, b) => a.count - b.count); chosenId = counts[0].id;
          } else if (strategy === "least_tasks") {
            const counts: { id: string; count: number }[] = [];
            for (const mid of memberIds) { let q = supabase.from("tasks").select("id", { count: "exact", head: true }).eq("assignee_id", mid).eq("status", "todo"); if (extra !== "all") q = q.eq("category_id", extra); const { count } = await q; counts.push({ id: mid, count: count || 0 }); }
            counts.sort((a, b) => a.count - b.count); chosenId = counts[0].id;
          } else { chosenId = memberIds[0]; }
          await supabase.from("conversations").update({ assignee_id: chosenId }).eq("id", conversationId);
          await supabase.from("activity_log").insert({ conversation_id: conversationId, actor_id: null, action: "rule_executed", details: { auto_assigned_to: chosenId, strategy, pool } });
          const { data: member } = await supabase.from("team_members").select("name").eq("id", chosenId).maybeSingle();
          return `Auto-assigned to ${member?.name || chosenId} (${strategy})`;
        }

        // Direct assignment to a specific user — skip if OOO
        if (await isUserOOO(action.value)) {
          return `Skipped: user ${action.value} is OOO`;
        }
        await supabase.from("conversations").update({ assignee_id: action.value }).eq("id", conversationId);
        return "Assigned";
      }
      case "assign_sender": {
        if (msg?.sent_by_user_id) {
          await supabase.from("conversations").update({ assignee_id: msg.sent_by_user_id }).eq("id", conversationId);
          return "Assigned to sender";
        }
        if (msg?.from_email) {
          const { data: sender } = await supabase.from("team_members").select("id").eq("email", msg.from_email).maybeSingle();
          if (sender) { await supabase.from("conversations").update({ assignee_id: sender.id }).eq("id", conversationId); return `Assigned to sender`; }
          const { data: acct } = await supabase.from("email_accounts").select("id").eq("email", msg.from_email).maybeSingle();
          if (acct) {
            const { data: access } = await supabase.from("account_access").select("team_member_id").eq("email_account_id", acct.id).limit(1).maybeSingle();
            if (access) { await supabase.from("conversations").update({ assignee_id: access.team_member_id }).eq("id", conversationId); return "Assigned to sender (via account)"; }
          }
        }
        return null;
      }
      case "unassign": { await supabase.from("conversations").update({ assignee_id: null }).eq("id", conversationId); return "Unassigned"; }
      case "unassign_all": {
        if (action.value === "__except_initiator__" && event?.initiator_user_id) {
          const { data: convo } = await supabase.from("conversations").select("assignee_id").eq("id", conversationId).maybeSingle();
          if (convo?.assignee_id && convo.assignee_id === event.initiator_user_id) {
            return "Skipped unassign (initiator)";
          }
        }
        await supabase.from("conversations").update({ assignee_id: null }).eq("id", conversationId);
        return "Unassigned";
      }
      case "mark_starred": { await supabase.from("conversations").update({ is_starred: true }).eq("id", conversationId); return "Starred"; }
      case "unstar": { await supabase.from("conversations").update({ is_starred: false }).eq("id", conversationId); return "Unstarred"; }
      case "mark_read": { await supabase.from("conversations").update({ is_unread: false }).eq("id", conversationId); return "Marked as read"; }
      case "mark_unread": { await supabase.from("conversations").update({ is_unread: true }).eq("id", conversationId); return "Marked as unread"; }
      case "move_to_folder": { if (!action.value) return null; await supabase.from("conversations").update({ folder_id: action.value }).eq("id", conversationId); return "Moved to folder"; }
      case "set_status": { if (!action.value) return null; await supabase.from("conversations").update({ status: action.value }).eq("id", conversationId); return `Set status to ${action.value}`; }
      case "archive": { await supabase.from("conversations").update({ status: "closed" }).eq("id", conversationId); return "Archived"; }
      case "close_conversation": { await supabase.from("conversations").update({ status: "closed" }).eq("id", conversationId); return "Closed conversation"; }
      case "snooze": { await supabase.from("conversations").update({ status: "snoozed" }).eq("id", conversationId); return "Snoozed"; }
      case "discard_snooze": {
        // Only wakes up conversations that are currently snoozed.
        // If status is something else (open, closed, etc.) this is a no-op so we don't
        // accidentally reopen a closed conversation just because a rule fired on it.
        const { data: convo } = await supabase.from("conversations").select("status").eq("id", conversationId).maybeSingle();
        if (convo?.status !== "snoozed") return "Not snoozed (no-op)";
        await supabase.from("conversations").update({ status: "open" }).eq("id", conversationId);
        return "Snooze discarded";
      }
      case "trash": { await supabase.from("conversations").update({ status: "trash" }).eq("id", conversationId); return "Trashed"; }
      case "mark_as_spam": {
        // Marks the conversation as spam AND short-circuits further rule processing
        // (returns __STOP__ so subsequent actions/rules in the chain are skipped).
        await supabase.from("conversations").update({ status: "spam" }).eq("id", conversationId);
        await supabase.from("activity_log").insert({
          conversation_id: conversationId,
          actor_id: null,
          action: "marked_as_spam",
          details: { source: "rule" },
        });
        return "__STOP__";
      }
      case "send_auto_reply": {
        // Auto-reply to the most recent inbound message using a template.
        // action.value = template UUID
        //
        // Loop prevention layered:
        //   (i)  Per-thread cap — only 1 auto-reply per conversation, ever
        //   (ii) Time window — don't reply to same recipient within 24h
        //   (iii) Header detection — skip if incoming has Auto-Submitted header
        //         or subject starts with Auto-Reply/Out of Office prefixes
        //
        // On failure: adds a note to the conversation AND notifies the assignee.
        // On success: adds a note to the conversation, logs to auto_reply_log.
        // Does NOT trigger outgoing rules for the auto-reply itself.

        const templateId = action.value;
        if (!templateId) return null;

        // Helper to add a note to the conversation describing what happened
        const addNote = async (text: string) => {
          try {
            await supabase.from("notes").insert({
              conversation_id: conversationId,
              author_id: null,
              text,
            });
          } catch (_e) { /* best-effort */ }
        };

        // Helper to notify the conversation's assignee on failure (if any)
        const notifyAssigneeOnFailure = async (failureReason: string, subject: string) => {
          try {
            const { data: c } = await supabase
              .from("conversations")
              .select("assignee_id")
              .eq("id", conversationId)
              .maybeSingle();
            const assigneeId = c?.assignee_id;
            if (!assigneeId) return;
            await supabase.from("notifications").insert({
              user_id: assigneeId,
              type: "auto_reply_failed",
              title: "Auto-reply failed",
              body: `${subject || "Conversation"}: ${failureReason}`,
              conversation_id: conversationId,
              actor_id: null,
            });
          } catch (_e) { /* best-effort */ }
        };

        // ── Guard (i): per-thread cap (default max 1) ──
        const { count: priorCount } = await supabase
          .from("auto_reply_log")
          .select("id", { count: "exact", head: true })
          .eq("conversation_id", conversationId);
        if ((priorCount || 0) >= 1) {
          await addNote("Auto-reply skipped: this conversation has already received an auto-reply.");
          return "Auto-reply skipped (cap reached)";
        }

        // Determine recipient + check incoming message context for guard (iii)
        // We auto-reply to the from_email of the inbound message that triggered this rule.
        // If we have no msg context (e.g., event-based rule), fall back to conversation.from_email.
        let recipient = msg?.from_email || "";
        let inboundSubject = msg?.subject || "";
        let inboundHeaders: Record<string, string> = msg?.headers || {};

        if (!recipient) {
          const { data: c } = await supabase
            .from("conversations")
            .select("from_email, subject")
            .eq("id", conversationId)
            .maybeSingle();
          recipient = c?.from_email || "";
          if (!inboundSubject) inboundSubject = c?.subject || "";
        }

        if (!recipient) {
          await addNote("Auto-reply skipped: no recipient address could be determined.");
          return "Auto-reply skipped (no recipient)";
        }

        // ── Guard (iii): header / subject detection ──
        const lowerHeaders: Record<string, string> = {};
        for (const k of Object.keys(inboundHeaders)) {
          lowerHeaders[k.toLowerCase()] = String(inboundHeaders[k] || "").toLowerCase();
        }
        const autoSubmitted = lowerHeaders["auto-submitted"] || "";
        const xAutoResponse = lowerHeaders["x-auto-response-suppress"] || lowerHeaders["x-autoreply"] || "";
        const precedence = lowerHeaders["precedence"] || "";
        const looksAutomated =
          autoSubmitted.includes("auto-replied") ||
          autoSubmitted.includes("auto-generated") ||
          xAutoResponse.length > 0 ||
          precedence === "bulk" ||
          precedence === "list" ||
          precedence === "auto_reply";
        const subjectAutoPrefix = /^(auto[\s-]?(reply|response):|out of office:|vacation:|automatic reply:)/i.test(inboundSubject || "");
        if (looksAutomated || subjectAutoPrefix) {
          await addNote(`Auto-reply skipped: incoming message appears to be automated${subjectAutoPrefix ? " (subject prefix)" : " (headers)"}. Looping prevention.`);
          return "Auto-reply skipped (automated incoming)";
        }

        // ── Guard (ii): time-window check (24h to same recipient) ──
        const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count: recentCount } = await supabase
          .from("auto_reply_log")
          .select("id", { count: "exact", head: true })
          .eq("recipient_email", recipient)
          .gte("sent_at", dayAgo);
        if ((recentCount || 0) > 0) {
          await addNote(`Auto-reply skipped: another auto-reply was sent to ${recipient} within the last 24 hours.`);
          return "Auto-reply skipped (24h window)";
        }

        // ── Load template + account ──
        const { data: template } = await supabase
          .from("email_templates")
          .select("*")
          .eq("id", templateId)
          .maybeSingle();
        if (!template) {
          await addNote(`Auto-reply failed: template ${templateId} not found.`);
          await notifyAssigneeOnFailure("template not found", inboundSubject);
          return "Auto-reply failed (template missing)";
        }

        const { data: convoFull } = await supabase
          .from("conversations")
          .select("email_account_id, subject, from_email")
          .eq("id", conversationId)
          .maybeSingle();
        if (!convoFull?.email_account_id) {
          await addNote("Auto-reply failed: conversation has no email account.");
          await notifyAssigneeOnFailure("no email account", inboundSubject);
          return "Auto-reply failed (no account)";
        }

        const { data: account } = await supabase
          .from("email_accounts")
          .select("*")
          .eq("id", convoFull.email_account_id)
          .maybeSingle();
        if (!account) {
          await addNote("Auto-reply failed: email account not found.");
          await notifyAssigneeOnFailure("account not found", inboundSubject);
          return "Auto-reply failed (account missing)";
        }

        const replySubject = template.subject || `Re: ${convoFull.subject || ""}`;
        const replyBodyHtml = template.body || "";
        const replyBodyText = String(replyBodyHtml).replace(/<[^>]*>/g, "");

        // ── Send via the account's configured method (matches send-route + follow-up cron) ──
        try {
          if (account.provider === "microsoft_oauth" && account.oauth_refresh_token) {
            const { refreshMicrosoftToken } = await import("@/lib/microsoft-oauth");
            const token = await refreshMicrosoftToken(account.id);
            await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
              method: "POST",
              headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
              body: JSON.stringify({
                message: {
                  subject: replySubject,
                  body: { contentType: "HTML", content: replyBodyHtml },
                  toRecipients: [{ emailAddress: { address: recipient } }],
                  // Mark as auto-replied so downstream systems can detect
                  internetMessageHeaders: [
                    { name: "Auto-Submitted", value: "auto-replied" },
                    { name: "X-Auto-Response-Suppress", value: "All" },
                  ],
                },
                saveToSentItems: true,
              }),
            });
          } else if (account.smtp_host) {
            const nodemailer = (await import("nodemailer")).default;
            const auth: any = { user: account.smtp_user || account.email };
            if (account.provider === "google_oauth" && account.oauth_refresh_token) {
              const { refreshGoogleToken } = await import("@/lib/google-oauth");
              auth.type = "OAuth2";
              auth.accessToken = await refreshGoogleToken(account.id);
            } else {
              auth.pass = account.smtp_password || account.imap_password;
            }
            const transport = nodemailer.createTransport({
              host: account.smtp_host,
              port: account.smtp_port || 587,
              secure: account.smtp_port === 465,
              auth,
              tls: { rejectUnauthorized: false },
            });
            await transport.sendMail({
              from: `"${account.name}" <${account.email}>`,
              to: recipient,
              subject: replySubject,
              html: replyBodyHtml,
              text: replyBodyText,
              headers: {
                "Auto-Submitted": "auto-replied",
                "X-Auto-Response-Suppress": "All",
              },
            });
          } else {
            await addNote("Auto-reply failed: account has no sending method configured.");
            await notifyAssigneeOnFailure("no sending method", inboundSubject);
            return "Auto-reply failed (no method)";
          }

          // Insert outbound message record so it's visible in the conversation thread
          await supabase.from("messages").insert({
            conversation_id: conversationId,
            provider_message_id: `auto-reply:${Date.now()}`,
            from_name: account.name,
            from_email: account.email,
            to_addresses: recipient,
            subject: replySubject,
            body_text: replyBodyText.slice(0, 5000),
            body_html: replyBodyHtml,
            snippet: replyBodyText.slice(0, 200),
            is_outbound: true,
            has_attachments: false,
            sent_at: new Date().toISOString(),
          });

          // Update conversation preview + last_message_at
          await supabase.from("conversations").update({
            preview: replyBodyText.slice(0, 200),
            last_message_at: new Date().toISOString(),
          }).eq("id", conversationId);

          // Log to auto_reply_log for future loop prevention
          await supabase.from("auto_reply_log").insert({
            conversation_id: conversationId,
            rule_id: ruleId || null,
            template_id: templateId,
            recipient_email: recipient,
          });

          // Add the visible note (Q5: γ — both real email AND note)
          await addNote(`Auto-reply sent to ${recipient} using template "${template.name || "Untitled"}".`);

          // NOTE: We deliberately do NOT call runRulesForMessage(...,"outgoing") for this
          // auto-reply, so it doesn't trigger other outgoing rules and doesn't notify watchers
          // about the outbound. The visible note above keeps watchers informed if they
          // opted into comment notifications.

          return `Auto-reply sent to ${recipient}`;
        } catch (sendErr: any) {
          const reason = sendErr?.message || "unknown error";
          console.error("[send_auto_reply] send failed:", reason);
          await addNote(`Auto-reply failed: ${reason}`);
          await notifyAssigneeOnFailure(reason, inboundSubject);
          return "Auto-reply failed";
        }
      }
      case "add_watcher": {
        // action.value should be a user ID. "__initiator__" supported.
        if (!action.value) return null;
        let userId = action.value;
        if (userId === "__initiator__") {
          if (!event?.initiator_user_id) return null;
          userId = event.initiator_user_id;
        }
        // Use defaults (matches batch4 watchers route DEFAULT_PREFS)
        await supabase.from("conversation_watchers").upsert({
          conversation_id: conversationId,
          user_id: userId,
          watch_source: "rule",
          notify_on_new_message: true,
          notify_on_status_change: true,
          notify_on_assignee_change: true,
          notify_on_label_change: false,
          notify_on_comment: false,
        }, { onConflict: "conversation_id,user_id" });
        return "Watcher added";
      }
      case "remove_watcher": {
        if (!action.value) return null;
        let userId = action.value;
        if (userId === "__initiator__") {
          if (!event?.initiator_user_id) return null;
          userId = event.initiator_user_id;
        }
        await supabase.from("conversation_watchers")
          .delete()
          .eq("conversation_id", conversationId)
          .eq("user_id", userId);
        return "Watcher removed";
      }
      case "add_note": {
        if (!action.value) return null;
        const authorId = event?.initiator_user_id || null;
        await supabase.from("notes").insert({ conversation_id: conversationId, text: action.value, author_id: authorId });
        return "Added note";
      }
      case "add_task": {
        if (!action.value) return null;
        const taskPayload: any = { conversation_id: conversationId, text: action.value, status: "todo", is_done: false };
        if (action.task_due_days || action.task_due_hours) {
          const totalMs = ((action.task_due_days || 0) * 24 * 60 * 60 * 1000) + ((action.task_due_hours || 0) * 60 * 60 * 1000);
          const dueDate = new Date(Date.now() + totalMs);
          taskPayload.due_date = dueDate.toISOString().slice(0, 10);
          taskPayload.due_time = dueDate.toTimeString().slice(0, 5);
        }
        const { data: newTask } = await supabase.from("tasks").insert(taskPayload).select("id").single();
        if (newTask) {
          let assigneeIds: string[] = [];
          if (action.task_assignee_mode === "specific" && action.task_assignee_ids?.length) {
            assigneeIds = action.task_assignee_ids;
          } else if (action.task_assignee_mode === "assigned_users") {
            const { data: convo } = await supabase.from("conversations").select("assignee_id").eq("id", conversationId).maybeSingle();
            if (convo?.assignee_id) assigneeIds = [convo.assignee_id];
          } else if (action.task_assignee_mode === "initiator") {
            if (event?.initiator_user_id) assigneeIds = [event.initiator_user_id];
          } else if (action.task_assignee_mode === "all") {
            const { data: all } = await supabase.from("team_members").select("id").eq("is_active", true);
            assigneeIds = (all || []).map((m: any) => m.id);
          }
          for (const mid of assigneeIds) { await supabase.from("task_assignees").insert({ task_id: newTask.id, team_member_id: mid }); }
        }
        return "Added task";
      }
      case "create_task_template": {
        if (!action.value) return null;
        const { data: tpl } = await supabase.from("task_templates").select("*").eq("id", action.value).maybeSingle();
        if (!tpl) return "Template not found";
        const p: any = { conversation_id: conversationId, text: tpl.text || tpl.name || "Task from template", status: "todo", is_done: false, category_id: tpl.category_id || null };
        if (tpl.deadline_hours) { const d = new Date(Date.now() + tpl.deadline_hours * 60 * 60 * 1000); p.due_date = d.toISOString().slice(0, 10); p.due_time = d.toTimeString().slice(0, 5); }
        const { data: nt } = await supabase.from("tasks").insert(p).select("id").single();
        if (nt && tpl.assignee_ids && Array.isArray(tpl.assignee_ids)) { for (const mid of tpl.assignee_ids) { await supabase.from("task_assignees").insert({ task_id: nt.id, team_member_id: mid }); } }
        return `Created task from template: ${tpl.name || tpl.text}`;
      }
      case "set_priority": {
        let lid = action.value;
        if (!lid) { const { data: e } = await supabase.from("labels").select("id").ilike("name", "%urgent%").limit(1).maybeSingle(); if (e) lid = e.id; else { const { data: c } = await supabase.from("labels").insert({ name: "Urgent", color: "#F85149", bg_color: "rgba(248,81,73,0.12)" }).select("id").single(); lid = c?.id; } }
        if (lid) await supabase.from("conversation_labels").upsert({ conversation_id: conversationId, label_id: lid });
        return "Set priority (Urgent)";
      }
      case "forward_email": {
        if (!action.value || !msg) return null;
        try {
          const { data: convo } = await supabase.from("conversations").select("email_account_id").eq("id", conversationId).single();
          if (!convo?.email_account_id) return "No account";
          const { data: acct } = await supabase.from("email_accounts").select("*").eq("id", convo.email_account_id).single();
          if (!acct) return "Account not found";
          const nodemailer = (await import("nodemailer")).default;
          const subj = `Fwd: ${msg.subject}`;
          const body = `---------- Forwarded message ----------\nFrom: ${msg.from_name} <${msg.from_email}>\nSubject: ${msg.subject}\n\n${msg.body_text}`;
          const auth: any = { user: acct.smtp_user || acct.email };
          if (acct.provider === "google_oauth" && acct.oauth_refresh_token) { const { refreshGoogleToken } = await import("@/lib/google-oauth"); auth.type = "OAuth2"; auth.accessToken = await refreshGoogleToken(acct.id); } else { auth.pass = acct.smtp_password || acct.imap_password; }
          if (acct.smtp_host) { const t = nodemailer.createTransport({ host: acct.smtp_host, port: acct.smtp_port || 587, secure: acct.smtp_port === 465, auth, tls: { rejectUnauthorized: false } }); await t.sendMail({ from: `"${acct.name}" <${acct.email}>`, to: action.value, subject: subj, text: body }); return `Forwarded to ${action.value}`; }
          else if (acct.provider === "microsoft_oauth") { const { refreshMicrosoftToken } = await import("@/lib/microsoft-oauth"); const token = await refreshMicrosoftToken(acct.id); await fetch("https://graph.microsoft.com/v1.0/me/sendMail", { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify({ message: { subject: subj, body: { contentType: "Text", content: body }, toRecipients: [{ emailAddress: { address: action.value } }] }, saveToSentItems: false }) }); return `Forwarded to ${action.value}`; }
          return "No sending method";
        } catch (e: any) { console.error("Forward failed:", e.message); return "Forward failed"; }
      }
      case "slack_notify": {
        const url = action.value || process.env.SLACK_WEBHOOK_URL;
        if (!url) return null;
        try {
          const subject = msg?.subject || event?.event_type || "Tenkara event";
          const from = msg?.from_email || "system";
          const to = msg?.to_addresses || "";
          await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: `📧 Rule triggered: *${subject}*\nFrom: ${from}\nTo: ${to}\n<${process.env.NEXTAUTH_URL || ""}/#conversation=${conversationId}|Open in Tenkara>` }) });
          return "Slack notification sent";
        }
        catch (e: any) { console.error("Slack failed:", e.message); return "Slack failed"; }
      }
      case "stop_processing": { return "__STOP__"; }
      case "webhook": {
        if (!action.value) return null;
        if (action.webhook_run_once && msg?.message_id && ruleId) {
          const { data: existing } = await supabase.from("activity_log").select("id").eq("action", "webhook_sent").eq("conversation_id", conversationId).contains("details", { rule_id: ruleId, message_id: msg.message_id }).limit(1).maybeSingle();
          if (existing) return null;
        }
        try {
          const payload = JSON.stringify({
            event: event?.event_type || "rule_triggered",
            conversation_id: conversationId,
            message_id: msg?.message_id || null,
            subject: msg?.subject,
            from_email: msg?.from_email,
            from_name: msg?.from_name,
            to_addresses: msg?.to_addresses,
            cc_addresses: msg?.cc_addresses || "",
            has_attachments: msg?.has_attachments || false,
            initiator_user_id: event?.initiator_user_id || null,
            label_id: event?.label_id || null,
            label_name: event?.label_name || null,
            comment_text: event?.comment_text || null,
            comment_type: event?.comment_type || null,
            mentioned_user_ids: event?.mentioned_user_ids || null,
            new_assignee_id: event?.new_assignee_id || null,
            old_assignee_id: event?.old_assignee_id || null,
            new_status: event?.new_status || null,
            old_status: event?.old_status || null,
            new_team_id: event?.new_team_id || null,
            old_team_id: event?.old_team_id || null,
            new_team_name: event?.new_team_name || null,
            old_team_name: event?.old_team_name || null,
            added_assignee_id: event?.added_assignee_id || null,
            removed_assignee_id: event?.removed_assignee_id || null,
            timestamp: new Date().toISOString(),
          });
          const hdrs: Record<string, string> = { "Content-Type": "application/json" };
          if (action.webhook_secret) { hdrs["X-Webhook-Signature"] = crypto.createHmac("sha256", action.webhook_secret).update(payload).digest("hex"); }
          await fetch(action.value, { method: "POST", headers: hdrs, body: payload });
          if (action.webhook_run_once && msg?.message_id && ruleId) { await supabase.from("activity_log").insert({ conversation_id: conversationId, actor_id: null, action: "webhook_sent", details: { rule_id: ruleId, message_id: msg.message_id, webhook_url: action.value } }); }
          return "Webhook sent";
        } catch (e: any) { console.error("Webhook failed:", e.message); return "Webhook failed"; }
      }
      default: return null;
    }
  } catch (err: any) { console.error(`Rule action ${action.type} failed:`, err.message); return null; }
}

async function tryClaimRuleRun(supabase: any, ruleId: string, eventKey: string, conversationId: string): Promise<boolean> {
  try {
    const { error } = await supabase.from("rule_runs").insert({
      rule_id: ruleId,
      event_key: eventKey,
      conversation_id: conversationId,
    });
    if (!error) return true;
    if (error.code === "23505" || (error.message || "").toLowerCase().includes("duplicate")) {
      return false;
    }
    console.error("rule_runs insert error (failing open):", error.message);
    return true;
  } catch (e: any) {
    console.error("rule_runs dedupe check failed (failing open):", e?.message);
    return true;
  }
}

export async function runRulesForMessage(
  conversationId: string, msg: MessageContext, triggerType: "incoming" | "outgoing" | "user_action" = "incoming"
): Promise<{ matched: number; actions: string[] }> {
  const supabase = createServerClient();
  const result = { matched: 0, actions: [] as string[] };

  // Notify watchers about new inbound messages (best-effort, fire-and-forget).
  // This is centralized here rather than in the sync libraries (imap, ms-graph, ms-oauth-sync)
  // because all three call runRulesForMessage with triggerType="incoming" after inserting the message.
  if (triggerType === "incoming") {
    try {
      const { notifyWatchers } = await import("@/lib/notifications");
      const senderName = msg.from_name || msg.from_email || "Someone";
      await notifyWatchers(conversationId, "new_message", {
        title: `New message from ${senderName}`,
        body: msg.subject || undefined,
        actorId: null, // inbound message — actor is the external sender
      });
    } catch (_e) { /* best-effort */ }
  }

  try {
    const { data: rules, error } = await supabase.from("rules").select("*").eq("is_active", true).eq("trigger_type", triggerType).order("sort_order");
    if (error || !rules || rules.length === 0) return result;
    for (const rule of rules as RuleRow[]) {
      if (rule.account_ids && Array.isArray(rule.account_ids) && rule.account_ids.length > 0) {
        if (!msg.email_account_id || !rule.account_ids.includes(msg.email_account_id)) continue;
      }
      let conditions: (Condition | ConditionGroup)[] = [];
      if (rule.conditions && Array.isArray(rule.conditions) && rule.conditions.length > 0) { conditions = rule.conditions; }
      else if (rule.condition_field && rule.condition_operator) { conditions = [{ field: rule.condition_field, operator: rule.condition_operator, value: rule.condition_value || "" }]; }
      let ruleActions: Action[] = [];
      if (rule.actions && Array.isArray(rule.actions) && rule.actions.length > 0) { ruleActions = rule.actions; }
      else if (rule.action_type) { ruleActions = [{ type: rule.action_type, value: rule.action_value || "" }]; }
      const matchMode = rule.match_mode || "all";
      const matches = await evaluateConditions(supabase, conversationId, msg, undefined, conditions, matchMode);
      if (matches) {
        result.matched++;
        let stop = false;
        for (const action of ruleActions) {
          const r = await executeAction(supabase, conversationId, action, msg, rule.id, undefined);
          if (r === "__STOP__") { stop = true; result.actions.push(`${rule.name}: Stopped processing`); break; }
          if (r) result.actions.push(`${rule.name}: ${r}`);
        }
        await supabase.from("activity_log").insert({ conversation_id: conversationId, actor_id: null, action: "rule_executed", details: { rule_id: rule.id, rule_name: rule.name, match_mode: matchMode, conditions_count: conditions.length, actions_count: ruleActions.length } });
        if (stop) break;
      }
    }
  } catch (err: any) { console.error("Rule engine error:", err.message); }
  return result;
}

export async function runRulesForEvent(
  event: RuleEvent
): Promise<{ matched: number; actions: string[] }> {
  const supabase = createServerClient();
  const result = { matched: 0, actions: [] as string[] };
  const { conversation_id: conversationId, event_type: triggerType, event_key } = event;
  if (!conversationId || !triggerType || !event_key) return result;

  try {
    const { data: rules, error } = await supabase
      .from("rules")
      .select("*")
      .eq("is_active", true)
      .eq("trigger_type", triggerType)
      .order("sort_order");
    if (error || !rules || rules.length === 0) return result;

    const { data: convo } = await supabase
      .from("conversations")
      .select("email_account_id, subject, from_email, from_name")
      .eq("id", conversationId)
      .maybeSingle();

    const msgShell: MessageContext = {
      conversation_id: conversationId,
      subject: convo?.subject || "",
      from_email: convo?.from_email || "",
      from_name: convo?.from_name || "",
      to_addresses: "",
      body_text: "",
      email_account_id: convo?.email_account_id || undefined,
    };

    for (const rule of rules as RuleRow[]) {
      if (rule.account_ids && Array.isArray(rule.account_ids) && rule.account_ids.length > 0) {
        if (!msgShell.email_account_id || !rule.account_ids.includes(msgShell.email_account_id)) continue;
      }

      let conditions: (Condition | ConditionGroup)[] = [];
      if (rule.conditions && Array.isArray(rule.conditions) && rule.conditions.length > 0) {
        conditions = rule.conditions;
      } else if (rule.condition_field && rule.condition_operator) {
        conditions = [{ field: rule.condition_field, operator: rule.condition_operator, value: rule.condition_value || "" }];
      }
      let ruleActions: Action[] = [];
      if (rule.actions && Array.isArray(rule.actions) && rule.actions.length > 0) {
        ruleActions = rule.actions;
      } else if (rule.action_type) {
        ruleActions = [{ type: rule.action_type, value: rule.action_value || "" }];
      }

      const matchMode = rule.match_mode || "all";
      const matches = await evaluateConditions(supabase, conversationId, msgShell, event, conditions, matchMode);
      if (!matches) continue;

      const claimed = await tryClaimRuleRun(supabase, rule.id, event_key, conversationId);
      if (!claimed) continue;

      result.matched++;
      let stop = false;
      for (const action of ruleActions) {
        const r = await executeAction(supabase, conversationId, action, msgShell, rule.id, event);
        if (r === "__STOP__") { stop = true; result.actions.push(`${rule.name}: Stopped processing`); break; }
        if (r) result.actions.push(`${rule.name}: ${r}`);
      }
      await supabase.from("activity_log").insert({
        conversation_id: conversationId,
        actor_id: event.initiator_user_id || null,
        action: "rule_executed",
        details: {
          rule_id: rule.id,
          rule_name: rule.name,
          trigger_type: triggerType,
          event_key,
          match_mode: matchMode,
          conditions_count: conditions.length,
          actions_count: ruleActions.length,
        },
      });
      if (stop) break;
    }
  } catch (err: any) {
    console.error("Rule engine (event) error:", err.message);
  }
  return result;
}