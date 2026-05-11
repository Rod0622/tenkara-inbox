import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

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