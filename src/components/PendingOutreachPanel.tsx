"use client";

/**
 * PendingOutreachPanel
 *
 * The operator queue for agent-created cold-outreach drafts that haven't
 * been sent yet because they're missing a sender account. Agents (e.g.
 * Sammy v1) POST to /api/external/conversations to create a conv + draft
 * but leave `email_account_id` null and `requires_sender_selection = TRUE`,
 * deferring the sender choice to a human.
 *
 * UX:
 *   • Each row shows the agent name, supplier email, draft subject and
 *     a body preview.
 *   • Inline account-picker dropdown — operator picks which mailbox to
 *     send from.
 *   • One-click "Send" button — fires POST /api/send, which already
 *     handles the agent-draft lifecycle (deletes the draft, fires
 *     draft.sent webhook to the agent, logs activity).
 *   • Discard removes the draft (DELETE /api/drafts?id=...) — fires
 *     draft.discarded webhook to the agent.
 *
 * Refresh cadence mirrors DraftsPanel: 15s polling + window-focus refetch.
 */

import { useState, useEffect, useRef } from "react";
import {
  Bell,
  Loader2,
  Send,
  Trash2,
  Clock,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
} from "lucide-react";
import type { TeamMember } from "@/types";

interface EmailAccount {
  id: string;
  name: string | null;
  email: string | null;
  color?: string | null;
}

interface PendingDraft {
  id: string;
  conversation_id: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  bcc_addresses: string | null;
  created_by_agent: string | null;
  requires_sender_selection: boolean;
  external_id: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  conversation: {
    id: string;
    subject: string | null;
    from_email: string | null;
    primary_contact_email: string | null;
    primary_contact_name: string | null;
    thread_id: string | null;
  } | null;
}

interface ToastState {
  kind: "ok" | "error";
  message: string;
}

