"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderOpen } from "lucide-react";
import { useFolders } from "@/lib/hooks";

export default function MoveToFolderDropdown({
  conversationId,
  currentFolderId,
  onMove,
}: {
  conversationId: string;
  currentFolderId: string | null;
  onMove: (conversationIds: string[], folderId: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const allFolders = useFolders();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const move = async (folderId: string) => {
    await onMove([conversationId], folderId);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 px-2 py-1 rounded-md border border-[#1E242C] bg-[#12161B] text-[11px] font-medium text-[#7D8590] hover:bg-[#181D24]"
      >
        <FolderOpen size={12} />
        <span>Move to</span>
        <ChevronDown size={10} className="text-[#484F58]" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-52 bg-[#161B22] border border-[#1E242C] rounded-xl shadow-2xl shadow-black/40 py-1 max-h-[320px] overflow-y-auto">
          <div className="px-3 py-2 border-b border-[#1E242C]">
            <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
              Move to folder
            </div>
          </div>

          {allFolders.map((folder) => {
            const active = folder.id === currentFolderId;
            return (
              <button
                key={folder.id}
                onClick={() => !active && move(folder.id)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-[12px] ${
                  active
                    ? "text-[#4ADE80] bg-[rgba(74,222,128,0.06)]"
                    : "text-[#7D8590] hover:bg-[#1E242C]"
                }`}
              >
                <span className="text-[13px]">{folder.icon || "📁"}</span>
                <span className="flex-1 text-left truncate">{folder.name}</span>
                {active && <Check size={12} className="text-[#4ADE80]" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

