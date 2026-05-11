"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Edit3, ExternalLink, FileText, Globe, ListTodo, Mail, MessageSquare, Save, ShieldAlert, Users, X } from "lucide-react";

const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const TZS = ["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Sao_Paulo","Europe/London","Europe/Berlin","Europe/Paris","Asia/Shanghai","Asia/Tokyo","Asia/Manila","Asia/Kolkata","Asia/Dubai","Australia/Sydney","Pacific/Auckland"];

function safeDecode(v: string) { try { return decodeURIComponent(v); } catch { return v; } }
function fmtDt(v?: string|null) { if (!v) return "Unknown"; const d=new Date(v); return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleString(); }
function fmtRel(v?: string|null) { if (!v) return ""; const h=Math.floor((Date.now()-new Date(v).getTime())/(1e3*3600)); if (h<1) return "just now"; if (h<24) return h+"h ago"; return Math.floor(h/24)+"d ago"; }

function ThreadCard({ thread, showAccount }: { thread: any; showAccount?: boolean }) {
  const href = `/#conversation=${thread.id}&mailbox=${thread.email_account_id||""}&folder=${thread.folder_id||""}`;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {thread.is_unread && <span className="w-2 h-2 rounded-full bg-[var(--accent)]" />}
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{thread.subject || "(No subject)"}</div>
          </div>
          <div className="text-[11px] text-[var(--text-secondary)] mb-1.5 truncate">{thread.preview || "No preview"}</div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[var(--text-secondary)]">{thread.status || "open"}</span>
            {showAccount && thread.account_name && <span className="rounded-full border border-[#BC8CFF]/20 bg-[rgba(188,140,255,0.08)] px-2 py-0.5 text-[#BC8CFF]">{thread.account_name}</span>}
            <span className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-[var(--text-secondary)]">{fmtRel(thread.last_message_at)}</span>
          </div>
        </div>
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--info)] hover:bg-[var(--surface-2)]"><ExternalLink size={11} /> Open</a>
      </div>
    </div>
  );
}

