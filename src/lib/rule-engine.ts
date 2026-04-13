import { createServerClient } from "@/lib/supabase";

interface Condition {
  field: string;
  operator: string;
  value: string;
  required?: boolean;
}

interface Action {
  type: string;
  value: string;
}

interface RuleRow {
  id: string;
  name: string;
  is_active: boolean;
  trigger_type: string;
  match_mode: "all" | "any" | "none";
  conditions: Condition[];
  actions: Action[];
  account_ids?: string[] | null;
  // Legacy single fields (fallback)
  condition_field?: string;
  condition_operator?: string;
  condition_value?: string;
  action_type?: string;
  action_value?: string;
}

interface MessageContext {
  conversation_id: string;
  subject: string;
  from_email: string;
  from_name: string;
  to_addresses: string;
  cc_addresses?: string;
  bcc_addresses?: string;
  body_text: string;
  email_account_id?: string;
  has_attachments?: boolean;
}

function getFieldValue(msg: MessageContext, field: string): string {
  switch (field) {
    case "subject": return msg.subject || "";
    case "from_email": return msg.from_email || "";
    case "from_name": return msg.from_name || "";
    case "to_addresses": return msg.to_addresses || "";
    case "cc_addresses": return msg.cc_addresses || "";
    case "bcc_addresses": return msg.bcc_addresses || "";
    case "to_cc_bcc": return [msg.to_addresses, msg.cc_addresses, msg.bcc_addresses].filter(Boolean).join(", ");
    case "body_text": return msg.body_text || "";
    case "any_field": return [msg.from_email, msg.from_name, msg.to_addresses, msg.cc_addresses, msg.bcc_addresses, msg.subject, msg.body_text].filter(Boolean).join(" ");
    case "email_account": return msg.email_account_id || "";
    case "has_attachments": return msg.has_attachments ? "true" : "false";
    default: return "";
  }
}

function evaluateCondition(fieldValue: string, operator: string, conditionValue: string): boolean {
  const field = (fieldValue || "").toLowerCase();
  const value = (conditionValue || "").toLowerCase();
  switch (operator) {
    case "contains": return field.includes(value);
    case "not_contains": return !field.includes(value);
    case "equals": return field === value;
    case "not_equals": return field !== value;
    case "starts_with": return field.startsWith(value);
    case "ends_with": return field.endsWith(value);
    case "is_true": return field === "true";
    case "is_false": return field === "false" || field === "";
    case "greater_than": return parseFloat(field) > parseFloat(value);
    case "less_than": return parseFloat(field) < parseFloat(value);
    default: return false;
  }
}

async function evaluateConditions(
  supabase: any,
  conversationId: string,
  msg: MessageContext,
  conditions: Condition[],
  matchMode: "all" | "any" | "none"
): Promise<boolean> {
  if (conditions.length === 0) return false;

  // Lazy-load conversation data only if needed
  let convoData: any = null;
  let convoLabels: string[] | null = null;
  let msgCount: number | null = null;

  const getConvo = async () => {
    if (!convoData) {
      const { data } = await supabase.from("conversations").select("status, assignee_id, folder_id").eq("id", conversationId).maybeSingle();
      convoData = data || {};
    }
    return convoData;
  };
  const getLabels = async () => {
    if (convoLabels === null) {
      const { data } = await supabase.from("conversation_labels").select("label_id").eq("conversation_id", conversationId);
      convoLabels = (data || []).map((r: any) => r.label_id);
    }
    return convoLabels;
  };
  const getMsgCount = async () => {
    if (msgCount === null) {
      const { count } = await supabase.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId);
      msgCount = count || 0;
    }
    return msgCount;
  };

  const results: { required: boolean; result: boolean }[] = [];

  for (const c of conditions) {
    let result: boolean;

    // DB-lookup conditions
    if (c.field === "conversation_status") {
      const convo = await getConvo();
      result = evaluateCondition(convo.status || "open", c.operator, c.value);
    } else if (c.field === "assignee") {
      const convo = await getConvo();
      const assigneeVal = c.value === "__unassigned__" ? "" : c.value;
      result = evaluateCondition(convo.assignee_id || "", c.operator, assigneeVal);
    } else if (c.field === "folder") {
      const convo = await getConvo();
      result = evaluateCondition(convo.folder_id || "", c.operator, c.value);
    } else if (c.field === "has_label") {
      const lbls = await getLabels() || [];
      if (c.operator === "equals") result = lbls.includes(c.value);
      else if (c.operator === "not_equals") result = !lbls.includes(c.value);
      else result = lbls.includes(c.value);
    } else if (c.field === "message_count") {
      const count = await getMsgCount() || 0;
      result = evaluateCondition(count.toString(), c.operator, c.value);
    } else {
      // Standard text-field conditions
      const fieldValue = getFieldValue(msg, c.field);
      result = evaluateCondition(fieldValue, c.operator, c.value);
    }

    results.push({ required: !!c.required, result });
  }

  // Required conditions MUST always match
  const requiredResults = results.filter((r) => r.required);
  const optionalResults = results.filter((r) => !r.required);

  if (requiredResults.length > 0 && !requiredResults.every((r) => r.result)) return false;
  if (optionalResults.length === 0) return requiredResults.length > 0 ? requiredResults.every((r) => r.result) : false;

  const optVals = optionalResults.map((r) => r.result);
  switch (matchMode) {
    case "all": return optVals.every(Boolean);
    case "any": return optVals.some(Boolean);
    case "none": return optVals.every((r) => !r);
    default: return false;
  }
}

