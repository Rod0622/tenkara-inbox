// src/components/QuickCallModal.tsx
//
// Modal for placing an outbound call via Quo. Opens from the QuickActions
// dropdown ("Make a call"). Workflow:
//
//   1. Pick "Call from" — one of your Quo workspace numbers
//   2. Type the target phone number (or pick a supplier → auto-fills phone)
//   3. Optionally search + select a supplier (auto-picks their most recent open conv)
//   4. Click "Call" → POST /api/calls/dial creates a stub row + returns tel:
//   5. Browser opens tel:, OS hands off to Quo desktop/mobile
//
// Important UX honesty: Quo's API doesn't let us override the active line
// programmatically. The "Call from" picker selects which workspace number the
// call IS LOGGED AGAINST in our DB; the actual dial line is whatever the
// user's Quo app is currently set to. The modal makes this clear.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Phone, X, Search, Loader2, Check, AlertCircle, ChevronDown,
  Building2, MessageCircle, ExternalLink,
} from "lucide-react";

interface QuoPhoneNumber {
  id: string;
  number: string;
  name: string | null;
}

interface SupplierSearchResult {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  last_exchange_at: string | null;
  open_conversation_count: number;
  most_recent_open_conversation_id: string | null;
  primary_contact_person: { id: string; name: string; phone: string } | null;
}

