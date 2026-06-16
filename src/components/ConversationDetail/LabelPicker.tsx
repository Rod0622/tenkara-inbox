"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, Tag } from "lucide-react";
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
  const [search, setSearch] = useState("");
  const allLabels = useLabels();
  const ref = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [localLabelIds, setLocalLabelIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Sync local checkbox state from the server-provided labels ONLY when the
    // dropdown is closed. While it's open and the user is actively toggling,
    // the parent refetch triggered by onToggle() can briefly return stale
    // labels (the write may not be reflected yet), which would overwrite the
    // optimistic tick and make the checkbox flip back. Syncing only while
    // closed keeps the user's clicks authoritative during interaction, then
    // reconciles with server truth once they finish.
    if (!open) {
      setLocalLabelIds(new Set(currentLabels.map((cl) => cl.label_id)));
    }
  }, [currentLabels, open]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // When the dropdown opens, focus the search input automatically and reset
  // the search term. Tiny setTimeout to wait for the input to mount.
  useEffect(() => {
    if (open) {
      setSearch("");
      setTimeout(() => searchInputRef.current?.focus(), 10);
    }
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
      const res = await fetch("/api/conversations/labels", {
        method: add ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, labelId }),
      });
      if (!res.ok) throw new Error(`label ${add ? "add" : "remove"} failed (${res.status})`);
      onToggle();
    } catch (error) {
      // Roll back the optimistic change so the checkbox reflects reality.
      console.error("Label toggle failed:", error);
      setLocalLabelIds((prev) => {
        const next = new Set(prev);
        if (add) next.delete(labelId);
        else next.add(labelId);
        return next;
      });
    }
  };

  // Build sorted parent → children structure. Memoized so re-renders during
  // search-typing don't reshuffle.
  //
  // Sort uses localeCompare with numeric: true so "1-inquiries", "2-quotes",
  // "10-archived" sort in that order (plain string sort would give 1, 10, 2).
  // Children sort the same way within each parent.
  const sortedTree = useMemo(() => {
    const naturalSort = (a: string, b: string) =>
      (a || "").localeCompare(b || "", undefined, { numeric: true, sensitivity: "base" });

    const topLevel = allLabels
      .filter((l: any) => !l.parent_label_id)
      .slice()
      .sort((a: any, b: any) => naturalSort(a.name, b.name));

    const childrenByParent = new Map<string, any[]>();
    for (const l of allLabels as any[]) {
      if (l.parent_label_id) {
        const arr = childrenByParent.get(l.parent_label_id) || [];
        arr.push(l);
        childrenByParent.set(l.parent_label_id, arr);
      }
    }
    // Sort children within each parent
    childrenByParent.forEach((kids) => {
      kids.sort((a: any, b: any) => naturalSort(a.name, b.name));
    });

    return { topLevel, childrenByParent };
  }, [allLabels]);

  // Filter by search term. We match on the label's own name AND its parent's
  // name (so typing "asia" surfaces "Suppliers > Asia"). For a parent label,
  // it's shown when EITHER the parent name matches OR any of its children
  // match (so the user can drill into it).
  const filteredTree = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedTree;

    const { topLevel, childrenByParent } = sortedTree;
    const filteredChildren = new Map<string, any[]>();
    const matchedParentIds = new Set<string>();

    // First pass: find matching children — they pin their parent into view.
    for (const parent of topLevel) {
      const kids = childrenByParent.get(parent.id) || [];
      const matchingKids = kids.filter((k: any) =>
        (k.name || "").toLowerCase().includes(q)
      );
      if (matchingKids.length > 0) {
        filteredChildren.set(parent.id, matchingKids);
        matchedParentIds.add(parent.id);
      }
    }

    // Second pass: include parents whose name itself matches; their children
    // are shown in full (so a search for "1-inquiries" reveals the parent
    // plus all its children, which is probably what the user wants).
    const filteredTopLevel = topLevel.filter((parent: any) => {
      if (matchedParentIds.has(parent.id)) return true;
      if ((parent.name || "").toLowerCase().includes(q)) {
        const kids = childrenByParent.get(parent.id) || [];
        if (kids.length > 0) filteredChildren.set(parent.id, kids);
        return true;
      }
      return false;
    });

    return { topLevel: filteredTopLevel, childrenByParent: filteredChildren };
  }, [sortedTree, search]);

  const renderRow = (label: any, isChild: boolean) => {
    const active = localLabelIds.has(label.id);
    return (
      <button
        key={label.id}
        onClick={() => toggleLabel(label.id)}
        className={`flex items-center gap-2 w-full px-3 py-1.5 text-[12px] hover:bg-[var(--border)] ${isChild ? "pl-6" : ""}`}
      >
        <div
          className={`w-4 h-4 rounded border-[1.5px] flex items-center justify-center ${
            active ? "border-transparent" : "border-[var(--text-muted)]"
          }`}
          style={active ? { background: label.color } : {}}
        >
          {active && <Check size={10} className="text-[var(--bg)]" />}
        </div>
        {isChild && <span className="text-[var(--text-muted)] text-[10px] select-none">└</span>}
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: label.color }} />
        <span className={`truncate text-left ${active ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-secondary)]"}`}>
          {label.name}
        </span>
      </button>
    );
  };

  // Count of visible labels after filtering — used for the empty state
  const visibleCount =
    filteredTree.topLevel.length +
    Array.from(filteredTree.childrenByParent.values()).reduce((s, kids) => s + kids.length, 0);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
      >
        <Tag size={12} />
        <span>Labels</span>
        <ChevronDown size={10} className="text-[var(--text-muted)]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-60 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shadow-2xl shadow-black/40 py-1 flex flex-col max-h-[420px]">
          <div className="px-3 py-2 border-b border-[var(--border)] shrink-0">
            <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Toggle labels
            </div>
            {/* Search bar — filters by label name AND parent name. Auto-
                focuses when the dropdown opens. */}
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search labels…"
                className="w-full pl-6 pr-2 py-1 text-[11px] bg-[var(--bg)] border border-[var(--border)] rounded-md text-[var(--text-primary)] outline-none focus:border-[var(--info)]/50 placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>

          {/* Scrollable list. Header stays pinned. */}
          <div className="flex-1 overflow-y-auto py-1">
            {filteredTree.topLevel.map((parent: any) => (
              <div key={parent.id}>
                {renderRow(parent, false)}
                {(filteredTree.childrenByParent.get(parent.id) || []).map((child: any) =>
                  renderRow(child, true)
                )}
              </div>
            ))}

            {allLabels.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-[var(--text-muted)] text-center">
                No labels yet
              </div>
            )}
            {allLabels.length > 0 && visibleCount === 0 && (
              <div className="px-3 py-3 text-[11px] text-[var(--text-muted)] text-center">
                No matches for "{search}"
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}