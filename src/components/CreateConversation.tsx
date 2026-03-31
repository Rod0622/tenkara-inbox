"use client";

import { useState, useEffect } from "react";
import {
  X, User, Phone, MessageSquare, Send, FileText, ChevronDown, Loader2, Plus
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";
import type { TeamMember, Mailbox } from "@/types";

const supabase = createBrowserClient();

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

  // Get callers (team members with call skillset)
  const [callers, setCallers] = useState<TeamMember[]>([]);
  useEffect(() => {
    supabase
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
    <div className="flex-1 flex flex-col bg-[#0B0E11] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#1E242C] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MessageSquare size={18} className="text-[#4ADE80]" />
          <div>
            <h2 className="text-sm font-bold text-[#E6EDF3]">Create Conversation</h2>
            <p className="text-[10px] text-[#484F58]">Set up a team workspace before emailing the supplier</p>
          </div>
        </div>
        <button onClick={onClose} className="w-8 h-8 rounded-md text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#12161B] flex items-center justify-center">
          <X size={16} />
        </button>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {error && (
          <div className="px-3 py-2 rounded-lg bg-[#F85149]/10 border border-[#F85149]/20 text-[#F85149] text-xs">{error}</div>
        )}

        {/* Subject */}
        <div>
          <label className="block text-[11px] font-semibold text-[#7D8590] uppercase tracking-wider mb-1.5">Subject *</label>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Supplier quote follow-up — ChemCorp"
            autoFocus
            className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
          />
        </div>

        {/* Email Account */}
        <div>
          <label className="block text-[11px] font-semibold text-[#7D8590] uppercase tracking-wider mb-1.5">Email Account *</label>
          <select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] cursor-pointer"
          >
            {emailAccounts.map((acc) => (
              <option key={acc.id} value={acc.id}>{acc.name} ({acc.email})</option>
            ))}
          </select>
          <p className="text-[10px] text-[#484F58] mt-1">Emails sent from this conversation will use this account</p>
        </div>

        {/* Assign To */}
        <div>
          <label className="block text-[11px] font-semibold text-[#7D8590] uppercase tracking-wider mb-1.5">
            <User size={11} className="inline mr-1" />
            Assign to
          </label>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] cursor-pointer"
          >
            <option value="">Unassigned</option>
            {activeMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.name} — {m.department}</option>
            ))}
          </select>
          <p className="text-[10px] text-[#484F58] mt-1">This conversation will appear in their personal inbox</p>
        </div>

        {/* Call Assignment */}
        <div>
          <label className="block text-[11px] font-semibold text-[#7D8590] uppercase tracking-wider mb-1.5">
            <Phone size={11} className="inline mr-1" />
            Assign Caller (optional)
          </label>
          <select
            value={callerId}
            onChange={(e) => setCallerId(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] cursor-pointer"
          >
            <option value="">No caller assigned</option>
            {(callers.length > 0 ? callers : activeMembers).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>

        {/* Initial Notes */}
        <div>
          <label className="block text-[11px] font-semibold text-[#7D8590] uppercase tracking-wider mb-1.5">
            <FileText size={11} className="inline mr-1" />
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add context for the team — what is this about, what needs to happen..."
            rows={4}
            className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58] resize-none"
          />
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[#1E242C] flex items-center justify-between">
        <p className="text-[10px] text-[#484F58]">You can compose an email from within the conversation after creating it</p>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-[#1E242C] text-xs font-medium text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#12161B] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={creating || !subject.trim() || !accountId}
            className="px-4 py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold hover:bg-[#3FCF73] disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {creating ? "Creating..." : "Create Conversation"}
          </button>
        </div>
      </div>
    </div>
  );
}