// src/components/AttachmentPreviewModal.tsx
//
// Centered modal that previews a single attachment. Supports:
//   - Images (jpg, png, gif, webp, svg) → <img>
//   - PDFs → <iframe>
//   - Plain text (.txt, .csv, .log, .md, .json, .xml, .yaml, .yml, .ini, .cfg) → <pre>
//   - .eml (forwarded emails) → parsed From/To/Date/Subject + body
//   - Anything else → metadata tile with Download / Open in new tab buttons
//
// Two consumption surfaces:
//   1. MessageAttachments / ThreadAttachmentBar — click an attachment chip
//   2. ThreadAttachmentBar's Drive picker modal — click a "Preview" button
//      next to each row's checkbox

"use client";

import { useEffect, useState } from "react";
import {
  X, Download, ExternalLink, Loader2, FileText, File as FileIcon,
  Image as ImageIcon, Mail, AlertCircle,
} from "lucide-react";

interface PreviewTarget {
  messageId: string;
  attachmentId: string;
  filename: string;
  contentType?: string;
  size?: number;
}

interface Props {
  target: PreviewTarget | null;  // null = closed
  onClose: () => void;
}

// ── Filetype detection ──────────────────────────────────────
function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

type PreviewKind = "image" | "pdf" | "text" | "eml" | "unsupported";

