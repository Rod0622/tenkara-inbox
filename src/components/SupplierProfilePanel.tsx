"use client";

import { useEffect, useState } from "react";

// ── Field definitions ──────────────────────────────────────────────────────
const SUPPLIER_TYPES = ["unknown", "distributor", "direct_manufacturer", "broker"];

const PROFILE_TEXT_FIELDS: { key: string; label: string; full?: boolean }[] = [
  { key: "website", label: "Website" },
  { key: "pickup_address", label: "Pick-up Address", full: true },
  { key: "purchasing_thresholds", label: "Purchasing Thresholds", full: true },
  { key: "shipping_terms", label: "Shipping Terms", full: true },
  { key: "shipping_email", label: "Shipping Email" },
  { key: "billing_email", label: "Billing Email" },
  { key: "acc_hazmat_handling_rate", label: "Hazmat Handling Rate" },
  { key: "acc_temperature_controlled_rate", label: "Temp-Controlled Storage Rate" },
  { key: "acc_liftgate_service_rate", label: "Liftgate Service Rate" },
  { key: "acc_special_packaging_rate", label: "Special Packaging Rate" },
  { key: "acc_other", label: "Other Accessorials", full: true },
  { key: "payment_method", label: "Payment Method" },
  { key: "payment_details", label: "Payment Details", full: true },
  { key: "payment_terms_type", label: "Payment Terms" },
  { key: "payment_terms_details", label: "Payment Terms Details", full: true },
  { key: "facility_certifications", label: "Facility Certifications / Compliances", full: true },
  { key: "other_notes", label: "Other Notes", full: true },
];

const QUOTE_FIELDS: { key: string; label: string; type?: "text" | "bool"; full?: boolean }[] = [
  { key: "material_name", label: "Material Name", full: true },
  { key: "inci_trade_name", label: "INCI / Trade Name" },
  { key: "grade", label: "Grade(s)" },
  { key: "price_raw", label: "Price (as quoted)", full: true },
  { key: "price_numeric", label: "Price (numeric, base)" },
  { key: "price_qty", label: "Price Qty" },
  { key: "price_unit", label: "Price Unit" },
  { key: "case_width", label: "Case Width" },
  { key: "case_height", label: "Case Height" },
  { key: "case_length", label: "Case Length" },
  { key: "case_weight", label: "Case Weight" },
  { key: "case_size", label: "Case Size" },
  { key: "pack_size", label: "Pack Size" },
  { key: "quote_provided_date", label: "Quote Provided" },
  { key: "quote_expiry", label: "Quote Expiry / Valid Until" },
  { key: "lead_time", label: "Lead Time" },
  { key: "moq", label: "MOQ" },
  { key: "max_inventory", label: "Max Inventory" },
  { key: "hazardous", label: "Hazardous", type: "bool" },
  { key: "refrigerated", label: "Refrigerated", type: "bool" },
  { key: "equipment_accessorials", label: "Equipment Accessorials", full: true },
  { key: "material_id", label: "Material ID" },
  { key: "doc_coa", label: "COA Supplied", type: "bool" },
  { key: "doc_sds", label: "SDS Supplied", type: "bool" },
  { key: "doc_tds", label: "TDS Supplied", type: "bool" },
  { key: "sample_handling", label: "Sample Handling", full: true },
  { key: "other_notes", label: "Other Notes", full: true },
];

function emptyQuote(): Record<string, any> {
  const q: Record<string, any> = {};
  for (const f of QUOTE_FIELDS) q[f.key] = f.type === "bool" ? false : "";
  return q;
}

const dash = (v: any) => (v === null || v === undefined || v === "" ? "—" : String(v));
const yn = (v: any) => (v === true ? "Yes" : v === false ? "No" : "—");

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]/50";
const labelCls = "text-[10px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]";

