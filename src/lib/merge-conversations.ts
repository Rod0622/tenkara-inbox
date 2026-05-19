/**
 * mergeConversation — reusable helper that merges one conversation into another.
 *
 * Extracted from src/app/api/merge/route.ts so it can be called by both the
 * /api/merge endpoint (manual UI-driven merges) AND by sync code (automatic
 * RFC822-based merges when a duplicate is detected during inbound message
 * reconciliation).
 *
 * Same behavior as the route version:
 *   - Records the merge in conversation_merges for unmerge capability
 *   - Tracks all moved records in merge_moved_records (for unmerge)
 *   - Moves messages, tasks, notes, activity_log, email_drafts, response_times
 *   - Handles conversation_labels carefully (move non-dupes, delete dupes)
 *   - Updates primary.last_message_at to the latest sent_at
 *   - Marks the merged conversation: merged_into=primaryId, status="merged"
 *   - Logs an activity_log entry on the primary
 *
 * Returns the same shape as the route: { success, merges, moved }.
 */

export interface MergeResult {
  success: boolean;
  merges: number;
  moved: {
    messages: number;
    tasks: number;
    notes: number;
    activities: number;
    labels: number;
    drafts: number;
    response_times: number;
  };
  error?: string;
}

/**
 * Merge `duplicateId` INTO `primaryId`. The duplicate is marked merged_into=primary
 * and all its child records are moved to point at primary.
 *
 * `actorId` is recorded in the merge record; pass null for system/sync-initiated
 * merges.
 */
