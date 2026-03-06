import { createServerClient } from "@/lib/supabase";

interface RuleRow {
  id: string;
  name: string;
  is_active: boolean;
  condition_field: string;
  condition_operator: string;
  condition_value: string;
  action_type: string;
  action_value: string;
}

interface MessageContext {
  conversation_id: string;
  subject: string;
  from_email: string;
  from_name: string;
  to_addresses: string;
  body_text: string;
}

// Evaluate a single condition against a message
function evaluateCondition(
  fieldValue: string,
  operator: string,
  conditionValue: string
): boolean {
  const field = (fieldValue || "").toLowerCase();
  const value = (conditionValue || "").toLowerCase();

  switch (operator) {
    case "contains":
      return field.includes(value);
    case "not_contains":
      return !field.includes(value);
    case "equals":
      return field === value;
    case "starts_with":
      return field.startsWith(value);
    case "ends_with":
      return field.endsWith(value);
    default:
      return false;
  }
}

// Get the field value from the message context
function getFieldValue(msg: MessageContext, field: string): string {
  switch (field) {
    case "subject":
      return msg.subject || "";
    case "from_email":
      return msg.from_email || "";
    case "from_name":
      return msg.from_name || "";
    case "to_addresses":
      return msg.to_addresses || "";
    case "body_text":
      return msg.body_text || "";
    default:
      return "";
  }
}

// Execute a single rule action
async function executeAction(
  supabase: any,
  conversationId: string,
  actionType: string,
  actionValue: string
): Promise<string | null> {
  try {
    switch (actionType) {
      case "add_label": {
        if (!actionValue) return null;
        await supabase
          .from("conversation_labels")
          .upsert({ conversation_id: conversationId, label_id: actionValue });
        return `Added label`;
      }

      case "remove_label": {
        if (!actionValue) return null;
        await supabase
          .from("conversation_labels")
          .delete()
          .eq("conversation_id", conversationId)
          .eq("label_id", actionValue);
        return `Removed label`;
      }

      case "assign_to": {
        if (!actionValue) return null;
        // Assign clears folder_id (goes to personal inbox)
        await supabase
          .from("conversations")
          .update({ assignee_id: actionValue, folder_id: null })
          .eq("id", conversationId);
        return `Assigned to ${actionValue}`;
      }

      case "mark_starred": {
        await supabase
          .from("conversations")
          .update({ is_starred: true })
          .eq("id", conversationId);
        return `Starred`;
      }

      case "mark_read": {
        await supabase
          .from("conversations")
          .update({ is_unread: false })
          .eq("id", conversationId);
        return `Marked as read`;
      }

      case "move_to_folder": {
        if (!actionValue) return null;
        await supabase
          .from("conversations")
          .update({ folder_id: actionValue })
          .eq("id", conversationId);
        return `Moved to folder`;
      }

      case "set_status": {
        if (!actionValue) return null;
        await supabase
          .from("conversations")
          .update({ status: actionValue })
          .eq("id", conversationId);
        return `Set status to ${actionValue}`;
      }

      default:
        return null;
    }
  } catch (err: any) {
    console.error(`Rule action ${actionType} failed:`, err.message);
    return null;
  }
}

/**
 * Run all active rules against a message/conversation.
 * Call this after a new message is synced or a conversation is created.
 * @param triggerType - 'incoming', 'outgoing', or 'user_action'
 */
export async function runRulesForMessage(
  conversationId: string,
  msg: MessageContext,
  triggerType: "incoming" | "outgoing" | "user_action" = "incoming"
): Promise<{ matched: number; actions: string[] }> {
  const supabase = createServerClient();
  const result = { matched: 0, actions: [] as string[] };

  try {
    // Fetch all active rules matching the trigger type
    const { data: rules, error } = await supabase
      .from("rules")
      .select("*")
      .eq("is_active", true)
      .eq("trigger_type", triggerType)
      .order("sort_order");

    if (error || !rules || rules.length === 0) return result;

    for (const rule of rules as RuleRow[]) {
      const fieldValue = getFieldValue(msg, rule.condition_field);
      const matches = evaluateCondition(fieldValue, rule.condition_operator, rule.condition_value);

      if (matches) {
        result.matched++;
        const actionResult = await executeAction(
          supabase,
          conversationId,
          rule.action_type,
          rule.action_value
        );

        if (actionResult) {
          result.actions.push(`${rule.name}: ${actionResult}`);

          // Log to activity_log
          await supabase.from("activity_log").insert({
            conversation_id: conversationId,
            actor_id: null,
            action: "rule_executed",
            details: {
              rule_id: rule.id,
              rule_name: rule.name,
              action_type: rule.action_type,
              action_value: rule.action_value,
            },
          });
        }
      }
    }
  } catch (err: any) {
    console.error("Rule engine error:", err.message);
  }

  return result;
}