export default function SupplierProfilePanel({
  supplierContactId,
  email,
  initialProfile,
  initialQuotes,
}: {
  supplierContactId: string | null;
  email: string;
  initialProfile: any;
  initialQuotes: any[];
}) {
  const [profile, setProfile] = useState<any>(initialProfile || null);
  const [quotes, setQuotes] = useState<any[]>(Array.isArray(initialQuotes) ? initialQuotes : []);

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState<Record<string, any>>({});

  // Quote edit state — id of the quote being edited, "new" for adding, or null
  const [quoteFormFor, setQuoteFormFor] = useState<string | null>(null);
  const [quoteForm, setQuoteForm] = useState<Record<string, any>>(emptyQuote());
  const [savingQuote, setSavingQuote] = useState(false);
  const [deletingQuoteId, setDeletingQuoteId] = useState<string | null>(null);

  useEffect(() => {
    setProfile(initialProfile || null);
  }, [initialProfile]);
  useEffect(() => {
    setQuotes(Array.isArray(initialQuotes) ? initialQuotes : []);
  }, [initialQuotes]);

  const body = (extra: Record<string, any>) => ({
    supplier_contact_id: supplierContactId,
    email,
    ...extra,
  });

  // ── Profile ──
  const openEditProfile = () => {
    const form: Record<string, any> = { type: profile?.type || "unknown" };
    for (const f of PROFILE_TEXT_FIELDS) form[f.key] = profile?.[f.key] || "";
    setProfileForm(form);
    setEditingProfile(true);
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const res = await fetch("/api/supplier-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body(profileForm)),
      });
      const json = await res.json();
      if (res.ok) {
        setProfile(json.profile);
        setEditingProfile(false);
      } else {
        alert(json?.error || "Failed to save profile");
      }
    } catch (e: any) {
      alert(e?.message || "Failed to save profile");
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Quotes ──
  const openAddQuote = () => {
    setQuoteForm(emptyQuote());
    setQuoteFormFor("new");
  };
  const openEditQuote = (q: any) => {
    const form: Record<string, any> = {};
    for (const f of QUOTE_FIELDS) form[f.key] = q[f.key] ?? (f.type === "bool" ? false : "");
    setQuoteForm(form);
    setQuoteFormFor(q.id);
  };

  const saveQuote = async () => {
    if (!String(quoteForm.material_name || "").trim()) {
      alert("Material name is required");
      return;
    }
    setSavingQuote(true);
    try {
      const isNew = quoteFormFor === "new";
      const res = await fetch("/api/supplier-quotes", {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isNew ? body(quoteForm) : { id: quoteFormFor, ...quoteForm }),
      });
      const json = await res.json();
      if (res.ok) {
        if (isNew) {
          setQuotes((prev) => [json.quote, ...prev]);
        } else {
          setQuotes((prev) => prev.map((q) => (q.id === json.quote.id ? json.quote : q)));
        }
        setQuoteFormFor(null);
      } else {
        alert(json?.error || "Failed to save quote");
      }
    } catch (e: any) {
      alert(e?.message || "Failed to save quote");
    } finally {
      setSavingQuote(false);
    }
  };

  const deleteQuote = async (id: string) => {
    if (!confirm("Delete this quote?")) return;
    setDeletingQuoteId(id);
    try {
      const res = await fetch(`/api/supplier-quotes?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setQuotes((prev) => prev.filter((q) => q.id !== id));
      } else {
        const json = await res.json().catch(() => ({}));
        alert(json?.error || "Failed to delete quote");
      }
    } catch (e: any) {
      alert(e?.message || "Failed to delete quote");
    } finally {
      setDeletingQuoteId(null);
    }
  };

  const renderQuoteForm = () => (
    <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--bg)] p-3 mb-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {QUOTE_FIELDS.map((f) => (
          <div key={f.key} className={f.full ? "col-span-2" : ""}>
            <label className={labelCls}>{f.label}</label>
            {f.type === "bool" ? (
              <select
                className={inputCls}
                value={quoteForm[f.key] ? "yes" : "no"}
                onChange={(e) => setQuoteForm((s) => ({ ...s, [f.key]: e.target.value === "yes" }))}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            ) : (
              <input
                className={inputCls}
                value={quoteForm[f.key] ?? ""}
                onChange={(e) => setQuoteForm((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={saveQuote}
          disabled={savingQuote}
          className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[12px] font-semibold disabled:opacity-60"
        >
          {savingQuote ? "Saving..." : "Save Quote"}
        </button>
        <button
          onClick={() => setQuoteFormFor(null)}
          className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] font-semibold text-[var(--text-secondary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* ── Supplier Information ── */}
      <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold">Supplier Information</span>
          {!editingProfile && (
            <button
              onClick={openEditProfile}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--info)] border border-[var(--info)]/30 hover:bg-[var(--info)]/10"
            >
              Edit
            </button>
          )}
        </div>

        {editingProfile ? (
          <div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <div>
                <label className={labelCls}>Type</label>
                <select
                  className={inputCls}
                  value={profileForm.type || "unknown"}
                  onChange={(e) => setProfileForm((s) => ({ ...s, type: e.target.value }))}
                >
                  {SUPPLIER_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              {PROFILE_TEXT_FIELDS.map((f) => (
                <div key={f.key} className={f.full ? "col-span-2" : ""}>
                  <label className={labelCls}>{f.label}</label>
                  <input
                    className={inputCls}
                    value={profileForm[f.key] ?? ""}
                    onChange={(e) => setProfileForm((s) => ({ ...s, [f.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <button
                onClick={saveProfile}
                disabled={savingProfile}
                className="px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[12px] font-semibold disabled:opacity-60"
              >
                {savingProfile ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditingProfile(false)}
                className="px-3 py-1.5 rounded-lg border border-[var(--border)] text-[12px] font-semibold text-[var(--text-secondary)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : !profile ? (
          <div className="text-sm text-[var(--text-secondary)]">
            No supplier information saved yet. Click Edit to add it, or use “Save to supplier profile”
            from a conversation’s Summary tab.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="flex flex-col gap-0.5">
              <span className={labelCls}>Type</span>
              <span className="text-sm text-[var(--text-primary)]">
                {profile.type ? String(profile.type).replace(/_/g, " ") : "—"}
              </span>
            </div>
            {PROFILE_TEXT_FIELDS.map((f) => (
              <div key={f.key} className={"flex flex-col gap-0.5 " + (f.full ? "col-span-2" : "")}>
                <span className={labelCls}>{f.label}</span>
                <span className="text-sm text-[var(--text-primary)] break-words [overflow-wrap:anywhere]">{dash(profile[f.key])}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Quotes ── */}
      <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Quotes</span>
            <span className="text-[11px] text-[var(--text-muted)]">({quotes.length})</span>
          </div>
          {quoteFormFor === null && (
            <button
              onClick={openAddQuote}
              className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/10"
            >
              + Add Quote
            </button>
          )}
        </div>

        {quoteFormFor === "new" && renderQuoteForm()}

        {quotes.length === 0 && quoteFormFor !== "new" ? (
          <div className="text-sm text-[var(--text-secondary)]">No quotes saved for this supplier yet.</div>
        ) : (
          <div className="space-y-3">
            {quotes.map((q) =>
              quoteFormFor === q.id ? (
                <div key={q.id}>{renderQuoteForm()}</div>
              ) : (
                <div key={q.id} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {dash(q.material_name)}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => openEditQuote(q)}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--info)] border border-[var(--info)]/30 hover:bg-[var(--info)]/10"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => deleteQuote(q.id)}
                        disabled={deletingQuoteId === q.id}
                        className="px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--danger)] border border-[var(--danger)]/30 hover:bg-[var(--danger)]/10 disabled:opacity-60"
                      >
                        {deletingQuoteId === q.id ? "..." : "Delete"}
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                    <Field label="INCI / Trade Name" value={dash(q.inci_trade_name)} />
                    <Field label="Grade(s)" value={dash(q.grade)} />
                    <Field label="Price (as quoted)" value={dash(q.price_raw)} full />
                    <Field label="Price Qty / Unit" value={`${dash(q.price_qty)} / ${dash(q.price_unit)}`} />
                    <Field label="Material ID" value={dash(q.material_id)} />
                    <Field
                      label="Case W / H / L"
                      value={`${dash(q.case_width)} / ${dash(q.case_height)} / ${dash(q.case_length)}`}
                    />
                    <Field label="Case Weight" value={dash(q.case_weight)} />
                    <Field label="Case Size" value={dash(q.case_size)} />
                    <Field label="Pack Size" value={dash(q.pack_size)} />
                    <Field label="Quote Provided" value={dash(q.quote_provided_date)} />
                    <Field label="Quote Expiry / Valid Until" value={dash(q.quote_expiry)} />
                    <Field label="Lead Time" value={dash(q.lead_time)} />
                    <Field label="MOQ" value={dash(q.moq)} />
                    <Field label="Max Inventory" value={dash(q.max_inventory)} />
                    <Field label="Hazardous" value={yn(q.hazardous)} />
                    <Field label="Refrigerated" value={yn(q.refrigerated)} />
                    <Field label="Equipment Accessorials" value={dash(q.equipment_accessorials)} full />
                    <Field label="Sample Handling" value={dash(q.sample_handling)} full />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className={labelCls}>Docs</span>
                    <DocChip label="COA" on={q.doc_coa === true} />
                    <DocChip label="SDS" on={q.doc_sds === true} />
                    <DocChip label="TDS" on={q.doc_tds === true} />
                  </div>
                  {q.other_notes && (
                    <div className="mt-2 text-[11px] text-[var(--text-secondary)]">{q.other_notes}</div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </>
  );
}

function Field({ label, value, full }: { label: string; value: any; full?: boolean }) {
  return (
    <div className={"flex flex-col gap-0.5 " + (full ? "col-span-2" : "")}>
      <span className={labelCls}>{label}</span>
      <span className="text-sm text-[var(--text-primary)] break-words [overflow-wrap:anywhere]">{value}</span>
    </div>
  );
}

function DocChip({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold " +
        (on
          ? "bg-[rgba(74,222,128,0.12)] text-[var(--accent)]"
          : "bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]")
      }
    >
      {label} {on ? "✓" : "—"}
    </span>
  );
}