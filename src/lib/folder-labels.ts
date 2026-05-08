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

export async function ensureGlobalLabel(
  name: string,
  options?: { color?: string; bg_color?: string }
): Promise<string | null> {
  const supabase = createServerClient();
  const trimmed = name.trim();
  if (!trimmed) return null;

  // Try to find existing
  const { data: existing } = await supabase
    .from("labels")
    .select("id")
    .ilike("name", trimmed)
    .limit(1)
    .maybeSingle();

  if (existing?.id) return existing.id;

  // Create
  const palette = options?.color
    ? { color: options.color, bg_color: options.bg_color || options.color + "20" }
    : pickColorFor(trimmed);

  const { data: created, error } = await supabase
    .from("labels")
    .insert({ name: trimmed, color: palette.color, bg_color: palette.bg_color })
    .select("id")
    .single();

  if (error) {
    console.error("[ensureGlobalLabel] insert failed for", trimmed, ":", error.message);
    return null;
  }
  return created?.id || null;
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

export async function ensureFolderLabel(folderId: string): Promise<string | null> {
  const supabase = createServerClient();

  const { data: folder, error } = await supabase
    .from("folders")
    .select("name")
    .eq("id", folderId)
    .maybeSingle();

  if (error || !folder?.name) {
    console.error("[ensureFolderLabel] folder not found:", folderId);
    return null;
  }

  return ensureGlobalLabel(folder.name);
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

export async function swapFolderLabel(
  conversationId: string,
  oldFolderId: string | null,
  newFolderId: string | null
): Promise<void> {
  if (oldFolderId === newFolderId) return; // no-op

  const oldLabelId = oldFolderId ? await ensureFolderLabel(oldFolderId) : null;
  const newLabelId = newFolderId ? await ensureFolderLabel(newFolderId) : null;

  // Don't strip the old label if it happens to be the same UUID as the new label
  // (can happen if two folders share a name → share a label id).
  if (oldLabelId && oldLabelId !== newLabelId) {
    await removeLabelsFromConversation(conversationId, [oldLabelId]);
  }
  if (newLabelId) {
    await applyLabelsToConversation(conversationId, [newLabelId]);
  }
}

// ────────────────────────────────────────────────────────────────────
// onNewConversationFromSync
//
// Called once per newly-created conversation during inbound sync (IMAP or
// Microsoft Graph). Applies the appropriate auto-labels:
//
//   • Inbound mail (isOutbound=false): [account_label, "Inbox"]
//   • Outbound mail (isOutbound=true): [account_label] only
//     (outbound conversations belong in Sent, not Inbox)
//
// Best-effort — never throws. If anything goes wrong, logs and returns.
// Caller should NOT await this in a tight loop where one failure might
// matter, but in practice the cost is one upsert per new conversation.
// ────────────────────────────────────────────────────────────────────

export async function onNewConversationFromSync(
  conversationId: string,
  accountId: string,
  isOutbound: boolean
): Promise<void> {
  try {
    const { account_label_id, inbox_label_id } = await ensureAccountLabels(accountId);
    const labelsToApply: Array<string | null> = [account_label_id];
    if (!isOutbound) {
      labelsToApply.push(inbox_label_id);
    }
    await applyLabelsToConversation(conversationId, labelsToApply);
  } catch (e: any) {
    console.error("[onNewConversationFromSync] failed:", e?.message || e);
  }
}