export default function PendingOutreachPanel({
  currentUser,
  emailAccounts,
  onOpenConversation,
}: {
  currentUser: TeamMember | null;
  emailAccounts: EmailAccount[];
  onOpenConversation?: (conversationId: string) => void;
}) {
  const [drafts, setDrafts] = useState<PendingDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // draftId → accountId picked in the dropdown (local-only state until Send)
  const [pickedAccount, setPickedAccount] = useState<Record<string, string>>(
    {}
  );
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Pause polling while a mutation is in flight so optimistic UI doesn't
  // get clobbered by a refetch that hasn't seen the change yet.
  const inflightRef = useRef<boolean>(false);
  useEffect(() => {
    inflightRef.current = !!sendingId || !!discardingId;
  }, [sendingId, discardingId]);

  const fetchDrafts = async () => {
    try {
      const res = await fetch("/api/drafts/pending-outreach");
      if (res.ok) {
        const data = await res.json();
        setDrafts((data.drafts || []) as PendingDraft[]);
        setError(null);
      } else {
        const err = await res.json().catch(() => ({}));
        setError(err.error || "Failed to load pending outreach");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load pending outreach");
    }
    setLoading(false);
  };

  useEffect(() => {
    setLoading(true);
    fetchDrafts();
    const interval = setInterval(() => {
      if (!inflightRef.current) fetchDrafts();
    }, 15000);
    const onFocus = () => {
      if (!inflightRef.current) fetchDrafts();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (kind: ToastState["kind"], message: string) => {
    setToast({ kind, message });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSend = async (draft: PendingDraft) => {
    const accountId = pickedAccount[draft.id];
    if (!accountId) {
      showToast("error", "Pick a sending account first.");
      return;
    }
    if (!draft.conversation_id) {
      showToast(
        "error",
        "Draft is missing its conversation — can't send. Discard and ask the agent to recreate."
      );
      return;
    }
    setSendingId(draft.id);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: draft.conversation_id,
          account_id: accountId,
          to: draft.to_addresses || draft.conversation?.primary_contact_email || "",
          cc: draft.cc_addresses || "",
          bcc: draft.bcc_addresses || "",
          subject: draft.subject || draft.conversation?.subject || "",
          body: draft.body_html || draft.body_text || "",
          actor_id: currentUser?.id || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Send failed (${res.status})`);
      }
      // /api/send deletes the agent draft on success and fires the
      // draft.sent webhook. Remove the row optimistically; the next
      // poll will confirm.
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      const pickedName =
        emailAccounts.find((a) => a.id === accountId)?.email || "selected account";
      showToast("ok", `Sent from ${pickedName}.`);
    } catch (e: any) {
      showToast("error", e?.message || "Send failed");
    } finally {
      setSendingId(null);
    }
  };

  const handleDiscard = async (draft: PendingDraft) => {
    if (
      !window.confirm(
        `Discard this draft from ${draft.created_by_agent || "the agent"}?\n\nThe draft will be deleted and a draft.discarded webhook will fire so the agent knows. This cannot be undone.`
      )
    ) {
      return;
    }
    setDiscardingId(draft.id);
    try {
      const res = await fetch(`/api/drafts?id=${draft.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Discard failed (${res.status})`);
      }
      setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
      showToast("ok", "Draft discarded.");
    } catch (e: any) {
      showToast("error", e?.message || "Discard failed");
    } finally {
      setDiscardingId(null);
    }
  };

  if (loading && drafts.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="animate-spin text-[var(--accent)]" size={24} />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--bg)]">
      <div className="max-w-3xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Bell size={22} className="text-[var(--warning)]" />
          <div>
            <h1 className="text-xl font-bold text-[var(--text-primary)]">
              Pending Outreach
            </h1>
            <p className="text-xs text-[var(--text-secondary)]">
              {drafts.length} agent draft{drafts.length !== 1 ? "s" : ""} awaiting
              sender selection
            </p>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[12px] text-[var(--danger)]">
            <AlertTriangle size={13} className="inline mr-1.5" />
            {error}
          </div>
        )}

        {/* Toast */}
        {toast && (
          <div
            className={`mb-4 p-3 rounded-lg text-[12px] border ${
              toast.kind === "ok"
                ? "bg-[var(--accent)]/10 border-[var(--accent)]/30 text-[var(--accent)]"
                : "bg-[var(--danger)]/10 border-[var(--danger)]/30 text-[var(--danger)]"
            }`}
          >
            {toast.message}
          </div>
        )}

        {/* Empty state */}
        {drafts.length === 0 && !error ? (
          <div className="text-center py-16">
            <Bell
              size={40}
              className="mx-auto mb-3 text-[var(--text-muted)] opacity-50"
            />
            <div className="text-sm text-[var(--text-muted)]">
              No pending outreach
            </div>
            <div className="text-xs text-[var(--text-muted)] mt-1">
              Drafts created by agents needing operator sender selection will
              appear here.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {drafts.map((draft) => {
              const isSending = sendingId === draft.id;
              const isDiscarding = discardingId === draft.id;
              const isBusy = isSending || isDiscarding;
              const accountId = pickedAccount[draft.id] || "";
              const pickedAccountRow = emailAccounts.find(
                (a) => a.id === accountId
              );
              const supplierEmail =
                draft.to_addresses ||
                draft.conversation?.primary_contact_email ||
                draft.conversation?.from_email ||
                "—";
              const ageLabel = humanizeAge(draft.created_at);

              return (
                <div
                  key={draft.id}
                  className="group p-4 rounded-xl bg-[var(--surface)] border border-[var(--border)] hover:border-[var(--border)]/80 transition-all"
                >
                  {/* Row 1: subject + agent chip + age */}
                  <div className="flex items-start gap-2 mb-2 flex-wrap">
                    <div className="text-sm font-medium text-[var(--text-primary)] flex-1 min-w-0 truncate">
                      {draft.subject ||
                        draft.conversation?.subject ||
                        "(no subject)"}
                    </div>
                    {draft.created_by_agent && (
                      <span
                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#A855F7]/10 text-[#A855F7] border border-[#A855F7]/20 shrink-0 flex items-center gap-1"
                        title={`Drafted by ${draft.created_by_agent}`}
                      >
                        <span>🤖</span>
                        <span>{draft.created_by_agent}</span>
                      </span>
                    )}
                    <span
                      className="text-[10px] text-[var(--text-muted)] flex items-center gap-1 shrink-0"
                      title={new Date(draft.created_at).toLocaleString()}
                    >
                      <Clock size={10} />
                      {ageLabel}
                    </span>
                  </div>

                  {/* Row 2: supplier + external_id */}
                  <div className="text-[11px] text-[var(--text-secondary)] mb-1.5 flex items-center gap-1.5 flex-wrap">
                    <span>
                      <span className="text-[var(--text-muted)]">To:</span>{" "}
                      {supplierEmail}
                    </span>
                    {draft.external_id && (
                      <span
                        className="text-[10px] text-[var(--text-muted)] font-mono"
                        title="Agent's correlation id (passed in the POST that created this draft)"
                      >
                        · {draft.external_id}
                      </span>
                    )}
                  </div>

                  {/* Row 3: body preview */}
                  <div className="text-xs text-[var(--text-muted)] line-clamp-2 mb-3">
                    {(draft.body_text || stripHtml(draft.body_html || "")).slice(
                      0,
                      240
                    ) || "(empty body)"}
                  </div>

                  {/* Row 4: actions — account picker + send + discard + open */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Account picker */}
                    <AccountPicker
                      accounts={emailAccounts}
                      value={accountId}
                      onChange={(id) =>
                        setPickedAccount((prev) => ({ ...prev, [draft.id]: id }))
                      }
                      disabled={isBusy}
                    />

                    {/* Send button */}
                    <button
                      onClick={() => handleSend(draft)}
                      disabled={isBusy || !accountId}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--bg)] text-[12px] font-semibold hover:bg-[var(--accent)]/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                      title={
                        accountId
                          ? `Send from ${pickedAccountRow?.email || "selected account"}`
                          : "Pick a sending account first"
                      }
                    >
                      {isSending ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Send size={12} />
                      )}
                      <span>{isSending ? "Sending…" : "Send"}</span>
                    </button>

                    <div className="flex-1" />

                    {/* Open in conversation popup (uses the same popup pattern
                        as ConversationList's double-click) */}
                    {draft.conversation_id && (
                      <button
                        onClick={() => {
                          if (onOpenConversation && draft.conversation_id) {
                            onOpenConversation(draft.conversation_id);
                          }
                        }}
                        disabled={isBusy}
                        className="p-1.5 rounded-md hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--info)] disabled:opacity-40"
                        title="Open conversation to edit draft"
                      >
                        <ExternalLink size={14} />
                      </button>
                    )}

                    {/* Discard */}
                    <button
                      onClick={() => handleDiscard(draft)}
                      disabled={isBusy}
                      className="p-1.5 rounded-md hover:bg-[var(--surface-hover)] text-[var(--text-secondary)] hover:text-[var(--danger)] disabled:opacity-40"
                      title="Discard draft (fires draft.discarded webhook)"
                    >
                      {isDiscarding ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Account picker subcomponent ────────────────────────────────────────

function AccountPicker({
  accounts,
  value,
  onChange,
  disabled,
}: {
  accounts: EmailAccount[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selected = accounts.find((a) => a.id === value);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] border transition-all min-w-[180px] ${
          selected
            ? "bg-[var(--surface)] border-[var(--border)] text-[var(--text-primary)]"
            : "bg-[var(--warning)]/10 border-[var(--warning)]/40 text-[var(--warning)]"
        } disabled:opacity-40 hover:border-[var(--text-muted)]`}
        title={selected ? `Send from ${selected.email}` : "Pick a sending account"}
      >
        <span className="flex-1 truncate text-left">
          {selected
            ? selected.email || selected.name || "—"
            : "Pick sender…"}
        </span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 min-w-[260px] max-h-[280px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl shadow-black/40 py-1">
          {accounts.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-[var(--text-muted)]">
              No email accounts available
            </div>
          ) : (
            accounts.map((acc) => (
              <button
                key={acc.id}
                onClick={() => {
                  onChange(acc.id);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-[var(--border)] flex items-center gap-2 ${
                  acc.id === value
                    ? "bg-[var(--border)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium text-[var(--text-primary)]">
                    {acc.email || acc.name || "—"}
                  </div>
                  {acc.name && acc.email && (
                    <div className="truncate text-[10px] text-[var(--text-muted)]">
                      {acc.name}
                    </div>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function stripHtml(s: string): string {
  return s
    .replace(/<\/(p|div|h[1-6]|blockquote|li)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function humanizeAge(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    const min = Math.floor(ms / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h ago`;
    const day = Math.floor(hr / 24);
    if (day < 30) return `${day}d ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
}
