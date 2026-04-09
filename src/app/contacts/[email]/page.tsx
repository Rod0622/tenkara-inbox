"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Edit3, ExternalLink, FileText, Globe, ListTodo, Mail, MessageSquare, Save, ShieldAlert, X } from "lucide-react";

const DAY_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const TZS = ["America/New_York","America/Chicago","America/Denver","America/Los_Angeles","America/Sao_Paulo","Europe/London","Europe/Berlin","Europe/Paris","Asia/Shanghai","Asia/Tokyo","Asia/Manila","Asia/Kolkata","Asia/Dubai","Australia/Sydney","Pacific/Auckland"];

function safeDecode(v: string) { try { return decodeURIComponent(v); } catch { return v; } }
function fmtDt(v?: string|null) { if (!v) return "Unknown"; const d=new Date(v); return Number.isNaN(d.getTime()) ? "Unknown" : d.toLocaleString(); }
function fmtRel(v?: string|null) { if (!v) return ""; const h=Math.floor((Date.now()-new Date(v).getTime())/(1e3*3600)); if (h<1) return "just now"; if (h<24) return h+"h ago"; return Math.floor(h/24)+"d ago"; }

function ThreadCard({ thread, showAccount }: { thread: any; showAccount?: boolean }) {
  const href = `/#conversation=${thread.id}&mailbox=${thread.email_account_id||""}&folder=${thread.folder_id||""}`;
  return (
    <div className="rounded-xl border border-[#1E242C] bg-[#12161B] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {thread.is_unread && <span className="w-2 h-2 rounded-full bg-[#4ADE80]" />}
            <div className="truncate text-sm font-semibold text-[#E6EDF3]">{thread.subject || "(No subject)"}</div>
          </div>
          <div className="text-[11px] text-[#7D8590] mb-1.5 truncate">{thread.preview || "No preview"}</div>
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full border border-[#1E242C] bg-[#0B0E11] px-2 py-0.5 text-[#9BA7B4]">{thread.status || "open"}</span>
            {showAccount && thread.account_name && <span className="rounded-full border border-[#BC8CFF]/20 bg-[rgba(188,140,255,0.08)] px-2 py-0.5 text-[#BC8CFF]">{thread.account_name}</span>}
            <span className="rounded-full border border-[#1E242C] bg-[#0B0E11] px-2 py-0.5 text-[#9BA7B4]">{fmtRel(thread.last_message_at)}</span>
          </div>
        </div>
        <a href={href} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-2.5 py-1.5 text-[11px] font-semibold text-[#58A6FF] hover:bg-[#151A21]"><ExternalLink size={11} /> Open</a>
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

  if (loading) return <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3]"><div className="mx-auto max-w-7xl px-6 py-10"><div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-6 text-sm text-[#7D8590]">Loading command center...</div></div></div>;
  if (error || !data) return <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3]"><div className="mx-auto max-w-5xl px-6 py-10"><div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-6"><AlertTriangle className="text-[#F87171] mb-2" size={20} /><div className="text-lg font-semibold text-[#F87171]">Unable to load</div><div className="mt-2 text-sm text-[#9BA7B4]">{error}</div><Link href="/" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-4 py-2 text-sm font-semibold text-[#58A6FF] hover:bg-[#151A21]"><ArrowLeft size={16} /> Back</Link></div></div></div>;

  const { contact, summary, threads, cross_account_threads=[], tasks, notes, thread_summaries, supplier_hours } = data;
  const now = new Date();
  const openTasks = tasks.filter((t: any) => !["completed","done","dismissed"].includes((t.status||"").toLowerCase()) && !t.is_done);
  const dismissedTasks = tasks.filter((t: any) => t.status === "dismissed");
  const completedTasks = tasks.filter((t: any) => ["completed","done"].includes((t.status||"").toLowerCase()) || t.is_done);

  return (
    <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3] overflow-y-auto">
      <div className="mx-auto max-w-7xl px-6 py-8">
        {/* Header */}
        <div className="mb-6">
          <Link href="/" className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[#58A6FF] hover:text-[#79B8FF]"><ArrowLeft size={16} /> Back to inbox</Link>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#12161B] border border-[#1E242C]"><Mail size={20} className="text-[#58A6FF]" /></div>
            <div><h1 className="text-2xl font-bold tracking-tight">{contact.name || contact.email}</h1><div className="text-sm text-[#7D8590]">{contact.email}</div></div>
          </div>
        </div>

        {/* Business Hours */}
        <div className="mb-4 rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2"><Globe size={16} className="text-[#58A6FF]" /><span className="text-sm font-semibold">Supplier Business Hours</span></div>
            {!editingHours ? (
              <button onClick={() => setEditingHours(true)} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium text-[#7D8590] hover:text-[#E6EDF3] border border-[#1E242C] hover:border-[#58A6FF]/30"><Edit3 size={11} /> Edit</button>
            ) : (
              <div className="flex items-center gap-1">
                <button onClick={saveHours} disabled={savingHours} className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-[#4ADE80] border border-[#4ADE80]/30 hover:bg-[#4ADE80]/10 disabled:opacity-50"><Save size={11} /> {savingHours ? "Saving..." : "Save"}</button>
                <button onClick={() => setEditingHours(false)} className="px-2 py-1 rounded-lg text-[11px] text-[#7D8590] border border-[#1E242C]"><X size={11} /></button>
              </div>
            )}
          </div>
          {!editingHours ? (
            <div className="flex flex-wrap gap-4 text-xs text-[#7D8590]">
              <span><span className="text-[#484F58]">Timezone:</span> {supplier_hours?.timezone || "EST (default)"}</span>
              <span><span className="text-[#484F58]">Hours:</span> {supplier_hours?.work_start || "09:00"} – {supplier_hours?.work_end || "20:00"}</span>
              <span><span className="text-[#484F58]">Days:</span> {(supplier_hours?.work_days || [1,2,3,4,5]).map((d: number) => DAY_LABELS[d]).join(", ")}</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] text-[#484F58] uppercase mb-1 block">Timezone</label>
                <select value={hoursForm.timezone} onChange={e => setHoursForm(f => ({...f, timezone: e.target.value}))} className="w-full px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none">
                  <option value="">Default (EST)</option>
                  {TZS.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1"><label className="text-[10px] text-[#484F58] uppercase mb-1 block">Start</label><input type="time" value={hoursForm.work_start} onChange={e => setHoursForm(f => ({...f, work_start: e.target.value}))} className="w-full px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none" /></div>
                <div className="flex-1"><label className="text-[10px] text-[#484F58] uppercase mb-1 block">End</label><input type="time" value={hoursForm.work_end} onChange={e => setHoursForm(f => ({...f, work_end: e.target.value}))} className="w-full px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none" /></div>
              </div>
              <div>
                <label className="text-[10px] text-[#484F58] uppercase mb-1 block">Work Days</label>
                <div className="flex gap-1">{DAY_LABELS.map((day, i) => (
                  <button key={i} onClick={() => setHoursForm(f => ({...f, work_days: f.work_days.includes(i) ? f.work_days.filter(d=>d!==i) : [...f.work_days, i].sort()}))} className={`w-8 h-7 rounded text-[10px] font-semibold transition-all ${hoursForm.work_days.includes(i) ? "bg-[#4ADE80]/15 text-[#4ADE80] border border-[#4ADE80]/30" : "bg-[#0B0E11] text-[#484F58] border border-[#1E242C]"}`}>{day}</button>
                ))}</div>
              </div>
            </div>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4"><div className="text-xs uppercase tracking-wide text-[#7D8590]">Total Threads</div><div className="mt-2 text-2xl font-bold">{summary.total_threads}</div></div>
          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4"><div className="text-xs uppercase tracking-wide text-[#7D8590]">Open</div><div className="mt-2 text-2xl font-bold text-[#4ADE80]">{summary.open_threads}</div></div>
          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4"><div className="text-xs uppercase tracking-wide text-[#7D8590]">Action Items</div><div className="mt-2 text-2xl font-bold text-[#F5D547]">{openTasks.length}</div></div>
          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4"><div className="text-xs uppercase tracking-wide text-[#7D8590]">Notes</div><div className="mt-2 text-2xl font-bold">{summary.notes_count}</div></div>
          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4"><div className="text-xs uppercase tracking-wide text-[#7D8590]">Last Activity</div><div className="mt-2 text-sm font-semibold">{fmtRel(summary.last_activity)}</div></div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* LEFT */}
          <div className="xl:col-span-2 space-y-6">
            {/* Summary */}
            <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-3 flex items-center gap-2"><MessageSquare size={16} className="text-[#58A6FF]" /><span className="text-sm font-semibold">Summary</span></div>
              <div className="text-sm leading-6 text-[#C9D1D9]">{summary.rollup || "No summary."}</div>
              {summary.risk_signals?.length > 0 && <div className="mt-4"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#F5D547]"><ShieldAlert size={16} /> Risk Signals</div><div className="flex flex-wrap gap-2">{summary.risk_signals.map((r: string) => <span key={r} className="inline-flex items-center rounded-full border border-[rgba(245,213,71,0.24)] bg-[rgba(245,213,71,0.1)] px-3 py-1 text-xs font-semibold text-[#F5D547]">{r}</span>)}</div></div>}
            </section>

            {/* This Account Threads */}
            <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-4 flex items-center gap-2"><Mail size={16} className="text-[#58A6FF]" /><span className="text-sm font-semibold">Related Threads — This Account ({threads.length})</span></div>
              <div className="space-y-2">{threads.length === 0 ? <div className="text-sm text-[#7D8590]">No related threads in this account.</div> : threads.map((t: any) => <ThreadCard key={t.id} thread={t} />)}</div>
            </section>

            {/* Cross-Account Threads */}
            {cross_account_threads.length > 0 && (
              <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
                <div className="mb-4 flex items-center gap-2"><Globe size={16} className="text-[#BC8CFF]" /><span className="text-sm font-semibold">Related Threads — Other Accounts ({cross_account_threads.length})</span></div>
                <div className="space-y-2">{cross_account_threads.map((t: any) => <ThreadCard key={t.id} thread={t} showAccount />)}</div>
              </section>
            )}

            {/* Thread Summaries */}
            {thread_summaries.length > 0 && (
              <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
                <div className="mb-4 flex items-center gap-2"><FileText size={16} className="text-[#58A6FF]" /><span className="text-sm font-semibold">Thread Summaries</span></div>
                <div className="space-y-3">{thread_summaries.map((item: any) => <div key={item.conversation_id} className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4"><div className="text-xs text-[#7D8590] mb-2">Generated: {fmtDt(item.generated_at)}</div><div className="text-sm font-semibold text-[#E6EDF3]">{item.summary?.status||"No status"}</div><div className="mt-2 text-sm leading-6 text-[#C9D1D9]">{item.summary?.overview||"No overview"}</div></div>)}</div>
              </section>
            )}
          </div>

          {/* RIGHT */}
          <div className="space-y-6">
            {/* Action Items */}
            <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-4 flex items-center gap-2"><ListTodo size={16} className="text-[#F5D547]" /><span className="text-sm font-semibold">Action Items ({openTasks.length})</span></div>
              <div className="space-y-2">
                {openTasks.length === 0 && <div className="text-sm text-[#7D8590]">No pending action items.</div>}
                {openTasks.map((task: any) => {
                  const overdue = task.due_date && new Date(task.due_date) < now;
                  const dueH = task.due_date ? Math.round((new Date(task.due_date).getTime()-now.getTime())/(1e3*3600)) : null;
                  return (
                    <div key={task.id} className={`rounded-xl border p-3 ${overdue ? "border-[#F85149]/30 bg-[rgba(248,81,73,0.04)]" : "border-[#1E242C] bg-[#12161B]"}`}>
                      <div className="text-sm font-medium text-[#E6EDF3]">{task.text}</div>
                      {task.category && <span className="inline-flex mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ background: (task.category.color||"#1E242C")+"20", color: task.category.color||"#7D8590" }}>{task.category.name}</span>}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {task.due_date && <span className={`text-[10px] font-semibold ${overdue ? "text-[#F85149]" : dueH!==null&&dueH<24 ? "text-[#F0883E]" : "text-[#7D8590]"}`}>{overdue ? `⏰ ${Math.abs(dueH||0)}h overdue` : dueH!==null ? `Due in ${dueH}h` : ""}</span>}
                        {(task.assignees||[]).map((p: any) => <span key={p.id} className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: `${p.color||"#58A6FF"}20`, color: p.color||"#58A6FF" }}>{p.name}</span>)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Completed */}
            {completedTasks.length > 0 && <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-4 flex items-center gap-2"><CheckCircle2 size={16} className="text-[#4ADE80]" /><span className="text-sm font-semibold">Completed ({completedTasks.length})</span></div>
              <div className="space-y-2">{completedTasks.slice(0,5).map((t: any) => <div key={t.id} className="rounded-xl border border-[#1E242C] bg-[#12161B] p-3"><div className="text-sm text-[#7D8590] line-through">{t.text}</div></div>)}{completedTasks.length > 5 && <div className="text-[10px] text-[#484F58]">+{completedTasks.length-5} more</div>}</div>
            </section>}

            {/* Dismissed */}
            {dismissedTasks.length > 0 && <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-4 flex items-center gap-2"><Clock3 size={16} className="text-[#F0883E]" /><span className="text-sm font-semibold">Dismissed ({dismissedTasks.length})</span></div>
              <div className="space-y-2">{dismissedTasks.map((t: any) => <div key={t.id} className="rounded-xl border border-[#F0883E]/15 bg-[#12161B] p-3"><div className="text-sm text-[#F0883E] italic">{t.text}</div>{t.dismiss_reason && <div className="text-[10px] text-[#7D8590] mt-1">Reason: {t.dismiss_reason}</div>}</div>)}</div>
            </section>}

            {/* Notes */}
            <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-4 flex items-center gap-2"><CheckCircle2 size={16} className="text-[#58A6FF]" /><span className="text-sm font-semibold">Recent Notes</span></div>
              <div className="space-y-2">{notes.length === 0 ? <div className="text-sm text-[#7D8590]">No notes.</div> : notes.slice(0,8).map((n: any) => <div key={n.id} className="rounded-xl border border-[#1E242C] bg-[#12161B] p-3"><div className="mb-1 text-[10px] text-[#484F58]">{fmtRel(n.created_at)}</div><div className="text-sm leading-6 text-[#C9D1D9] whitespace-pre-wrap">{n.text}</div></div>)}</div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}