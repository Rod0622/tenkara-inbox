"use client";

import { useEffect, useMemo, useState } from "react";
import AttachmentPreviewModal from "@/components/AttachmentPreviewModal";
import {
  ChevronDown, Check, Download, ExternalLink, File, FileText, FolderOpen,
  Image, Paperclip, Plus, X, Edit3, RotateCcw, Eye,
} from "lucide-react";

// One row in the Drive upload modal. Tracks per-attachment checked/rename
// state. `messageId` is needed because the Drive upload API takes both
// messageId and attachmentId (attachments belong to specific messages).
type AttSelection = {
  // Composite key: messageId + attachmentId, since attachmentId may not be
  // globally unique across messages.
  key: string;
  messageId: string;
  attachmentId: string;
  fromName: string;       // who sent the message this attachment came from
  originalName: string;
  rename: string;
  checked: boolean;
  size: number | null;
  contentType: string;
  isManuallyRenamed: boolean;
};

// Split a filename into (base, ext) using the LAST dot as the boundary.
//   "report.final.pdf" → ["report.final", ".pdf"]
//   "archive.tar.gz"   → ["archive.tar", ".gz"]
//   "noext"            → ["noext", ""]
//   ".env"             → [".env", ""]   (leading-dot filenames are not extensions)
function splitNameExt(name: string): [string, string] {
  if (!name) return ["", ""];
  const lastDot = name.lastIndexOf(".");
  if (lastDot <= 0) return [name, ""];
  return [name.slice(0, lastDot), name.slice(lastDot)];
}

// If the user has stripped the extension from their rename, restore it from
// the original name. Comparison is case-insensitive.
function withRestoredExt(rename: string, originalName: string): string {
  const [, ext] = splitNameExt(originalName);
  if (!ext) return rename;
  if (rename.toLowerCase().endsWith(ext.toLowerCase())) return rename;
  return rename + ext;
}

