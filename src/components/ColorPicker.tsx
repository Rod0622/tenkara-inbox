"use client";

import { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";

// Single source of truth for the color palette.
// Each color has a swatch (background), label, border, and ring tint
// for use across the conversation list stripe and header chip.
export const COLORS = [
  { id: "red",    label: "Red",    swatch: "#F85149", stripe: "#F85149", chipBg: "#5C2828", chipText: "#FCA5A5" },
  { id: "orange", label: "Orange", swatch: "#F8A33B", stripe: "#F8A33B", chipBg: "#5C3F1F", chipText: "#FCD34D" },
  { id: "yellow", label: "Yellow", swatch: "#F5D547", stripe: "#F5D547", chipBg: "#52481F", chipText: "#FDE68A" },
  { id: "green",  label: "Green",  swatch: "#4ADE80", stripe: "#4ADE80", chipBg: "#1F4A2D", chipText: "#86EFAC" },
  { id: "blue",   label: "Blue",   swatch: "#58A6FF", stripe: "#58A6FF", chipBg: "#1F3A5C", chipText: "#93C5FD" },
  { id: "purple", label: "Purple", swatch: "#A78BFA", stripe: "#A78BFA", chipBg: "#3F2D5C", chipText: "#C4B5FD" },
  { id: "pink",   label: "Pink",   swatch: "#F472B6", stripe: "#F472B6", chipBg: "#5C264D", chipText: "#FBCFE8" },
  { id: "gray",   label: "Gray",   swatch: "#7D8590", stripe: "#7D8590", chipBg: "#2A3038", chipText: "#C9D1D9" },
] as const;

export type ColorId = typeof COLORS[number]["id"];

export function getColor(id: string | null | undefined) {
  if (!id) return null;
  return COLORS.find((c) => c.id === id) || null;
}

interface ColorPickerProps {
  conversationId: string;
  currentColor: string | null;
  actorId?: string;
  onChange?: (color: string | null) => void;
  // Optional render override — by default a small swatch button.
  // If `trigger` is provided, that element opens the picker instead.
  trigger?: React.ReactNode;
}

export default function ColorPicker({ conversationId, currentColor, actorId, onChange, trigger }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const current = getColor(currentColor);

  const setColor = async (next: string | null) => {
    setSaving(true);
    try {
      const res = await fetch("/api/conversations/color", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: conversationId,
          color: next,
          actor_id: actorId,
        }),
      });
      if (res.ok) {
        onChange?.(next);
        setOpen(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative inline-flex">
      {trigger ? (
        <button
          ref={buttonRef}
          onClick={() => setOpen(!open)}
          disabled={saving}
          className="inline-flex"
        >
          {trigger}
        </button>
      ) : (
        <button
          ref={buttonRef}
          onClick={() => setOpen(!open)}
          disabled={saving}
          title={current ? `Color: ${current.label}` : "Set color"}
          className={`w-8 h-8 rounded-md border border-[#1E242C] bg-[#12161B] flex items-center justify-center hover:bg-[#181D24] disabled:opacity-50`}
        >
          {current ? (
            <span
              className="w-4 h-4 rounded-full border border-[#0B0E11]"
              style={{ background: current.swatch }}
            />
          ) : (
            <span className="w-4 h-4 rounded-full border-2 border-dashed border-[#7D8590]" />
          )}
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-50 w-[220px] bg-[#0F1318] border border-[#1E242C] rounded-xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#1E242C]">
              <span className="text-xs font-bold text-[#E6EDF3]">Conversation color</span>
              <button onClick={() => setOpen(false)} className="text-[#7D8590] hover:text-[#E6EDF3]">
                <X size={12} />
              </button>
            </div>
            <div className="p-2 grid grid-cols-4 gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setColor(c.id)}
                  disabled={saving}
                  title={c.label}
                  className={`w-9 h-9 rounded-md flex items-center justify-center transition-all hover:scale-105 disabled:opacity-50 ${
                    currentColor === c.id ? "ring-2 ring-white/40" : ""
                  }`}
                  style={{ background: c.swatch }}
                />
              ))}
            </div>
            <button
              onClick={() => setColor(null)}
              disabled={saving || !currentColor}
              className="w-full px-3 py-2 border-t border-[#1E242C] text-[11px] text-[#9CA3AF] hover:bg-[#12161B] disabled:opacity-50 text-left"
            >
              Clear color
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Color filter chips — small row of colored dots used above the conversation list.
// Click a dot to add that color to the active filter set; click again to remove.
interface ColorFilterChipsProps {
  selectedColors: string[];
  onChange: (colors: string[]) => void;
  // Optional counts (shown as a small badge)
  counts?: Partial<Record<ColorId, number>>;
}

export function ColorFilterChips({ selectedColors, onChange, counts }: ColorFilterChipsProps) {
  const toggle = (id: string) => {
    if (selectedColors.includes(id)) {
      onChange(selectedColors.filter((c) => c !== id));
    } else {
      onChange([...selectedColors, id]);
    }
  };

  // Only show colors that have at least one conversation
  const visible = counts
    ? COLORS.filter((c) => (counts[c.id] || 0) > 0 || selectedColors.includes(c.id))
    : COLORS;

  if (visible.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-3 pb-1.5 pt-0.5 flex-wrap">
      <span className="text-[10px] text-[#484F58] uppercase tracking-wider mr-0.5">Color:</span>
      {visible.map((c) => {
        const isSelected = selectedColors.includes(c.id);
        const count = counts?.[c.id] || 0;
        return (
          <button
            key={c.id}
            onClick={() => toggle(c.id)}
            title={`${c.label}${count ? ` (${count})` : ""}`}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] transition-all ${
              isSelected
                ? "bg-[#1E242C] ring-1"
                : "hover:bg-[#181D24]"
            }`}
            style={isSelected ? { boxShadow: `inset 0 0 0 1px ${c.swatch}` } : undefined}
          >
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.swatch }} />
            {count > 0 && (
              <span className={isSelected ? "text-[#E6EDF3]" : "text-[#7D8590]"}>{count}</span>
            )}
          </button>
        );
      })}
      {selectedColors.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="text-[10px] text-[#7D8590] hover:text-[#E6EDF3] ml-1"
        >
          Clear
        </button>
      )}
    </div>
  );
}