export default function ContactCommandCenterPage({ params }: { params: { email: string } }) {
  const decodedEmail = useMemo(() => safeDecode(params.email || ""), [params.email]);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string|null>(null);
  const [editingHours, setEditingHours] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [hoursForm, setHoursForm] = useState({ timezone: "", work_start: "09:00", work_end: "17:00", work_days: [1,2,3,4,5] as number[] });
  const account = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("account") || "" : "";

  // Override body overflow:hidden from globals.css so this page can scroll
  useEffect(() => {
    document.body.style.overflow = "auto";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    let c = false;
    (async () => {
      if (!decodedEmail) { setError("Missing email"); setLoading(false); return; }
      try {
        setLoading(true); setError(null);
        const qs = new URLSearchParams(); qs.set("email", decodedEmail); if (account) qs.set("account", account);
        const res = await fetch(`/api/contact-command-center?${qs}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error || "Failed");
        if (!c) { setData(json); if (json.supplier_hours) setHoursForm({ timezone: json.supplier_hours.timezone||"", work_start: json.supplier_hours.work_start||"09:00", work_end: json.supplier_hours.work_end||"17:00", work_days: json.supplier_hours.work_days||[1,2,3,4,5] }); }
      } catch (e: any) { if (!c) setError(e?.message||"Failed"); }
      finally { if (!c) setLoading(false); }
    })();
    return () => { c = true; };
  }, [decodedEmail, account]);

  const saveHours = async () => {
    if (!data) return; setSavingHours(true);
    try {
      const res = await fetch("/api/contact-command-center", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ supplier_contact_id: data.supplier_hours?.id||null, email: decodedEmail, ...hoursForm }) });
      if (res.ok) { setEditingHours(false); const qs = new URLSearchParams(); qs.set("email", decodedEmail); if (account) qs.set("account", account); const r2 = await fetch(`/api/contact-command-center?${qs}`, { cache: "no-store" }); const j = await r2.json(); if (r2.ok) setData(j); }
    } catch (e) { console.error(e); } finally { setSavingHours(false); }
  };

  if (loading) return <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]"><div className="mx-auto max-w-7xl px-6 py-10"><div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--text-secondary)]">Loading command center...</div></div></div>;
  if (error || !data) return <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)]"><div className="mx-auto max-w-5xl px-6 py-10"><div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"><AlertTriangle className="text-[#F87171] mb-2" size={20} /><div className="text-lg font-semibold text-[#F87171]">Unable to load</div><div className="mt-2 text-sm text-[var(--text-secondary)]">{error}</div><Link href="/" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-sm font-semibold text-[var(--info)] hover:bg-[var(--surface-2)]"><ArrowLeft size={16} /> Back</Link></div></div></div>;

  const { contact, summary, threads, cross_account_threads=[], domain_threads=[], domain_contacts=[], tasks, notes, thread_summaries, supplier_hours, responsiveness, responsiveness_summary } = data;
  const now = new Date();
  const openTasks = tasks.filter((t: any) => !["completed","done","dismissed"].includes((t.status||"").toLowerCase()) && !t.is_done);
  const dismissedTasks = tasks.filter((t: any) => t.status === "dismissed");
  const completedTasks = tasks.filter((t: any) => ["completed","done"].includes((t.status||"").toLowerCase()) || t.is_done);

  const fmtMinutes = (m: number | null | undefined) => {
    if (!m && m !== 0) return "—";
    if (m < 60) return Math.round(m) + "m";
    if (m < 1440) return Math.round(m / 60 * 10) / 10 + "h";
    return Math.round(m / 1440 * 10) / 10 + "d";
  };
  const responseColor = (m: number | null | undefined) => {
    if (!m && m !== 0) return "var(--text-secondary)";
    if (m <= 60) return "var(--accent)";
    if (m <= 240) return "var(--info)";
    if (m <= 720) return "var(--highlight)";
    if (m <= 1440) return "var(--warning)";
    return "var(--danger)";
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text-primary)] overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[var(--info)] hover:text-[#79B8FF]"><ArrowLeft size={16} /> Back to inbox</Link>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--surface)] border border-[var(--border)]"><Mail size={20} className="text-[var(--info)]" /></div>
            <div>
              {/* Phase 4f: editorial eyebrow — surfaces real responsiveness/thread metadata */}
              <div className="text-[10px] font-mono uppercase tracking-widest text-[var(--text-muted)] mb-1.5">
                SUPPLIER
                {responsiveness_summary && responsiveness_summary.tier && responsiveness_summary.tier !== "no_response" ? (
                  <>
                    <span className="mx-1.5">·</span>
                    TIER <span className="text-[var(--text-secondary)]">{String(responsiveness_summary.tier).toUpperCase()}</span>
                    {typeof responsiveness_summary.qualifying_exchanges === "number" && responsiveness_summary.qualifying_exchanges > 0 && (
                      <>
                        <span className="mx-1.5">·</span>
                        <span className="tabular-nums">{responsiveness_summary.qualifying_exchanges}</span> EXCHANGES
                      </>
                    )}
                  </>
                ) : summary && typeof summary.total_threads === "number" && summary.total_threads > 0 ? (
                  <>
                    <span className="mx-1.5">·</span>
                    <span className="tabular-nums">{summary.total_threads}</span> {summary.total_threads === 1 ? "THREAD" : "THREADS"}
                  </>
                ) : null}
              </div>
              <h1 className="text-3xl font-normal font-serif tracking-tight">{contact.name || contact.email}</h1>
              {contact.company && contact.company !== contact.name && <div className="text-sm text-[var(--info)]">{contact.company}</div>}
              <div className="text-sm text-[var(--text-secondary)]">{contact.email}</div>
            </div>
          </div>
        </div>

        {/* Business Hours */}
        <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2"><Globe size={16} className="text-[var(--info)]" /><span className="text-sm font-semibold">Supplier Business Hours</span></div>
            {!editingHours ? (
              <button onClick={() => setEditingHours(true)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--info)]/30"><Edit3 size={11} /> Edit</button>
            ) : (
              <div className="flex items-center gap-1">
                <button onClick={saveHours} disabled={savingHours} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-[var(--accent)] border border-[var(--accent)]/30 hover:bg-[var(--accent)]/10 disabled:opacity-50"><Save size={11} /> {savingHours ? "Saving..." : "Save"}</button>
                <button onClick={() => setEditingHours(false)} className="px-2 py-1 rounded-lg text-[11px] text-[var(--text-secondary)] border border-[var(--border)]"><X size={11} /></button>
              </div>
            )}
          </div>
          {!editingHours ? (
            <div className="flex flex-wrap gap-4 text-xs text-[var(--text-secondary)]">
              <span><span className="text-[var(--text-muted)]">Timezone:</span> {supplier_hours?.timezone || "EST (default)"}</span>
              <span><span className="text-[var(--text-muted)]">Hours:</span> {supplier_hours?.work_start || "09:00"} – {supplier_hours?.work_end || "20:00"}</span>
              <span><span className="text-[var(--text-muted)]">Days:</span> {(supplier_hours?.work_days || [1,2,3,4,5]).map((d: number) => DAY_LABELS[d]).join(", ")}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-[var(--text-muted)] uppercase mb-1 block">Timezone</label>
                <select value={hoursForm.timezone} onChange={e => setHoursForm(f => ({...f, timezone: e.target.value}))} className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none">
                  <option value="">Default (EST)</option>
                  {TZS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1"><label className="text-[10px] text-[var(--text-muted)] uppercase mb-1 block">Start</label><input type="time" value={hoursForm.work_start} onChange={e => setHoursForm(f => ({...f, work_start: e.target.value}))} className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none" /></div>
                <div className="flex-1"><label className="text-[10px] text-[var(--text-muted)] uppercase mb-1 block">End</label><input type="time" value={hoursForm.work_end} onChange={e => setHoursForm(f => ({...f, work_end: e.target.value}))} className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text-primary)] outline-none" /></div>
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)] uppercase mb-1 block">Work Days</label>
                <div className="flex gap-1">{DAY_LABELS.map((day, i) => (
                  <button key={i} onClick={() => setHoursForm(f => ({...f, work_days: f.work_days.includes(i) ? f.work_days.filter(d=>d!==i) : [...f.work_days, i].sort()}))} className={`w-8 h-7 rounded text-[10px] font-semibold transition-all ${hoursForm.work_days.includes(i) ? "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30" : "bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]"}`}>{day}</button>
                ))}</div>
              </div>
            </div>
          )}
        </div>

        {/* Responsiveness */}
        {(responsiveness_summary || (responsiveness && (responsiveness.supplier || responsiveness.team))) && (
          <div className="mb-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2"><Clock3 size={16} className="text-[#BC8CFF]" /><span className="text-sm font-semibold">Response Times</span></div>
              {responsiveness_summary && (() => {
                const tier = responsiveness_summary.tier as "excellent" | "good" | "fair" | "low" | "no_response";
                const TIER_COLORS: Record<string, string> = { excellent: "var(--accent)", good: "var(--info)", fair: "var(--warning)", low: "var(--danger)", no_response: "var(--text-muted)" };
                const TIER_BG: Record<string, string> = { excellent: "rgba(74,222,128,0.10)", good: "rgba(88,166,255,0.10)", fair: "rgba(240,136,62,0.10)", low: "rgba(248,81,73,0.10)", no_response: "rgba(72,79,88,0.10)" };
                const TIER_LABELS: Record<string, string> = { excellent: "Excellent", good: "Good", fair: "Fair", low: "Low", no_response: "No response" };
                const color = TIER_COLORS[tier] || "var(--text-muted)";
                const bg = TIER_BG[tier] || "rgba(72,79,88,0.10)";
                const label = TIER_LABELS[tier] || "—";
                const score = responsiveness_summary.score;
                const exchanges = responsiveness_summary.qualifying_exchanges;
                const median = responsiveness_summary.weighted_median_minutes ?? responsiveness_summary.all_time_median_minutes ?? null;
                const updated = responsiveness_summary.score_updated_at ? new Date(responsiveness_summary.score_updated_at) : null;
                const updatedLabel = updated ? fmtRel(updated.toISOString()) : "";
                return (
                  <div className="flex items-center gap-2 flex-wrap" title={`Median ${fmtMinutes(median)} over ${exchanges} exchanges${updatedLabel ? ` · updated ${updatedLabel}` : ""}`}>
                    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold border" style={{ color, background: bg, borderColor: color + "40" }}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                      {label}
                      <span className="text-[10px] opacity-70">· score {score}/4</span>
                    </span>
                    <span className="text-[10px] text-[var(--text-secondary)]">{exchanges} exchanges{median !== null ? ` · ${fmtMinutes(median)} median` : ""}</span>
                  </div>
                );
              })()}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {responsiveness && responsiveness.supplier && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)] mb-2">Supplier Responsiveness</div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-2xl font-bold" style={{ color: responseColor(responsiveness.supplier.avg_minutes) }}>{fmtMinutes(responsiveness.supplier.avg_minutes)}</span>
                    <span className="text-xs text-[var(--text-muted)]">avg response</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text-secondary)]">
                    <span>Median: <span className="text-[#C9D1D9] font-medium">{fmtMinutes(responsiveness.supplier.median_minutes)}</span></span>
                    <span>Fastest: <span className="text-[var(--accent)] font-medium">{fmtMinutes(responsiveness.supplier.fastest_minutes)}</span></span>
                    <span>Slowest: <span className="text-[var(--danger)] font-medium">{fmtMinutes(responsiveness.supplier.slowest_minutes)}</span></span>
                    <span>Total: <span className="text-[#C9D1D9] font-medium">{responsiveness.supplier.total} replies</span></span>
                  </div>
                </div>
              )}
              {responsiveness && responsiveness.team && (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3">
                  <div className="text-[10px] uppercase tracking-wide text-[var(--text-secondary)] mb-2">Our Team Responsiveness</div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <span className="text-2xl font-bold" style={{ color: responseColor(responsiveness.team.avg_minutes) }}>{fmtMinutes(responsiveness.team.avg_minutes)}</span>
                    <span className="text-xs text-[var(--text-muted)]">avg response</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] text-[var(--text-secondary)]">
                    <span>Median: <span className="text-[#C9D1D9] font-medium">{fmtMinutes(responsiveness.team.median_minutes)}</span></span>
                    <span>Fastest: <span className="text-[var(--accent)] font-medium">{fmtMinutes(responsiveness.team.fastest_minutes)}</span></span>
                    <span>Slowest: <span className="text-[var(--danger)] font-medium">{fmtMinutes(responsiveness.team.slowest_minutes)}</span></span>
                    <span>Total: <span className="text-[#C9D1D9] font-medium">{responsiveness.team.total} replies</span></span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Total Threads</div><div className="mt-2 text-2xl font-bold">{summary.total_threads}</div></div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Open</div><div className="mt-2 text-2xl font-bold text-[var(--accent)]">{summary.open_threads}</div></div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Action Items</div><div className="mt-2 text-2xl font-bold text-[var(--highlight)]">{openTasks.length}</div></div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Notes</div><div className="mt-2 text-2xl font-bold">{summary.notes_count}</div></div>
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs uppercase tracking-wide text-[var(--text-secondary)]">Last Activity</div><div className="mt-2 text-sm font-semibold">{fmtRel(summary.last_activity)}</div></div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* LEFT */}
          <div className="xl:col-span-2 space-y-6">
            {/* Summary */}
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-3 flex items-center gap-2"><MessageSquare size={16} className="text-[var(--info)]" /><span className="text-sm font-semibold">Summary</span></div>
              <div className="text-sm leading-6 text-[#C9D1D9]">{summary.rollup || "No summary."}</div>
              {summary.risk_signals?.length > 0 && <div className="mt-4"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[var(--highlight)]"><ShieldAlert size={16} /> Risk Signals</div><div className="flex flex-wrap gap-2">{summary.risk_signals.map((r: string) => <span key={r} className="inline-flex items-center rounded-full border border-[var(--highlight)]/20 bg-[var(--highlight-bg)] px-3 py-1 text-xs font-semibold text-[var(--highlight)]">{r}</span>)}</div></div>}
            </section>

            {/* This Account Threads */}
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-4 flex items-center gap-2"><Mail size={16} className="text-[var(--info)]" /><span className="text-sm font-semibold">Related Threads — This Account ({threads.length})</span></div>
              <div className="space-y-2">{threads.length === 0 ? <div className="text-sm text-[var(--text-secondary)]">No related threads in this account.</div> : threads.map((t: any) => <ThreadCard key={t.id} thread={t} />)}</div>
            </section>

            {/* Cross-Account Threads */}
            {cross_account_threads.length > 0 && (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="mb-4 flex items-center gap-2"><Globe size={16} className="text-[#BC8CFF]" /><span className="text-sm font-semibold">Related Threads — Other Accounts ({cross_account_threads.length})</span></div>
                <div className="space-y-2">{cross_account_threads.map((t: any) => <ThreadCard key={t.id} thread={t} showAccount />)}</div>
              </section>
            )}

            {/* Domain Threads — same domain, different contacts */}
            {domain_threads.length > 0 && (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Users size={16} className="text-[var(--highlight)]" />
                  <span className="text-sm font-semibold">Same Domain — {contact.email.split("@")[1]} ({domain_threads.length})</span>
                </div>
                {domain_contacts.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-1.5">
                    {domain_contacts.map((dc: string) => (
                      <Link key={dc} href={`/contacts/${encodeURIComponent(dc)}`}
                        className="px-2 py-0.5 rounded-full bg-[var(--highlight)]/10 border border-[var(--highlight)]/20 text-[10px] text-[var(--highlight)] hover:bg-[var(--highlight)]/20 transition-colors">
                        {dc}
                      </Link>
                    ))}
                  </div>
                )}
                <div className="space-y-2">{domain_threads.map((t: any) => <ThreadCard key={t.id} thread={t} showAccount />)}</div>
              </section>
            )}

            {/* Thread Summaries */}
            {thread_summaries.length > 0 && (
              <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="mb-4 flex items-center gap-2"><FileText size={16} className="text-[var(--info)]" /><span className="text-sm font-semibold">Thread Summaries</span></div>
                <div className="space-y-3">{thread_summaries.map((item: any) => <div key={item.conversation_id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"><div className="text-xs text-[var(--text-secondary)] mb-2">Generated: {fmtDt(item.generated_at)}</div><div className="text-sm font-semibold text-[var(--text-primary)]">{item.summary?.status||"No status"}</div><div className="mt-2 text-sm leading-6 text-[#C9D1D9]">{item.summary?.overview||"No overview"}</div></div>)}</div>
              </section>
            )}
          </div>

          {/* RIGHT */}
          <div className="space-y-6">
            {/* Action Items */}
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-4 flex items-center gap-2"><ListTodo size={16} className="text-[var(--highlight)]" /><span className="text-sm font-semibold">Action Items ({openTasks.length})</span></div>
              <div className="space-y-2">
                {openTasks.length === 0 && <div className="text-sm text-[var(--text-secondary)]">No pending action items.</div>}
                {openTasks.map((task: any) => {
                  const overdue = task.due_date && new Date(task.due_date) < now;
                  const dueH = task.due_date ? Math.round((new Date(task.due_date).getTime()-now.getTime())/(1e3*3600)) : null;
                  return (
                    <div key={task.id} className={`rounded-xl border p-3 ${overdue ? "border-[var(--danger)]/30 bg-[rgba(248,81,73,0.04)]" : "border-[var(--border)] bg-[var(--surface)]"}`}>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{task.text}</div>
                      {task.category && <span className="inline-flex mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: (task.category.color||"var(--border)")+"20", color: task.category.color||"var(--text-secondary)" }}>{task.category.name}</span>}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {task.due_date && <span className={`text-[10px] font-semibold ${overdue ? "text-[var(--danger)]" : dueH!==null&&dueH<24 ? "text-[var(--warning)]" : "text-[var(--text-secondary)]"}`}>{overdue ? `⏰ ${Math.abs(dueH||0)}h overdue` : dueH!==null ? `Due in ${dueH}h` : ""}</span>}
                        {(task.assignees||[]).map((p: any) => <span key={p.id} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${p.color||"var(--info)"}20`, color: p.color||"var(--info)" }}>{p.name}</span>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Completed */}
            {completedTasks.length > 0 && <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-4 flex items-center gap-2"><CheckCircle2 size={16} className="text-[var(--accent)]" /><span className="text-sm font-semibold">Completed ({completedTasks.length})</span></div>
              <div className="space-y-2">{completedTasks.slice(0,5).map((t: any) => <div key={t.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="text-sm text-[var(--text-secondary)] line-through">{t.text}</div></div>)}{completedTasks.length > 5 && <div className="text-[10px] text-[var(--text-muted)]">+{completedTasks.length-5} more</div>}</div>
            </section>}

            {/* Dismissed */}
            {dismissedTasks.length > 0 && <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-4 flex items-center gap-2"><Clock3 size={16} className="text-[var(--warning)]" /><span className="text-sm font-semibold">Dismissed ({dismissedTasks.length})</span></div>
              <div className="space-y-2">{dismissedTasks.map((t: any) => <div key={t.id} className="rounded-xl border border-[var(--warning)]/15 bg-[var(--surface)] p-3"><div className="text-sm text-[var(--warning)] italic">{t.text}</div>{t.dismiss_reason && <div className="text-[10px] text-[var(--text-secondary)] mt-1">Reason: {t.dismiss_reason}</div>}</div>)}</div>
            </section>}

            {/* Notes */}
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-4 flex items-center gap-2"><CheckCircle2 size={16} className="text-[var(--info)]" /><span className="text-sm font-semibold">Recent Notes</span></div>
              <div className="space-y-2">{notes.length === 0 ? <div className="text-sm text-[var(--text-secondary)]">No notes.</div> : notes.slice(0,8).map((n: any) => <div key={n.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3"><div className="mb-1 text-[10px] text-[var(--text-muted)]">{fmtRel(n.created_at)}</div><div className="text-sm leading-6 text-[#C9D1D9] whitespace-pre-wrap">{n.text}</div></div>)}</div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}