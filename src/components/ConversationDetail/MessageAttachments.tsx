"use client";

import { useEffect, useMemo, useState } from "react";
import AttachmentPreviewModal from "@/components/AttachmentPreviewModal";
import {
  Archive, Check, Download, ExternalLink, File, FileText, FolderOpen,
  Image, Paperclip, Plus, X, Edit3, RotateCcw,
} from "lucide-react";

// One row in the Drive upload modal. Tracks user's per-attachment selection
// (checked/unchecked) and per-attachment rename. `originalName` is the file's
// real name as it arrived in the email; `rename` is what the user wants to
// save it as in Drive. `isManuallyRenamed` flips true the first time the user
// types in the rename field — bulk operations (prefix / find-replace) skip
// manually-renamed rows to avoid clobbering deliberate edits.
type AttSelection = {
  id: string;
  originalName: string;
  rename: string;
  checked: boolean;
  size: number | null;
  contentType: string;
  isManuallyRenamed: boolean;
};

// Split a filename into (base, ext) using the LAST dot as the boundary.
//   "report.final.pdf" → ["report.final", ".pdf"]
//   "archive.tar.gz"   → ["archive.tar", ".gz"]   (acceptable; not perfect for compound exts)
//   "noext"            → ["noext", ""]
//   ".env"             → [".env", ""]            (leading-dot filenames are not extensions)
function splitNameExt(name: string): [string, string] {
  if (!name) return ["", ""];
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return [name, ""]; // no extension, or leading-dot filename
  return [name.slice(0, lastDot), name.slice(lastDot)];
}

// If the user has stripped the extension from their rename, restore it from
// the original name. Comparison is case-insensitive.
function withRestoredExt(rename: string, originalName: string): string {
  const [, ext] = splitNameExt(originalName);
  if (!ext) return rename; // original had no extension; nothing to restore
  if (rename.toLowerCase().endsWith(ext.toLowerCase())) return rename; // ext present
  return rename + ext;
}