export default function QuickCallModal({
  isOpen,
  onClose,
  onCallPlaced,
  conversationContext,
}: {
  isOpen: boolean;
  onClose: () => void;
  // Called after stub row is created. Receives the stub object. Caller can
  // navigate to the conversation, refetch state, etc.
  onCallPlaced?: (stub: any) => void;
  // When the modal is opened from inside a conversation, pass this so we can
  // pre-fill supplier + phone + auto-link the stub to the conversation.
  conversationContext?: {
    conversation_id: string;
    supplier_contact_id: string | null;
    // Display-only: the conversation's subject + sender, so the modal header
    // can show "Calling about: <subject>" instead of a generic title.
    subject?: string | null;
    from_name?: string | null;
  } | null;
}) {
  const [phoneNumbers, setPhoneNumbers] = useState<QuoPhoneNumber[]>([]);
  const [selectedFromId, setSelectedFromId] = useState<string>("");
  const [toPhone, setToPhone] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierResults, setSupplierResults] = useState<SupplierSearchResult[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<SupplierSearchResult | null>(null);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  // Contact persons attached to the selected supplier (when in conversation context)
  const [persons, setPersons] = useState<Array<{ id: string; name: string; phone: string | null; title: string | null }>>([]);
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);

  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [dialing, setDialing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const supplierBlurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load workspace numbers + user's last-used pick ───────
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    (async () => {
      try {
        const res = await fetch("/api/calls/dial-preferences");
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to load");
        const numbers: QuoPhoneNumber[] = data.phone_numbers || [];
        setPhoneNumbers(numbers);
        // Restore last preference, or default to first
        const preferred = data.preferred_quo_phone_number_id;
        if (preferred && numbers.find((n) => n.id === preferred)) {
          setSelectedFromId(preferred);
        } else if (numbers.length > 0) {
          setSelectedFromId(numbers[0].id);
        }
      } catch (e: any) {
        setError(e?.message || "Failed to load workspace numbers");
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen]);

  // Clear state on close
  useEffect(() => {
    if (!isOpen) {
      setToPhone("");
      setSupplierQuery("");
      setSupplierResults([]);
      setSelectedSupplier(null);
      setShowSupplierDropdown(false);
      setPersons([]);
      setSelectedPersonId(null);
      setError(null);
      setSuccess(null);
    }
  }, [isOpen]);

  // ── Conversation-context pre-load ────────────────────────
  // When opened from inside a conversation that has a supplier_contact_id,
  // fetch that supplier + its full contact persons list, pre-select the
  // supplier, and auto-fill the phone with the primary contact person.
  useEffect(() => {
    if (!isOpen) return;
    if (!conversationContext?.supplier_contact_id) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/suppliers/search?id=${encodeURIComponent(conversationContext.supplier_contact_id!)}`
        );
        const data = await res.json();
        if (cancelled || !res.ok || !data?.supplier) return;

        const s = data.supplier;
        // Shape into SupplierSearchResult format used by selectedSupplier
        const result: SupplierSearchResult = {
          id: s.id,
          name: s.name,
          email: s.email,
          company: s.company,
          last_exchange_at: s.last_exchange_at,
          open_conversation_count: s.open_conversation_count || 0,
          // Pre-link the stub to THIS conversation, not the supplier's "most recent"
          most_recent_open_conversation_id: conversationContext.conversation_id,
          primary_contact_person: s.primary_contact_person || null,
        };
        setSelectedSupplier(result);
        setSupplierQuery(s.name);

        const allPersons = (data.persons || []) as any[];
        setPersons(allPersons);

        // Pick primary (first person with phone, by sort_order)
        const primary = allPersons.find((p: any) => p.phone) || null;
        if (primary) {
          setSelectedPersonId(primary.id);
          setToPhone(primary.phone);
        }
      } catch (e: any) {
        // Non-fatal — user can still search/type manually
        console.warn("[QuickCallModal] preload failed:", e?.message);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, conversationContext?.supplier_contact_id, conversationContext?.conversation_id]);

  // ── Supplier autocomplete (debounced) ───────────────────
  useEffect(() => {
    if (!isOpen) return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    // Don't search if user has already selected one and the query matches it
    if (selectedSupplier && supplierQuery === selectedSupplier.name) return;

    searchDebounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `/api/suppliers/search?q=${encodeURIComponent(supplierQuery)}&limit=10`;
        const res = await fetch(url);
        const data = await res.json();
        if (res.ok) {
          setSupplierResults(data.suppliers || []);
        }
      } catch { /* swallow */ }
      finally { setSearching(false); }
    }, 200);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [supplierQuery, isOpen, selectedSupplier]);

  const selectSupplier = async (s: SupplierSearchResult) => {
    setSelectedSupplier(s);
    setSupplierQuery(s.name);
    setShowSupplierDropdown(false);
    // Auto-fill phone if supplier has a contact person with a phone AND toPhone is empty
    if (!toPhone && s.primary_contact_person?.phone) {
      setToPhone(s.primary_contact_person.phone);
    }
    // Also fetch the full persons list (so the person picker can show them).
    // Best-effort; non-fatal on failure.
    try {
      const res = await fetch(`/api/suppliers/search?id=${encodeURIComponent(s.id)}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.persons)) {
        setPersons(data.persons);
        // Pre-select the primary if not already
        const primary = data.persons.find((p: any) => p.phone);
        if (primary && !selectedPersonId) {
          setSelectedPersonId(primary.id);
        }
      }
    } catch { /* swallow */ }
  };

  const clearSupplier = () => {
    setSelectedSupplier(null);
    setSupplierQuery("");
    setShowSupplierDropdown(false);
    setPersons([]);
    setSelectedPersonId(null);
  };

  // Pick a different contact person (only meaningful when persons.length > 1).
  // Updates the phone field to that person's phone.
  const selectPerson = (personId: string) => {
    const p = persons.find((p) => p.id === personId);
    if (!p) return;
    setSelectedPersonId(personId);
    if (p.phone) setToPhone(p.phone);
  };

  const handleDial = async () => {
    setError(null);
    setSuccess(null);

    const trimmedTo = toPhone.trim();
    if (!trimmedTo) {
      setError("Enter a phone number to call");
      return;
    }

    setDialing(true);
    try {
      const fromNumber = phoneNumbers.find((n) => n.id === selectedFromId);
      const body: any = {
        to_phone: trimmedTo,
        from_phone_number_id: selectedFromId || null,
        from_phone: fromNumber?.number || null,
      };
      if (selectedSupplier) {
        body.supplier_contact_id = selectedSupplier.id;
        // Prefer the user-picked person over the supplier's primary; fall back
        // to the primary when no explicit pick.
        body.supplier_contact_person_id =
          selectedPersonId || selectedSupplier.primary_contact_person?.id || null;
        // When opened from inside a conversation, ALWAYS pin the stub to THAT
        // conversation, even if the supplier has multiple open threads.
        body.conversation_id =
          conversationContext?.conversation_id ||
          selectedSupplier.most_recent_open_conversation_id;
      } else if (conversationContext) {
        // No supplier selected but we have a conversation — pin to it anyway
        body.conversation_id = conversationContext.conversation_id;
      }
      const res = await fetch("/api/calls/dial", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Dial failed");

      // Launch the tel: link to open Quo
      const link = document.createElement("a");
      link.href = data.tel;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setSuccess("Call initiated. Quo should ring momentarily.");
      onCallPlaced?.(data.stub);
      // Auto-close after a moment so user sees confirmation
      setTimeout(() => onClose(), 1500);
    } catch (e: any) {
      setError(e?.message || "Dial failed");
    } finally {
      setDialing(false);
    }
  };

  // ── Render ───────────────────────────────────────────────
  if (!isOpen) return null;

  const fromNumber = phoneNumbers.find((n) => n.id === selectedFromId);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[var(--accent)]/12 flex items-center justify-center">
              <Phone size={15} className="text-[var(--accent)]" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">Make a call</h2>
              {conversationContext?.subject ? (
                <p className="text-[10px] text-[var(--text-muted)] truncate max-w-[240px]">
                  re: {conversationContext.subject}
                </p>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)]">via Quo</p>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md flex items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--border)]"
          >
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="p-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
          </div>
        ) : phoneNumbers.length === 0 ? (
          <div className="p-6 text-center">
            <AlertCircle className="w-8 h-8 mx-auto text-[var(--warning)] mb-2" />
            <p className="text-[13px] text-[var(--text-primary)] mb-1 font-semibold">No Quo numbers found</p>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Connect Quo in Settings → Integrations first.
            </p>
          </div>
        ) : (
          <div className="p-5 space-y-3">
            {/* Call from */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                Call from
              </label>
              <div className="relative">
                <select
                  value={selectedFromId}
                  onChange={(e) => setSelectedFromId(e.target.value)}
                  className="w-full appearance-none px-3 py-2.5 pr-8 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
                >
                  {phoneNumbers.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.number}
                      {n.name ? ` — ${n.name}` : ""}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              </div>
            </div>

            {/* Supplier search (optional) */}
            <div className="relative">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                Link to supplier <span className="font-normal normal-case text-[var(--text-muted)]/80">(optional)</span>
              </label>
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                <input
                  type="text"
                  value={supplierQuery}
                  onChange={(e) => {
                    setSupplierQuery(e.target.value);
                    if (selectedSupplier && e.target.value !== selectedSupplier.name) {
                      setSelectedSupplier(null);
                    }
                    setShowSupplierDropdown(true);
                  }}
                  onFocus={() => setShowSupplierDropdown(true)}
                  onBlur={() => {
                    // Delay so click on a result still registers
                    supplierBlurTimerRef.current = setTimeout(() => setShowSupplierDropdown(false), 150);
                  }}
                  placeholder="Search suppliers by name or company..."
                  className="w-full pl-7 pr-8 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
                />
                {selectedSupplier && (
                  <button
                    onClick={clearSupplier}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--danger)]"
                    title="Clear supplier"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>

              {showSupplierDropdown && supplierResults.length > 0 && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] shadow-2xl shadow-black/40 max-h-60 overflow-y-auto">
                  {supplierResults.map((s) => (
                    <button
                      key={s.id}
                      onMouseDown={(e) => {
                        // mousedown beats blur — selection lands before input loses focus
                        e.preventDefault();
                        selectSupplier(s);
                      }}
                      className="w-full px-3 py-2 text-left hover:bg-[var(--border)] flex items-start gap-2"
                    >
                      <Building2 size={13} className="mt-0.5 text-[var(--text-muted)] shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[12px] font-medium text-[var(--text-primary)] truncate">{s.name}</span>
                          {s.open_conversation_count > 0 && (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[var(--accent)]/12 text-[var(--accent)] inline-flex items-center gap-0.5">
                              <MessageCircle size={9} />
                              {s.open_conversation_count} open
                            </span>
                          )}
                          {s.primary_contact_person?.phone && (
                            <span className="text-[9px] text-[var(--text-muted)] inline-flex items-center gap-0.5">
                              <Phone size={9} />
                              has phone
                            </span>
                          )}
                        </div>
                        {s.company && s.company !== s.name && (
                          <div className="text-[10px] text-[var(--text-muted)] truncate">{s.company}</div>
                        )}
                        {s.email && (
                          <div className="text-[10px] text-[var(--text-secondary)] truncate">{s.email}</div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {showSupplierDropdown && !searching && supplierResults.length === 0 && supplierQuery && (
                <div className="absolute z-10 left-0 right-0 mt-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                  No suppliers found
                </div>
              )}
            </div>

            {/* Contact person picker — shown when supplier has multiple contact persons */}
            {persons.length > 1 && (
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                  Contact person
                </label>
                <div className="relative">
                  <select
                    value={selectedPersonId || ""}
                    onChange={(e) => selectPerson(e.target.value)}
                    className="w-full appearance-none px-3 py-2 pr-8 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] transition-colors"
                  >
                    <option value="">— Choose person —</option>
                    {persons.map((p) => (
                      <option key={p.id} value={p.id} disabled={!p.phone}>
                        {p.name}
                        {p.title ? ` — ${p.title}` : ""}
                        {p.phone ? ` · ${p.phone}` : " · (no phone)"}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
                </div>
              </div>
            )}

            {/* Phone number */}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-1.5">
                Phone number to call
              </label>
              <input
                type="tel"
                value={toPhone}
                onChange={(e) => setToPhone(e.target.value)}
                placeholder="+1 555 123 4567"
                className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] font-mono outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              />
              {conversationContext?.conversation_id ? (
                <p className="text-[10px] text-[var(--accent)] mt-1 inline-flex items-center gap-1">
                  <Check size={10} />
                  Will be logged on this conversation
                </p>
              ) : selectedSupplier?.most_recent_open_conversation_id && (
                <p className="text-[10px] text-[var(--accent)] mt-1 inline-flex items-center gap-1">
                  <Check size={10} />
                  Will be logged on this supplier's most recent open conversation
                </p>
              )}
            </div>

            {/* Honesty note */}
            <div className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[10px] text-[var(--text-secondary)] leading-relaxed">
              <strong className="text-[var(--text-primary)]">Heads up:</strong> Quo's API doesn't let us override the active line. If you have multiple Quo numbers, set <strong>{fromNumber?.number || "your chosen number"}</strong> as the active line in your Quo app first. The call will be logged here against {fromNumber?.number || "the selected number"} regardless of which line you actually dial from.
            </div>

            {/* Messages */}
            {error && (
              <div className="px-3 py-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/30 text-xs text-[var(--danger)] flex items-start gap-2">
                <AlertCircle size={13} className="mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="px-3 py-2 rounded-lg bg-[var(--accent)]/10 border border-[var(--accent)]/30 text-xs text-[var(--accent)] flex items-start gap-2">
                <Check size={13} className="mt-0.5 shrink-0" />
                <span>{success}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={onClose}
                disabled={dialing}
                className="px-4 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:bg-[var(--border)] disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleDial}
                disabled={dialing || !toPhone.trim() || !selectedFromId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-sm font-semibold hover:bg-[var(--accent-strong)] disabled:opacity-40 transition-colors"
              >
                {dialing ? <Loader2 size={14} className="animate-spin" /> : <Phone size={14} />}
                {dialing ? "Initiating..." : "Call"}
                <ExternalLink size={11} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}