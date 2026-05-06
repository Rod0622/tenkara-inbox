"use client";

import { useState, useEffect } from "react";
import {
  X, User, Phone, MessageSquare, Send, FileText, ChevronDown, Loader2, Plus
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";
import type { TeamMember, Mailbox } from "@/types";

// Lazy-init supabase client (avoid module-level call that breaks static generation)
let _supabase: ReturnType<typeof createBrowserClient> | null = null;
function getSupabase() {
  if (!_supabase) _supabase = createBrowserClient();
  return _supabase;
}

export default function CreateConversation({
  currentUser,
  teamMembers,
  emailAccounts,
  onCreated,
  onClose,
}: {
  currentUser: TeamMember | null;
  teamMembers: TeamMember[];
  emailAccounts: Mailbox[];
  onCreated: (conversationId: string) => void;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [assigneeId, setAssigneeId] = useState(currentUser?.id || "");
  const [callerId, setCallerId] = useState("");
  const [accountId, setAccountId] = useState(emailAccounts[0]?.id || "");
  const [notes, setNotes] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  // Supplier contact fields
  const [supplierEmail, setSupplierEmail] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [supplierCompany, setSupplierCompany] = useState("");
  const [supplierTimezone, setSupplierTimezone] = useState("America/New_York");
  const [supplierWorkStart, setSupplierWorkStart] = useState("09:00");
  const [supplierWorkEnd, setSupplierWorkEnd] = useState("17:00");
  const [supplierWorkDays, setSupplierWorkDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [createCallTask, setCreateCallTask] = useState(true);

  // Get callers (team members with call skillset)
  const [callers, setCallers] = useState<TeamMember[]>([]);
  useEffect(() => {
    getSupabase()
      .from("team_members")
      .select("*")
      .eq("is_active", true)
      .eq("has_call_skillset", true)
      .then(({ data }) => setCallers((data as any) || []));
  }, []);

  const activeMembers = teamMembers.filter((m) => m.is_active !== false);

  const handleCreate = async () => {
    if (!subject.trim()) { setError("Subject is required"); return; }
    if (!accountId) { setError("Please select an email account"); return; }

    setCreating(true);
    setError("");

    try {
      // Create or update supplier contact if email provided
      let supplierContactId: string | null = null;
      if (supplierEmail.trim()) {
        // Check if contact exists
        const { data: existing } = await getSupabase()
          .from("supplier_contacts")
          .select("id")
          .eq("email", supplierEmail.trim().toLowerCase())
          .single();

        if (existing) {
          supplierContactId = existing.id;
          // Update existing contact
          await getSupabase().from("supplier_contacts").update({
            name: supplierName.trim() || undefined,
            company: supplierCompany.trim() || undefined,
            timezone: supplierTimezone,
            work_start: supplierWorkStart,
            work_end: supplierWorkEnd,
            work_days: supplierWorkDays,
            updated_at: new Date().toISOString(),
          }).eq("id", existing.id);
        } else {
          // Create new contact
          const { data: newContact } = await getSupabase().from("supplier_contacts").insert({
            email: supplierEmail.trim().toLowerCase(),
            name: supplierName.trim() || null,
            company: supplierCompany.trim() || null,
            timezone: supplierTimezone,
            work_start: supplierWorkStart,
            work_end: supplierWorkEnd,
            work_days: supplierWorkDays,
          }).select("id").single();
          supplierContactId = newContact?.id || null;
        }
      }

      const res = await fetch("/api/conversations/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: subject.trim(),
          assignee_id: assigneeId || null,
          email_account_id: accountId,
          actor_id: currentUser?.id,
          notes: notes.trim() || null,
          caller_assignee_id: callerId || null,
          create_call_task: callerId ? createCallTask : false,
          supplier_contact_id: supplierContactId,
          from_email: supplierEmail.trim() || null,
          from_name: supplierName.trim() || supplierCompany.trim() || null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create conversation");
        setCreating(false);
        return;
      }

      onCreated(data.conversation.id);
    } catch (err: any) {
      setError(err.message || "Failed to create");
      setCreating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--bg)] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquare size={18} className="text-[var(--accent)]" />
          <div>
            <h2 className="text-sm font-bold text-[var(--text-primary)]">Create Conversation</h2>
            <p className="text-[10px] text-[var(--text-muted)]">Set up a team workspace before emailing the supplier</p>
          </div>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] flex items-center justify-center">
          <X size={16} />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {error && (
          <div className="px-3 py-2 rounded-lg bg-[var(--danger)]/10 border border-[var(--danger)]/20 text-[var(--danger)] text-xs">{error}</div>
        )}

        {/* Subject */}
        <div>
          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Subject *</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Supplier quote follow-up — ChemCorp"
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
          />
        </div>

        {/* Email Account */}
        <div>
          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Email Account *</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            {emailAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>{acc.name} ({acc.email})</option>
            ))}
          </select>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">Emails sent from this conversation will use this account</p>
        </div>

        {/* Assign To */}
        <div>
          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
            <User size={11} className="inline mr-1" />
            Assign to
          </label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="">Unassigned</option>
            {activeMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.name} — {m.department}</option>
            ))}
          </select>
          <p className="text-[10px] text-[var(--text-muted)] mt-1">This conversation will appear in their personal inbox</p>
        </div>

        {/* Call Assignment */}
        <div>
          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
            <Phone size={11} className="inline mr-1" />
            Assign Caller (optional)
          </label>
          <select
            value={callerId}
            onChange={(e) => setCallerId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] cursor-pointer"
          >
            <option value="">No caller assigned</option>
            {(callers.length > 0 ? callers : activeMembers).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          {callerId && (
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <div
                onClick={() => setCreateCallTask(!createCallTask)}
                className={`w-8 h-[18px] rounded-full flex items-center px-0.5 transition-colors cursor-pointer ${
                  createCallTask ? "bg-[var(--accent)] justify-end" : "bg-[var(--border)] justify-start"
                }`}
              >
                <div className="w-3.5 h-3.5 rounded-full bg-white shadow" />
              </div>
              <span className="text-[11px] text-[var(--text-secondary)]">Create call task</span>
            </label>
          )}
        </div>

        {/* Supplier Contact Info */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
          <div className="text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Supplier Contact</div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Email</label>
              <input value={supplierEmail} onChange={(e) => setSupplierEmail(e.target.value)}
                placeholder="supplier@company.com"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Contact Name</label>
              <input value={supplierName} onChange={(e) => setSupplierName(e.target.value)}
                placeholder="John Smith"
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Company</label>
            <input value={supplierCompany} onChange={(e) => setSupplierCompany(e.target.value)}
              placeholder="ChemCorp Inc."
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Timezone</label>
              <select value={supplierTimezone} onChange={(e) => setSupplierTimezone(e.target.value)}
                className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[11px] text-[var(--text-primary)] outline-none">
                <optgroup label="Americas">
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                  <option value="America/Anchorage">Alaska (AKT)</option>
                  <option value="Pacific/Honolulu">Hawaii (HST)</option>
                  <option value="America/Sao_Paulo">Brazil (BRT)</option>
                  <option value="America/Mexico_City">Mexico City</option>
                </optgroup>
                <optgroup label="Europe & Africa">
                  <option value="Europe/London">London (GMT/BST)</option>
                  <option value="Europe/Paris">Paris (CET)</option>
                  <option value="Europe/Berlin">Berlin (CET)</option>
                  <option value="Europe/Moscow">Moscow (MSK)</option>
                  <option value="Africa/Cairo">Cairo (EET)</option>
                  <option value="Africa/Lagos">Lagos (WAT)</option>
                </optgroup>
                <optgroup label="Asia & Pacific">
                  <option value="Asia/Dubai">Dubai (GST)</option>
                  <option value="Asia/Kolkata">India (IST)</option>
                  <option value="Asia/Shanghai">China (CST)</option>
                  <option value="Asia/Tokyo">Japan (JST)</option>
                  <option value="Asia/Seoul">Korea (KST)</option>
                  <option value="Asia/Manila">Philippines (PHT)</option>
                  <option value="Asia/Singapore">Singapore (SGT)</option>
                  <option value="Asia/Bangkok">Thailand (ICT)</option>
                  <option value="Australia/Sydney">Sydney (AEST)</option>
                  <option value="Pacific/Auckland">New Zealand (NZST)</option>
                </optgroup>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Work Start</label>
              <input type="time" value={supplierWorkStart} onChange={(e) => setSupplierWorkStart(e.target.value)}
                className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none [color-scheme:dark]" />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1">Work End</label>
              <input type="time" value={supplierWorkEnd} onChange={(e) => setSupplierWorkEnd(e.target.value)}
                className="w-full h-9 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 text-[12px] text-[var(--text-primary)] outline-none [color-scheme:dark]" />
            </div>
          </div>

          <div>
            <label className="block text-[10px] text-[var(--text-muted)] font-semibold mb-1.5">Work Days</label>
            <div className="flex gap-1">
              {[
                { day: 0, label: "Sun" }, { day: 1, label: "Mon" }, { day: 2, label: "Tue" },
                { day: 3, label: "Wed" }, { day: 4, label: "Thu" }, { day: 5, label: "Fri" }, { day: 6, label: "Sat" },
              ].map(({ day, label }) => (
                <button key={day} onClick={() => {
                  setSupplierWorkDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort());
                }}
                  className={`w-10 h-8 rounded-lg text-[10px] font-semibold transition-all ${
                    supplierWorkDays.includes(day) ? "bg-[var(--accent)]/15 text-[var(--accent)] border border-[var(--accent)]/30" : "bg-[var(--bg)] text-[var(--text-muted)] border border-[var(--border)]"
                  }`}
                >{label}</button>
              ))}
            </div>
          </div>

          <div className="text-[9px] text-[var(--text-muted)]">Task timers will only count down during the supplier&apos;s working hours in their timezone.</div>
        </div>

        {/* Initial Notes */}
        <div>
          <label className="block text-[11px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">
            <FileText size={11} className="inline mr-1" />
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add context for the team — what is this about, what needs to happen..."
            rows={4}
            className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)] resize-none"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[var(--border)] flex items-center justify-between">
        <p className="text-[10px] text-[var(--text-muted)]">You can compose an email from within the conversation after creating it</p>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !subject.trim() || !accountId}
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-xs font-semibold hover:bg-[var(--accent)] disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {creating ? "Creating..." : "Create Conversation"}
          </button>
        </div>
      </div>
    </div>
  );
}