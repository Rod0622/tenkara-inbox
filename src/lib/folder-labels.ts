/**
 * Folder/label automation helpers.
 *
 * These functions implement the automatic labeling system where:
 *   • Connecting a new email account creates an account-name label + ensures global "Inbox"
 *   • Creating a folder creates a label with the folder's name
 *   • Inbound mail gets [account_label, "Inbox"] automatically
 *   • Folder moves swap the folder label, keeping account label
 *
 * IMPORTANT: These helpers do NOT trigger label_added / label_removed rule events.
 * Auto-applied labels are system housekeeping, not user actions. The existing
 * /api/conversations/labels endpoints (used by humans clicking the labels picker)
 * still fire those events.
 *
 * If a future requirement needs auto-labels to fire rules, add an opt-in flag
 * (e.g. fireRules: true) to the apply/remove helpers below.
 */

import { createServerClient } from "@/lib/supabase";

// ────────────────────────────────────────────────────────────────────
// Color palette for auto-created labels
// ────────────────────────────────────────────────────────────────────

// Stable color picker so the same name always gets the same color.
// Hash the label name to one of these colors. Visually distinct, all theme-friendly.
const AUTO_LABEL_COLORS: Array<{ color: string; bg_color: string }> = [
  { color: "#58A6FF", bg_color: "rgba(88, 166, 255, 0.12)" },   // blue
  { color: "#39D2C0", bg_color: "rgba(57, 210, 192, 0.12)" },   // teal
  { color: "#4ADE80", bg_color: "rgba(74, 222, 128, 0.12)" },   // green
  { color: "#F5D547", bg_color: "rgba(245, 213, 71, 0.14)" },   // yellow
  { color: "#F0883E", bg_color: "rgba(240, 136, 62, 0.14)" },   // orange
  { color: "#BC8CFF", bg_color: "rgba(188, 140, 255, 0.14)" },  // purple
  { color: "#7D8590", bg_color: "rgba(125, 133, 144, 0.14)" },  // gray
];

function pickColorFor(name: string): { color: string; bg_color: string } {
  // Simple sum-of-charcodes hash → modulo into palette
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash + name.charCodeAt(i)) | 0;
  }
  return AUTO_LABEL_COLORS[Math.abs(hash) % AUTO_LABEL_COLORS.length];
}

// ────────────────────────────────────────────────────────────────────
// ensureGlobalLabel
//
// Returns the id of a label with the given name. Creates one if missing.
// Names are matched case-insensitively (ilike) so "Inbox", "inbox", "INBOX"
// all resolve to the same label.
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// ensureGlobalLabel
//
// Returns the id of a label with the given name. Creates one if missing.
// Names are matched case-insensitively (ilike) so "Inbox", "inbox", "INBOX"
// all resolve to the same label.
//
// Optional `parentLabelId` filter — when set, the lookup AND any created
// label are scoped to that parent. This is how the folder-hierarchy fix
// works: "Asia" under parent "Suppliers" is a distinct label from "Asia"
// under parent "Operations" (or top-level "Asia"). Pass null explicitly
// to match top-level labels only. Pass undefined (default) for the old
// behavior — match ANY label with that name (legacy callers).
// ────────────────────────────────────────────────────────────────────

export async function ensureGlobalLabel(
  name: string,
  options?: { color?: string; bg_color?: string; parentLabelId?: string | null }
): Promise<string | null> {
  const supabase = createServerClient();
  const trimmed = name.trim();
  if (!trimmed) return null;

  // Look up an existing label by name (case-insensitive). When parentLabelId
  // is explicitly provided (even null), scope the lookup to that parent.
  // When undefined, fall through to the legacy any-match behavior.
  let lookupQ = supabase
    .from("labels")
    .select("id")
    .ilike("name", trimmed);
  if (options && "parentLabelId" in options) {
    if (options.parentLabelId === null) {
      lookupQ = lookupQ.is("parent_label_id", null);
    } else {
      lookupQ = lookupQ.eq("parent_label_id", options.parentLabelId);
    }
  }
  const { data: existing } = await lookupQ.limit(1).maybeSingle();

  if (existing?.id) return existing.id;

  // Create
  const palette = options?.color
    ? { color: options.color, bg_color: options.bg_color || options.color + "20" }
    : pickColorFor(trimmed);

  const insertRow: any = { name: trimmed, color: palette.color, bg_color: palette.bg_color };
  if (options && "parentLabelId" in options && options.parentLabelId) {
    insertRow.parent_label_id = options.parentLabelId;
  }

  const { data: created, error } = await supabase
    .from("labels")
    .insert(insertRow)
    .select("id")
    .single();

  if (error) {
    console.error("[ensureGlobalLabel] insert failed for", trimmed, ":", error.message);
    return null;
  }
  return created?.id || null;
}

