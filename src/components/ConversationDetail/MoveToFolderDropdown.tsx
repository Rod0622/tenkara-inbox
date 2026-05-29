"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen, Search } from "lucide-react";
import { useFolders } from "@/lib/hooks";

export default function MoveToFolderDropdown({
  conversationId,
  currentFolderId,
  accountId,
  onMove,
}: {
  conversationId: string;
  currentFolderId: string | null;
  // Restrict the list to this account's folders. Cross-account moves don't
  // make sense (different mailbox, different permissions, would orphan the
  // conversation). If accountId is empty/null we defensively show all
  // folders rather than break the UI.
  accountId?: string | null;
  onMove: (conversationIds: string[], folderId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const allFolders = useFolders();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const folders = accountId
    ? allFolders.filter((f: any) => f.email_account_id === accountId)
    : allFolders;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Auto-focus search on open + reset query
  useEffect(() => {
    if (open) {
      setSearch("");
      setTimeout(() => searchInputRef.current?.focus(), 10);
    }
  }, [open]);

  const move = async (folderId: string) => {
    await onMove([conversationId], folderId);
    setOpen(false);
  };

  // Filter folders by search term — case-insensitive match against folder name.
  // Note: we preserve the hook's existing sort (by sort_order). The search
  // just narrows the visible list.
  const filteredFolders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f: any) => (f.name || "").toLowerCase().includes(q));
  }, [folders, search]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[11px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-2)]"
      >
        <FolderOpen size={12} />
        <span>Move to</span>
        <ChevronDown size={10} className="text-[var(--text-muted)]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-60 bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shadow-2xl shadow-black/40 py-1 flex flex-col max-h-[380px]">
          <div className="px-3 py-2 border-b border-[var(--border)] shrink-0">
            <div className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mb-1.5">
              Move to folder
            </div>
            {/* Search bar — narrows the folder list by name. Auto-focuses on open. */}
            <div className="relative">
              <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search folders…"
                className="w-full pl-6 pr-2 py-1 text-[11px] bg-[var(--bg)] border border-[var(--border)] rounded-md text-[var(--text-primary)] outline-none focus:border-[var(--info)]/50 placeholder:text-[var(--text-muted)]"
              />
            </div>
          </div>

          {/* Scrollable list — header stays pinned */}
          <div className="flex-1 overflow-y-auto py-1">
            {filteredFolders.map((folder) => {
              const active = folder.id === currentFolderId;
              return (
                <button
                  key={folder.id}
                  onClick={() => !active && move(folder.id)}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-[12px] ${
                    active
                      ? "text-[var(--accent)] bg-[rgba(74,222,128,0.06)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--border)]"
                  }`}
                >
                  <span className="text-[13px]">{folder.icon || "📁"}</span>
                  <span className="flex-1 text-left truncate">{folder.name}</span>
                  {active && <Check size={12} className="text-[var(--accent)]" />}
                </button>
              );
            })}

            {folders.length === 0 && (
              <div className="px-3 py-3 text-[11px] text-[var(--text-muted)] text-center">
                No folders for this account
              </div>
            )}
            {folders.length > 0 && filteredFolders.length === 0 && (
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