async function executeAction(
  supabase: any,
  conversationId: string,
  action: Action,
  msg?: MessageContext
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
        await supabase.from("conversations").update({ assignee_id: action.value }).eq("id", conversationId);
        return "Assigned";
      }
      case "unassign": {
        await supabase.from("conversations").update({ assignee_id: null }).eq("id", conversationId);
        return "Unassigned";
      }
      case "mark_starred": {
        await supabase.from("conversations").update({ is_starred: true }).eq("id", conversationId);
        return "Starred";
      }
      case "unstar": {
        await supabase.from("conversations").update({ is_starred: false }).eq("id", conversationId);
        return "Unstarred";
      }
      case "mark_read": {
        await supabase.from("conversations").update({ is_unread: false }).eq("id", conversationId);
        return "Marked as read";
      }
      case "mark_unread": {
        await supabase.from("conversations").update({ is_unread: true }).eq("id", conversationId);
        return "Marked as unread";
      }
      case "move_to_folder": {
        if (!action.value) return null;
        await supabase.from("conversations").update({ folder_id: action.value }).eq("id", conversationId);
        return "Moved to folder";
      }
      case "set_status": {
        if (!action.value) return null;
        await supabase.from("conversations").update({ status: action.value }).eq("id", conversationId);
        return `Set status to ${action.value}`;
      }
      case "archive": {
        await supabase.from("conversations").update({ status: "closed" }).eq("id", conversationId);
        return "Archived";
      }
      case "snooze": {
        await supabase.from("conversations").update({ status: "snoozed" }).eq("id", conversationId);
        return "Snoozed";
      }
      case "trash": {
        await supabase.from("conversations").update({ status: "trash" }).eq("id", conversationId);
        return "Trashed";
      }
      case "add_note": {
        if (!action.value) return null;
        await supabase.from("notes").insert({ conversation_id: conversationId, text: action.value, author_id: null });
        return "Added note";
      }
      case "add_task": {
        if (!action.value) return null;
        await supabase.from("tasks").insert({ conversation_id: conversationId, text: action.value, status: "todo", is_done: false });
        return "Added task";
      }
      case "stop_processing": {
        return "__STOP__";
      }
      case "webhook": {
        if (!action.value) return null;
        try {
          await fetch(action.value, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "rule_triggered",
              conversation_id: conversationId,
              subject: msg?.subject,
              from_email: msg?.from_email,
              to_addresses: msg?.to_addresses,
              timestamp: new Date().toISOString(),
            }),
          });
          return "Webhook sent";
        } catch (webhookErr: any) {
          console.error("Webhook failed:", webhookErr.message);
          return "Webhook failed";
        }
      }
      default: return null;
    }
  } catch (err: any) {
    console.error(`Rule action ${action.type} failed:`, err.message);
    return null;
  }
}

/**
 * Run all active rules against a message/conversation.
 */
export async function runRulesForMessage(
  conversationId: string,
  msg: MessageContext,
  triggerType: "incoming" | "outgoing" | "user_action" = "incoming"
): Promise<{ matched: number; actions: string[] }> {
  const supabase = createServerClient();
  const result = { matched: 0, actions: [] as string[] };

  try {
    const { data: rules, error } = await supabase
      .from("rules")
      .select("*")
      .eq("is_active", true)
      .eq("trigger_type", triggerType)
      .order("sort_order");

    if (error || !rules || rules.length === 0) return result;

    for (const rule of rules as RuleRow[]) {
      // Skip if rule is restricted to specific accounts and this conversation doesn't belong
      if (rule.account_ids && Array.isArray(rule.account_ids) && rule.account_ids.length > 0) {
        if (!msg.email_account_id || !rule.account_ids.includes(msg.email_account_id)) {
          continue;
        }
      }

      // Build conditions array — support both new JSONB and legacy single fields
      let conditions: Condition[] = [];
      if (rule.conditions && Array.isArray(rule.conditions) && rule.conditions.length > 0) {
        conditions = rule.conditions;
      } else if (rule.condition_field && rule.condition_operator) {
        conditions = [{ field: rule.condition_field, operator: rule.condition_operator, value: rule.condition_value || "" }];
      }

      // Build actions array
      let ruleActions: Action[] = [];
      if (rule.actions && Array.isArray(rule.actions) && rule.actions.length > 0) {
        ruleActions = rule.actions;
      } else if (rule.action_type) {
        ruleActions = [{ type: rule.action_type, value: rule.action_value || "" }];
      }

      const matchMode = rule.match_mode || "all";
      const matches = await evaluateConditions(supabase, conversationId, msg, conditions, matchMode);

      if (matches) {
        result.matched++;
        let stopProcessing = false;

        for (const action of ruleActions) {
          const actionResult = await executeAction(supabase, conversationId, action, msg);
          if (actionResult === "__STOP__") {
            stopProcessing = true;
            result.actions.push(`${rule.name}: Stopped processing`);
            break;
          }
          if (actionResult) {
            result.actions.push(`${rule.name}: ${actionResult}`);
          }
        }

        // Log to activity_log
        await supabase.from("activity_log").insert({
          conversation_id: conversationId,
          actor_id: null,
          action: "rule_executed",
          details: {
            rule_id: rule.id,
            rule_name: rule.name,
            match_mode: matchMode,
            conditions_count: conditions.length,
            actions_count: ruleActions.length,
          },
        });

        if (stopProcessing) break;
      }
    }
  } catch (err: any) {
    console.error("Rule engine error:", err.message);
  }

  return result;
}