"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  Bold, Italic, Underline, Strikethrough, Link2, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Type, Palette, Smile, ChevronDown,
  Undo2, Redo2, X, Check, Paperclip, FolderOpen,
} from "lucide-react";

// ── Font options ────────────────────────────────────
const FONT_FAMILIES = [
  { value: "Arial, sans-serif", label: "Arial" },
  { value: "'Helvetica Neue', Helvetica, sans-serif", label: "Helvetica" },
  { value: "Georgia, serif", label: "Georgia" },
  { value: "'Times New Roman', Times, serif", label: "Times New Roman" },
  { value: "'Courier New', monospace", label: "Courier New" },
  { value: "Verdana, sans-serif", label: "Verdana" },
  { value: "'Trebuchet MS', sans-serif", label: "Trebuchet" },
  { value: "Tahoma, sans-serif", label: "Tahoma" },
  { value: "system-ui, sans-serif", label: "System" },
];

const FONT_SIZES = ["10px", "12px", "13px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"];

const COLORS = [
  "#E6EDF3", "#FFFFFF", "#F85149", "#F0883E", "#F5D547", "#4ADE80",
  "#39D2C0", "#58A6FF", "#BC8CFF", "#7D8590", "#484F58", "#0B0E11",
  "#FF6B6B", "#FFD93D", "#6BCB77", "#4D96FF", "#9B59B6", "#E74C3C",
];

const EMOJI_SETS = [
  ["😀", "😂", "😊", "🥰", "😎", "🤔", "😢", "😡", "🤗", "👋"],
  ["👍", "👎", "👏", "🙏", "🤝", "💪", "✌️", "🫡", "🎉", "🔥"],
  ["❤️", "💯", "⭐", "✅", "❌", "⚠️", "📧", "📎", "📄", "🕐"],
  ["🚀", "💼", "📊", "📈", "🎯", "💡", "🔔", "📌", "🏷️", "✏️"],
];

// ── Toolbar Button ──────────────────────────────────
function ToolbarBtn({
  onClick, active, title, children, className = "",
}: {
  onClick: () => void; active?: boolean; title: string;
  children: React.ReactNode; className?: string;
}) {
  return (
    <button
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`w-7 h-7 rounded flex items-center justify-center transition-all ${
        active ? "bg-[#4ADE80] text-[#0B0E11]" : "text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C]"
      } ${className}`}
    >
      {children}
    </button>
  );
}

