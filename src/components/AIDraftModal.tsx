"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Sparkles, X, Search, ChevronDown, RefreshCw, Check, Loader2 } from "lucide-react";

// ── Tone presets ─────────────────────────────────────────────────────────────
const TONES = [
  { id: "warm", label: "Warm", hint: "Friendly, appreciative" },
  { id: "casual", label: "Casual", hint: "Relaxed, brief" },
  { id: "direct", label: "Direct", hint: "Clear, efficient" },
  { id: "excited", label: "Excited", hint: "Enthusiastic" },
  { id: "professional", label: "Professional", hint: "Polished" },
  { id: "custom", label: "Custom", hint: "Define your own" },
];

// ── Smart prompts (ported verbatim from the Tenkara Missive tool) ────────────
const SMART_PROMPTS: { emoji: string; label: string; text: string }[] = [
  { emoji: "💲", label: "Request Quote", text: "Ask for a quote on this material" },
  { emoji: "📋", label: "Request Docs", text: "Ask for COA, SDS, and spec sheet" },
  { emoji: "📟", label: "Follow Up", text: "Follow up on our previous email - no response yet" },
  { emoji: "📬", label: "Request Sample", text: "Request a sample for testing" },
  { emoji: "☑️", label: "Confirm Order", text: "Confirm order details and shipping timeline" },
  { emoji: "📠", label: "Shipping Status", text: "Ask about shipping status and tracking" },
  { emoji: "✌️", label: "Close Thread", text: "Thank them and close out this thread" },
  { emoji: "💬", label: "Answer Question", text: "Answer their question about our requirements" },
];

// ── Modifiers used for "Regenerate as..." ─────────────────────────────────────
const MODIFIERS = [
  { id: "shorter", label: "Shorter" },
  { id: "longer", label: "Longer" },
  { id: "different", label: "Different angle" },
  { id: "formal", label: "More formal" },
];

// Phase color map for the email-code dropdown
const PHASE_COLOR: Record<number, string> = {
  1: "var(--info)",
  2: "var(--accent)",
  3: "var(--warning)",
  4: "var(--highlight)",
};

interface Props {
  open: boolean;
  onClose: () => void;
  // Auto-fill data from the current conversation
  initialSupplierCompany?: string;
  initialContactName?: string;
  initialEmailSubject?: string;
  initialIncomingMessage?: string;
  organizationName?: string;
  // Called when user clicks Insert — receives the generated text
  onInsert: (text: string) => void;
}

