"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, AlertTriangle, ArrowLeft, ExternalLink, ChevronRight } from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────
interface AccountLite { id: string; name: string; email: string; }
interface Supplier { domain: string; sampleEmail: string; msgCount: number; }
interface Suspect {
  conversation_id: string;
  subject: string;
  folder_id: string | null;
  status: string;
  last_message_at: string | null;
  supplier_count: number;
  suppliers: Supplier[];
}
interface ReviewMessage {
  id: string;
  from_email: string | null;
  from_name: string | null;
  to_addresses: string | null;
  is_outbound: boolean;
  sent_at: string | null;
  subject: string | null;
  snippet: string | null;
  supplier_email: string | null;
  supplier_domain: string | null;
  is_own_domain: boolean;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Stable color per domain for quick visual grouping.
const DOMAIN_COLORS = [
  "#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED",
  "#DB2777", "#0891B2", "#65A30D", "#9333EA", "#E11D48",
];
function colorForDomain(domain: string, order: string[]): string {
  const idx = order.indexOf(domain);
  return DOMAIN_COLORS[(idx < 0 ? 0 : idx) % DOMAIN_COLORS.length];
}

export default function LeakReviewPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();

  const [accounts, setAccounts] = useState<AccountLite[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [scanned, setScanned] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Suspect | null>(null);
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.push("/login");
  }, [authStatus, router]);

  // Load accounts for the picker.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/data?dataset=accounts");
        if (res.ok) {
          const data = await res.json();
          setAccounts(data.accounts || []);
        }
      } catch {
        /* non-fatal */
      }
    })();
  }, []);

  const scan = useCallback(async (accId: string) => {
    if (!accId) return;
    setLoading(true);
    setError(null);
    setSelected(null);
    setMessages([]);
    try {
      const res = await fetch(`/api/leak-review?account_id=${encodeURIComponent(accId)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Scan failed");
        setSuspects([]);
      } else {
        setSuspects(data.suspects || []);
        setScanned(typeof data.scanned === "number" ? data.scanned : null);
      }
    } catch (e: any) {
      setError(e?.message || "Scan failed");
      setSuspects([]);
    }
    setLoading(false);
  }, []);

  const openSuspect = useCallback(async (s: Suspect) => {
    setSelected(s);
    setMsgLoading(true);
    setMessages([]);
    try {
      const res = await fetch(
        `/api/leak-review/messages?conversation_id=${encodeURIComponent(s.conversation_id)}`
      );
      const data = await res.json();
      if (res.ok) setMessages(data.messages || []);
    } catch {
      /* non-fatal */
    }
    setMsgLoading(false);
  }, []);

  const domainOrder = selected ? selected.suppliers.map((s) => s.domain) : [];

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]">
      {/* Header */}
      <div className="border-b border-[var(--border)] px-6 py-4 flex items-center gap-3">
        <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]">
          <ArrowLeft size={18} />
        </Link>
        <AlertTriangle size={18} className="text-[#D97706]" />
        <h1 className="text-[15px] font-semibold">Leak Review</h1>
        <span className="text-[12px] text-[var(--text-muted)]">
          Conversations that may contain more than one supplier
        </span>
      </div>

      <div className="px-6 py-4">
        {/* Account picker */}
        <div className="flex items-center gap-3 mb-4">
          <label className="text-[13px] text-[var(--text-secondary)]">Account</label>
          <select
            value={accountId}
            onChange={(e) => { setAccountId(e.target.value); scan(e.target.value); }}
            className="text-[13px] bg-[var(--surface)] border border-[var(--border)] rounded-md px-2 py-1.5 min-w-[240px]"
          >
            <option value="">Select an account to scan…</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          {accountId && (
            <button
              onClick={() => scan(accountId)}
              className="text-[12px] px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--surface)]"
            >
              Re-scan
            </button>
          )}
          {scanned !== null && !loading && (
            <span className="text-[12px] text-[var(--text-muted)]">
              Scanned {scanned} conversations · {suspects.length} suspected
            </span>
          )}
        </div>

        {error && (
          <div className="text-[13px] text-[#DC2626] mb-3">{error}</div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)] py-8">
            <Loader2 size={16} className="animate-spin" /> Scanning…
          </div>
        ) : (
          <div className="flex gap-4">
            {/* Suspect list */}
            <div className="w-[420px] shrink-0">
              {suspects.length === 0 && accountId && (
                <div className="text-[13px] text-[var(--text-muted)] py-6">
                  No suspected leaks found in this account. 🎉
                </div>
              )}
              <div className="flex flex-col gap-1.5">
                {suspects.map((s) => (
                  <button
                    key={s.conversation_id}
                    onClick={() => openSuspect(s)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      selected?.conversation_id === s.conversation_id
                        ? "border-[var(--accent)] bg-[var(--surface)]"
                        : "border-[var(--border)] hover:bg-[var(--surface)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium truncate">{s.subject || "(no subject)"}</span>
                      <span className="text-[11px] text-[#D97706] font-semibold shrink-0">
                        {s.supplier_count} suppliers
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {s.suppliers.map((sup) => (
                        <span
                          key={sup.domain}
                          className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{
                            color: colorForDomain(sup.domain, s.suppliers.map((x) => x.domain)),
                            background: "var(--surface)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          {sup.domain} ({sup.msgCount})
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1">
                      Last activity {fmtDate(s.last_message_at)}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Review panel */}
            <div className="flex-1 min-w-0">
              {!selected ? (
                <div className="text-[13px] text-[var(--text-muted)] py-6">
                  Select a conversation to review its messages grouped by supplier.
                </div>
              ) : (
                <div className="border border-[var(--border)] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-[14px] font-semibold">{selected.subject}</div>
                      <div className="text-[12px] text-[var(--text-muted)]">
                        {selected.supplier_count} distinct suppliers in this thread
                      </div>
                    </div>
                    <a
                      href={`/#conversation=${selected.conversation_id}`}
                      className="text-[12px] flex items-center gap-1 text-[var(--accent)] hover:underline"
                    >
                      Open in inbox <ExternalLink size={12} />
                    </a>
                  </div>

                  {/* Stage B placeholder — actions go here */}
                  <div className="mb-3 p-2.5 rounded-md bg-[var(--surface)] border border-dashed border-[var(--border)] text-[12px] text-[var(--text-muted)]">
                    Review the messages below. Split &amp; merge actions will appear
                    here next — for now this view is read-only so you can confirm
                    which messages belong to a foreign supplier.
                  </div>

                  {msgLoading ? (
                    <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)] py-4">
                      <Loader2 size={16} className="animate-spin" /> Loading messages…
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {messages.map((m) => {
                        const dom = m.supplier_domain || "(unknown)";
                        const c = m.is_own_domain
                          ? "var(--text-muted)"
                          : colorForDomain(dom, domainOrder);
                        return (
                          <div
                            key={m.id}
                            className="flex items-start gap-2 p-2 rounded-md border border-[var(--border)]"
                            style={{ borderLeft: `3px solid ${c}` }}
                          >
                            <div className="shrink-0 w-[150px]">
                              <div className="text-[11px] font-medium truncate" style={{ color: c }}>
                                {m.is_own_domain ? "Us" : dom}
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)] truncate">
                                {m.is_outbound ? "→ " : "← "}
                                {m.supplier_email || m.from_email || "?"}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] truncate">{m.subject || "(no subject)"}</div>
                              <div className="text-[11px] text-[var(--text-muted)] truncate">
                                {m.snippet || ""}
                              </div>
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] shrink-0">
                              {fmtDate(m.sent_at)}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}