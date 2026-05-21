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
