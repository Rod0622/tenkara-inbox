// src/components/settings/IntegrationsTab.tsx
//
// Settings → Integrations tab. Currently lists only Quo. Designed to extend
// to Granola (and others) later by dropping in more card components.

"use client";

import { useEffect, useState } from "react";
import {
  Phone,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Eye,
  EyeOff,
  Trash2,
  RefreshCw,
  ExternalLink,
  Users,
  UserCheck,
  Sparkles,
} from "lucide-react";

interface QuoStatus {
  connected: boolean;
  is_active: boolean;
  apiKeyMask?: string | null;
  webhookSecretMask?: string | null;
  phoneNumberId?: string | null;
  last_event_at?: string | null;
  total_events_received?: number;
  consecutive_errors?: number;
  last_error_at?: string | null;
  last_error_message?: string | null;
  callCount?: number;
}

function formatRel(ts: string | null | undefined): string {
  if (!ts) return "never";
  const t = new Date(ts).getTime();
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} hr ago`;
  return new Date(ts).toLocaleString();
}

export default function IntegrationsTab() {
  return (
    <div className="p-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Integrations</h1>
        <p className="text-sm text-[var(--text-secondary)]">
          Connect third-party services to bring calls, meetings, and other context into Tenkara Inbox.
        </p>
      </div>
      <QuoCard />
    </div>
  );
}

function QuoCard() {
  const [status, setStatus] = useState<QuoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const [apiKey, setApiKey] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [validatedNumbers, setValidatedNumbers] = useState<any[] | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/integrations/quo", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setStatus(json);
      if (json.phoneNumberId) setPhoneNumberId(json.phoneNumberId);
    } catch (e: any) {
      setError(e?.message || "Failed to load Quo status");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  async function handleSave() {
    clearMessages();
    if (!apiKey && !phoneNumberId && !webhookSecret) {
      setError("Provide at least one value to save");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/integrations/quo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: apiKey || undefined,
          phoneNumberId: phoneNumberId || undefined,
          webhookSecret: webhookSecret || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setSuccess("Saved successfully");
      setApiKey("");
      setWebhookSecret("");
      if (json.validatedNumbers) setValidatedNumbers(json.validatedNumbers);
      await load();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    clearMessages();
    setTesting(true);
    try {
      const res = await fetch("/api/integrations/quo", { method: "PATCH" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Test failed");
      setValidatedNumbers(json.numbers || []);
      setSuccess(`Quo reachable — ${json.numbers?.length || 0} phone numbers in workspace`);
    } catch (e: any) {
      setError("Test failed: " + (e?.message || "unknown"));
    } finally {
      setTesting(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Quo? Saved call history will be kept, but new events won't be received until reconnected.")) {
      return;
    }
    clearMessages();
    setDisconnecting(true);
    try {
      const res = await fetch("/api/integrations/quo", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Disconnect failed");
      setSuccess("Disconnected");
      setValidatedNumbers(null);
      await load();
    } catch (e: any) {
      setError(e?.message || "Disconnect failed");
    } finally {
      setDisconnecting(false);
    }
  }

  const webhookUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/api/webhooks/quo`
      : "/api/webhooks/quo";

  async function copyWebhookUrl() {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    } catch {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = webhookUrl;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    }
  }

  const connected = !!status?.connected && !!status?.is_active;

  return (
    <div className="border border-[var(--border)] rounded-xl p-6 bg-[var(--surface)]">
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[var(--bg)] flex items-center justify-center">
            <Phone size={20} className="text-[var(--accent)]" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Quo (formerly OpenPhone)</h2>
            <p className="text-xs text-[var(--text-secondary)]">
              Sync calls, voicemails, and AI summaries into supplier conversations
            </p>
          </div>
        </div>
        <div>
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
          ) : connected ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-500/10 text-green-400">
              <CheckCircle2 size={12} /> Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--border)] text-[var(--text-secondary)]">
              Not connected
            </span>
          )}
        </div>
      </div>

      {/* Stats row when connected */}
      {connected && (
        <div className="grid grid-cols-3 gap-3 mb-5 mt-4">
          <div className="border border-[var(--border)] rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Calls logged</div>
            <div className="text-lg font-semibold">{status?.callCount || 0}</div>
          </div>
          <div className="border border-[var(--border)] rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Events received</div>
            <div className="text-lg font-semibold">{status?.total_events_received || 0}</div>
            <div className="text-[10px] text-[var(--text-secondary)] mt-0.5">
              last: {formatRel(status?.last_event_at)}
            </div>
          </div>
          <div className="border border-[var(--border)] rounded-lg p-3">
            <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">Recent errors</div>
            <div className="text-lg font-semibold">{status?.consecutive_errors || 0}</div>
            {status?.last_error_at ? (
              <div className="text-[10px] text-red-400 mt-0.5">
                last: {formatRel(status.last_error_at)}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* Starter plan notice */}
      <div className="bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 mb-5 text-xs text-[var(--text-secondary)]">
        <div className="font-medium text-[var(--text-primary)] mb-1">Starter plan limitations</div>
        <ul className="list-disc list-inside space-y-0.5">
          <li>AI call summaries and transcripts only flow in for Sona-handled calls</li>
          <li>Voicemail transcripts and call metadata work normally</li>
          <li>Auto-recording is not available — manual recording only</li>
        </ul>
      </div>

      {/* Inputs */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium mb-1">
            API Key {status?.apiKeyMask ? <span className="text-[var(--text-muted)] font-normal">(saved: {status.apiKeyMask})</span> : null}
          </label>
          <div className="relative">
            <input
              type={showApiKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={status?.apiKeyMask ? "Leave blank to keep current key" : "Paste from Quo Settings → API"}
              className="w-full px-3 py-2 pr-10 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
              aria-label="Toggle visibility"
            >
              {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">Phone Number ID</label>
          <input
            type="text"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value)}
            placeholder="PN..."
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm outline-none focus:border-[var(--accent)]"
          />
          <p className="text-[10px] text-[var(--text-muted)] mt-1">
            Find this in Quo: Settings → Phone Numbers → click the number → copy the ID from the URL.
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            Webhook URL{" "}
            <span className="text-[var(--text-muted)] font-normal">(set this in Quo)</span>
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={webhookUrl}
              readOnly
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs font-mono text-[var(--text-secondary)]"
            />
            <button
              type="button"
              onClick={copyWebhookUrl}
              className="px-3 rounded-lg border border-[var(--border)] hover:bg-[var(--border)] text-xs"
            >
              {copiedUrl ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1">
            Webhook Signing Secret{" "}
            {status?.webhookSecretMask ? <span className="text-[var(--text-muted)] font-normal">(saved)</span> : null}
          </label>
          <div className="relative">
            <input
              type={showSecret ? "text" : "password"}
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={status?.webhookSecretMask ? "Leave blank to keep current" : "Paste from Quo webhook creation"}
              className="w-full px-3 py-2 pr-10 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]"
              aria-label="Toggle visibility"
            >
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400 flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}
      {success && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/30 text-xs text-green-400 flex items-start gap-2">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
          <div>{success}</div>
        </div>
      )}

      {/* Validated phone numbers */}
      {validatedNumbers && validatedNumbers.length > 0 && (
        <div className="mt-4 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs">
          <div className="font-medium text-[var(--text-primary)] mb-1">Workspace phone numbers</div>
          <ul className="space-y-0.5 text-[var(--text-secondary)]">
            {validatedNumbers.map((n: any) => (
              <li key={n.id} className="font-mono">
                {n.number || "—"} <span className="text-[var(--text-muted)]">({n.name || n.id})</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="mt-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving || (!apiKey && !phoneNumberId && !webhookSecret)}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold disabled:opacity-40"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {connected && (
            <button
              onClick={handleTest}
              disabled={testing}
              className="px-3 py-2 rounded-lg border border-[var(--border)] text-sm hover:bg-[var(--border)] disabled:opacity-40 flex items-center gap-1.5"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Test connection
            </button>
          )}
        </div>
        {connected && (
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            className="px-3 py-2 rounded-lg border border-red-500/30 text-red-400 text-sm hover:bg-red-500/10 disabled:opacity-40 flex items-center gap-1.5"
          >
            {disconnecting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Disconnect
          </button>
        )}
      </div>

      {/* Quo user → team member mapping */}
      {status?.connected && <QuoUserMapping />}

      {/* Webhook setup help */}
      <details className="mt-5 text-xs">
        <summary className="cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          How to set up the Quo webhook
        </summary>
        <ol className="list-decimal list-inside space-y-1 mt-2 text-[var(--text-secondary)]">
          <li>Go to Quo Settings → Developer → Webhooks (Beta)</li>
          <li>Click <strong>Create webhook</strong></li>
          <li>Paste the URL above</li>
          <li>
            Enable events: <code className="text-[10px]">call.ringing</code>,{" "}
            <code className="text-[10px]">call.completed</code>,{" "}
            <code className="text-[10px]">call.recording.completed</code>,{" "}
            <code className="text-[10px]">call.summary.completed</code>,{" "}
            <code className="text-[10px]">call.transcript.completed</code>
          </li>
          <li>Copy the signing secret Quo shows once, paste it into the field above, and Save</li>
          <li>
            Verify by making a test call — it should appear here within a few seconds.{" "}
            <a
              href="https://www.quo.com/docs/mdx/guides/webhooks"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--accent)] inline-flex items-center gap-0.5"
            >
              Quo webhook docs <ExternalLink size={10} />
            </a>
          </li>
        </ol>
      </details>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// QuoUserMapping — maps Quo workspace users to team members
// ────────────────────────────────────────────────────────────
//
// Extracts unique Quo users from the saved knownPhoneNumbers data and lets
// the admin pick which team member each one corresponds to. Saves the
// result into integration_configs.config.quo_user_email_map, which the
// webhook handler (matchQuoUserToTeamMember) already reads.
//
// Forward-only: existing calls keep team_member_id=NULL. New calls
// (after the mapping is saved) populate correctly.

interface QuoUserMappingRow {
  quo_user_id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  role: string | null;
  phone_numbers: Array<{ id: string; number: string | null; name: string | null }>;
  mapped_email: string | null;
  mapped_team_member: { id: string; name: string; initials: string; color: string } | null;
  suggested_team_member: { id: string; name: string; initials: string; color: string } | null;
}

interface TeamMemberOption {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
}

function QuoUserMapping() {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState<QuoUserMappingRow[]>([]);
  const [members, setMembers] = useState<TeamMemberOption[]>([]);
  // Working draft of the map (quoUserId -> email). Distinct from the saved
  // state so we can show "unsaved changes" and only PATCH on save.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/quo/users");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load Quo users");

      const usersList: QuoUserMappingRow[] = data.users || [];
      setUsers(usersList);

      const membersList: TeamMemberOption[] = (data.team_members || []).map((m: any) => ({
        id: m.id,
        name: m.name,
        email: m.email,
        initials: m.initials || (m.name || "").slice(0, 2).toUpperCase(),
        color: m.color || "#888",
      }));
      setMembers(membersList);

      // Seed draft from current mappings (so saved state is shown in selects)
      const seed: Record<string, string> = {};
      for (const u of usersList) {
        if (u.mapped_email) seed[u.quo_user_id] = u.mapped_email.toLowerCase();
      }
      setDraft(seed);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // Reload only on mount; user clicks Refresh to pull latest from server
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMappingFor = (quoUserId: string, email: string) => {
    setDraft((d) => {
      const next = { ...d };
      if (!email) {
        delete next[quoUserId];
      } else {
        next[quoUserId] = email.toLowerCase();
      }
      return next;
    });
    setSaved(false);
  };

  const applySuggestion = (quoUserId: string, email: string) => {
    setMappingFor(quoUserId, email);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/integrations/quo/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ map: draft }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Save failed");
      setSaved(true);
      // Refresh to show the just-saved state as "mapped"
      await load();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const draftCount = Object.values(draft).filter(Boolean).length;
  const totalUsers = users.length;
  const hasUnsavedChanges = (() => {
    // Compare draft to current saved state (mapped_email per user)
    const saved: Record<string, string> = {};
    for (const u of users) {
      if (u.mapped_email) saved[u.quo_user_id] = u.mapped_email.toLowerCase();
    }
    const savedKeys = Object.keys(saved);
    const draftKeys = Object.keys(draft);
    if (savedKeys.length !== draftKeys.length) return true;
    for (const k of draftKeys) {
      if (saved[k] !== draft[k]) return true;
    }
    return false;
  })();

  return (
    <div className="mt-6 pt-5 border-t border-[var(--border)]">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-[var(--info)]/12 flex items-center justify-center shrink-0">
            <Users size={15} className="text-[var(--info)]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-[var(--text-primary)]">
              Map Quo users to team members
            </h3>
            <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
              Lets calls show who in your team made them. Affects new calls only.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[11px] font-mono text-[var(--text-muted)]">
            {draftCount} of {totalUsers} mapped
          </span>
          <button
            onClick={load}
            disabled={loading}
            title="Refresh Quo users"
            className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] disabled:opacity-40"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="py-6 flex justify-center">
          <Loader2 size={18} className="animate-spin text-[var(--info)]" />
        </div>
      ) : error ? (
        <div className="px-3 py-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-xs text-[var(--danger)] flex items-start gap-2">
          <AlertCircle size={13} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      ) : users.length === 0 ? (
        <div className="px-3 py-6 rounded-lg bg-[var(--bg)] border border-dashed border-[var(--border)] text-center">
          <p className="text-[12px] text-[var(--text-secondary)] mb-1">No Quo users found</p>
          <p className="text-[10px] text-[var(--text-muted)]">
            Click <strong>Test connection</strong> on the Quo card above to refresh workspace data.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-[var(--bg)] text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-bold">
                <tr>
                  <th className="text-left px-3 py-2">Quo user</th>
                  <th className="text-left px-3 py-2">Phone numbers</th>
                  <th className="text-left px-3 py-2 w-[260px]">Map to team member</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {users.map((u) => {
                  const fullName = `${u.firstName || ""} ${u.lastName || ""}`.trim() || "(no name)";
                  const currentDraftEmail = draft[u.quo_user_id] || "";
                  const isMapped = !!currentDraftEmail;
                  const hasSuggestion =
                    !isMapped &&
                    u.suggested_team_member &&
                    u.email; // we can only apply suggestions if Quo gave us the email

                  return (
                    <tr key={u.quo_user_id} className="hover:bg-[var(--bg)]/40">
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex flex-col">
                          <span className="text-[var(--text-primary)] font-medium">{fullName}</span>
                          {u.email && (
                            <span className="text-[10px] text-[var(--text-muted)] font-mono">
                              {u.email}
                            </span>
                          )}
                          {u.role && (
                            <span className="text-[9px] uppercase tracking-wider text-[var(--text-muted)] mt-0.5">
                              {u.role}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex flex-col gap-0.5">
                          {u.phone_numbers.map((p) => (
                            <span key={p.id} className="text-[10px] font-mono text-[var(--text-secondary)]">
                              {p.number || p.id}
                              {p.name && (
                                <span className="text-[var(--text-muted)]"> · {p.name}</span>
                              )}
                            </span>
                          ))}
                          {u.phone_numbers.length === 0 && (
                            <span className="text-[10px] text-[var(--text-muted)] italic">none</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={currentDraftEmail}
                            onChange={(e) => setMappingFor(u.quo_user_id, e.target.value)}
                            className="flex-1 min-w-0 px-2 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                          >
                            <option value="">— Unmapped —</option>
                            {members.map((m) => (
                              <option key={m.id} value={m.email}>
                                {m.name} ({m.email})
                              </option>
                            ))}
                          </select>
                          {isMapped && (
                            <UserCheck size={13} className="text-[var(--accent)] shrink-0" />
                          )}
                          {hasSuggestion && (
                            <button
                              onClick={() => applySuggestion(u.quo_user_id, u.email!)}
                              title={`Apply suggestion: ${u.suggested_team_member!.name}`}
                              className="p-1 rounded text-[var(--highlight)] hover:bg-[var(--highlight)]/10 shrink-0"
                            >
                              <Sparkles size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between gap-3 mt-3">
            <div className="text-[10px] text-[var(--text-muted)]">
              {hasUnsavedChanges ? (
                <span className="text-[var(--warning)]">Unsaved changes</span>
              ) : saved ? (
                <span className="text-[var(--accent)] inline-flex items-center gap-1">
                  <Check size={11} /> Saved
                </span>
              ) : (
                <>Forward-only — existing calls keep their attribution.</>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saving || !hasUnsavedChanges}
              className="px-3 py-1.5 rounded-md bg-[var(--accent)] text-[var(--bg)] text-[12px] font-semibold hover:bg-[var(--accent-strong)] disabled:opacity-40 flex items-center gap-1.5"
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              Save mappings
            </button>
          </div>
        </>
      )}
    </div>
  );
}