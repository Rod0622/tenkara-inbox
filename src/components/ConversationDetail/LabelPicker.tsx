"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Tag } from "lucide-react";
import { useLabels } from "@/lib/hooks";

export default function LabelPicker({
  conversationId,
  currentLabels,
  onToggle,
}: {
  conversationId: string;
  currentLabels: { label_id: string; label?: any }[];
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const allLabels = useLabels();
  const ref = useRef<HTMLDivElement>(null);
  const [localLabelIds, setLocalLabelIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setLocalLabelIds(new Set(currentLabels.map((cl) => cl.label_id)));
  }, [currentLabels]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const toggleLabel = async (labelId: string) => {
    const add = !localLabelIds.has(labelId);

    setLocalLabelIds((prev) => {
      const next = new Set(prev);
      if (add) next.add(labelId);
      else next.delete(labelId);
      return next;
    });

    try {
      await fetch("/api/conversations/labels", {
        method: add ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, labelId }),
      });
      onToggle();
    } catch (error) {
      console.error("Label toggle failed:", error);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md border border-[#1E242C] bg-[#12161B] text-[11px] font-medium text-[#7D8590] hover:bg-[#181D24]"
      >
        <Tag size={12} />
        <span>Labels</span>
        <ChevronDown size={10} className="text-[#484F58]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1">
          <div className="px-3 py-2 border-b border-[#1E242C]">
            <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
              Toggle labels
            </div>
          </div>

          {allLabels.map((label) => {
            const active = localLabelIds.has(label.id);
            return (
              <button
                key={label.id}
                onClick={() => toggleLabel(label.id)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-[12px] hover:bg-[#1E242C]"
              >
                <div
                  className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center ${
                    active ? "border-transparent" : "border-[#484F58]"
                  }`}
                  style={active ? { background: label.color } : {}}
                >
                  {active && <Check size={10} className="text-[#0B0E11]" />}
                </div>
                <span className="w-2 h-2 rounded-full" style={{ background: label.color }} />
                <span className={active ? "text-[#E6EDF3] font-medium" : "text-[#7D8590]"}>
                  {label.name}
                </span>
              </button>
            );
          })}

          {allLabels.length === 0 && (
            <div className="px-3 py-3 text-[11px] text-[#484F58] text-center">
              No labels yet
            </div>
          )}
        </div>
      )}
    </div>
  );
}

