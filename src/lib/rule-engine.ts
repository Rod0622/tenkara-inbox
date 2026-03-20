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
  body_text: string;
}

function getFieldValue(msg: MessageContext, field: string): string {
  switch (field) {
    case "subject": return msg.subject || "";
    case "from_email": return msg.from_email || "";
    case "from_name": return msg.from_name || "";
    case "to_addresses": return msg.to_addresses || "";
    case "body_text": return msg.body_text || "";
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
    case "starts_with": return field.startsWith(value);
    case "ends_with": return field.endsWith(value);
    default: return false;
  }
}

function evaluateConditions(
  msg: MessageContext,
  conditions: Condition[],
  matchMode: "all" | "any" | "none"
): boolean {
  if (conditions.length === 0) return false;

  const evaluatedConditions = conditions.map((c) => {
    const fieldValue = getFieldValue(msg, c.field);
    return { ...c, result: evaluateCondition(fieldValue, c.operator, c.value) };
  });

  // Required conditions MUST always match regardless of match mode
  const requiredConditions = evaluatedConditions.filter((c) => c.required);
  const optionalConditions = evaluatedConditions.filter((c) => !c.required);

  // If any required condition fails, rule doesn't match
  if (requiredConditions.length > 0 && !requiredConditions.every((c) => c.result)) {
    return false;
  }

  // If there are no optional conditions, just check required ones passed
  if (optionalConditions.length === 0) {
    return requiredConditions.length > 0 ? requiredConditions.every((c) => c.result) : false;
  }

  // Apply match mode to optional conditions only
  const optionalResults = optionalConditions.map((c) => c.result);
  switch (matchMode) {
    case "all": return optionalResults.every(Boolean);
    case "any": return optionalResults.some(Boolean);
    case "none": return optionalResults.every((r) => !r);
    default: return false;
  }
}

async function executeAction(
  supabase: any,
  conversationId: string,
  action: Action
): Promise<string | null> {
  try {
    switch (action.type) {
      case "add_label": {
        if (!action.value) return null;
        await supabase.from("conversation_labels")
          .upsert({ conversation_id: conversationId, label_id: action.value });
        return "Added label";
      }
      case "remove_label": {
        if (!action.value) return null;
        await supabase.from("conversation_labels")
          .delete().eq("conversation_id", conversationId).eq("label_id", action.value);
        return "Removed label";
      }
      case "assign_to": {
        if (!action.value) return null;
        await supabase.from("conversations")
          .update({ assignee_id: action.value, folder_id: null }).eq("id", conversationId);
        return `Assigned`;
      }
      case "mark_starred": {
        await supabase.from("conversations")
          .update({ is_starred: true }).eq("id", conversationId);
        return "Starred";
      }
      case "mark_read": {
        await supabase.from("conversations")
          .update({ is_unread: false }).eq("id", conversationId);
        return "Marked as read";
      }
      case "move_to_folder": {
        if (!action.value) return null;
        await supabase.from("conversations")
          .update({ folder_id: action.value }).eq("id", conversationId);
        return "Moved to folder";
      }
      case "set_status": {
        if (!action.value) return null;
        await supabase.from("conversations")
          .update({ status: action.value }).eq("id", conversationId);
        return `Set status to ${action.value}`;
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
      const matches = evaluateConditions(msg, conditions, matchMode);

      if (matches) {
        result.matched++;

        for (const action of ruleActions) {
          const actionResult = await executeAction(supabase, conversationId, action);
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
      }
    }
  } catch (err: any) {
    console.error("Rule engine error:", err.message);
  }

  return result;
}