// ────────────────────────────────────────────────────────────────────
// ensureSuperAgentLabel
//
// Returns the id of the global "Super Agent" label, creating it if missing.
// Applied to every conversation created via the external API (agent-created
// conversations) so operators can spot them. Top-level label (no parent).
// ────────────────────────────────────────────────────────────────────

export async function ensureSuperAgentLabel(): Promise<string | null> {
  // Distinct purple so it stands out from account/folder labels.
  return ensureGlobalLabel("Super Agent", {
    color: "#BC8CFF",
    bg_color: "rgba(188, 140, 255, 0.14)",
    parentLabelId: null,
  });
}

// ────────────────────────────────────────────────────────────────────
// labelManualCreatedConversation
//
// Called after a conversation is created via the manual create route
// (/api/conversations/create) or the external API. Applies:
//   • the account label (always)
//   • the "Inbox" label AND sets folder_id = account's Inbox folder
//     (only when the conversation is unassigned — assigned convos go to
//     the assignee's plate, not the shared inbox triage)
//
// Mirrors onNewConversationFromSync's inbound behavior, but for
// human/agent-created conversations rather than synced mail.
//
// Best-effort — never throws.
// ────────────────────────────────────────────────────────────────────

export async function labelManualCreatedConversation(
  conversationId: string,
  accountId: string,
  isUnassigned: boolean
): Promise<void> {
  try {
    const supabase = createServerClient();
    const { account_label_id, inbox_label_id } = await ensureAccountLabels(accountId);
    const labelsToApply: Array<string | null> = [account_label_id];

    if (isUnassigned) {
      labelsToApply.push(inbox_label_id);

      // Place in the account's Inbox folder so it appears in that account's
      // inbox triage (and under Inbox → Pending Outreach for agent drafts).
      const { data: inboxFolder } = await supabase
        .from("folders")
        .select("id")
        .eq("email_account_id", accountId)
        .ilike("name", "Inbox")
        .eq("is_system", true)
        .limit(1)
        .maybeSingle();

      if (inboxFolder?.id) {
        await supabase
          .from("conversations")
          .update({ folder_id: inboxFolder.id })
          .eq("id", conversationId);
      }
    }

    await applyLabelsToConversation(conversationId, labelsToApply);
  } catch (e: any) {
    console.error("[labelManualCreatedConversation] failed:", e?.message || e);
  }
}

// ────────────────────────────────────────────────────────────────────
// ensureAccountLabels
//
// Called once after an email account is created (any provider).
// Idempotent — safe to call repeatedly.
//
// Creates:
//   • A label with the account's display name (e.g. "Operations")
//   • The global "Inbox" label (if it doesn't already exist)
//   • A "Completed" folder for this account (if it doesn't already exist)
//
// Returns the IDs so callers can apply them right away if they want.
// ────────────────────────────────────────────────────────────────────

export interface AccountLabelIds {
  account_label_id: string | null;
  inbox_label_id: string | null;
  completed_folder_id: string | null;
}

