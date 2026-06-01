import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { runRulesForEvent } from "@/lib/rule-engine";
import { notifyWatchers } from "@/lib/notifications";

// POST /api/conversations/bulk — perform bulk actions
export async function POST(req: NextRequest) {
  const supabase = createServerClient();
  const body = await req.json();

  const { ids, action, actor_id } = body;

  if (!ids?.length || !action) {
    return NextResponse.json({ error: "ids and action are required" }, { status: 400 });
  }

  let error: any = null;

  switch (action) {
    case "star": {
      // Toggle star — we'll set all to starred
      const { error: e } = await supabase
        .from("conversations")
        .update({ is_starred: true })
        .in("id", ids);
      error = e;
      break;
    }

    case "unstar": {
      const { error: e } = await supabase
        .from("conversations")
        .update({ is_starred: false })
        .in("id", ids);
      error = e;
      break;
    }

    case "mark_unread": {
      const { error: e } = await supabase
        .from("conversations")
        .update({ is_unread: true })
        .in("id", ids);
      error = e;
      break;
    }

    case "mark_read": {
      const { error: e } = await supabase
        .from("conversations")
        .update({ is_unread: false })
        .in("id", ids);
      error = e;
      break;
    }

    case "archive": {
      const { error: e } = await supabase
        .from("conversations")
        .update({ status: "closed" })
        .in("id", ids);
      error = e;
      break;
    }

    case "delete": {
      // Move to trash
      const { error: e } = await supabase
        .from("conversations")
        .update({ status: "trash" })
        .in("id", ids);
      error = e;
      break;
    }

    case "restore": {
      // Restore trashed/spam conversations back to "open"
      const { error: e } = await supabase
        .from("conversations")
        .update({ status: "open" })
        .in("id", ids);
      error = e;
      break;
    }

    case "move_folder": {
      // Move to a different email account (folder)
      if (!body.target_account_id) {
        return NextResponse.json({ error: "target_account_id required" }, { status: 400 });
      }
      const { error: e } = await supabase
        .from("conversations")
        .update({ email_account_id: body.target_account_id })
        .in("id", ids);
      error = e;
      break;
    }

    case "apply_labels": {
      // Apply one or more labels to all selected conversations at once.
      //
      // body.label_ids: string[]   — required, non-empty array of label IDs
      //
      // Behavior matches the per-conversation label endpoint:
      //   - Upserts conversation_labels rows (idempotent — already-applied
      //     labels stay applied without errors)
      //   - Logs one activity_log entry per (conversation, label) pair
      //   - Fires label_added rule events per (conversation, label) pair
      //   - Notifies watchers on each conversation
      //
      // Bulk path takes a single round trip for the upsert and parallel
      // best-effort calls for activity log + rules + watcher notifications.
      const labelIds: string[] = Array.isArray(body.label_ids) ? body.label_ids : [];
      if (labelIds.length === 0) {
        return NextResponse.json({ error: "label_ids required" }, { status: 400 });
      }

      // Build the full cartesian product of conversation × label rows.
      // Upsert is idempotent so re-applying an existing label is a no-op.
      const upsertRows = [];
      for (const cid of ids) {
        for (const lid of labelIds) {
          upsertRows.push({ conversation_id: cid, label_id: lid });
        }
      }

      const { error: upsertErr } = await supabase
        .from("conversation_labels")
        .upsert(upsertRows, { onConflict: "conversation_id,label_id" });

      if (upsertErr) {
        return NextResponse.json({ error: upsertErr.message }, { status: 500 });
      }

      // Fetch label names for the activity log + rule payloads. One query
      // total, not per-label.
      const { data: labels } = await supabase
        .from("labels")
        .select("id, name")
        .in("id", labelIds);
      const labelNameById = new Map<string, string>(
        (labels || []).map((l: any) => [l.id, l.name || "Unknown"])
      );

      // Activity log — one entry per (conversation, label) pair so the
      // history pane shows each label_added discretely (matches the per-
      // conversation endpoint's behavior).
      const logEntries = [];
      for (const cid of ids) {
        for (const lid of labelIds) {
          logEntries.push({
            conversation_id: cid,
            actor_id: actor_id || null,
            action: "label_added",
            details: {
              label_id: lid,
              label_name: labelNameById.get(lid) || "Unknown",
              source: "bulk",
              bulk_count: ids.length,
            },
          });
        }
      }
      if (logEntries.length > 0) {
        await supabase.from("activity_log").insert(logEntries);
      }

      // Best-effort: fire label_added rule events and notify watchers.
      // Done in parallel since each is independent — errors swallowed
      // because the apply itself already succeeded.
      const ruleAndWatcherPromises: Promise<any>[] = [];
      for (const cid of ids) {
        for (const lid of labelIds) {
          const labelName = labelNameById.get(lid);
          ruleAndWatcherPromises.push(
            runRulesForEvent({
              event_type: "label_added",
              conversation_id: cid,
              initiator_user_id: actor_id || null,
              event_key: `label_added:${cid}:${lid}:${Date.now()}`,
              label_id: lid,
              label_name: labelName || undefined,
            }).catch((e: any) => console.error("[bulk/apply_labels] rule error:", e?.message))
          );
          ruleAndWatcherPromises.push(
            notifyWatchers(cid, "label_change", {
              title: `Label added: ${labelName || "label"}`,
              actorId: actor_id || null,
            }).catch(() => { /* best-effort */ })
          );
        }
      }
      await Promise.allSettled(ruleAndWatcherPromises);

      // Skip the default activity log entry below — we already wrote
      // per-(conversation, label) entries above. Return early.
      return NextResponse.json({
        success: true,
        count: ids.length,
        label_count: labelIds.length,
      });
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Log bulk activity
  const logEntries = ids.map((id: string) => ({
    conversation_id: id,
    actor_id: actor_id || null,
    action: `bulk_${action}`,
    details: { bulk_count: ids.length },
  }));

  await supabase.from("activity_log").insert(logEntries);

  return NextResponse.json({ success: true, count: ids.length });
}