// ── Dropdown wrapper ────────────────────────────────
function ToolbarDropdown({
  trigger, children, open, setOpen,
}: {
  trigger: React.ReactNode; children: React.ReactNode;
  open: boolean; setOpen: (o: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, setOpen]);

  return (
    <div className="relative" ref={ref}>
      <div onMouseDown={(e) => { e.preventDefault(); setOpen(!open); }}>{trigger}</div>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 bg-[#161B22] border border-[#1E242C] rounded-lg shadow-2xl shadow-black/40 py-1 animate-fade-in">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Main Rich Text Editor ───────────────────────────
interface RichTextEditorProps {
  value?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
  compact?: boolean;
  signature?: string;
  autoFocus?: boolean;
  onAttach?: () => void;
  onDrive?: () => void;
}

export default function RichTextEditor({
  value, onChange, placeholder = "Write your message...",
  minHeight = 200, compact = false, signature, autoFocus = false,
  onAttach, onDrive,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showFontFamily, setShowFontFamily] = useState(false);
  const [showFontSize, setShowFontSize] = useState(false);
  const [showFontColor, setShowFontColor] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [currentFont, setCurrentFont] = useState("Arial");
  const [currentSize, setCurrentSize] = useState("13px");
  const [initialized, setInitialized] = useState(false);

  // Initialize content
  useEffect(() => {
    if (editorRef.current && !initialized) {
      if (value) {
        editorRef.current.innerHTML = value;
      } else if (signature) {
        editorRef.current.innerHTML = `<br><br><div style="border-top: 1px solid #1E242C; padding-top: 8px; margin-top: 8px; color: #7D8590; font-size: 12px;">${signature}</div>`;
      }
      setInitialized(true);
      if (autoFocus) {
        editorRef.current.focus();
        // Place cursor at start
        const range = document.createRange();
        range.setStart(editorRef.current, 0);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [value, signature, initialized, autoFocus]);

  // Emit changes
  const handleInput = useCallback(() => {
    if (editorRef.current && onChange) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  // Execute formatting command
  const exec = useCallback((command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    handleInput();
  }, [handleInput]);

  const handleInsertLink = () => {
    if (linkUrl.trim()) {
      const url = linkUrl.startsWith("http") ? linkUrl : `https://${linkUrl}`;
      exec("createLink", url);
      setLinkUrl("");
      setShowLinkInput(false);
    }
  };

  const handleInsertEmoji = (emoji: string) => {
    editorRef.current?.focus();
    document.execCommand("insertText", false, emoji);
    handleInput();
    setShowEmoji(false);
  };

  // Get current selection state for active buttons
  const isActive = (command: string) => {
    try { return document.queryCommandState(command); } catch { return false; }
  };

  return (
    <div className="rounded-xl border border-[#1E242C] bg-[#0B0E11] overflow-hidden">
      {/* Toolbar */}
      <div className={`flex items-center gap-0.5 px-2 py-1.5 border-b border-[#161B22] bg-[#0D1117] flex-wrap ${compact ? "gap-0" : ""}`}>
        {/* Undo / Redo */}
        {!compact && (
          <>
            <ToolbarBtn onClick={() => exec("undo")} title="Undo"><Undo2 size={13} /></ToolbarBtn>
            <ToolbarBtn onClick={() => exec("redo")} title="Redo"><Redo2 size={13} /></ToolbarBtn>
            <div className="w-px h-4 bg-[#1E242C] mx-1" />
          </>
        )}

        {/* Font Family */}
        {!compact && (
          <ToolbarDropdown
            open={showFontFamily} setOpen={setShowFontFamily}
            trigger={
              <button className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C] transition-all">
                <Type size={12} />
                <span className="max-w-[70px] truncate">{currentFont}</span>
                <ChevronDown size={10} />
              </button>
            }
          >
            <div className="w-48 max-h-[200px] overflow-y-auto">
              {FONT_FAMILIES.map((f) => (
                <button key={f.value}
                  onMouseDown={(e) => { e.preventDefault(); exec("fontName", f.value); setCurrentFont(f.label); setShowFontFamily(false); }}
                  className="w-full px-3 py-1.5 text-left text-[12px] text-[#E6EDF3] hover:bg-[#1E242C] transition-colors"
                  style={{ fontFamily: f.value }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </ToolbarDropdown>
        )}

        {/* Font Size */}
        {!compact && (
          <ToolbarDropdown
            open={showFontSize} setOpen={setShowFontSize}
            trigger={
              <button className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C] transition-all">
                <span>{currentSize}</span>
                <ChevronDown size={10} />
              </button>
            }
          >
            <div className="w-24">
              {FONT_SIZES.map((s) => (
                <button key={s}
                  onMouseDown={(e) => { e.preventDefault(); exec("fontSize", "3"); /* fontSize only accepts 1-7, we'll use CSS instead */ setCurrentSize(s); setShowFontSize(false); }}
                  className="w-full px-3 py-1 text-left text-[12px] text-[#E6EDF3] hover:bg-[#1E242C] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </ToolbarDropdown>
        )}

        {!compact && <div className="w-px h-4 bg-[#1E242C] mx-1" />}

        {/* Format buttons */}
        <ToolbarBtn onClick={() => exec("bold")} active={isActive("bold")} title="Bold (Ctrl+B)">
          <Bold size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("italic")} active={isActive("italic")} title="Italic (Ctrl+I)">
          <Italic size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("underline")} active={isActive("underline")} title="Underline (Ctrl+U)">
          <Underline size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("strikeThrough")} active={isActive("strikeThrough")} title="Strikethrough">
          <Strikethrough size={13} />
        </ToolbarBtn>

        <div className="w-px h-4 bg-[#1E242C] mx-1" />

        {/* Font Color */}
        <ToolbarDropdown
          open={showFontColor} setOpen={setShowFontColor}
          trigger={
            <button className="w-7 h-7 rounded flex items-center justify-center text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C] transition-all" title="Text color">
              <Palette size={13} />
            </button>
          }
        >
          <div className="p-2 w-[180px]">
            <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Text Color</div>
            <div className="flex flex-wrap gap-1">
              {COLORS.map((c) => (
                <button key={c}
                  onMouseDown={(e) => { e.preventDefault(); exec("foreColor", c); setShowFontColor(false); }}
                  className="w-5 h-5 rounded-sm border border-[#1E242C] hover:scale-125 transition-transform"
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </ToolbarDropdown>

        {/* Lists — available in both full and compact mode */}
        <div className="w-px h-4 bg-[#1E242C] mx-1" />
        <ToolbarBtn onClick={() => exec("insertUnorderedList")} title="Bullet list">
          <List size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("insertOrderedList")} title="Numbered list">
          <ListOrdered size={13} />
        </ToolbarBtn>

        {!compact && (
          <>
            <div className="w-px h-4 bg-[#1E242C] mx-1" />

            {/* Alignment */}
            <ToolbarBtn onClick={() => exec("justifyLeft")} title="Align left">
              <AlignLeft size={13} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => exec("justifyCenter")} title="Align center">
              <AlignCenter size={13} />
            </ToolbarBtn>
            <ToolbarBtn onClick={() => exec("justifyRight")} title="Align right">
              <AlignRight size={13} />
            </ToolbarBtn>
          </>
        )}

        <div className="w-px h-4 bg-[#1E242C] mx-1" />

        {/* Link */}
        <div className="relative">
          <ToolbarBtn onClick={() => setShowLinkInput(!showLinkInput)} title="Insert link">
            <Link2 size={13} />
          </ToolbarBtn>
          {showLinkInput && (
            <div className="absolute left-0 top-full mt-1 z-50 flex items-center gap-1.5 p-2 bg-[#161B22] border border-[#1E242C] rounded-lg shadow-xl">
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleInsertLink(); if (e.key === "Escape") setShowLinkInput(false); }}
                placeholder="https://..."
                autoFocus
                className="w-52 px-2 py-1 rounded bg-[#0B0E11] border border-[#1E242C] text-[11px] text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
              />
              <button onMouseDown={(e) => { e.preventDefault(); handleInsertLink(); }}
                className="w-6 h-6 rounded bg-[#4ADE80] text-[#0B0E11] flex items-center justify-center">
                <Check size={11} />
              </button>
              <button onMouseDown={(e) => { e.preventDefault(); setShowLinkInput(false); setLinkUrl(""); }}
                className="w-6 h-6 rounded text-[#484F58] hover:text-[#7D8590] flex items-center justify-center">
                <X size={11} />
              </button>
            </div>
          )}
        </div>

        {/* Emoji */}
        <ToolbarDropdown
          open={showEmoji} setOpen={setShowEmoji}
          trigger={
            <button className="w-7 h-7 rounded flex items-center justify-center text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C] transition-all" title="Emoji">
              <Smile size={13} />
            </button>
          }
        >
          <div className="p-2 w-[260px]">
            <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Emoji</div>
            {EMOJI_SETS.map((row, i) => (
              <div key={i} className="flex gap-0.5 mb-0.5">
                {row.map((emoji) => (
                  <button key={emoji}
                    onMouseDown={(e) => { e.preventDefault(); handleInsertEmoji(emoji); }}
                    className="w-7 h-7 rounded flex items-center justify-center text-[15px] hover:bg-[#1E242C] transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </ToolbarDropdown>

        {/* Attach file + Drive buttons */}
        {(onAttach || onDrive) && (
          <>
            <div className="w-px h-4 bg-[#1E242C] mx-1" />
            {onAttach && (
              <ToolbarBtn onClick={onAttach} title="Attach file">
                <Paperclip size={13} />
              </ToolbarBtn>
            )}
            {onDrive && (
              <ToolbarBtn onClick={onDrive} title="Insert from Drive">
                <FolderOpen size={13} />
              </ToolbarBtn>
            )}
          </>
        )}
      </div>

      {/* Editor area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onKeyDown={(e) => {
          // Keyboard shortcuts
          if (e.metaKey || e.ctrlKey) {
            if (e.key === "b") { e.preventDefault(); exec("bold"); }
            if (e.key === "i") { e.preventDefault(); exec("italic"); }
            if (e.key === "u") { e.preventDefault(); exec("underline"); }
          }
        }}
        data-placeholder={placeholder}
        className="px-4 py-3 text-[13.5px] text-[#E6EDF3] leading-relaxed outline-none overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-[#484F58] empty:before:pointer-events-none"
        style={{
          minHeight: compact ? 40 : minHeight,
          maxHeight: compact ? 150 : 500,
          fontFamily: "Arial, sans-serif",
        }}
      />
    </div>
  );
}

// ── Helper: Get plain text from HTML ────────────────
export function htmlToPlainText(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || div.innerText || "";
}

// ── Helper: Get clean HTML for sending ──────────────
export function getCleanHtml(html: string): string {
  // Remove contenteditable artifacts
  return html
    .replace(/ contenteditable="[^"]*"/g, "")
    .replace(/ data-placeholder="[^"]*"/g, "")
    .trim();
}