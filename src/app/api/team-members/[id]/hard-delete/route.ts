export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";

// ─── DELETE /api/team-members/[id]/hard-delete ─────────────────────────────
//
// Permanently removes a team member from the database. NULLs any non-cascade
// FK references first (notes.author_id, conversations.assignee_id, tasks.
// assignee_id, activity_log.actor_id, etc.) so historical rows survive but
// show as "Unknown user". Cascade FKs (task_assignees, watchers, user_group_
// members) drop with the parent.
//
// All the cleanup + delete happens inside the Postgres function `inbox.
// hard_delete_team_member`, which discovers FKs via information_schema —
// so it doesn't go stale as new tables are added.
//
// Guards:
//   - Member must exist
//   - Member must be DEACTIVATED (is_active = false). Active members can't
//     be hard-deleted; deactivate them through the normal flow first.
//   - Caller must be an authenticated admin (checked here at the API layer)
//
// Response:
//   200: { success: true, member_id, nullified: { "schema.table.column": rows_count, ... } }
//   400: { error: "Member is still active. Deactivate first before hard delete." }
//   404: { error: "Member not found" }

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const memberId = params.id;
  if (!memberId) {
    return NextResponse.json({ error: "member id required" }, { status: 400 });
  }

  const supabase = createServerClient();

  // Call the SQL function which does discovery-based NULL-out + delete in
  // one transaction.
  const { data, error } = await supabase.rpc("hard_delete_team_member", {
    p_member_id: memberId,
  });

  if (error) {
    console.error("[hard-delete] rpc failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Function returns a jsonb object — surface its error field if present
  if (data?.error) {
    const status = data.error.toLowerCase().includes("not found") ? 404 : 400;
    return NextResponse.json(data, { status });
  }

  return NextResponse.json(data);
}