export default function MessageAttachments({ messageId }: { messageId: string }) {
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<{
    messageId: string;
    attachmentId: string;
    filename: string;
    contentType?: string;
    size?: number;
  } | null>(null);

  // ── Drive modal state ─────────────────────────────────
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  // Per-attachment selection rows for the modal. Built each time the modal opens.
  const [driveSelections, setDriveSelections] = useState<AttSelection[]>([]);
  // Bulk-rename controls
  const [bulkPrefix, setBulkPrefix] = useState("");
  const [bulkFind, setBulkFind] = useState("");
  const [bulkReplace, setBulkReplace] = useState("");
  const [showBulkControls, setShowBulkControls] = useState(false);

  // Drive picker / folder navigation state
  const [drives, setDrives] = useState<any[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<any>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);

  // Auto-load on mount and whenever messageId changes. Previously this was
  // gated behind a "Show attachments" button click, which surfaced
  // "No downloadable attachments" noise everywhere. With auto-load we know
  // the real state up front and can hide the row entirely when empty.
  useEffect(() => {
    setAttachments([]);
    setLoaded(false);
    setShowDrivePicker(false);
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/attachments?message_id=${messageId}`);
        const data = await res.json();
        if (cancelled) return;
        setAttachments(data.attachments || []);
      } catch (err) {
        if (!cancelled) console.error("Failed to load attachments:", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [messageId]);

  // Manual reload — kept for any future reload trigger; currently unused.
  const reloadAttachments = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/attachments?message_id=${messageId}`);
      const data = await res.json();
      setAttachments(data.attachments || []);
    } catch (err) {
      console.error("Failed to load attachments:", err);
    }
    setLoading(false);
    setLoaded(true);
  };

  const downloadAttachment = async (attId: string, filename: string) => {
    setDownloading(attId);
    try {
      const res = await fetch(`/api/attachments?message_id=${messageId}&attachment_id=${attId}`);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
    setDownloading(null);
  };

  const downloadAllAttachments = async () => {
    setDownloadingAll(true);
    try {
      const res = await fetch(`/api/attachments?message_id=${messageId}&download_all=true`);
      const data = await res.json();
      if (data.attachments && data.format === "base64") {
        for (const att of data.attachments) {
          const bytes = Uint8Array.from(atob(att.data), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: att.contentType || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = att.name;
          a.click();
          URL.revokeObjectURL(url);
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    } catch (err) {
      console.error("Download all failed:", err);
    }
    setDownloadingAll(false);
  };

  const getFileIcon = (name: string, contentType: string) => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext) || contentType.startsWith("image/"))
      return <Image size={14} className="text-[#BC8CFF]" />;
    if (["pdf"].includes(ext)) return <FileText size={14} className="text-[var(--danger)]" />;
    if (["doc", "docx", "txt", "rtf"].includes(ext)) return <FileText size={14} className="text-[var(--info)]" />;
    if (["xls", "xlsx", "csv"].includes(ext)) return <FileText size={14} className="text-[var(--accent)]" />;
    if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) return <Archive size={14} className="text-[var(--warning)]" />;
    return <File size={14} className="text-[var(--text-secondary)]" />;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // ── Open the unified Drive picker ─────────────────────
  // Two entry points:
  //   - "Save to Drive" toolbar button → all attachments listed and checked
  //   - Per-row Drive icon button → only that one attachment is checked,
  //     others are present but unchecked (user can still toggle them on)
  const openDrivePicker = async (singleAttId?: string) => {
    const downloadable = attachments.filter((a: any) => !a.isInline);
    const selections: AttSelection[] = downloadable.map((a: any) => ({
      id: a.id,
      originalName: a.name,
      rename: a.name,
      checked: singleAttId ? a.id === singleAttId : true,
      size: typeof a.size === "number" ? a.size : null,
      contentType: a.contentType || "application/octet-stream",
      isManuallyRenamed: false,
    }));
    setDriveSelections(selections);
    setBulkPrefix("");
    setBulkFind("");
    setBulkReplace("");
    setShowBulkControls(false);
    setUploadResult(null);
    setShowDrivePicker(true);
    setFolders([]);
    setFolderPath([]);
    setSelectedDrive(null);
    setLoadingFolders(true);

    try {
      const configRes = await fetch("/api/drive?action=config");
      const config = await configRes.json();

      if (config.mode === "direct" && config.folderId) {
        setSelectedDrive({ id: "configured", name: "Shared Drive" });
        setFolderPath([{ id: config.folderId, name: "Training Files" }]);
        const res = await fetch(`/api/drive?action=folders&folder_id=${config.folderId}`);
        const data = await res.json();
        setFolders(data.folders || []);
      } else {
        setLoadingDrives(true);
        const res = await fetch("/api/drive?action=drives");
        const data = await res.json();
        setDrives(data.drives || []);
        setLoadingDrives(false);
      }
    } catch (e) {
      console.error("Failed to load drive:", e);
    }
    setLoadingFolders(false);
  };

  const selectDrive = async (drive: any) => {
    setSelectedDrive(drive);
    setFolderPath([]);
    setLoadingFolders(true);
    try {
      const res = await fetch(`/api/drive?action=folders&drive_id=${drive.id}`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setLoadingFolders(false);
  };

  const openFolder = async (folder: any) => {
    setFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setLoadingFolders(true);
    try {
      // Pass drive_id ONLY when it's a real picked Shared Drive. In direct/
      // configured mode selectedDrive.id is the "configured" placeholder, which
      // is NOT a valid driveId — sending it makes the API query Google with a
      // bogus drive and return no folders (the bug). Omitting it lets the API
      // resolve the real drive from folder_id, exactly as ThreadAttachmentBar does.
      const driveParam =
        selectedDrive?.id && selectedDrive.id !== "configured"
          ? `&drive_id=${selectedDrive.id}`
          : "";
      const res = await fetch(`/api/drive?action=folders&folder_id=${folder.id}${driveParam}`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setLoadingFolders(false);
  };

  const navigateToPathIndex = async (index: number) => {
    if (index < 0) {
      setFolderPath([]);
      // Back to root. In direct/configured mode, selectDrive would query with
      // the bogus "configured" id and return nothing — instead reload the
      // configured root folder. In picker mode, selectDrive with the real
      // drive is correct.
      if (selectedDrive?.id && selectedDrive.id !== "configured") {
        await selectDrive(selectedDrive);
      } else {
        setLoadingFolders(true);
        try {
          const configRes = await fetch("/api/drive?action=config");
          const config = await configRes.json();
          if (config.mode === "direct" && config.folderId) {
            setFolderPath([{ id: config.folderId, name: "Training Files" }]);
            const res = await fetch(`/api/drive?action=folders&folder_id=${config.folderId}`);
            const data = await res.json();
            setFolders(data.folders || []);
          }
        } catch (e) { console.error(e); }
        setLoadingFolders(false);
      }
      return;
    }
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);
    setLoadingFolders(true);
    try {
      const fId = newPath[newPath.length - 1].id;
      const driveParam =
        selectedDrive?.id && selectedDrive.id !== "configured"
          ? `&drive_id=${selectedDrive.id}`
          : "";
      const res = await fetch(`/api/drive?action=folders&folder_id=${fId}${driveParam}`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setLoadingFolders(false);
  };

  // ── Per-attachment selection mutators ─────────────────
  const toggleAttChecked = (id: string) => {
    setDriveSelections((s) => s.map((row) => row.id === id ? { ...row, checked: !row.checked } : row));
  };

  const setAttRename = (id: string, value: string) => {
    setDriveSelections((s) => s.map((row) =>
      row.id === id ? { ...row, rename: value, isManuallyRenamed: true } : row
    ));
  };

  const resetAttRename = (id: string) => {
    setDriveSelections((s) => s.map((row) =>
      row.id === id ? { ...row, rename: row.originalName, isManuallyRenamed: false } : row
    ));
  };

  const checkAll = () => setDriveSelections((s) => s.map((r) => ({ ...r, checked: true })));
  const uncheckAll = () => setDriveSelections((s) => s.map((r) => ({ ...r, checked: false })));

  // ── Bulk rename application ───────────────────────────
  // Applied LIVE as the user types in the bulk-control fields, but ONLY
  // to rows that haven't been manually renamed. That way the user can
  // tweak one or two filenames by hand and still use bulk for the rest.
  const applyBulkRename = (
    prefix: string,
    find: string,
    replace: string,
  ) => {
    setDriveSelections((s) => s.map((row) => {
      if (row.isManuallyRenamed) return row;
      const [base, ext] = splitNameExt(row.originalName);
      let baseAfter = base;
      // Find-replace operates on the base name only (preserves extension)
      if (find) {
        // Literal substring replace, not regex
        baseAfter = baseAfter.split(find).join(replace);
      }
      // Prefix prepends to whatever the result is
      const finalBase = prefix + baseAfter;
      return { ...row, rename: finalBase + ext };
    }));
  };

  // Wrap the setters so bulk-rename re-applies on every keystroke
  const onChangeBulkPrefix = (v: string) => {
    setBulkPrefix(v);
    applyBulkRename(v, bulkFind, bulkReplace);
  };
  const onChangeBulkFind = (v: string) => {
    setBulkFind(v);
    applyBulkRename(bulkPrefix, v, bulkReplace);
  };
  const onChangeBulkReplace = (v: string) => {
    setBulkReplace(v);
    applyBulkRename(bulkPrefix, bulkFind, v);
  };

  // Reset everything in the modal (renames + bulk controls + selections)
  const resetAll = () => {
    setDriveSelections((s) => s.map((row) => ({
      ...row,
      rename: row.originalName,
      checked: true,
      isManuallyRenamed: false,
    })));
    setBulkPrefix("");
    setBulkFind("");
    setBulkReplace("");
  };

  // ── Upload ────────────────────────────────────────────
  const saveToDrive = async () => {
    if (!selectedDrive) return;
    const checked = driveSelections.filter((r) => r.checked);
    if (checked.length === 0) {
      setUploadResult("Error: Select at least one file");
      return;
    }
    setUploading(true);
    setUploadResult(null);
    const targetFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;

    let saved = 0;
    let failed = 0;
    try {
      for (const row of checked) {
        // Auto-restore extension if user removed it
        const finalName = withRestoredExt((row.rename || row.originalName).trim() || row.originalName, row.originalName);
        const res = await fetch("/api/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upload_attachment",
            messageId,
            attachmentId: row.id,
            fileName: finalName,
            folderId: targetFolderId,
            driveId: selectedDrive.id,
          }),
        });
        const data = await res.json();
        if (data.success) saved++;
        else { failed++; console.error("Drive upload failed:", data.error); }
      }
      if (failed === 0) {
        const label = saved === 1 ? "1 file" : `${saved} files`;
        setUploadResult(`Saved ${label} to Drive!`);
      } else if (saved === 0) {
        setUploadResult(`Error: All ${failed} uploads failed`);
      } else {
        setUploadResult(`Saved ${saved}, ${failed} failed`);
      }
    } catch (e: any) {
      setUploadResult(`Error: ${e.message}`);
    }
    setUploading(false);
  };

  // ── Render ────────────────────────────────────────────
  const visibleAttachments = loaded ? attachments.filter((a: any) => !a.isInline) : [];
  const totalSize = useMemo(() => visibleAttachments.reduce((sum, a) => sum + (a.size || 0), 0), [visibleAttachments]);

  // Hide the entire row if there are no attachments — same behavior as before
  if (loaded && visibleAttachments.length === 0) return null;
  if (!loaded) return null;

  const checkedCount = driveSelections.filter((r) => r.checked).length;
  const totalCount = driveSelections.length;

  return (
    <div className="border-t border-[var(--border)] bg-[var(--bg)]">
      <div className="px-4 py-2.5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Paperclip size={12} className="text-[var(--text-muted)]" />
            <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              {visibleAttachments.length} attachment{visibleAttachments.length === 1 ? "" : "s"}
            </span>
            <span className="text-[10px] text-[var(--text-muted)]">· {formatSize(totalSize)}</span>
            {uploading && <span className="text-[10px] text-[var(--info)] ml-2">Uploading to Drive...</span>}
          </div>
          <div className="flex items-center gap-1.5">
            {visibleAttachments.length > 1 && (
              <button
                onClick={downloadAllAttachments}
                disabled={downloadingAll}
                className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] text-[10px] text-[var(--text-secondary)] hover:bg-[var(--surface)] disabled:opacity-50"
              >
                <Download size={10} />
                {downloadingAll ? "Downloading..." : "Download all"}
              </button>
            )}
            <button
              onClick={() => openDrivePicker()}
              className="flex items-center gap-1 px-2 py-1 rounded-md border border-[var(--border)] bg-[var(--surface)] text-[10px] font-semibold text-[var(--info)] hover:bg-[var(--info)]/10"
              title="Save attachments to Google Drive"
            >
              <ExternalLink size={10} />
              Save to Drive
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {visibleAttachments.map((att: any) => (
            <div
              key={att.id}
              className="flex items-center bg-[var(--bg)] border border-[var(--border)] rounded-lg overflow-hidden hover:border-[var(--accent)]/30 transition-all group"
              title={`${att.name} · ${formatSize(att.size)}\nClick to preview`}
            >
              <button
                onClick={() => setPreviewTarget({
                  messageId,
                  attachmentId: att.id,
                  filename: att.name,
                  contentType: att.contentType,
                  size: att.size,
                })}
                className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-[var(--surface)] transition-colors"
              >
                {getFileIcon(att.name, att.contentType)}
                <span className="text-[11px] text-[var(--text-primary)] max-w-[150px] truncate">{att.name}</span>
                <span className="text-[9px] text-[var(--text-muted)]">{formatSize(att.size)}</span>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); downloadAttachment(att.id, att.name); }}
                disabled={downloading === att.id}
                title="Download"
                className="px-1.5 py-1.5 border-l border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--surface)] transition-colors disabled:opacity-50"
              >
                <Download size={11} />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); openDrivePicker(att.id); }}
                title="Save just this file to Google Drive"
                className="px-1.5 py-1.5 border-l border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--info)] hover:bg-[var(--surface)] transition-colors"
              >
                <ExternalLink size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Drive Picker Modal */}
      {showDrivePicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowDrivePicker(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
              <div>
                <div className="text-sm font-bold text-[var(--text-primary)]">
                  Save to Google Drive
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  Pick attachments, rename if needed, then choose a folder.
                </div>
              </div>
              <button
                onClick={() => setShowDrivePicker(false)}
                className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* ── Attachments selection list ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Files ({checkedCount} of {totalCount})
                  </div>
                  <div className="flex items-center gap-2">
                    {totalCount > 1 && (
                      <>
                        <button
                          onClick={checkAll}
                          className="text-[10px] text-[var(--info)] hover:underline"
                        >
                          Check all
                        </button>
                        <span className="text-[var(--text-muted)] text-[10px]">·</span>
                        <button
                          onClick={uncheckAll}
                          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                          Uncheck all
                        </button>
                        <span className="text-[var(--text-muted)] text-[10px]">·</span>
                        <button
                          onClick={() => setShowBulkControls((v) => !v)}
                          className="text-[10px] text-[var(--accent)] hover:underline inline-flex items-center gap-1"
                        >
                          <Edit3 size={9} />
                          {showBulkControls ? "Hide" : "Bulk rename"}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Bulk rename controls */}
                {showBulkControls && totalCount > 1 && (
                  <div className="mb-3 px-3 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] space-y-2">
                    <div className="text-[10px] text-[var(--text-muted)] mb-1">
                      Applies to files you haven't renamed by hand. Extension is preserved.
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-[var(--text-secondary)] w-16 shrink-0">Prefix:</label>
                      <input
                        type="text"
                        value={bulkPrefix}
                        onChange={(e) => onChangeBulkPrefix(e.target.value)}
                        placeholder="e.g. 2026-Q1-"
                        className="flex-1 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-[var(--text-secondary)] w-16 shrink-0">Find:</label>
                      <input
                        type="text"
                        value={bulkFind}
                        onChange={(e) => onChangeBulkFind(e.target.value)}
                        placeholder="text to find"
                        className="flex-1 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-[var(--text-secondary)] w-16 shrink-0">Replace:</label>
                      <input
                        type="text"
                        value={bulkReplace}
                        onChange={(e) => onChangeBulkReplace(e.target.value)}
                        placeholder="replacement"
                        className="flex-1 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[9px] text-[var(--text-muted)]">
                        Substring match (not regex). Skips files you've manually renamed.
                      </span>
                      <button
                        onClick={resetAll}
                        className="text-[10px] text-[var(--danger)] hover:underline inline-flex items-center gap-1"
                      >
                        <RotateCcw size={9} />
                        Reset all
                      </button>
                    </div>
                  </div>
                )}

                {/* Per-attachment rows */}
                <div className="space-y-1.5">
                  {driveSelections.map((row) => {
                    const [, ext] = splitNameExt(row.originalName);
                    return (
                      <div
                        key={row.id}
                        className={`flex items-center gap-2 px-2 py-2 rounded-lg border transition-colors ${
                          row.checked
                            ? "border-[var(--border)] bg-[var(--bg)]"
                            : "border-[var(--border)]/30 bg-transparent opacity-50"
                        }`}
                      >
                        <button
                          onClick={() => toggleAttChecked(row.id)}
                          className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                            row.checked
                              ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--bg)]"
                              : "border-[var(--text-muted)]"
                          }`}
                          aria-label={row.checked ? "Uncheck" : "Check"}
                        >
                          {row.checked && <Check size={10} />}
                        </button>
                        <div className="shrink-0">{getFileIcon(row.originalName, row.contentType)}</div>
                        <input
                          type="text"
                          value={row.rename}
                          onChange={(e) => setAttRename(row.id, e.target.value)}
                          disabled={!row.checked}
                          className="flex-1 min-w-0 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                          placeholder={row.originalName}
                        />
                        {row.size !== null && (
                          <span className="text-[9px] text-[var(--text-muted)] font-mono shrink-0 w-16 text-right">
                            {formatSize(row.size)}
                          </span>
                        )}
                        {row.isManuallyRenamed && (
                          <button
                            onClick={() => resetAttRename(row.id)}
                            title="Reset to original filename"
                            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
                          >
                            <RotateCcw size={10} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Hint about extension preservation */}
                <div className="mt-2 text-[10px] text-[var(--text-muted)]">
                  Tip: file extensions are auto-restored on save if you remove them.
                </div>
              </div>

              {/* ── Drive + folder picker ── */}
              <div className="border-t border-[var(--border)] pt-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  Destination
                </div>
                {!selectedDrive ? (
                  <>
                    <div className="text-[11px] text-[var(--text-muted)] mb-2">Select a Shared Drive:</div>
                    {loadingDrives ? (
                      <div className="text-center py-6 text-[var(--text-muted)] text-[12px]">Loading drives...</div>
                    ) : drives.length === 0 ? (
                      <div className="text-center py-6 text-[var(--text-muted)] text-[12px]">
                        No shared drives found. Make sure the service account has access.
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {drives.map((d) => (
                          <button
                            key={d.id}
                            onClick={() => selectDrive(d)}
                            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-[var(--border)] text-left transition-colors"
                          >
                            <FolderOpen size={16} className="text-[var(--warning)]" />
                            <span className="text-[12px] text-[var(--text-primary)] font-medium">{d.name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1 mb-3 text-[11px] flex-wrap">
                      <button
                        onClick={() => { setSelectedDrive(null); setFolderPath([]); setFolders([]); }}
                        className="text-[var(--info)] hover:underline"
                      >
                        Drives
                      </button>
                      <span className="text-[var(--text-muted)]">/</span>
                      <button
                        onClick={() => navigateToPathIndex(-1)}
                        className="text-[var(--info)] hover:underline"
                      >
                        {selectedDrive.name}
                      </button>
                      {folderPath.map((fp, i) => (
                        <span key={fp.id} className="flex items-center gap-1">
                          <span className="text-[var(--text-muted)]">/</span>
                          <button
                            onClick={() => navigateToPathIndex(i)}
                            className="text-[var(--info)] hover:underline"
                          >
                            {fp.name}
                          </button>
                        </span>
                      ))}
                    </div>

                    {loadingFolders ? (
                      <div className="text-center py-4 text-[var(--text-muted)] text-[12px]">Loading folders...</div>
                    ) : (
                      <div className="space-y-0.5">
                        {folders.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => openFolder(f)}
                            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--border)] text-left transition-colors"
                          >
                            <FolderOpen size={14} className="text-[var(--warning)]" />
                            <span className="text-[12px] text-[var(--text-primary)]">{f.name}</span>
                          </button>
                        ))}
                        <button
                          onClick={async () => {
                            const name = prompt("New folder name:");
                            if (!name?.trim()) return;
                            const parentId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : selectedDrive?.id;
                            try {
                              const res = await fetch("/api/drive", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  action: "create_folder",
                                  folderName: name.trim(),
                                  parentFolderId: parentId,
                                }),
                              });
                              const data = await res.json();
                              if (data.success && data.folder) {
                                setFolders((prev) => [...prev, { id: data.folder.id, name: data.folder.name }]);
                              }
                            } catch (e) { console.error("Create folder failed:", e); }
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--border)] text-left transition-colors border border-dashed border-[var(--border)] mt-1"
                        >
                          <Plus size={14} className="text-[var(--accent)]" />
                          <span className="text-[12px] text-[var(--accent)] font-medium">New Folder</span>
                        </button>
                        {folders.length === 0 && (
                          <div className="text-[11px] text-[var(--text-muted)] py-1">No subfolders yet.</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {uploadResult && (
              <div
                className={`mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] shrink-0 ${
                  uploadResult.startsWith("Error")
                    ? "bg-[rgba(248,81,73,0.1)] text-[var(--danger)]"
                    : "bg-[rgba(74,222,128,0.1)] text-[var(--accent)]"
                }`}
              >
                {uploadResult}
              </div>
            )}

            {(selectedDrive || folderPath.length > 0) && (
              <div className="px-4 py-3 border-t border-[var(--border)] flex justify-between items-center shrink-0">
                <div className="text-[10px] text-[var(--text-muted)]">
                  Saving {checkedCount === 1 ? "1 file" : `${checkedCount} files`} to:{" "}
                  {folderPath.length > 0 ? folderPath.map((p) => p.name).join(" / ") : selectedDrive?.name || "Drive root"}
                </div>
                <button
                  onClick={saveToDrive}
                  disabled={uploading || checkedCount === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold disabled:opacity-50"
                >
                  <ExternalLink size={12} />
                  {uploading ? "Uploading..." : `Save ${checkedCount === 1 ? "file" : `${checkedCount} files`}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preview modal — click any attachment chip to open */}
      <AttachmentPreviewModal target={previewTarget} onClose={() => setPreviewTarget(null)} />
    </div>
  );
}