function detectKind(filename: string, contentType?: string): PreviewKind {
  const ext = getExtension(filename);
  const ct = (contentType || "").toLowerCase();
  if (ct.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico"].includes(ext)) return "image";
  if (ct === "application/pdf" || ext === "pdf") return "pdf";
  if (ext === "eml" || ct === "message/rfc822") return "eml";
  if (ct.startsWith("text/") || ["txt", "csv", "log", "md", "json", "xml", "yaml", "yml", "ini", "cfg", "tsv", "sql"].includes(ext)) return "text";
  return "unsupported";
}

function formatSize(bytes?: number): string {
  if (typeof bytes !== "number" || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AttachmentPreviewModal({ target, onClose }: Props) {
  const [textContent, setTextContent] = useState<string | null>(null);
  const [emlData, setEmlData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on Escape
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [target, onClose]);

  // Reset state when target changes
  useEffect(() => {
    setTextContent(null);
    setEmlData(null);
    setError(null);
  }, [target?.attachmentId]);

  // Fetch content for text + eml previews. Images and PDFs use the URL directly.
  useEffect(() => {
    if (!target) return;
    const kind = detectKind(target.filename, target.contentType);
    if (kind !== "text" && kind !== "eml") return;

    setLoading(true);
    setError(null);

    if (kind === "eml") {
      // Parsed eml view — server returns JSON with headers + body
      fetch(`/api/attachments?message_id=${target.messageId}&attachment_id=${target.attachmentId}&parse=eml`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        })
        .then((data) => setEmlData(data))
        .catch((e) => setError(e?.message || "Failed to parse email"))
        .finally(() => setLoading(false));
    } else {
      // Plain text — fetch as text/blob and decode. Cap at 1 MB.
      fetch(`/api/attachments?message_id=${target.messageId}&attachment_id=${target.attachmentId}`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          if (blob.size > 1024 * 1024) {
            // Truncate large text files — show first ~1 MB only
            const slice = blob.slice(0, 1024 * 1024);
            const txt = await slice.text();
            return txt + "\n\n[... truncated — file is larger than 1 MB ...]";
          }
          return blob.text();
        })
        .then((text) => setTextContent(text))
        .catch((e) => setError(e?.message || "Failed to load text"))
        .finally(() => setLoading(false));
    }
  }, [target]);

  if (!target) return null;
  const kind = detectKind(target.filename, target.contentType);
  const fileUrl = `/api/attachments?message_id=${target.messageId}&attachment_id=${target.attachmentId}`;

  const handleDownload = async () => {
    try {
      const res = await fetch(fileUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = target.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Download failed:", e);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl h-[85vh] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <KindIcon kind={kind} />
            <div className="min-w-0">
              <div className="text-sm font-bold text-[var(--text-primary)] truncate">{target.filename}</div>
              <div className="text-[10px] text-[var(--text-muted)]">
                {target.contentType || "unknown"} · {formatSize(target.size)}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener"
              className="px-2 py-1.5 rounded-md text-[11px] text-[var(--text-secondary)] hover:bg-[var(--border)] inline-flex items-center gap-1"
            >
              <ExternalLink size={11} />
              Open in new tab
            </a>
            <button
              onClick={handleDownload}
              className="px-2 py-1.5 rounded-md text-[11px] font-semibold bg-[var(--accent)] text-[var(--bg)] inline-flex items-center gap-1"
            >
              <Download size={11} />
              Download
            </button>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-[var(--bg)]">
          {kind === "image" && (
            <div className="w-full h-full flex items-center justify-center p-4">
              <img
                src={fileUrl}
                alt={target.filename}
                className="max-w-full max-h-full object-contain"
              />
            </div>
          )}

          {kind === "pdf" && (
            <iframe
              src={fileUrl}
              title={target.filename}
              className="w-full h-full border-0"
            />
          )}

          {kind === "text" && (
            <div className="p-4 h-full">
              {loading && <PreviewLoading />}
              {error && <PreviewError msg={error} />}
              {!loading && !error && textContent !== null && (
                <pre className="text-[11px] text-[var(--text-primary)] font-mono whitespace-pre-wrap break-words p-4 bg-[var(--surface)] border border-[var(--border)] rounded-lg h-full overflow-auto">
                  {textContent}
                </pre>
              )}
            </div>
          )}

          {kind === "eml" && (
            <div className="p-4 h-full overflow-auto">
              {loading && <PreviewLoading />}
              {error && <PreviewError msg={error} />}
              {!loading && !error && emlData && <EmlPreview data={emlData} />}
            </div>
          )}

          {kind === "unsupported" && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center max-w-md px-6">
                <div className="w-16 h-16 rounded-full bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center mx-auto mb-4">
                  <FileIcon size={24} className="text-[var(--text-muted)]" />
                </div>
                <div className="text-[13px] font-semibold text-[var(--text-primary)] mb-2">
                  Preview not available for this file type
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] mb-4">
                  Download the file to view it, or open it in a new tab if your browser can render it.
                </div>
                <div className="flex items-center justify-center gap-2">
                  <a
                    href={fileUrl}
                    target="_blank"
                    rel="noopener"
                    className="px-3 py-1.5 rounded-md text-[11px] text-[var(--text-secondary)] border border-[var(--border)] hover:bg-[var(--surface)] inline-flex items-center gap-1"
                  >
                    <ExternalLink size={11} />
                    Open in new tab
                  </a>
                  <button
                    onClick={handleDownload}
                    className="px-3 py-1.5 rounded-md text-[11px] font-semibold bg-[var(--accent)] text-[var(--bg)] inline-flex items-center gap-1"
                  >
                    <Download size={11} />
                    Download
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KindIcon({ kind }: { kind: PreviewKind }) {
  if (kind === "image") return <ImageIcon size={14} className="text-[var(--info)] shrink-0" />;
  if (kind === "pdf") return <FileText size={14} className="text-[var(--danger)] shrink-0" />;
  if (kind === "text") return <FileText size={14} className="text-[var(--text-secondary)] shrink-0" />;
  if (kind === "eml") return <Mail size={14} className="text-[var(--accent)] shrink-0" />;
  return <FileIcon size={14} className="text-[var(--text-muted)] shrink-0" />;
}

function PreviewLoading() {
  return (
    <div className="h-full flex items-center justify-center text-[var(--text-muted)] text-[12px]">
      <Loader2 size={16} className="animate-spin mr-2" /> Loading preview…
    </div>
  );
}

function PreviewError({ msg }: { msg: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center max-w-md px-6">
        <div className="w-12 h-12 rounded-full bg-[var(--danger)]/10 flex items-center justify-center mx-auto mb-3">
          <AlertCircle size={20} className="text-[var(--danger)]" />
        </div>
        <div className="text-[12px] text-[var(--danger)]">{msg}</div>
      </div>
    </div>
  );
}

// ── Eml preview ─────────────────────────────────────────────
// Renders parsed forwarded-email content: header table + body
function EmlPreview({ data }: { data: any }) {
  const headers = [
    { label: "From", value: data.from },
    { label: "To", value: data.to },
    { label: "Cc", value: data.cc },
    { label: "Date", value: data.date },
    { label: "Subject", value: data.subject },
  ].filter((h) => h.value);

  return (
    <div className="max-w-3xl mx-auto bg-[var(--surface)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Header table */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--bg)]">
        <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1.5 text-[11px]">
          {headers.map((h) => (
            <div key={h.label} className="contents">
              <div className="text-[var(--text-muted)] font-semibold">{h.label}:</div>
              <div className="text-[var(--text-primary)] break-words">{h.value}</div>
            </div>
          ))}
        </div>
      </div>
      {/* Body */}
      <div className="p-4 text-[12px] text-[var(--text-primary)] leading-relaxed">
        {data.body_html ? (
          <div
            className="eml-body-content"
            dangerouslySetInnerHTML={{ __html: data.body_html }}
          />
        ) : data.body_text ? (
          <pre className="whitespace-pre-wrap break-words font-sans">{data.body_text}</pre>
        ) : (
          <div className="text-[var(--text-muted)] italic">(empty body)</div>
        )}
      </div>
      {data.attachments_count > 0 && (
        <div className="px-4 py-2 border-t border-[var(--border)] bg-[var(--bg)] text-[10px] text-[var(--text-muted)]">
          This forwarded email had {data.attachments_count} nested attachment{data.attachments_count === 1 ? "" : "s"} (not previewable from here).
        </div>
      )}
    </div>
  );
}