export default function ThreadAttachmentBar({ messages }: { messages: any[] }) {
  const messagesWithAttachments = messages.filter((m: any) => m.has_attachments);
  const [allAttachments, setAllAttachments] = useState<{ messageId: string; fromName: string; attachments: any[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);  // Track whether the API returned any rows AT ALL (inline or not). Used
  // to distinguish "truly missing (pre-capture)" from "only inline images"
  // — the latter is normal for emails with signature logos.
  const [hadAnyRows, setHadAnyRows] = useState(false);
  // Auto-expand once attachments load — user asked to skip the manual click step.
  const [expanded, setExpanded] = useState(true);
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveResult, setDriveResult] = useState<string | null>(null);
  const [previewTarget, setPreviewTarget] = useState<{
    messageId: string;
    attachmentId: string;
    filename: string;
    contentType?: string;
    size?: number;
  } | null>(null);
  const [downloadingAllThread, setDownloadingAllThread] = useState(false);

  // ── Drive picker state ────────────────────────────────
  const [showThreadDrivePicker, setShowThreadDrivePicker] = useState(false);
  // Two-step modal: 1 = pick attachments + rename, 2 = pick destination
  const [modalStep, setModalStep] = useState<1 | 2>(1);
  const [driveSelections, setDriveSelections] = useState<AttSelection[]>([]);
  const [bulkPrefix, setBulkPrefix] = useState("");
  const [bulkFind, setBulkFind] = useState("");
  const [bulkReplace, setBulkReplace] = useState("");
  const [showBulkControls, setShowBulkControls] = useState(false);

  // Drive picker mode: either "direct" (a DEFAULT_FOLDER_ID env var is set,
  // and we land inside that folder) or "picker" (no default — user has to
  // pick a shared drive first, then navigate folders inside it).
  const [driveMode, setDriveMode] = useState<"direct" | "picker" | null>(null);
  const [drives, setDrives] = useState<any[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<any>(null);
  const [loadingDrives, setLoadingDrives] = useState(false);

  const [threadFolders, setThreadFolders] = useState<any[]>([]);
  const [threadFolderPath, setThreadFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [threadLoadingFolders, setThreadLoadingFolders] = useState(false);
  const [threadDefaultFolderId, setThreadDefaultFolderId] = useState<string | null>(null);

  // When the set of attachment-bearing messages changes (i.e. user switched
  // conversations), reset state and auto-load. Previously this only reset
  // and waited for a click; that hid attachments behind an extra step.
  const messageIds = messagesWithAttachments.map((m: any) => m.id).join(",");
  useEffect(() => {
    setAllAttachments([]);
    setLoaded(false);
    setHadAnyRows(false);
    setExpanded(true);
    setDriveResult(null);
    setShowThreadDrivePicker(false);
    if (messagesWithAttachments.length === 0) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const results: { messageId: string; fromName: string; attachments: any[] }[] = [];
      let anyRows = false;
      for (const msg of messagesWithAttachments) {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/attachments?message_id=${msg.id}`);
          const data = await res.json();
          const all = data.attachments || [];
          if (all.length > 0) anyRows = true;
          const nonInline = all.filter((a: any) => !a.isInline);
          if (nonInline.length > 0) {
            results.push({ messageId: msg.id, fromName: msg.from_name || "Unknown", attachments: nonInline });
          }
        } catch (e) { /* skip individual failures */ }
      }
      if (cancelled) return;
      setAllAttachments(results);
      setHadAnyRows(anyRows);
      setLoaded(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageIds]);

  if (messagesWithAttachments.length === 0) return null;

  const totalCount = allAttachments.reduce((sum, g) => sum + g.attachments.length, 0);

  // "Pre-capture" = has_attachments flags set but zero attachment rows.
  // Only claim that for OLD messages: a message synced in the last hour is
  // almost certainly mid-race (sync sets the flag, then uploads the files
  // moments later — and the just-sent case reconciles before uploading).
  // Showing "synced before attachment storage was enabled — run backfill"
  // on a 3-minute-old email is wrong and alarming; within the window we
  // render nothing and the next open picks up the rows.
  const RECENT_MS = 60 * 60 * 1000;
  const newestAttachmentMsgAt = messagesWithAttachments.reduce((max: number, m: any) => {
    const t = m.sent_at ? new Date(m.sent_at).getTime() : 0;
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);
  const withinSyncWindow = newestAttachmentMsgAt > Date.now() - RECENT_MS;
  const isPreCapture = loaded && !hadAnyRows && messagesWithAttachments.length > 0 && !withinSyncWindow;
  const isOnlyInline = loaded && hadAnyRows && totalCount === 0;

  const downloadAtt = async (messageId: string, attId: string, name: string) => {
    try {
      const res = await fetch(`/api/attachments?message_id=${messageId}&attachment_id=${attId}`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = name; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { console.error(e); }
  };

  const getIcon = (name: string) => {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (["jpg","jpeg","png","gif","webp","svg"].includes(ext)) return <Image size={12} className="text-[#BC8CFF]" />;
    if (ext === "pdf") return <FileText size={12} className="text-[var(--danger)]" />;
    if (["doc","docx","txt","rtf"].includes(ext)) return <FileText size={12} className="text-[var(--info)]" />;
    if (["xls","xlsx","csv"].includes(ext)) return <FileText size={12} className="text-[var(--accent)]" />;
    return <File size={12} className="text-[var(--text-secondary)]" />;
  };

  const formatSize = (bytes: number | null) => {
    if (bytes === null || bytes === undefined) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const downloadAllThread = async () => {
    setDownloadingAllThread(true);
    for (const group of allAttachments) {
      for (const att of group.attachments) {
        await downloadAtt(group.messageId, att.id, att.name);
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    setDownloadingAllThread(false);
  };

  // ── Open the unified Drive picker ─────────────────────
  // The thread-level bar always opens with ALL attachments listed and checked.
  // The user can uncheck the ones they don't want.
  const openThreadDrivePicker = async () => {
    const selections: AttSelection[] = [];
    for (const group of allAttachments) {
      for (const att of group.attachments) {
        selections.push({
          key: `${group.messageId}:${att.id}`,
          messageId: group.messageId,
          attachmentId: att.id,
          fromName: group.fromName,
          originalName: att.name,
          rename: att.name,
          checked: true,
          size: typeof att.size === "number" ? att.size : null,
          contentType: att.contentType || "application/octet-stream",
          isManuallyRenamed: false,
        });
      }
    }
    setDriveSelections(selections);
    setBulkPrefix("");
    setBulkFind("");
    setBulkReplace("");
    setShowBulkControls(false);
    setShowThreadDrivePicker(true);
    setModalStep(1);
    setDriveResult(null);
    setThreadFolders([]);
    setThreadFolderPath([]);
    setDriveMode(null);
    setDrives([]);
    setSelectedDrive(null);
    setThreadDefaultFolderId(null);
    // Don't kick off the destination fetch until the user clicks Next →
    // (Step 2). Reduces unnecessary network when user cancels in Step 1.
  };

  // Called when the user clicks "Next →" to move from Step 1 to Step 2.
  // Lazily fetches the drive config + initial folder list / drives list.
  const goToStep2 = async () => {
    setModalStep(2);
    // If we already loaded once (user went back to Step 1 then forward again),
    // skip the network roundtrip.
    if (driveMode) return;
    setThreadLoadingFolders(true);
    try {
      const configRes = await fetch("/api/drive?action=config");
      const config = await configRes.json();
      if (config.mode === "direct" && config.folderId) {
        setDriveMode("direct");
        setThreadDefaultFolderId(config.folderId);
        setThreadFolderPath([{ id: config.folderId, name: config.folderName || "Configured folder" }]);
        const res = await fetch(`/api/drive?action=folders&folder_id=${config.folderId}`);
        const data = await res.json();
        setThreadFolders(data.folders || []);
      } else {
        setDriveMode("picker");
        setLoadingDrives(true);
        const res = await fetch("/api/drive?action=drives");
        const data = await res.json();
        setDrives(data.drives || []);
        setLoadingDrives(false);
      }
    } catch (e) {
      console.error("[ThreadAttachmentBar] destination load failed:", e);
    }
    setThreadLoadingFolders(false);
  };

  // Picker mode: user picks a shared drive at the top level.
  const selectDriveForUpload = async (drive: any) => {
    setSelectedDrive(drive);
    setThreadFolderPath([]);
    setThreadLoadingFolders(true);
    try {
      const res = await fetch(`/api/drive?action=folders&drive_id=${drive.id}`);
      const data = await res.json();
      setThreadFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setThreadLoadingFolders(false);
  };

  const openThreadFolder = async (folder: any) => {
    setThreadFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setThreadLoadingFolders(true);
    try {
      // Pass drive_id only in picker mode (the API supports either form)
      const driveParam = driveMode === "picker" && selectedDrive ? `&drive_id=${selectedDrive.id}` : "";
      const res = await fetch(`/api/drive?action=folders&folder_id=${folder.id}${driveParam}`);
      const data = await res.json();
      setThreadFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setThreadLoadingFolders(false);
  };

  const navigateThreadPath = async (index: number) => {
    // index = -1 means "back to root":
    //   - direct mode: back to the configured folder
    //   - picker mode: back to the drive root
    let newPath: { id: string; name: string }[];
    if (index < 0) {
      if (driveMode === "direct" && threadDefaultFolderId) {
        newPath = [{ id: threadDefaultFolderId, name: "Configured folder" }];
      } else {
        newPath = [];
      }
    } else {
      newPath = threadFolderPath.slice(0, index + 1);
    }
    setThreadFolderPath(newPath);
    setThreadLoadingFolders(true);
    try {
      const fId = newPath[newPath.length - 1]?.id;
      const driveParam = driveMode === "picker" && selectedDrive ? `&drive_id=${selectedDrive.id}` : "";
      if (fId) {
        const res = await fetch(`/api/drive?action=folders&folder_id=${fId}${driveParam}`);
        const data = await res.json();
        setThreadFolders(data.folders || []);
      } else if (driveMode === "picker" && selectedDrive) {
        // Back to drive root in picker mode
        const res = await fetch(`/api/drive?action=folders&drive_id=${selectedDrive.id}`);
        const data = await res.json();
        setThreadFolders(data.folders || []);
      }
    } catch (e) { console.error(e); }
    setThreadLoadingFolders(false);
  };

  // ── Per-attachment selection mutators ─────────────────
  const toggleAttChecked = (key: string) => {
    setDriveSelections((s) => s.map((row) => row.key === key ? { ...row, checked: !row.checked } : row));
  };

  const setAttRename = (key: string, value: string) => {
    setDriveSelections((s) => s.map((row) =>
      row.key === key ? { ...row, rename: value, isManuallyRenamed: true } : row
    ));
  };

  const resetAttRename = (key: string) => {
    setDriveSelections((s) => s.map((row) =>
      row.key === key ? { ...row, rename: row.originalName, isManuallyRenamed: false } : row
    ));
  };

  const checkAll = () => setDriveSelections((s) => s.map((r) => ({ ...r, checked: true })));
  const uncheckAll = () => setDriveSelections((s) => s.map((r) => ({ ...r, checked: false })));

  // ── Bulk rename application ───────────────────────────
  // Applied LIVE as the user types in the bulk-control fields, but ONLY
  // to rows that haven't been manually renamed.
  const applyBulkRename = (prefix: string, find: string, replace: string) => {
    setDriveSelections((s) => s.map((row) => {
      if (row.isManuallyRenamed) return row;
      const [base, ext] = splitNameExt(row.originalName);
      let baseAfter = base;
      if (find) {
        baseAfter = baseAfter.split(find).join(replace);
      }
      const finalBase = prefix + baseAfter;
      return { ...row, rename: finalBase + ext };
    }));
  };

  const onChangeBulkPrefix = (v: string) => { setBulkPrefix(v); applyBulkRename(v, bulkFind, bulkReplace); };
  const onChangeBulkFind = (v: string) => { setBulkFind(v); applyBulkRename(bulkPrefix, v, bulkReplace); };
  const onChangeBulkReplace = (v: string) => { setBulkReplace(v); applyBulkRename(bulkPrefix, bulkFind, v); };

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
    // Resolve destination folder. In direct mode: folder at top of breadcrumb.
    // In picker mode: same, but if no folder was opened yet, fall back to the
    // drive root (which the API treats as null folderId + driveId).
    const folderId = threadFolderPath.length > 0 ? threadFolderPath[threadFolderPath.length - 1].id : threadDefaultFolderId;
    if (!folderId && !(driveMode === "picker" && selectedDrive)) {
      setDriveResult("Error: Choose a destination folder first");
      return;
    }
    const checked = driveSelections.filter((r) => r.checked);
    if (checked.length === 0) {
      setDriveResult("Error: Select at least one file");
      return;
    }
    setSavingToDrive(true);
    setDriveResult(null);
    let saved = 0;
    let failed = 0;
    try {
      for (const row of checked) {
        const finalName = withRestoredExt((row.rename || row.originalName).trim() || row.originalName, row.originalName);
        const body: any = {
          action: "upload_attachment",
          messageId: row.messageId,
          attachmentId: row.attachmentId,
          fileName: finalName,
          folderId,
        };
        // Picker mode also sends driveId so the API can scope the upload
        // to the right shared drive (matches MessageAttachments behavior).
        if (driveMode === "picker" && selectedDrive) {
          body.driveId = selectedDrive.id;
        }
        const res = await fetch("/api/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.success) saved++;
        else { failed++; console.error("Drive upload failed:", data.error); }
      }
      if (failed === 0) {
        const label = saved === 1 ? "1 file" : `${saved} files`;
        setDriveResult(`Saved ${label} to Drive!`);
        setTimeout(() => { setDriveResult(null); setShowThreadDrivePicker(false); }, 2000);
      } else if (saved === 0) {
        setDriveResult(`Error: All ${failed} uploads failed`);
      } else {
        setDriveResult(`Saved ${saved}, ${failed} failed`);
      }
    } catch (e: any) {
      setDriveResult(`Error: ${e.message}`);
    }
    setSavingToDrive(false);
  };

  const checkedCount = driveSelections.filter((r) => r.checked).length;
  const totalSel = driveSelections.length;

  // ── Render ────────────────────────────────────────────
  if (isOnlyInline) {
    return null;
  }

  // Suppressed pre-capture case: no rows yet but the message is recent
  // enough that the sync is likely still uploading. Render nothing rather
  // than an empty "0 attachments" bar; the next open shows the real state.
  if (loaded && !hadAnyRows && withinSyncWindow) {
    return null;
  }

  if (isPreCapture) {
    return (
      <div className="mb-3 rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-4 py-2.5 flex items-center gap-2">
        <Paperclip size={14} className="text-[var(--warning)] shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold text-[var(--text-primary)]">
            {messagesWithAttachments.length} message{messagesWithAttachments.length !== 1 ? "s" : ""} have attachments — not yet captured
          </div>
          <div className="text-[10px] text-[var(--text-secondary)]">
            Synced before attachment storage was enabled. Run Attachment Backfill in Settings → Accounts to fetch them.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-[var(--surface-2)] transition-colors"
      >
        <Paperclip size={14} className="text-[var(--info)]" />
        <span className="text-[12px] font-semibold text-[var(--text-primary)]">
          {loading
            ? `Loading attachments from ${messagesWithAttachments.length} message${messagesWithAttachments.length !== 1 ? "s" : ""}…`
            : `${totalCount} attachment${totalCount !== 1 ? "s" : ""}`}
        </span>
        {driveResult && (
          <span className={`text-[10px] ml-1 ${driveResult.startsWith("Error") ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>
            {driveResult}
          </span>
        )}
        <ChevronDown size={12} className={`ml-auto text-[var(--text-muted)] transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>

      {expanded && loaded && totalCount > 0 && (
        <div className="px-4 pb-3 border-t border-[var(--border)]">
          {/* Action buttons */}
          <div className="flex items-center gap-3 py-2 border-b border-[var(--border)] mb-2">
            <button
              onClick={downloadAllThread}
              disabled={downloadingAllThread}
              className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:text-[#3BC96E] font-semibold transition-colors"
            >
              <Download size={10} />
              {downloadingAllThread ? "Downloading..." : "Download All"}
            </button>
            <button
              onClick={openThreadDrivePicker}
              disabled={savingToDrive}
              className="flex items-center gap-1 text-[10px] text-[var(--info)] hover:text-[#79B8FF] font-semibold transition-colors"
            >
              <ExternalLink size={10} />
              {savingToDrive ? "Uploading..." : "Save to Drive"}
            </button>
          </div>

          {/* Attachment list grouped by sender */}
          <div className="space-y-2">
            {allAttachments.map((group) => (
              <div key={group.messageId}>
                <div className="text-[10px] text-[var(--text-muted)] mt-2 mb-1">From {group.fromName}:</div>
                <div className="flex flex-wrap gap-1.5">
                  {group.attachments.map((att: any) => (
                    <div
                      key={att.id}
                      className="flex items-center bg-[var(--bg)] border border-[var(--border)] rounded-lg overflow-hidden hover:border-[var(--accent)]/30 transition-all"
                      title={`${att.name}\nClick to preview`}
                    >
                      <button
                        onClick={() => setPreviewTarget({
                          messageId: group.messageId,
                          attachmentId: att.id,
                          filename: att.name,
                          contentType: att.contentType,
                          size: att.size,
                        })}
                        className="flex items-center gap-1.5 px-2 py-1 hover:bg-[var(--surface)] transition-colors text-left"
                      >
                        {getIcon(att.name)}
                        <span className="text-[10px] text-[var(--text-primary)] max-w-[140px] truncate">{att.name}</span>
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); downloadAtt(group.messageId, att.id, att.name); }}
                        title="Download"
                        className="px-1.5 py-1 border-l border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] hover:bg-[var(--surface)] transition-colors"
                      >
                        <Download size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Thread Drive Picker Modal — two-step layout.
          Step 1: pick attachments + rename (+ bulk controls)
          Step 2: pick destination (direct mode → folders only;
                  picker mode → drives → folders) */}
      {showThreadDrivePicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowThreadDrivePicker(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[90vh] bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header with step indicator */}
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
              <div>
                <div className="text-sm font-bold text-[var(--text-primary)]">Save to Google Drive</div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5 flex items-center gap-1.5">
                  <span className={modalStep === 1 ? "font-semibold text-[var(--accent)]" : ""}>1. Pick files</span>
                  <span className="text-[var(--text-muted)]">→</span>
                  <span className={modalStep === 2 ? "font-semibold text-[var(--accent)]" : ""}>2. Choose destination</span>
                </div>
              </div>
              <button
                onClick={() => setShowThreadDrivePicker(false)}
                className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center"
              >
                <X size={16} />
              </button>
            </div>

            {/* Step 1: file selection + rename */}
            {modalStep === 1 && (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Files ({checkedCount} of {totalSel})
                  </div>
                  <div className="flex items-center gap-2">
                    {totalSel > 1 && (
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
                {showBulkControls && totalSel > 1 && (
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

                {/* Per-attachment rows, grouped by sender */}
                <div className="space-y-1.5">
                  {(() => {
                    const rendered: React.ReactNode[] = [];
                    let lastFrom: string | null = null;
                    for (const row of driveSelections) {
                      if (row.fromName !== lastFrom) {
                        rendered.push(
                          <div key={`sender-${row.fromName}-${row.key}`} className="text-[10px] text-[var(--text-muted)] mt-2 first:mt-0 mb-0.5">
                            From {row.fromName}:
                          </div>
                        );
                        lastFrom = row.fromName;
                      }
                      rendered.push(
                        <div
                          key={row.key}
                          className={`flex items-center gap-2 px-2 py-2 rounded-lg border transition-colors ${
                            row.checked
                              ? "border-[var(--border)] bg-[var(--bg)]"
                              : "border-[var(--border)]/30 bg-transparent opacity-50"
                          }`}
                        >
                          <button
                            onClick={() => toggleAttChecked(row.key)}
                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                              row.checked
                                ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--bg)]"
                                : "border-[var(--text-muted)]"
                            }`}
                            aria-label={row.checked ? "Uncheck" : "Check"}
                          >
                            {row.checked && <Check size={10} />}
                          </button>
                          <div className="shrink-0">{getIcon(row.originalName)}</div>
                          <input
                            type="text"
                            value={row.rename}
                            onChange={(e) => setAttRename(row.key, e.target.value)}
                            disabled={!row.checked}
                            className="flex-1 min-w-0 px-2 py-1 rounded-md bg-[var(--surface)] border border-[var(--border)] text-[11px] font-mono text-[var(--text-primary)] outline-none focus:border-[var(--accent)] disabled:opacity-50"
                            placeholder={row.originalName}
                          />
                          <button
                            onClick={() => setPreviewTarget({
                              messageId: row.messageId,
                              attachmentId: row.attachmentId,
                              filename: row.originalName,
                              contentType: row.contentType,
                              size: row.size ?? undefined,
                            })}
                            title="Preview this file before saving"
                            className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--info)] hover:bg-[var(--border)] shrink-0"
                          >
                            <Eye size={11} />
                          </button>
                          {row.size !== null && (
                            <span className="text-[9px] text-[var(--text-muted)] font-mono shrink-0 w-16 text-right">
                              {formatSize(row.size)}
                            </span>
                          )}
                          {row.isManuallyRenamed && (
                            <button
                              onClick={() => resetAttRename(row.key)}
                              title="Reset to original filename"
                              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
                            >
                              <RotateCcw size={10} />
                            </button>
                          )}
                        </div>
                      );
                    }
                    return rendered;
                  })()}
                </div>

                <div className="mt-2 text-[10px] text-[var(--text-muted)]">
                  Tip: file extensions are auto-restored on save if you remove them.
                </div>
              </div>
            )}

            {/* Step 2: destination */}
            {modalStep === 2 && (
              <div className="flex-1 overflow-y-auto p-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-muted)] mb-2">
                  Destination
                </div>

                {/* Picker mode: drives list first, then folders after a drive is picked */}
                {driveMode === "picker" && !selectedDrive ? (
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
                            onClick={() => selectDriveForUpload(d)}
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
                    {/* Breadcrumbs */}
                    <div className="flex items-center gap-1 mb-3 text-[11px] flex-wrap">
                      {driveMode === "picker" && selectedDrive && (
                        <>
                          <button
                            onClick={() => { setSelectedDrive(null); setThreadFolderPath([]); setThreadFolders([]); }}
                            className="text-[var(--info)] hover:underline"
                          >
                            Drives
                          </button>
                          <span className="text-[var(--text-muted)]">/</span>
                          <button
                            onClick={() => navigateThreadPath(-1)}
                            className="text-[var(--info)] hover:underline"
                          >
                            {selectedDrive.name}
                          </button>
                        </>
                      )}
                      {threadFolderPath.map((fp, i) => (
                        <span key={fp.id} className="flex items-center gap-1">
                          {(i > 0 || (driveMode === "picker" && selectedDrive)) && <span className="text-[var(--text-muted)]">/</span>}
                          <button onClick={() => navigateThreadPath(i)} className="text-[var(--info)] hover:underline">{fp.name}</button>
                        </span>
                      ))}
                    </div>

                    {threadLoadingFolders ? (
                      <div className="text-center py-4 text-[var(--text-muted)] text-[12px]">Loading folders...</div>
                    ) : (
                      <div className="space-y-0.5">
                        {threadFolders.map((f) => (
                          <button
                            key={f.id}
                            onClick={() => openThreadFolder(f)}
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
                            const parentId = threadFolderPath.length > 0
                              ? threadFolderPath[threadFolderPath.length - 1].id
                              : (driveMode === "picker" && selectedDrive ? selectedDrive.id : null);
                            if (!parentId) return;
                            try {
                              const res = await fetch("/api/drive", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ action: "create_folder", folderName: name.trim(), parentFolderId: parentId }),
                              });
                              const data = await res.json();
                              if (data.success) setThreadFolders((prev) => [...prev, { id: data.folder.id, name: data.folder.name }]);
                            } catch (e) { console.error(e); }
                          }}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--border)] border border-dashed border-[var(--border)] mt-1"
                        >
                          <Plus size={14} className="text-[var(--accent)]" />
                          <span className="text-[12px] text-[var(--accent)] font-medium">New Folder</span>
                        </button>
                        {threadFolders.length === 0 && !threadLoadingFolders && (
                          <div className="text-[11px] text-[var(--text-muted)] py-1">No subfolders here yet.</div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {driveResult && (
              <div className={`mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] shrink-0 ${driveResult.startsWith("Error") ? "bg-[rgba(248,81,73,0.1)] text-[var(--danger)]" : "bg-[rgba(74,222,128,0.1)] text-[var(--accent)]"}`}>
                {driveResult}
              </div>
            )}

            {/* Footer with step-specific buttons */}
            <div className="px-4 py-3 border-t border-[var(--border)] flex justify-between items-center shrink-0 gap-3">
              {modalStep === 1 ? (
                <>
                  <button
                    onClick={() => setShowThreadDrivePicker(false)}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-3 py-1.5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={goToStep2}
                    disabled={checkedCount === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold disabled:opacity-50"
                  >
                    Next: Choose folder →
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setModalStep(1)}
                    className="text-[11px] text-[var(--text-muted)] hover:text-[var(--text-primary)] px-3 py-1.5"
                  >
                    ← Back
                  </button>
                  <div className="text-[10px] text-[var(--text-muted)] flex-1 text-right pr-2 truncate">
                    {(() => {
                      const parts: string[] = [];
                      if (driveMode === "picker" && selectedDrive) parts.push(selectedDrive.name);
                      parts.push(...threadFolderPath.map((p) => p.name));
                      const dest = parts.length > 0 ? parts.join(" / ") : "(no folder picked)";
                      return `Saving ${checkedCount === 1 ? "1 file" : `${checkedCount} files`} to: ${dest}`;
                    })()}
                  </div>
                  <button
                    onClick={saveToDrive}
                    disabled={
                      savingToDrive ||
                      checkedCount === 0 ||
                      (driveMode === "picker" && !selectedDrive) ||
                      (threadFolderPath.length === 0 && !(driveMode === "picker" && selectedDrive))
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold disabled:opacity-50"
                  >
                    <ExternalLink size={12} />
                    {savingToDrive ? "Uploading..." : `Save ${checkedCount === 1 ? "file" : `${checkedCount} files`}`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Preview modal — shared between thread-bar chips and Drive picker rows */}
      <AttachmentPreviewModal target={previewTarget} onClose={() => setPreviewTarget(null)} />
    </div>
  );
}