export async function ensureAccountLabels(accountId: string): Promise<AccountLabelIds> {
  const supabase = createServerClient();

  const { data: account, error: acctErr } = await supabase
    .from("email_accounts")
    .select("id, name, email")
    .eq("id", accountId)
    .maybeSingle();

  if (acctErr || !account) {
    console.error("[ensureAccountLabels] account not found:", accountId);
    return { account_label_id: null, inbox_label_id: null, completed_folder_id: null };
  }

  // Account label name = account.name (the display name set when connecting)
  const accountLabelName = (account.name || account.email || "").trim();
  const account_label_id = accountLabelName
    ? await ensureGlobalLabel(accountLabelName)
    : null;

  // Global Inbox label
  const inbox_label_id = await ensureGlobalLabel("Inbox");

  // Per-account Completed folder
  let completed_folder_id: string | null = null;
  const { data: existingCompleted } = await supabase
    .from("folders")
    .select("id")
    .eq("email_account_id", accountId)
    .ilike("name", "Completed")
    .limit(1)
    .maybeSingle();

  if (existingCompleted?.id) {
    completed_folder_id = existingCompleted.id;
  } else {
    // Determine sort_order — append at the end
    const { data: maxOrder } = await supabase
      .from("folders")
      .select("sort_order")
      .eq("email_account_id", accountId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextOrder = (maxOrder?.sort_order ?? -1) + 1;

    const { data: created, error } = await supabase
      .from("folders")
      .insert({
        email_account_id: accountId,
        name: "Completed",
        icon: "✅",
        color: "#4ADE80",
        sort_order: nextOrder,
        is_system: true,
      })
      .select("id")
      .single();

    if (error) {
      console.error("[ensureAccountLabels] failed to create Completed folder:", error.message);
    } else {
      completed_folder_id = created?.id || null;
    }
  }

  return { account_label_id, inbox_label_id, completed_folder_id };
}

// ────────────────────────────────────────────────────────────────────
// ensureFolderLabel
//
// Called after a folder is created. Creates a label with the folder's name
// (or returns the id of the existing label if one with that name exists).
//
// Returns the label id. Note: the label is NOT applied to anything by this
// helper — the caller decides when/where to apply it.
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// ensureFolderLabel
//
// Returns the label id for a folder. Mirrors folder hierarchy into label
// hierarchy (Option B):
//
//   • Top-level folder ("Suppliers") → top-level label "Suppliers"
//   • Child folder ("Asia" under "Suppliers") → child label "Asia" with
//     parent_label_id = top-level label "Suppliers"
//
// If the folder is 3+ levels deep, the label hierarchy flattens to 2 levels
// (matches the label-table constraint). The IMMEDIATE parent folder's
// name becomes the top-level label; the folder itself becomes the child.
// Deeper ancestors aren't reflected in labels.
//
// Idempotent: calling repeatedly returns the same id.
//
// Returns the label id. The label is NOT applied to anything by this helper
// — the caller decides when/where to apply it.
// ────────────────────────────────────────────────────────────────────

export async function ensureFolderLabel(folderId: string): Promise<string | null> {
  const supabase = createServerClient();

  const { data: folder, error } = await supabase
    .from("folders")
    .select("name, parent_folder_id")
    .eq("id", folderId)
    .maybeSingle();

  if (error || !folder?.name) {
    console.error("[ensureFolderLabel] folder not found:", folderId);
    return null;
  }

  const folderName = folder.name;
  const parentFolderId = folder.parent_folder_id as string | null;

  // Top-level folder: just create/find the label at the top level.
  if (!parentFolderId) {
    return ensureGlobalLabel(folderName, { parentLabelId: null });
  }

  // Child folder: look up the parent folder's name, ensure a top-level label
  // exists for it, then ensure a child label exists with the folder's name
  // under that parent. If parent folder lookup fails, fall back to top-level
  // (defensive — never lose the ability to label).
  const { data: parentFolder } = await supabase
    .from("folders")
    .select("name")
    .eq("id", parentFolderId)
    .maybeSingle();
  if (!parentFolder?.name) {
    console.warn("[ensureFolderLabel] parent folder missing, falling back to flat label for:", folderId);
    return ensureGlobalLabel(folderName, { parentLabelId: null });
  }

  // Ensure the parent label exists at the top level (parent_label_id = null).
  // This handles the case where the parent folder itself hasn't been "touched"
  // since the hierarchy fix went live — we don't need it to exist already.
  const parentLabelId = await ensureGlobalLabel(parentFolder.name, { parentLabelId: null });
  if (!parentLabelId) {
    console.warn("[ensureFolderLabel] could not ensure parent label, falling back to flat label for:", folderId);
    return ensureGlobalLabel(folderName, { parentLabelId: null });
  }

  // Ensure the child label exists under that parent.
  return ensureGlobalLabel(folderName, { parentLabelId });
}

// ────────────────────────────────────────────────────────────────────
// applyLabelsToConversation / removeLabelsFromConversation
//
// Bulk add or remove labels on a conversation. Filters out null/falsy ids so
// callers can pass the result of ensure* helpers directly without checking.
//
// These do NOT fire label_added / label_removed rule events. They are for
// system-driven labeling (auto-apply on inbound mail, folder moves, etc).
// ────────────────────────────────────────────────────────────────────

export async function applyLabelsToConversation(
  conversationId: string,
  labelIds: Array<string | null | undefined>
): Promise<void> {
  const supabase = createServerClient();
  const ids = labelIds.filter((id): id is string => !!id);
  if (ids.length === 0) return;

  // Upsert (id, id) pairs. The unique constraint on (conversation_id, label_id)
  // prevents duplicates, so this is safe to call repeatedly.
  const rows = ids.map((label_id) => ({
    conversation_id: conversationId,
    label_id,
  }));

  const { error } = await supabase
    .from("conversation_labels")
    .upsert(rows, { onConflict: "conversation_id,label_id" });

  if (error) {
    console.error("[applyLabelsToConversation] failed:", error.message);
  }
}

export async function removeLabelsFromConversation(
  conversationId: string,
  labelIds: Array<string | null | undefined>
): Promise<void> {
  const supabase = createServerClient();
  const ids = labelIds.filter((id): id is string => !!id);
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("conversation_labels")
    .delete()
    .eq("conversation_id", conversationId)
    .in("label_id", ids);

  if (error) {
    console.error("[removeLabelsFromConversation] failed:", error.message);
  }
}

// ────────────────────────────────────────────────────────────────────
// swapFolderLabel
//
// Used when a conversation is moved between folders. Removes the old folder's
// label (if any) and adds the new folder's label (if any). Account label is
// untouched. Idempotent — calling with same old/new is a no-op.
//
// Pass null for oldFolderId if the conversation wasn't in a folder before.
// Pass null for newFolderId if it's being moved to "no folder" (root).
// ────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────
// swapFolderLabel
//
// Called when a conversation is moved between folders. Removes the old
// folder's label (if any) and adds the new folder's label (if any).
// Account label is untouched. Idempotent — calling with same old/new is a no-op.
//
// Special handling for the global "Inbox" label:
//   • If the destination folder's name is NOT "Inbox", and the conversation
//     currently has the "Inbox" label, that label is stripped. This handles
//     the case where the conversation has the Inbox label from inbound-mail
//     auto-labeling but no folder_id was set (transitional data, or future
//     bugs in folder_id tracking).
//   • If the destination IS the Inbox folder, the Inbox label is added (this
//     happens naturally via the new-folder-label add path).
//
// Pass null for oldFolderId if the conversation wasn't in a folder before.
// Pass null for newFolderId if it's being moved to "no folder" (root).
// ────────────────────────────────────────────────────────────────────

export async function swapFolderLabel(
  conversationId: string,
  oldFolderId: string | null,
  newFolderId: string | null
): Promise<void> {
  if (oldFolderId === newFolderId) return; // no-op

  const supabase = createServerClient();

  // Resolve label ids for old and new folders
  const oldLabelId = oldFolderId ? await ensureFolderLabel(oldFolderId) : null;
  const newLabelId = newFolderId ? await ensureFolderLabel(newFolderId) : null;

  // Look up the new folder's name to decide whether to strip the global Inbox label.
  let newFolderName: string | null = null;
  if (newFolderId) {
    const { data: f } = await supabase
      .from("folders")
      .select("name")
      .eq("id", newFolderId)
      .maybeSingle();
    newFolderName = f?.name || null;
  }

  // Collect label ids to strip.
  const labelsToStrip: string[] = [];

  // Standard old-folder strip (don't strip if it's the same label as the new one,
  // which can happen when two folders share a name).
  if (oldLabelId && oldLabelId !== newLabelId) {
    labelsToStrip.push(oldLabelId);

    // ─── Nested-label cleanup ──────────────────────────────────────────
    // The old folder's label may have CHILD labels that the conversation
    // also has applied (e.g. parent label "Suppliers" with child "Asia",
    // or "Suppliers/A1", "Suppliers/A2"). When moving out of the parent
    // folder, those nested labels become stale and should be stripped too.
    //
    // Two-step: (1) find all child labels whose parent_label_id matches
    // the old folder's label, then (2) check which of those are actually
    // applied to this conversation, and add them to the strip list.
    //
    // We skip a child label if it equals newLabelId (caller is moving
    // INTO that child — keep it).
    const { data: childLabels } = await supabase
      .from("labels")
      .select("id")
      .eq("parent_label_id", oldLabelId);

    const childLabelIds = (childLabels || [])
      .map((l: any) => l.id)
      .filter((id: string) => id !== newLabelId);

    if (childLabelIds.length > 0) {
      // Of those child labels, which are actually attached to this conversation?
      const { data: attached } = await supabase
        .from("conversation_labels")
        .select("label_id")
        .eq("conversation_id", conversationId)
        .in("label_id", childLabelIds);

      for (const row of (attached || [])) {
        if (!labelsToStrip.includes(row.label_id)) {
          labelsToStrip.push(row.label_id);
        }
      }
    }
  }

  // ─── Migrated / never-foldered thread cleanup ─────────────────────
  // oldFolderId is NULL for threads that predate the folder system
  // (Missive migrations: all of Rove/NutriPro/Vita history). Their
  // pipeline stage lives purely in labels, so the standard strip above
  // has nothing to key on — the FIRST Move-to on such a thread would
  // leave stale stage labels behind (e.g. "1 - Inquiries" + its children
  // surviving a move into "2 - Quotes"). Same idea as the transitional
  // Inbox strip below, generalized: when moving INTO a top-level folder,
  // strip any attached labels that name-match the destination's SIBLING
  // top-level custom folders, plus those labels' attached children.
  //
  // Deliberately narrow: only fires when oldFolderId is NULL (native
  // threads keep the exact behavior above), only top-level destinations,
  // only non-system siblings (never touches Sent/Trash/Spam/Archive
  // semantics), and only labels actually attached to this conversation.
  // Existing labels are matched by name — nothing is created.
  if (!oldFolderId && newFolderId) {
    try {
      const { data: dest } = await supabase
        .from("folders")
        .select("id, name, email_account_id, parent_folder_id")
        .eq("id", newFolderId)
        .maybeSingle();

      if (dest && !dest.parent_folder_id) {
        const { data: siblings } = await supabase
          .from("folders")
          .select("id, name, is_system")
          .eq("email_account_id", dest.email_account_id)
          .is("parent_folder_id", null)
          .neq("id", newFolderId);

        const siblingNames = (siblings || [])
          .filter((f: any) => !f.is_system)
          .map((f: any) => String(f.name || "").trim())
          .filter(Boolean);

        if (siblingNames.length > 0) {
          const { data: stageLabels } = await supabase
            .from("labels")
            .select("id, name")
            .in("name", siblingNames)
            .is("parent_label_id", null);

          const stageIds = (stageLabels || [])
            .map((l: any) => l.id)
            .filter((id: string) => id !== newLabelId);

          if (stageIds.length > 0) {
            const { data: kids } = await supabase
              .from("labels")
              .select("id")
              .in("parent_label_id", stageIds);

            const candidateIds = [
              ...stageIds,
              ...((kids || []).map((l: any) => l.id)),
            ].filter((id: string) => id !== newLabelId);

            const { data: attached } = await supabase
              .from("conversation_labels")
              .select("label_id")
              .eq("conversation_id", conversationId)
              .in("label_id", candidateIds);

            for (const row of (attached || [])) {
              if (!labelsToStrip.includes(row.label_id)) {
                labelsToStrip.push(row.label_id);
              }
            }
          }
        }
      }
    } catch (e: any) {
      // Best-effort — a cleanup failure must never block the move itself.
      console.error("[swapFolderLabel] unfoldered-thread stage cleanup failed:", e?.message);
    }
  }

  // If destination is NOT the Inbox folder, also strip the global Inbox label
  // (handles transitional data where folder_id was NULL but Inbox label was applied).
  if (newFolderName?.toLowerCase() !== "inbox") {
    const inboxLabelId = await ensureGlobalLabel("Inbox");
    if (inboxLabelId && inboxLabelId !== newLabelId && !labelsToStrip.includes(inboxLabelId)) {
      labelsToStrip.push(inboxLabelId);
    }
  }

  if (labelsToStrip.length > 0) {
    await removeLabelsFromConversation(conversationId, labelsToStrip);
  }

  if (newLabelId) {
    await applyLabelsToConversation(conversationId, [newLabelId]);
  }
}

// ────────────────────────────────────────────────────────────────────
// isStageLabel / swapStageByAddedLabel
//
// A "stage label" is a TOP-LEVEL label (parent_label_id IS NULL) whose name
// matches a TOP-LEVEL, non-system folder — because every folder auto-creates a
// same-named mirror label. Brand/account labels (e.g. "Vita Organica") are also
// top-level but do NOT match a folder, so they are NOT stage labels and may
// co-exist. Nested labels (parent_label_id set) co-exist with their parent
// stage and are never treated as stages here.
//
// Stage labels are mutually exclusive: a conversation lives in exactly one
// pipeline stage. The Move-to-folder and Close paths already enforce this by
// swapping labels. This helper enforces the same invariant when a stage label
// is ADDED directly (e.g. via the label picker or an external agent), which
// otherwise bypasses the swap and produces the "two stage labels" corruption.
//
// Given the conversation and the newly-added stage label, it:
//   1. Resolves the folder whose name matches the added stage label.
//   2. Updates conversations.folder_id to that folder (full move parity).
//   3. Delegates to swapFolderLabel(old→new) to strip the previous stage
//      label + its children and apply the new stage label.
//
// Returns { swapped, removedStageName } so callers can surface a message.
// Best-effort — never throws; on any failure the plain label add still stands.
// ────────────────────────────────────────────────────────────────────

export interface StageInfo {
  isStage: boolean;
  /** The label id (== the added label) when it is a stage label. */
  stageLabelId?: string;
  /** The folder whose name matches this stage label, scoped to the account. */
  folderId?: string | null;
  folderName?: string | null;
}

/**
 * Determine whether `labelId` is a stage label for the given conversation's
 * account, and if so which folder it maps to. Read-only.
 */
export async function resolveStageLabel(
  conversationId: string,
  labelId: string
): Promise<StageInfo> {
  const supabase = createServerClient();

  // The label must be top-level to be a stage.
  const { data: label } = await supabase
    .from("labels")
    .select("id, name, parent_label_id")
    .eq("id", labelId)
    .maybeSingle();
  if (!label || label.parent_label_id) return { isStage: false };

  // Find the conversation's account so we match the correct account's folder.
  const { data: convo } = await supabase
    .from("conversations")
    .select("email_account_id")
    .eq("id", conversationId)
    .maybeSingle();
  if (!convo?.email_account_id) return { isStage: false };

  // Does a top-level folder on this account share the label's name?
  const { data: folder } = await supabase
    .from("folders")
    .select("id, name, is_system, parent_folder_id")
    .eq("email_account_id", convo.email_account_id)
    .is("parent_folder_id", null)
    .ilike("name", label.name)
    .maybeSingle();

  if (!folder) return { isStage: false };

  return {
    isStage: true,
    stageLabelId: label.id,
    folderId: folder.id,
    folderName: folder.name,
  };
}

/**
 * Enforce single-stage when a stage label was just added. Updates folder_id to
 * the added stage's folder and swaps labels (strip old stage + children, keep
 * the new one). No-op if the added label is not a stage label.
 */
export async function swapStageByAddedLabel(
  conversationId: string,
  addedLabelId: string
): Promise<{ swapped: boolean }> {
  try {
    const info = await resolveStageLabel(conversationId, addedLabelId);
    if (!info.isStage || !info.folderId) return { swapped: false };

    const supabase = createServerClient();

    // Capture the conversation's current folder (the "old" stage) before moving.
    const { data: convo } = await supabase
      .from("conversations")
      .select("folder_id")
      .eq("id", conversationId)
      .maybeSingle();
    const oldFolderId = convo?.folder_id ?? null;
    const newFolderId = info.folderId;

    if (oldFolderId === newFolderId) {
      // Already in this stage's folder — nothing to move; the label add stands.
      return { swapped: false };
    }

    // Full move parity: update folder_id first, then swap the labels. This
    // mirrors /api/conversations/move (which updates folder_id, then calls
    // swapFolderLabel). swapFolderLabel strips the old stage label + children
    // and applies the new stage label.
    await supabase
      .from("conversations")
      .update({ folder_id: newFolderId })
      .eq("id", conversationId);

    await swapFolderLabel(conversationId, oldFolderId, newFolderId);

    return { swapped: true };
  } catch (e: any) {
    console.error("[swapStageByAddedLabel] failed:", e?.message || e);
    return { swapped: false };
  }
}

// ────────────────────────────────────────────────────────────────────
// onNewConversationFromSync
//
// Called once per newly-created conversation during inbound sync (IMAP or
// Microsoft Graph). Applies the appropriate auto-labels AND sets folder_id:
//
//   • Inbound mail (isOutbound=false): folder_id = account's Inbox folder,
//     labels = [account_label, "Inbox"]
//   • Outbound mail (isOutbound=true): folder_id = account's Sent folder,
//     labels = [account_label]
//     (mirrors the send route's behavior at /api/send/route.ts — outbound
//      conversations belong in Sent. Without setting folder_id here,
//      outbound-first conversations are stranded: not in Inbox, not in
//      Sent — only reachable via the account label.)
//
// Setting folder_id is critical so future moves can correctly identify and
// strip the old folder's label.
//
// Best-effort — never throws. If anything goes wrong, logs and returns.
// ────────────────────────────────────────────────────────────────────

export async function onNewConversationFromSync(
  conversationId: string,
  accountId: string,
  isOutbound: boolean
): Promise<void> {
  try {
    const supabase = createServerClient();
    const { account_label_id, inbox_label_id } = await ensureAccountLabels(accountId);
    // Both inbound mail AND outbound-first outreach now live in the account's
    // Inbox (product decision: first outreach goes to Inbox, not Sent). So both
    // get the Inbox label + Inbox folder. The only difference left is unread:
    // inbound is unread-worthy, outbound is not (handled at message insert).
    const labelsToApply: Array<string | null> = [account_label_id, inbox_label_id];

    {
      // Set folder_id to the account's Inbox folder.
      const { data: inboxFolder } = await supabase
        .from("folders")
        .select("id")
        .eq("email_account_id", accountId)
        .ilike("name", "inbox")
        .eq("is_system", true)
        .limit(1)
        .maybeSingle();

      if (inboxFolder?.id) {
        await supabase
          .from("conversations")
          .update({ folder_id: inboxFolder.id })
          .eq("id", conversationId);
      }
    }

    await applyLabelsToConversation(conversationId, labelsToApply);
  } catch (e: any) {
    console.error("[onNewConversationFromSync] failed:", e?.message || e);
  }
}

// ────────────────────────────────────────────────────────────────────
// Business-days helper
//
// Returns true if `at` is within `days` business days of `now`.
// Business days = Mon–Fri. We count days, not hours — close enough
// for the supplier-reply reopen window per spec.
// ────────────────────────────────────────────────────────────────────

function isWithinBusinessDays(at: Date, now: Date, days: number): boolean {
  const cursor = new Date(at);
  let bizCount = 0;
  while (cursor < now) {
    cursor.setDate(cursor.getDate() + 1);
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) bizCount++;
    if (bizCount > days) return false;
  }
  return bizCount <= days;
}

