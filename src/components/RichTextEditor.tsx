"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import {
  Bold, Italic, Underline, Strikethrough, Link2, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Type, Palette, Smile, ChevronDown,
  Undo2, Redo2, X, Check, Paperclip, FolderOpen, FileSignature, Table2,
  Sparkles,
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
  "var(--text-primary)", "#FFFFFF", "var(--danger)", "var(--warning)", "var(--highlight)", "var(--accent)",
  "#39D2C0", "var(--info)", "#BC8CFF", "var(--text-secondary)", "var(--text-muted)", "var(--bg)",
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
        active ? "bg-[var(--accent)] text-[var(--bg)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)]"
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
        <div className="absolute left-0 top-full mt-1 z-50 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg shadow-2xl shadow-black/40 py-1 animate-fade-in">
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
  onTemplate?: () => void;
  onAIDraft?: () => void;
}

export default function RichTextEditor({
  value, onChange, placeholder = "Write your message...",
  minHeight = 200, compact = false, signature, autoFocus = false,
  onAttach, onDrive, onTemplate, onAIDraft,
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [showFontFamily, setShowFontFamily] = useState(false);
  const [showFontSize, setShowFontSize] = useState(false);
  const [showFontColor, setShowFontColor] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [tableRows, setTableRows] = useState("3");
  const [tableCols, setTableCols] = useState("3");
  const [hoveredTable, setHoveredTable] = useState<HTMLElement | null>(null);
  const [currentFont, setCurrentFont] = useState("Arial");
  const [currentSize, setCurrentSize] = useState("13px");
  const [initialized, setInitialized] = useState(false);

  // Re-initialize when signature changes (e.g., switching accounts in compose)
  const prevSignatureRef = useRef(signature);
  useEffect(() => {
    if (prevSignatureRef.current !== signature) {
      prevSignatureRef.current = signature;
      setInitialized(false);
    }
  }, [signature]);

  // Initialize content
  useEffect(() => {
    if (editorRef.current && !initialized) {
      if (value) {
        editorRef.current.innerHTML = value;
      } else if (signature) {
        editorRef.current.innerHTML = `<br><br><div style="padding-top: 8px; margin-top: 8px; font-size: 12px;">${signature}</div>`;
      }
      setInitialized(true);
      if (autoFocus) {
        editorRef.current.focus();
        const range = document.createRange();
        range.setStart(editorRef.current, 0);
        range.collapse(true);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  }, [value, signature, initialized, autoFocus]);

  // Update content when value changes externally (e.g., template insertion)
  const lastExternalValue = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (initialized && editorRef.current && value !== undefined && value !== lastExternalValue.current) {
      // Only update if the new value differs from what's in the editor
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
      lastExternalValue.current = value;
    }
  }, [value, initialized]);

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

  // Save selection before opening modals
  const savedSelectionRef = useRef<Range | null>(null);
  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedSelectionRef.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    if (savedSelectionRef.current && editorRef.current) {
      editorRef.current.focus();
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(savedSelectionRef.current);
      }
    }
  };

  const handleInsertTable = (rows: number, cols: number) => {
    if (!editorRef.current) return;

    // Restore cursor position before inserting
    restoreSelection();

    const table = document.createElement("table");
    table.style.cssText = "border-collapse:collapse;width:100%;margin:8px 0";
    table.setAttribute("data-editor-table", "true");
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (let i = 0; i < cols; i++) {
      const th = document.createElement("th");
      th.style.cssText = "border:1px solid var(--border);padding:6px 10px;background:var(--surface-2);color:var(--text-primary);font-size:12px;font-weight:600;text-align:left;overflow:hidden;resize:horizontal";
      th.textContent = "Header " + String(i + 1);
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (let r = 0; r < rows; r++) {
      const tr = document.createElement("tr");
      for (let c = 0; c < cols; c++) {
        const td = document.createElement("td");
        td.style.cssText = "border:1px solid var(--border);padding:6px 10px;color:var(--text-primary);font-size:12px";
        td.innerHTML = "\u00a0";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    const wrap = document.createElement("div");
    wrap.appendChild(document.createElement("br"));
    wrap.appendChild(table);
    wrap.appendChild(document.createElement("br"));
    document.execCommand("insertHTML", false, wrap.innerHTML);
    handleInput();
    setShowTablePicker(false);
  };

  // Get current selection state for active buttons
  const isActive = (command: string) => {
    try { return document.queryCommandState(command); } catch (_e) { return false; }
  };

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] overflow-hidden">
      {/* Toolbar */}
      <div className={`flex items-center gap-0.5 px-2 py-1.5 border-b border-[var(--surface-2)] bg-[var(--surface)] flex-wrap ${compact ? "gap-0" : ""}`}>
        {/* Undo / Redo */}
        {!compact && (
          <>
            <ToolbarBtn onClick={() => exec("undo")} title="Undo"><Undo2 size={13} /></ToolbarBtn>
            <ToolbarBtn onClick={() => exec("redo")} title="Redo"><Redo2 size={13} /></ToolbarBtn>
            <div className="w-px h-4 bg-[var(--border)] mx-1" />
          </>
        )}

        {/* Font Family */}
        {!compact && (
          <ToolbarDropdown
            open={showFontFamily} setOpen={setShowFontFamily}
            trigger={
              <button className="flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] transition-all">
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
                  className="w-full px-3 py-1.5 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors"
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
              <button className="flex items-center gap-1 px-1.5 py-1 rounded text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] transition-all">
                <span>{currentSize}</span>
                <ChevronDown size={10} />
              </button>
            }
          >
            <div className="w-24">
              {FONT_SIZES.map((s) => (
                <button key={s}
                  onMouseDown={(e) => { e.preventDefault(); exec("fontSize", "3"); /* fontSize only accepts 1-7, we'll use CSS instead */ setCurrentSize(s); setShowFontSize(false); }}
                  className="w-full px-3 py-1 text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--border)] transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </ToolbarDropdown>
        )}

        {!compact && <div className="w-px h-4 bg-[var(--border)] mx-1" />}

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

        <div className="w-px h-4 bg-[var(--border)] mx-1" />

        {/* Font Color */}
        <ToolbarDropdown
          open={showFontColor} setOpen={setShowFontColor}
          trigger={
            <button className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] transition-all" title="Text color">
              <Palette size={13} />
            </button>
          }
        >
          <div className="p-2 w-[180px]">
            <div className="text-[10px] text-[var(--text-muted)] font-semibold mb-1.5">Text Color</div>
            <div className="flex flex-wrap gap-1">
              {COLORS.map((c) => (
                <button key={c}
                  onMouseDown={(e) => { e.preventDefault(); exec("foreColor", c); setShowFontColor(false); }}
                  className="w-5 h-5 rounded-sm border border-[var(--border)] hover:scale-125 transition-transform"
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </ToolbarDropdown>

        {/* Lists — available in both full and compact mode */}
        <div className="w-px h-4 bg-[var(--border)] mx-1" />
        <ToolbarBtn onClick={() => exec("insertUnorderedList")} title="Bullet list">
          <List size={13} />
        </ToolbarBtn>
        <ToolbarBtn onClick={() => exec("insertOrderedList")} title="Numbered list">
          <ListOrdered size={13} />
        </ToolbarBtn>

        {!compact && (
          <>
            <div className="w-px h-4 bg-[var(--border)] mx-1" />

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

        <div className="w-px h-4 bg-[var(--border)] mx-1" />

        {/* Link */}
        <div className="relative">
          <ToolbarBtn onClick={() => setShowLinkInput(!showLinkInput)} title="Insert link">
            <Link2 size={13} />
          </ToolbarBtn>
          {showLinkInput && (
            <div className="absolute left-0 top-full mt-1 z-50 flex items-center gap-1.5 p-2 bg-[var(--surface-2)] border border-[var(--border)] rounded-lg shadow-xl">
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleInsertLink(); if (e.key === "Escape") setShowLinkInput(false); }}
                placeholder="https://..."
                autoFocus
                className="w-52 px-2 py-1 rounded bg-[var(--bg)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] placeholder:text-[var(--text-muted)]"
              />
              <button onMouseDown={(e) => { e.preventDefault(); handleInsertLink(); }}
                className="w-6 h-6 rounded bg-[var(--accent)] text-[var(--bg)] flex items-center justify-center">
                <Check size={11} />
              </button>
              <button onMouseDown={(e) => { e.preventDefault(); setShowLinkInput(false); setLinkUrl(""); }}
                className="w-6 h-6 rounded text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex items-center justify-center">
                <X size={11} />
              </button>
            </div>
          )}
        </div>

        {/* Table insert */}
        <ToolbarBtn onClick={() => { saveSelection(); setShowTablePicker(!showTablePicker); }} title="Insert table">
          <Table2 size={13} />
        </ToolbarBtn>
        {showTablePicker && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowTablePicker(false)}>
            <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl shadow-2xl p-4 w-52" onClick={(e) => e.stopPropagation()}>
              <div className="text-[11px] font-bold text-[var(--text-primary)] mb-3">Insert Table</div>
              <div className="flex items-center gap-3 mb-3">
                <div>
                  <div className="text-[9px] text-[var(--text-muted)] font-semibold mb-1">Rows</div>
                  <input type="number" min="1" max="50" value={tableRows}
                    onChange={(e) => setTableRows(e.target.value)}
                    autoFocus
                    className="w-16 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] text-center" />
                </div>
                <span className="text-[var(--text-muted)] mt-4 font-bold">x</span>
                <div>
                  <div className="text-[9px] text-[var(--text-muted)] font-semibold mb-1">Columns</div>
                  <input type="number" min="1" max="20" value={tableCols}
                    onChange={(e) => setTableCols(e.target.value)}
                    className="w-16 px-2 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[12px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] text-center" />
                </div>
              </div>
              <div className="text-[9px] text-[var(--text-muted)] mb-3">Rows do not include the header row</div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    handleInsertTable(
                      Math.max(1, Math.min(50, parseInt(tableRows) || 3)),
                      Math.max(1, Math.min(20, parseInt(tableCols) || 3))
                    );
                  }}
                  className="flex-1 px-3 py-2 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold hover:bg-[var(--accent-strong)]">
                  Insert
                </button>
                <button
                  onClick={() => setShowTablePicker(false)}
                  className="px-3 py-2 rounded-lg border border-[var(--border)] text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Emoji */}
        <ToolbarDropdown
          open={showEmoji} setOpen={setShowEmoji}
          trigger={
            <button className="w-7 h-7 rounded flex items-center justify-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] transition-all" title="Emoji">
              <Smile size={13} />
            </button>
          }
        >
          <div className="p-2 w-[260px]">
            <div className="text-[10px] text-[var(--text-muted)] font-semibold mb-1.5">Emoji</div>
            {EMOJI_SETS.map((row, i) => (
              <div key={i} className="flex gap-0.5 mb-0.5">
                {row.map((emoji) => (
                  <button key={emoji}
                    onMouseDown={(e) => { e.preventDefault(); handleInsertEmoji(emoji); }}
                    className="w-7 h-7 rounded flex items-center justify-center text-[15px] hover:bg-[var(--border)] transition-colors"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </ToolbarDropdown>

        {/* Attach file + Drive + Template + AI Draft buttons */}
        {(onAttach || onDrive || onTemplate || onAIDraft) && (
          <>
            <div className="w-px h-4 bg-[var(--border)] mx-1" />
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
            {onTemplate && (
              <ToolbarBtn onClick={onTemplate} title="Insert template">
                <FileSignature size={13} />
              </ToolbarBtn>
            )}
            {onAIDraft && (
              <ToolbarBtn onClick={onAIDraft} title="Draft with AI (Tenkara workflow)">
                <Sparkles size={13} />
              </ToolbarBtn>
            )}
          </>
        )}
      </div>

      {/* Editor area */}
      <div className="relative" style={{ position: "relative" }}>
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
          onMouseOver={(e) => {
            // Find if hovering over a table
            let node: HTMLElement | null = e.target as HTMLElement;
            while (node && node !== editorRef.current) {
              if (node.tagName === "TABLE") {
                setHoveredTable(node);
                return;
              }
              node = node.parentElement;
            }
          }}
          onMouseLeave={() => {
            // Delay clearing so user can click the delete button
            setTimeout(() => setHoveredTable(null), 200);
          }}
          data-placeholder={placeholder}
          className="px-4 py-3 text-[13.5px] text-[var(--text-primary)] leading-relaxed outline-none overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-[var(--text-muted)] empty:before:pointer-events-none"
          style={{
            minHeight: compact ? 80 : minHeight,
            maxHeight: compact ? 300 : 500,
            fontFamily: "Arial, sans-serif",
          }}
        />
        {hoveredTable && editorRef.current && (() => {
          const editorRect = editorRef.current.getBoundingClientRect();
          const tableRect = hoveredTable.getBoundingClientRect();
          const top = tableRect.top - editorRect.top + editorRef.current.scrollTop;
          const right = editorRect.right - tableRect.right;
          return (
            <button
              onMouseEnter={() => setHoveredTable(hoveredTable)}
              onClick={() => {
                hoveredTable.remove();
                handleInput();
                setHoveredTable(null);
              }}
              className="absolute flex items-center justify-center w-5 h-5 rounded-full bg-[var(--danger)] text-white hover:bg-[#FF6B6B] shadow-lg transition-all"
              style={{ top: top - 8, right: right - 8, zIndex: 10 }}
              title="Delete table"
            >
              <X size={11} />
            </button>
          );
        })()}
      </div>
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