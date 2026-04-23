"use client";

import { useState } from "react";
import { AlarmClock } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";
import { addBusinessHours } from "@/lib/business-hours";

export default function SlaResetPanel({ task, convo, onAddNote, onUpdateTask, onDone }: {
  task: any; convo: any;
  onAddNote: (conversationId: string, text: string) => Promise<void>;
  onUpdateTask: (taskId: string, updates: any) => Promise<void>;
  onDone: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<"same" | "next_day" | "custom">("next_day");
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const origHours = task.due_time
    ? Math.max(1, Math.round((new Date(task.due_date + "T" + task.due_time).getTime() - new Date(task.created_at).getTime()) / (1000 * 60 * 60)))
    : 24;

  const handleReset = async () => {
    if (!reason.trim()) return;
    setSaving(true);
    try {
      await onAddNote(convo.id, `⏱️ SLA Reset — Task: "${task.text.slice(0, 50)}"\nReason: ${reason.trim()}\nPrevious deadline: ${task.due_date}${task.due_time ? " " + task.due_time : ""}`);

      let supplierHrs: any = null;
      try {
        const sb = createBrowserClient();
        if (convo?.supplier_contact_id) {
          const { data: sc } = await sb.from("supplier_contacts")
            .select("timezone, work_start, work_end, work_days")
            .eq("id", convo.supplier_contact_id).single();
          if (sc) supplierHrs = sc;
        }
      } catch (_e) {}

      const { addBusinessHours } = await import("@/lib/business-hours");
      let newDueDate: string;
      let newDueTime: string | null = null;

      if (choice === "same") {
        const result = addBusinessHours(new Date(), origHours, supplierHrs);
        newDueDate = result.dueDate;
        newDueTime = result.dueTime;
      } else if (choice === "next_day") {
        const result = addBusinessHours(new Date(), Math.max(origHours, 11), supplierHrs);
        newDueDate = result.dueDate;
        newDueTime = result.dueTime;
      } else {
        newDueDate = customDate;
        newDueTime = customTime || null;
      }

      await onUpdateTask(task.id, { dueDate: newDueDate });
      if (newDueTime) {
        const sb = createBrowserClient();
        await sb.from("tasks").update({ due_time: newDueTime }).eq("id", task.id);
      }

      setOpen(false);
      setReason("");
      await onDone();
    } catch (e) { console.error("Reset SLA failed:", e); }
    setSaving(false);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] text-[#F0883E] bg-[rgba(240,136,62,0.1)] hover:bg-[rgba(240,136,62,0.2)] transition-colors"
        title="Reset the SLA timer">
        <AlarmClock size={11} /> Reset timer
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-[#1E242C] bg-[#12161B] p-3 w-full">
      <div className="text-[11px] font-semibold text-[#E6EDF3] mb-2">Reset SLA Timer</div>

      <div className="space-y-1.5 mb-2">
        <label className="flex items-center gap-2 cursor-pointer text-[11px] text-[#C9D1D9]">
          <input type="radio" name={`sla-${task.id}`} checked={choice === "same"} onChange={() => setChoice("same")} className="accent-[#F0883E]" />
          Same as original ({origHours}h from now)
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-[11px] text-[#C9D1D9]">
          <input type="radio" name={`sla-${task.id}`} checked={choice === "next_day"} onChange={() => setChoice("next_day")} className="accent-[#F0883E]" />
          Next business day ({Math.max(origHours, 11)}h from now)
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-[11px] text-[#C9D1D9]">
          <input type="radio" name={`sla-${task.id}`} checked={choice === "custom"} onChange={() => setChoice("custom")} className="accent-[#F0883E]" />
          Custom date & time
        </label>
        {choice === "custom" && (
          <div className="flex gap-2 ml-5 mt-1">
            <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)}
              className="flex-1 px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#F0883E] [color-scheme:dark]" />
            <input type="time" value={customTime} onChange={(e) => setCustomTime(e.target.value)}
              className="w-24 px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#F0883E] [color-scheme:dark]" />
          </div>
        )}
      </div>

      <div className="mb-2">
        <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (e.g., supplier busy, no answer, rescheduled)"
          className="w-full px-2 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#F0883E] placeholder:text-[#484F58]" />
      </div>

      <div className="flex items-center gap-1.5">
        <button disabled={saving || !reason.trim() || (choice === "custom" && !customDate)} onClick={handleReset}
          className="flex-1 px-2 py-1.5 rounded-lg bg-[#F0883E] text-[#0B0E11] text-[10px] font-semibold disabled:opacity-50">
          {saving ? "Resetting..." : "Reset Timer"}
        </button>
        <button onClick={() => setOpen(false)}
          className="px-2 py-1.5 rounded-lg border border-[#1E242C] text-[10px] text-[#7D8590] hover:text-[#E6EDF3]">
          Cancel
        </button>
      </div>
    </div>
  );
}