// ────────────────────────────────────────────────────────────────────
// onIncomingMessageReopenCheck
//
// Called by the sync code right after an INBOUND message is added to an
// EXISTING conversation (i.e. the conversation already existed; this isn't
// a new conversation). Implements the reopen rule per spec:
//
//   • If conversation is currently closed:
//       – flip status to "open"
//       – if currently unassigned AND most recent closure was within 3
//         business days → assign to last closer
//       – if unassigned AND > 3 business days → leave unassigned, leave in
//         the folder it was closed to (drops back to that folder's team
//         triage view)
//       – if currently assigned (someone took over) → leave assignee alone
//
// Best-effort — never throws.
// ────────────────────────────────────────────────────────────────────

export async function onIncomingMessageReopenCheck(
  conversationId: string,
  isOutbound: boolean
): Promise<void> {
  if (isOutbound) return; // outbound messages don't trigger reopen
  try {
    const supabase = createServerClient();

    // Fetch current state
    const { data: convo } = await supabase
      .from("conversations")
      .select("id, status, assignee_id")
      .eq("id", conversationId)
      .maybeSingle();

    if (!convo || convo.status !== "closed") return; // nothing to reopen

    // NEW model: a supplier reply reopens the conversation. We simply flip it
    // back to "open" and KEEP the existing assignee (no footprint-based
    // auto-reassignment). Reopened + assigned → returns to that assignee's
    // personal inbox (personal inbox = assigned AND open). Reopened +
    // unassigned → returns to its folder's normal (Inbox) view via its label.
    await supabase
      .from("conversations")
      .update({ status: "open" })
      .eq("id", conversationId);

    // Activity log
    await supabase.from("activity_log").insert({
      conversation_id: conversationId,
      actor_id: null,
      action: "reopened_by_supplier_reply",
      details: { auto_assigned_to: null },
    });
  } catch (e: any) {
    console.error("[onIncomingMessageReopenCheck] failed:", e?.message || e);
  }
}