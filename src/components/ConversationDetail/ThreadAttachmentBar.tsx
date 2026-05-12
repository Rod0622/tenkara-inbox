"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Download, ExternalLink, File, FileText, FolderOpen, Image, Paperclip, Plus, X } from "lucide-react";

export default function ThreadAttachmentBar({ messages }: { messages: any[] }) {
  const messagesWithAttachments = messages.filter((m: any) => m.has_attachments);
  const [allAttachments, setAllAttachments] = useState<{ messageId: string; fromName: string; attachments: any[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // Auto-expand once attachments load — user asked to skip the manual click step.
  const [expanded, setExpanded] = useState(true);
  const [savingToDrive, setSavingToDrive] = useState(false);
  const [driveResult, setDriveResult] = useState<string | null>(null);
  const [downloadingAllThread, setDownloadingAllThread] = useState(false);
  const [showThreadDrivePicker, setShowThreadDrivePicker] = useState(false);
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
    setExpanded(true);
    setDriveResult(null);
    if (messagesWithAttachments.length === 0) return;
    // Kick off the load immediately.
    let cancelled = false;
    (async () => {
      setLoading(true);
      const results: { messageId: string; fromName: string; attachments: any[] }[] = [];
      for (const msg of messagesWithAttachments) {
        if (cancelled) return;
        try {
          const res = await fetch(`/api/attachments?message_id=${msg.id}`);
          const data = await res.json();
          const nonInline = (data.attachments || []).filter((a: any) => !a.isInline);
          if (nonInline.length > 0) {
            results.push({ messageId: msg.id, fromName: msg.from_name || "Unknown", attachments: nonInline });
          }
        } catch (e) { /* skip individual failures */ }
      }
      if (cancelled) return;
      setAllAttachments(results);
      setLoaded(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageIds]);

  // Note: previously the bar hid itself if no message had has_attachments=true.
  // We keep that behavior — no need to render an empty bar.
  if (messagesWithAttachments.length === 0) return null;

  const totalCount = allAttachments.reduce((sum, g) => sum + g.attachments.length, 0);

  // After load: if the API returned ZERO non-inline attachments across every
  // message-with-attachments-flag, that's the "pre-capture" case (e.g. messages
  // synced before the storage migration). Show a helpful explainer instead of
  // a misleading "0 attachments" header.
  const isPreCapture = loaded && totalCount === 0 && messagesWithAttachments.length > 0;

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

  const openThreadDrivePicker = async () => {
    setShowThreadDrivePicker(true);
    setDriveResult(null);
    setThreadFolders([]);
    setThreadFolderPath([]);
    setThreadLoadingFolders(true);
    try {
      const configRes = await fetch("/api/drive?action=config");
      const config = await configRes.json();
      if (config.mode === "direct" && config.folderId) {
        setThreadDefaultFolderId(config.folderId);
        setThreadFolderPath([{ id: config.folderId, name: "Training Files" }]);
        const res = await fetch(`/api/drive?action=folders&folder_id=${config.folderId}`);
        const data = await res.json();
        setThreadFolders(data.folders || []);
      }
    } catch (e) { console.error(e); }
    setThreadLoadingFolders(false);
  };

  const openThreadFolder = async (folder: any) => {
    setThreadFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setThreadLoadingFolders(true);
    try {
      const res = await fetch(`/api/drive?action=folders&folder_id=${folder.id}`);
      const data = await res.json();
      setThreadFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setThreadLoadingFolders(false);
  };

  const navigateThreadPath = async (index: number) => {
    const newPath = index < 0 ? [{ id: threadDefaultFolderId!, name: "Training Files" }] : threadFolderPath.slice(0, index + 1);
    setThreadFolderPath(newPath);
    setThreadLoadingFolders(true);
    try {
      const fId = newPath[newPath.length - 1].id;
      const res = await fetch(`/api/drive?action=folders&folder_id=${fId}`);
      const data = await res.json();
      setThreadFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setThreadLoadingFolders(false);
  };

  const saveAllToDrive = async () => {
    const folderId = threadFolderPath.length > 0 ? threadFolderPath[threadFolderPath.length - 1].id : threadDefaultFolderId;
    if (!folderId) return;
    setSavingToDrive(true);
    setDriveResult(null);
    try {
      let saved = 0;
      for (const group of allAttachments) {
        for (const att of group.attachments) {
          const res = await fetch("/api/drive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "upload_attachment",
              messageId: group.messageId,
              attachmentId: att.id,
              fileName: att.name,
              folderId,
            }),
          });
          const data = await res.json();
          if (data.success) saved++;
        }
      }
      const label = saved === 1 ? "1 file" : `${saved} files`;
      setDriveResult(`Saved ${label} to Drive!`);
      setTimeout(() => { setDriveResult(null); setShowThreadDrivePicker(false); }, 2000);
    } catch (e: any) {
      setDriveResult(`Error: ${e.message}`);
    }
    setSavingToDrive(false);
  };

  // Pre-capture explainer — these messages were flagged has_attachments=true
  // during an earlier sync, before we stored the actual bytes. Direct the user
  // to the Backfill button in Settings.
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
              {savingToDrive ? "Uploading..." : "Save All to Drive"}
            </button>
          </div>

          {/* Attachment list grouped by sender */}
          <div className="space-y-2">
          {allAttachments.map((group) => (
            <div key={group.messageId}>
              <div className="text-[10px] text-[var(--text-muted)] mt-2 mb-1">From {group.fromName}:</div>
              <div className="flex flex-wrap gap-1.5">
                {group.attachments.map((att: any) => (
                  <button
                    key={att.id}
                    onClick={() => downloadAtt(group.messageId, att.id, att.name)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]/30 transition-all text-left"
                  >
                    {getIcon(att.name)}
                    <span className="text-[10px] text-[var(--text-primary)] max-w-[140px] truncate">{att.name}</span>
                    <Download size={9} className="text-[var(--text-muted)]" />
                  </button>
                ))}
              </div>
            </div>
          ))}
          </div>
        </div>
      )}

      {/* Thread Drive Picker Modal */}
      {showThreadDrivePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowThreadDrivePicker(false)}>
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[var(--text-primary)]">Save All Attachments to Drive</div>
                <div className="text-[10px] text-[var(--text-muted)]">{totalCount} file{totalCount !== 1 ? "s" : ""} — choose a folder</div>
              </div>
              <button onClick={() => setShowThreadDrivePicker(false)} className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 max-h-[350px] overflow-y-auto">
              {threadFolderPath.length > 0 && (
                <div className="flex items-center gap-1 mb-3 text-[11px] flex-wrap">
                  {threadFolderPath.map((fp, i) => (
                    <span key={fp.id} className="flex items-center gap-1">
                      {i > 0 && <span className="text-[var(--text-muted)]">/</span>}
                      <button onClick={() => navigateThreadPath(i)} className="text-[var(--info)] hover:underline">{fp.name}</button>
                    </span>
                  ))}
                </div>
              )}
              {threadLoadingFolders ? (
                <div className="text-center py-4 text-[var(--text-muted)] text-[12px]">Loading...</div>
              ) : (
                <div className="space-y-0.5">
                  {threadFolders.map((f) => (
                    <button key={f.id} onClick={() => openThreadFolder(f)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--border)] text-left transition-colors">
                      <FolderOpen size={14} className="text-[var(--warning)]" />
                      <span className="text-[12px] text-[var(--text-primary)]">{f.name}</span>
                    </button>
                  ))}
                  <button onClick={async () => {
                    const name = prompt("New folder name:");
                    if (!name?.trim()) return;
                    const parentId = threadFolderPath.length > 0 ? threadFolderPath[threadFolderPath.length - 1].id : null;
                    if (!parentId) return;
                    try {
                      const res = await fetch("/api/drive", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ action: "create_folder", folderName: name.trim(), parentFolderId: parentId }) });
                      const data = await res.json();
                      if (data.success) setThreadFolders((prev) => [...prev, { id: data.folder.id, name: data.folder.name }]);
                    } catch (e) { console.error(e); }
                  }} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--border)] border border-dashed border-[var(--border)] mt-1">
                    <Plus size={14} className="text-[var(--accent)]" />
                    <span className="text-[12px] text-[var(--accent)] font-medium">New Folder</span>
                  </button>
                </div>
              )}
            </div>
            {driveResult && (
              <div className={`mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] ${driveResult.startsWith("Error") ? "bg-[rgba(248,81,73,0.1)] text-[var(--danger)]" : "bg-[rgba(74,222,128,0.1)] text-[var(--accent)]"}`}>{driveResult}</div>
            )}
            <div className="px-4 py-3 border-t border-[var(--border)] flex justify-between items-center">
              <div className="text-[10px] text-[var(--text-muted)]">Saving to: {threadFolderPath.map((p) => p.name).join(" / ") || "..."}</div>
              <button onClick={saveAllToDrive} disabled={savingToDrive}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold disabled:opacity-50">
                <ExternalLink size={12} /> {savingToDrive ? "Uploading..." : "Save Here"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Message Attachments ─────────────────────────────