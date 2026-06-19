"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Loader2, AlertTriangle, ArrowLeft, ExternalLink, ChevronDown, ChevronRight,
  Scissors, X, Check, Undo2, EyeOff,
} from "lucide-react";
import { useEmailAccounts } from "@/lib/hooks";

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
  body_text: string | null;
  supplier_email: string | null;
  supplier_domain: string | null;
  is_own_domain: boolean;
}
interface Suggestion {
  conversation_id: string;
  subject: string;
  from_email: string | null;
  last_message_at: string | null;
  msg_count: number;
  match_type: "exact" | "domain";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

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
  const hookAccounts = useEmailAccounts(session?.user?.email);
  useEffect(() => {
    if (hookAccounts && hookAccounts.length > 0) {
      setAccounts(hookAccounts.map((a: any) => ({ id: a.id, name: a.name, email: a.email })));
    }
  }, [hookAccounts]);

  const [accountId, setAccountId] = useState<string>("");
  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [scanned, setScanned] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Suspect | null>(null);
  const [messages, setMessages] = useState<ReviewMessage[]>([]);
  const [msgLoading, setMsgLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Split flow state
  const [splitSupplier, setSplitSupplier] = useState<Supplier | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [sugLoading, setSugLoading] = useState(false);
  const [placement, setPlacement] = useState<string>("new"); // "new" | conversation_id
  const [busy, setBusy] = useState(false);
  const [recentSplits, setRecentSplits] = useState<
    { split_id: string; moved: number; domain: string; sourceSubject: string }[]
  >([]);
  const [showUndo, setShowUndo] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (authStatus === "unauthenticated") router.push("/login");
  }, [authStatus, router]);

  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 4000); };

  const scan = useCallback(async (accId: string) => {
    if (!accId) return;
    setLoading(true); setError(null); setSelected(null); setMessages([]);
    setSplitSupplier(null);
    try {
      const res = await fetch(`/api/leak-review?account_id=${encodeURIComponent(accId)}`);
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Scan failed"); setSuspects([]); }
      else { setSuspects(data.suspects || []); setScanned(typeof data.scanned === "number" ? data.scanned : null); }
    } catch (e: any) { setError(e?.message || "Scan failed"); setSuspects([]); }
    setLoading(false);
  }, []);

  const openSuspect = useCallback(async (s: Suspect) => {
    setSelected(s); setMsgLoading(true); setMessages([]); setExpanded(new Set());
    setSplitSupplier(null); setSuggestions([]);
    try {
      const res = await fetch(`/api/leak-review/messages?conversation_id=${encodeURIComponent(s.conversation_id)}`);
      const data = await res.json();
      if (res.ok) setMessages(data.messages || []);
    } catch { /* non-fatal */ }
    setMsgLoading(false);
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Begin split for a supplier: fetch suggestions, show the preview panel.
  const beginSplit = useCallback(async (sup: Supplier) => {
    if (!selected) return;
    setSplitSupplier(sup); setPlacement("new"); setSuggestions([]); setSugLoading(true);
    try {
      const res = await fetch(
        `/api/leak-review/suggestions?account_id=${encodeURIComponent(accountId)}&supplier_email=${encodeURIComponent(sup.sampleEmail)}&exclude=${encodeURIComponent(selected.conversation_id)}`
      );
      const data = await res.json();
      if (res.ok) setSuggestions(data.suggestions || []);
    } catch { /* non-fatal */ }
    setSugLoading(false);
  }, [selected, accountId]);

  // The messages that will move = those whose supplier_domain matches.
  const messagesToMove = splitSupplier
    ? messages.filter((m) => m.supplier_domain === splitSupplier.domain)
    : [];

  const executeSplit = useCallback(async () => {
    if (!selected || !splitSupplier) return;
    const ids = messagesToMove.map((m) => m.id);
    if (ids.length === 0) { showToast("No messages matched to move."); return; }
    setBusy(true);
    try {
      const destination =
        placement === "new"
          ? { type: "new", subject: selected.subject, from_email: splitSupplier.sampleEmail, from_name: splitSupplier.domain }
          : { type: "existing", conversation_id: placement };
      const res = await fetch(`/api/leak-review/split`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_conversation_id: selected.conversation_id,
          message_ids: ids,
          destination,
        }),
      });
      const data = await res.json();
      if (!res.ok) { showToast("Split failed: " + (data.error || "unknown")); }
      else {
        setRecentSplits((prev) => [
          { split_id: data.split_id, moved: data.moved, domain: splitSupplier.domain, sourceSubject: selected.subject },
          ...prev,
        ]);
        showToast(`Moved ${data.moved} message(s)${data.created_new ? " to a new conversation" : ""}. Undo available in "Recent splits".`);
        setSplitSupplier(null);
        await openSuspect(selected);   // refresh the panel
        await scan(accountId);         // refresh suspect list
      }
    } catch (e: any) { showToast("Split failed: " + e.message); }
    setBusy(false);
  }, [selected, splitSupplier, messagesToMove, placement, accountId, openSuspect, scan]);

  const undoSplit = useCallback(async (splitId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/leak-review/split?split_id=${encodeURIComponent(splitId)}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) showToast("Undo failed: " + (data.error || "unknown"));
      else {
        showToast(`Restored ${data.restored} message(s).`);
        setRecentSplits((prev) => prev.filter((r) => r.split_id !== splitId));
        await scan(accountId);
        setSelected(null);
      }
    } catch (e: any) { showToast("Undo failed: " + e.message); }
    setBusy(false);
  }, [accountId, scan]);

  const dismissSuspect = useCallback(async () => {
    if (!selected) return;
    if (!confirm("Mark this conversation as reviewed and NOT a leak? It will be hidden from future scans.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/leak-review/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: selected.conversation_id }),
      });
      if (res.ok) { showToast("Dismissed — hidden from scans."); setSelected(null); await scan(accountId); }
      else { const d = await res.json(); showToast("Dismiss failed: " + (d.error || "unknown")); }
    } catch (e: any) { showToast("Dismiss failed: " + e.message); }
    setBusy(false);
  }, [selected, accountId, scan]);

  const domainOrder = selected ? selected.suppliers.map((s) => s.domain) : [];

  // Open a conversation in a standalone popout window (reuses the app's
  // fullscreen conversation view), so the operator can inspect full context
  // without leaving the leak-review page.
  const openThreadWindow = (conversationId: string) => {
    const url = `/#conversation=${conversationId}&fullscreen=1`;
    window.open(url, "_blank", "noopener,noreferrer,width=900,height=800");
  };

  return (
    <div className="h-screen flex flex-col bg-[var(--bg)] text-[var(--text-primary)]">
      <div className="shrink-0 border-b border-[var(--border)] px-6 py-4 flex items-center gap-3">
        <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><ArrowLeft size={18} /></Link>
        <AlertTriangle size={18} className="text-[#D97706]" />
        <h1 className="text-[15px] font-semibold">Leak Review</h1>
        <span className="text-[12px] text-[var(--text-muted)]">Conversations that may contain more than one supplier</span>
        {recentSplits.length > 0 && (
          <button onClick={() => setShowUndo((v) => !v)}
            className="ml-auto text-[12px] flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--surface)]">
            <Undo2 size={13} /> Recent splits ({recentSplits.length})
          </button>
        )}
      </div>

      {/* Recent splits / undo tray */}
      {showUndo && recentSplits.length > 0 && (
        <div className="shrink-0 mx-6 mt-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="text-[12px] font-semibold mb-2">Recent splits (this session) — undo to restore</div>
          <div className="flex flex-col gap-1">
            {recentSplits.map((rs) => (
              <div key={rs.split_id} className="flex items-center justify-between text-[12px] gap-2">
                <span className="truncate">Moved {rs.moved} msg(s) of <span className="font-medium">{rs.domain}</span> out of “{rs.sourceSubject}”</span>
                <button onClick={() => undoSplit(rs.split_id)} disabled={busy}
                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] hover:bg-[var(--bg)]">
                  <Undo2 size={12} /> Undo
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && (
        <div className="shrink-0 mx-6 mt-3 text-[12px] px-3 py-2 rounded-md bg-[var(--surface)] border border-[var(--border)]">{toast}</div>
      )}

      <div className="flex-1 overflow-hidden px-6 py-4 flex flex-col">
        <div className="shrink-0 flex items-center gap-3 mb-4">
          <label className="text-[13px] text-[var(--text-secondary)]">Account</label>
          <select value={accountId}
            onChange={(e) => { setAccountId(e.target.value); scan(e.target.value); }}
            className="text-[13px] bg-[var(--surface)] border border-[var(--border)] rounded-md px-2 py-1.5 min-w-[240px]">
            <option value="">Select an account to scan…</option>
            {accounts.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
          </select>
          {accountId && (
            <button onClick={() => scan(accountId)} className="text-[12px] px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--surface)]">Re-scan</button>
          )}
          {scanned !== null && !loading && (
            <span className="text-[12px] text-[var(--text-muted)]">Scanned {scanned} conversations · {suspects.length} suspected</span>
          )}
        </div>

        {error && <div className="shrink-0 text-[13px] text-[#DC2626] mb-3">{error}</div>}

        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)] py-8"><Loader2 size={16} className="animate-spin" /> Scanning…</div>
        ) : (
          <div className="flex-1 overflow-hidden flex gap-4">
            {/* Suspect list */}
            <div className="w-[400px] shrink-0 overflow-y-auto pr-1">
              {suspects.length === 0 && accountId && (
                <div className="text-[13px] text-[var(--text-muted)] py-6">No suspected leaks found in this account. 🎉</div>
              )}
              <div className="flex flex-col gap-1.5">
                {suspects.map((s) => (
                  <button key={s.conversation_id} onClick={() => openSuspect(s)}
                    className={`text-left p-3 rounded-lg border transition-colors ${
                      selected?.conversation_id === s.conversation_id
                        ? "border-[var(--accent)] bg-[var(--surface)]"
                        : "border-[var(--border)] hover:bg-[var(--surface)]"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium truncate">{s.subject || "(no subject)"}</span>
                      <span className="text-[11px] text-[#D97706] font-semibold shrink-0">{s.supplier_count} suppliers</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {s.suppliers.map((sup) => (
                        <span key={sup.domain} className="text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{ color: colorForDomain(sup.domain, s.suppliers.map((x) => x.domain)), background: "var(--surface)", border: "1px solid var(--border)" }}>
                          {sup.domain} ({sup.msgCount})
                        </span>
                      ))}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1">Last activity {fmtDate(s.last_message_at)}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Review panel */}
            <div className="flex-1 min-w-0 overflow-y-auto">
              {!selected ? (
                <div className="text-[13px] text-[var(--text-muted)] py-6">Select a conversation to review its messages grouped by supplier.</div>
              ) : (
                <div className="border border-[var(--border)] rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <div className="text-[14px] font-semibold">{selected.subject}</div>
                      <div className="text-[12px] text-[var(--text-muted)]">{selected.supplier_count} distinct suppliers in this thread</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={dismissSuspect} disabled={busy}
                        className="text-[12px] flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] hover:bg-[var(--surface)]">
                        <EyeOff size={12} /> Not a leak
                      </button>
                      <button onClick={() => openThreadWindow(selected.conversation_id)}
                        className="text-[12px] flex items-center gap-1 text-[var(--accent)] hover:underline">
                        Open thread <ExternalLink size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Split action bar — per supplier */}
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {selected.suppliers.map((sup) => (
                      <button key={sup.domain} onClick={() => beginSplit(sup)} disabled={busy}
                        className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-md border hover:bg-[var(--surface)]"
                        style={{ borderColor: colorForDomain(sup.domain, domainOrder), color: colorForDomain(sup.domain, domainOrder) }}>
                        <Scissors size={11} /> Split out {sup.domain} ({sup.msgCount})
                      </button>
                    ))}
                  </div>

                  {/* Split placement panel */}
                  {splitSupplier && (
                    <div className="mb-3 p-3 rounded-lg border border-[var(--accent)] bg-[var(--surface)]">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[13px] font-semibold">Split out {splitSupplier.domain}</div>
                        <button onClick={() => setSplitSupplier(null)} className="text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X size={14} /></button>
                      </div>
                      <div className="text-[12px] text-[var(--text-muted)] mb-2">
                        {messagesToMove.length} message(s) from {splitSupplier.domain} will move out of this thread:
                      </div>
                      <div className="max-h-[120px] overflow-y-auto mb-3 flex flex-col gap-1">
                        {messagesToMove.map((m) => (
                          <div key={m.id} className="text-[11px] text-[var(--text-secondary)] truncate">
                            • {m.is_outbound ? "→" : "←"} {m.supplier_email} — {m.subject || "(no subject)"} ({fmtDate(m.sent_at)})
                          </div>
                        ))}
                      </div>
                      <div className="text-[12px] font-medium mb-1">Where should these go?</div>
                      {sugLoading ? (
                        <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)] py-2"><Loader2 size={14} className="animate-spin" /> Finding existing conversations…</div>
                      ) : (
                        <div className="flex flex-col gap-1 mb-3">
                          <label className="flex items-center gap-2 text-[12px] p-1.5 rounded hover:bg-[var(--bg)] cursor-pointer">
                            <input type="radio" name="placement" checked={placement === "new"} onChange={() => setPlacement("new")} />
                            <span>Create a new conversation (filed into this account's Inbox)</span>
                          </label>
                          {suggestions.map((sg) => (
                            <div key={sg.conversation_id} className="flex items-center gap-1.5">
                              <label className="flex-1 flex items-center gap-2 text-[12px] p-1.5 rounded hover:bg-[var(--bg)] cursor-pointer">
                                <input type="radio" name="placement" checked={placement === sg.conversation_id} onChange={() => setPlacement(sg.conversation_id)} />
                                <span className="truncate">
                                  Merge into: <span className="font-medium">{sg.subject || "(no subject)"}</span>{" "}
                                  <span className="text-[var(--text-muted)]">· {sg.msg_count} msgs · {sg.match_type === "exact" ? "exact email" : "same domain"}</span>
                                </span>
                              </label>
                              <button onClick={() => openThreadWindow(sg.conversation_id)} title="Inspect this thread in a new window"
                                className="shrink-0 text-[var(--text-muted)] hover:text-[var(--accent)] p-1">
                                <ExternalLink size={12} />
                              </button>
                            </div>
                          ))}
                          {suggestions.length === 0 && (
                            <div className="text-[11px] text-[var(--text-muted)] pl-1.5">No existing conversations found for this supplier — a new one will be created.</div>
                          )}
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        <button onClick={executeSplit} disabled={busy || messagesToMove.length === 0}
                          className="text-[12px] flex items-center gap-1 px-3 py-1.5 rounded-md bg-[var(--accent)] text-white disabled:opacity-50">
                          {busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Confirm split
                        </button>
                        <button onClick={() => setSplitSupplier(null)} className="text-[12px] px-2.5 py-1.5 rounded-md border border-[var(--border)] hover:bg-[var(--bg)]">Cancel</button>
                      </div>
                    </div>
                  )}

                  {/* Messages grouped/colored by supplier */}
                  {msgLoading ? (
                    <div className="flex items-center gap-2 text-[13px] text-[var(--text-muted)] py-4"><Loader2 size={16} className="animate-spin" /> Loading messages…</div>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {messages.map((m) => {
                        const dom = m.supplier_domain || "(unknown)";
                        const c = m.is_own_domain ? "var(--text-muted)" : colorForDomain(dom, domainOrder);
                        const isOpen = expanded.has(m.id);
                        return (
                          <div key={m.id} className="rounded-md border border-[var(--border)]" style={{ borderLeft: `3px solid ${c}` }}>
                            <button onClick={() => toggleExpand(m.id)} className="w-full flex items-start gap-2 p-2 text-left">
                              <span className="mt-0.5 text-[var(--text-muted)]">{isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
                              <div className="shrink-0 w-[150px]">
                                <div className="text-[11px] font-medium truncate" style={{ color: c }}>{m.is_own_domain ? "Us" : dom}</div>
                                <div className="text-[10px] text-[var(--text-muted)] truncate">{m.is_outbound ? "→ " : "← "}{m.supplier_email || m.from_email || "?"}</div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[12px] truncate">{m.subject || "(no subject)"}</div>
                                {!isOpen && <div className="text-[11px] text-[var(--text-muted)] truncate">{m.snippet || ""}</div>}
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)] shrink-0">{fmtDate(m.sent_at)}</div>
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-3 pl-[180px] text-[12px] text-[var(--text-secondary)] whitespace-pre-wrap break-words">
                                {m.body_text || m.snippet || "(no content)"}
                              </div>
                            )}
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