export async function mergeConversation(
  supabase: any,
  primaryId: string,
  duplicateId: string,
  actorId: string | null
): Promise<MergeResult> {
  const empty: MergeResult["moved"] = {
    messages: 0, tasks: 0, notes: 0, activities: 0, labels: 0, drafts: 0, response_times: 0,
  };

  if (!primaryId || !duplicateId) {
    return { success: false, merges: 0, moved: empty, error: "primaryId and duplicateId required" };
  }
  if (primaryId === duplicateId) {
    return { success: false, merges: 0, moved: empty, error: "cannot merge a conversation with itself" };
  }

  // Skip if this exact merge is already recorded as active.
  const { data: existingMerges } = await supabase
    .from("conversation_merges")
    .select("merged_conversation_id")
    .eq("primary_conversation_id", primaryId)
    .eq("is_active", true);
  const alreadyMergedIds = new Set((existingMerges || []).map((m: any) => m.merged_conversation_id));
  if (alreadyMergedIds.has(duplicateId)) {
    return { success: true, merges: 0, moved: empty };
  }

  // Validate both conversations exist; check duplicate isn't already merged elsewhere.
  const { data: convos } = await supabase
    .from("conversations")
    .select("id, merged_into")
    .in("id", [primaryId, duplicateId]);
  if (!convos || convos.length !== 2) {
    return { success: false, merges: 0, moved: empty, error: "one or both conversations not found" };
  }
  const duplicateRow = convos.find((c: any) => c.id === duplicateId);
  if (duplicateRow?.merged_into && duplicateRow.merged_into !== primaryId) {
    return { success: false, merges: 0, moved: empty, error: "duplicate is already merged into a different conversation" };
  }

  try {
    // Create merge record (tracks for unmerge later)
    const { data: mergeRecord, error: mergeErr } = await supabase
      .from("conversation_merges")
      .insert({
        primary_conversation_id: primaryId,
        merged_conversation_id: duplicateId,
        merged_by: actorId,
      })
      .select("id")
      .single();

    if (mergeErr || !mergeRecord) {
      return { success: false, merges: 0, moved: empty, error: mergeErr?.message || "failed to record merge" };
    }
    const mid = mergeRecord.id;

    // Fetch all child record IDs from the duplicate in parallel.
    const [msgsR, tasksR, notesR, activR, labelsR, draftsR, rtsR] = await Promise.all([
      supabase.from("messages").select("id").eq("conversation_id", duplicateId),
      supabase.from("tasks").select("id").eq("conversation_id", duplicateId),
      supabase.from("notes").select("id").eq("conversation_id", duplicateId),
      supabase.from("activity_log").select("id").eq("conversation_id", duplicateId),
      supabase.from("conversation_labels").select("id, label_id").eq("conversation_id", duplicateId),
      supabase.from("email_drafts").select("id").eq("conversation_id", duplicateId),
      supabase.from("response_times").select("id").eq("conversation_id", duplicateId),
    ]);

    const msgs = msgsR.data || [];
    const tasks = tasksR.data || [];
    const notes = notesR.data || [];
    const activ = activR.data || [];
    const labels = labelsR.data || [];
    const drafts = draftsR.data || [];
    const rts = rtsR.data || [];

    // Build tracking records for unmerge.
    const trackingRecords: any[] = [];
    const mkTrack = (table: string, records: any[]) => {
      for (const r of records) {
        trackingRecords.push({
          merge_id: mid,
          table_name: table,
          record_id: r.id,
          original_conversation_id: duplicateId,
          target_conversation_id: primaryId,
        });
      }
    };
    mkTrack("messages", msgs);
    mkTrack("tasks", tasks);
    mkTrack("notes", notes);
    mkTrack("activity_log", activ);
    mkTrack("conversation_labels", labels);
    mkTrack("email_drafts", drafts);
    mkTrack("response_times", rts);
    if (trackingRecords.length > 0) {
      await supabase.from("merge_moved_records").insert(trackingRecords);
    }

    // Move all records in parallel. Use distinct promise chains to avoid
    // chain-mutability issues with the Supabase query builder.
    const moveOps: Promise<any>[] = [];
    if (msgs.length > 0) moveOps.push(supabase.from("messages").update({ conversation_id: primaryId }).eq("conversation_id", duplicateId).select().then((r: any) => r));
    if (tasks.length > 0) moveOps.push(supabase.from("tasks").update({ conversation_id: primaryId }).eq("conversation_id", duplicateId).select().then((r: any) => r));
    if (notes.length > 0) moveOps.push(supabase.from("notes").update({ conversation_id: primaryId }).eq("conversation_id", duplicateId).select().then((r: any) => r));
    if (activ.length > 0) moveOps.push(supabase.from("activity_log").update({ conversation_id: primaryId }).eq("conversation_id", duplicateId).select().then((r: any) => r));
    if (drafts.length > 0) moveOps.push(supabase.from("email_drafts").update({ conversation_id: primaryId }).eq("conversation_id", duplicateId).select().then((r: any) => r));
    if (rts.length > 0) moveOps.push(supabase.from("response_times").update({ conversation_id: primaryId }).eq("conversation_id", duplicateId).select().then((r: any) => r));

    // Labels: avoid creating a duplicate (primary, label_id) row. Move
    // unique labels, delete dupes (the primary already has them).
    if (labels.length > 0) {
      const { data: existingLabels } = await supabase
        .from("conversation_labels")
        .select("label_id")
        .eq("conversation_id", primaryId);
      const existingLabelIds = new Set((existingLabels || []).map((l: any) => l.label_id));
      const toMove = labels.filter((l: any) => !existingLabelIds.has(l.label_id));
      const toDel = labels.filter((l: any) => existingLabelIds.has(l.label_id));
      if (toMove.length > 0) moveOps.push(supabase.from("conversation_labels").update({ conversation_id: primaryId }).in("id", toMove.map((l: any) => l.id)).select().then((r: any) => r));
      if (toDel.length > 0) moveOps.push(supabase.from("conversation_labels").delete().in("id", toDel.map((l: any) => l.id)).select().then((r: any) => r));
    }

    // Mark duplicate as merged.
    moveOps.push(
      supabase.from("conversations")
        .update({ merged_into: primaryId, status: "merged" })
        .eq("id", duplicateId)
        .select()
        .then((r: any) => r)
    );

    await Promise.all(moveOps);

    // Refresh primary.last_message_at to latest message timestamp.
    const { data: latestMsg } = await supabase
      .from("messages")
      .select("sent_at")
      .eq("conversation_id", primaryId)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestMsg?.sent_at) {
      await supabase
        .from("conversations")
        .update({ last_message_at: latestMsg.sent_at })
        .eq("id", primaryId);
    }

    // Activity log entry on primary.
    await supabase.from("activity_log").insert({
      conversation_id: primaryId,
      actor_id: actorId,
      action: "merge",
      details: { merged_conversation_id: duplicateId, merge_record_id: mid, source: actorId ? "manual" : "auto" },
    });

    return {
      success: true,
      merges: 1,
      moved: {
        messages: msgs.length,
        tasks: tasks.length,
        notes: notes.length,
        activities: activ.length,
        labels: labels.length,
        drafts: drafts.length,
        response_times: rts.length,
      },
    };
  } catch (error: any) {
    return { success: false, merges: 0, moved: empty, error: error?.message || "merge failed" };
  }
}