export default function AIDraftModal({
  open,
  onClose,
  initialSupplierCompany = "",
  initialContactName = "",
  initialEmailSubject = "",
  initialIncomingMessage = "",
  organizationName = "Tenkara",
  onInsert,
}: Props) {
  // ── Form state ─────────────────────────────────────────────────────────────
  const [supplierCompany, setSupplierCompany] = useState(initialSupplierCompany);
  const [contactName, setContactName] = useState(initialContactName);
  const [emailSubject, setEmailSubject] = useState(initialEmailSubject);
  const [incomingMessage, setIncomingMessage] = useState(initialIncomingMessage);
  const [emailCode, setEmailCode] = useState("");
  const [tone, setTone] = useState("warm");
  const [customTone, setCustomTone] = useState("");
  const [contextDescription, setContextDescription] = useState("");

  // ── Email code dropdown state ──────────────────────────────────────────────
  const [codes, setCodes] = useState<{ code: string; description: string; phase: number; phase_name: string }[]>([]);
  const [codesLoaded, setCodesLoaded] = useState(false);
  const [codeDropdownOpen, setCodeDropdownOpen] = useState(false);
  const [codeSearch, setCodeSearch] = useState("");
  const codeDropdownRef = useRef<HTMLDivElement>(null);

  // ── Generation state ───────────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState("");
  const [genMeta, setGenMeta] = useState<{ tone?: string; phase?: string | null; emailCode?: string | null } | null>(null);
  const [error, setError] = useState("");

  // Re-seed inputs whenever the modal is reopened with fresh conversation data
  useEffect(() => {
    if (open) {
      setSupplierCompany(initialSupplierCompany);
      setContactName(initialContactName);
      setEmailSubject(initialEmailSubject);
      setIncomingMessage(initialIncomingMessage);
      setError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lazy-load email code list on first open
  useEffect(() => {
    if (!open || codesLoaded) return;
    fetch("/api/ai/draft")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.codes)) setCodes(data.codes);
      })
      .finally(() => setCodesLoaded(true));
  }, [open, codesLoaded]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!codeDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (codeDropdownRef.current && !codeDropdownRef.current.contains(e.target as Node)) {
        setCodeDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [codeDropdownOpen]);

  // Filter codes by search
  const filteredCodes = useMemo(() => {
    if (!codeSearch.trim()) return codes;
    const q = codeSearch.toLowerCase();
    return codes.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.phase_name.toLowerCase().includes(q)
    );
  }, [codes, codeSearch]);

  const selectedCodeMeta = useMemo(
    () => codes.find((c) => c.code === emailCode),
    [codes, emailCode]
  );

  // ── Append a smart-prompt phrase to the context field ──────────────────────
  const addSmartPrompt = (text: string) => {
    setContextDescription((cur) => {
      const trimmed = cur.trim();
      if (!trimmed) return text;
      // Avoid duplicating if already there
      if (trimmed.includes(text)) return trimmed;
      return trimmed + ". " + text;
    });
  };

  // ── Generate ───────────────────────────────────────────────────────────────
  const generate = async (modifier?: string) => {
    setError("");
    if (!incomingMessage.trim() && !emailCode && !contextDescription.trim()) {
      setError("Provide at least one of: incoming message, email workflow code, or context description.");
      return;
    }
    setGenerating(true);
    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationName,
          supplierCompany,
          contactName,
          emailSubject,
          emailCode,
          incomingMessage,
          contextDescription,
          tone,
          customTone,
          modifier: modifier || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Generation failed");
        return;
      }
      setGenerated(data.text || "");
      setGenMeta(data.meta || null);
    } catch (e: any) {
      setError(e?.message || "Network error");
    } finally {
      setGenerating(false);
    }
  };

  const handleInsert = () => {
    if (!generated) return;
    onInsert(generated);
    // Reset & close
    setGenerated("");
    setGenMeta(null);
    setContextDescription("");
    onClose();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[600px] max-h-[90vh] flex flex-col bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-[var(--accent)]" />
            <div>
              <div className="text-sm font-bold text-[var(--text-primary)]">Draft with AI</div>
              <div className="text-[10px] text-[var(--text-muted)]">
                Tenkara workflow assistant — uses your supplier voice and email codes
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Auto-filled context fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Supplier
              </label>
              <input
                value={supplierCompany}
                onChange={(e) => setSupplierCompany(e.target.value)}
                placeholder="Auto-filled"
                className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              />
            </div>
            <div>
              <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
                Contact
              </label>
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Auto-filled"
                className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
              Subject
            </label>
            <input
              value={emailSubject}
              onChange={(e) => setEmailSubject(e.target.value)}
              placeholder="Auto-filled"
              className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
            />
          </div>

          {/* Email code dropdown */}
          <div ref={codeDropdownRef} className="relative">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
              Email Workflow Code <span className="text-[var(--text-muted)] normal-case font-normal">(optional)</span>
            </label>
            <button
              type="button"
              onClick={() => setCodeDropdownOpen((v) => !v)}
              className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-left outline-none hover:border-[var(--accent)]"
            >
              {selectedCodeMeta ? (
                <span className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: PHASE_COLOR[selectedCodeMeta.phase] || "var(--text-muted)" }}
                  />
                  <span className="font-mono text-[var(--text-primary)] shrink-0">{selectedCodeMeta.code}</span>
                  <span className="text-[var(--text-muted)] truncate">— {selectedCodeMeta.description}</span>
                </span>
              ) : (
                <span className="text-[var(--text-muted)]">Pick a workflow code (optional)…</span>
              )}
              <ChevronDown size={12} className="text-[var(--text-muted)] shrink-0 ml-2" />
            </button>
            {codeDropdownOpen && (
              <div className="absolute z-10 mt-1 left-0 right-0 rounded-lg bg-[var(--surface-2)] border border-[var(--border)] shadow-2xl shadow-black/40 max-h-[300px] flex flex-col">
                <div className="p-2 border-b border-[var(--border)] sticky top-0 bg-[var(--surface-2)]">
                  <div className="relative">
                    <Search
                      size={12}
                      className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none"
                    />
                    <input
                      autoFocus
                      value={codeSearch}
                      onChange={(e) => setCodeSearch(e.target.value)}
                      placeholder="Search by code, phase, or workflow…"
                      className="w-full pl-7 pr-2 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11px] outline-none placeholder:text-[var(--text-muted)]"
                    />
                  </div>
                </div>
                <div className="overflow-y-auto">
                  {emailCode && (
                    <button
                      type="button"
                      onClick={() => { setEmailCode(""); setCodeDropdownOpen(false); setCodeSearch(""); }}
                      className="w-full text-left px-3 py-1.5 text-[11px] text-[var(--danger)] hover:bg-[var(--border)]"
                    >
                      Clear selection
                    </button>
                  )}
                  {filteredCodes.length === 0 ? (
                    <div className="text-center py-4 text-[var(--text-muted)] text-[11px]">No matching codes</div>
                  ) : (
                    filteredCodes.map((c) => (
                      <button
                        key={c.code}
                        type="button"
                        onClick={() => { setEmailCode(c.code); setCodeDropdownOpen(false); setCodeSearch(""); }}
                        className={`w-full text-left px-3 py-1.5 hover:bg-[var(--border)] flex items-baseline gap-2 ${
                          emailCode === c.code ? "bg-[var(--border)]" : ""
                        }`}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full shrink-0 self-center"
                          style={{ background: PHASE_COLOR[c.phase] || "var(--text-muted)" }}
                        />
                        <span className="font-mono text-[10px] text-[var(--text-primary)] shrink-0 w-[120px]">{c.code}</span>
                        <span className="text-[11px] text-[var(--text-secondary)] flex-1 truncate">{c.description}</span>
                        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider shrink-0">{c.phase_name}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Tone selector */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1.5">
              Tone
            </label>
            <div className="flex flex-wrap gap-1.5">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTone(t.id)}
                  title={t.hint}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                    tone === t.id
                      ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            {tone === "custom" && (
              <input
                value={customTone}
                onChange={(e) => setCustomTone(e.target.value)}
                placeholder="Describe the tone (e.g. apologetic, urgent, sympathetic)"
                className="mt-2 w-full px-2.5 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              />
            )}
          </div>

          {/* Smart prompts */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1.5">
              Quick Prompts
            </label>
            <div className="flex flex-wrap gap-1.5">
              {SMART_PROMPTS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => addSmartPrompt(p.text)}
                  title={p.text}
                  className="px-2 py-1 rounded-md text-[11px] border border-[var(--border)] bg-[var(--bg)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] transition-colors"
                >
                  <span className="mr-1">{p.emoji}</span>
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Context */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] block mb-1">
              Additional Context
            </label>
            <textarea
              value={contextDescription}
              onChange={(e) => setContextDescription(e.target.value)}
              placeholder="Free-text instructions for the AI (or click a Quick Prompt above)…"
              rows={3}
              className="w-full px-2.5 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)] resize-y"
            />
          </div>

          {/* Incoming message — auto-filled, but user can edit */}
          <details className="border border-[var(--border)] rounded-md">
            <summary className="px-2.5 py-1.5 cursor-pointer text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg)] select-none">
              Incoming message ({incomingMessage.length} chars) {incomingMessage ? "✓ auto-filled" : "— empty"}
            </summary>
            <div className="border-t border-[var(--border)] p-2">
              <textarea
                value={incomingMessage}
                onChange={(e) => setIncomingMessage(e.target.value)}
                placeholder="The supplier's email you're replying to. Auto-filled from the latest inbound message."
                rows={5}
                className="w-full px-2 py-1.5 rounded-md bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)] resize-y font-mono"
              />
            </div>
          </details>

          {/* Error display */}
          {error && (
            <div className="p-2.5 rounded-md bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-[11px] text-[var(--danger)]">
              {error}
            </div>
          )}

          {/* Generated output */}
          {(generated || generating) && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
              <div className="px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    Generated Reply
                  </span>
                  {genMeta && (
                    <span className="text-[10px] text-[var(--text-muted)]">
                      · {genMeta.tone}
                      {genMeta.phase ? ` · ${genMeta.phase}` : ""}
                      {genMeta.emailCode ? ` · ${genMeta.emailCode}` : ""}
                    </span>
                  )}
                </div>
              </div>
              <div className="p-3 text-[12px] text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed min-h-[100px]">
                {generating ? (
                  <div className="flex items-center gap-2 text-[var(--text-muted)]">
                    <Loader2 size={14} className="animate-spin" />
                    Crafting your email…
                  </div>
                ) : (
                  generated
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer with action buttons */}
        <div className="border-t border-[var(--border)] px-5 py-3 flex items-center justify-between shrink-0 bg-[var(--surface-2)]/40">
          {generated && !generating ? (
            <>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mr-1">
                  Regenerate:
                </span>
                {MODIFIERS.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    disabled={generating}
                    onClick={() => generate(m.id)}
                    className="px-2 py-1 rounded-md text-[10px] font-medium border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] disabled:opacity-50"
                  >
                    <RefreshCw size={9} className="inline mr-1" />
                    {m.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleInsert}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-semibold text-[12px] hover:bg-[var(--accent-strong)] transition-colors"
              >
                <Check size={14} />
                Insert into Reply
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-md text-[12px] text-[var(--text-secondary)] hover:bg-[var(--border)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => generate()}
                disabled={generating}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] font-semibold text-[12px] hover:bg-[var(--accent-strong)] transition-colors disabled:opacity-50"
              >
                {generating ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    Generating…
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    Generate Response
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
