"use client";

import { useEffect, useState } from "react";
import { Archive, Check, Download, ExternalLink, File, FileText, FolderOpen, Image, Paperclip, Plus, X } from "lucide-react";

export default function MessageAttachments({ messageId }: { messageId: string }) {
  const [attachments, setAttachments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);
  // Drive state
  const [showDrivePicker, setShowDrivePicker] = useState(false);
  const [driveAction, setDriveAction] = useState<{ type: "single" | "all"; attId?: string; attName?: string } | null>(null);
  const [drives, setDrives] = useState<any[]>([]);
  const [selectedDrive, setSelectedDrive] = useState<any>(null);
  const [folders, setFolders] = useState<any[]>([]);
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [loadingDrives, setLoadingDrives] = useState(false);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<string | null>(null);

  // Reset when switching messages
  useEffect(() => {
    setAttachments([]);
    setLoaded(false);
    setShowDrivePicker(false);
    setUploadResult(null);
  }, [messageId]);

  const loadAttachments = async () => {
    if (loaded) return;
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
        // Download each file individually
        for (const att of data.attachments) {
          const bytes = Uint8Array.from(atob(att.data), (c) => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: att.contentType || "application/octet-stream" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = att.name;
          a.click();
          URL.revokeObjectURL(url);
          // Small delay between downloads
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

  // Drive functions
  const openDrivePicker = async (type: "single" | "all", attId?: string, attName?: string) => {
    setDriveAction({ type, attId, attName });
    setUploadResult(null);
    setShowDrivePicker(true);
    setFolders([]);
    setFolderPath([]);
    setSelectedDrive(null);
    setLoadingFolders(true);

    try {
      // Check if there's a default folder configured
      const configRes = await fetch("/api/drive?action=config");
      const config = await configRes.json();

      if (config.mode === "direct" && config.folderId) {
        // Start inside the configured folder
        setSelectedDrive({ id: "configured", name: "Shared Drive" });
        setFolderPath([{ id: config.folderId, name: "Training Files" }]);
        const res = await fetch(`/api/drive?action=folders&folder_id=${config.folderId}`);
        const data = await res.json();
        setFolders(data.folders || []);
      } else {
        // Load drives
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
      const res = await fetch(`/api/drive?action=folders&drive_id=${selectedDrive?.id}&folder_id=${folder.id}`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setLoadingFolders(false);
  };

  const navigateToPathIndex = async (index: number) => {
    if (index < 0) {
      // Back to drive root
      setFolderPath([]);
      await selectDrive(selectedDrive);
      return;
    }
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);
    setLoadingFolders(true);
    try {
      const fId = newPath[newPath.length - 1].id;
      const res = await fetch(`/api/drive?action=folders&drive_id=${selectedDrive?.id}&folder_id=${fId}`);
      const data = await res.json();
      setFolders(data.folders || []);
    } catch (e) { console.error(e); }
    setLoadingFolders(false);
  };

  const saveToDrive = async () => {
    if (!driveAction || !selectedDrive) return;
    setUploading(true);
    setUploadResult(null);
    const targetFolderId = folderPath.length > 0 ? folderPath[folderPath.length - 1].id : null;

    try {
      if (driveAction.type === "single" && driveAction.attId) {
        const res = await fetch("/api/drive", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "upload_attachment",
            messageId, attachmentId: driveAction.attId,
            fileName: driveAction.attName || "attachment",
            folderId: targetFolderId, driveId: selectedDrive.id,
          }),
        });
        const data = await res.json();
        if (data.success) { setUploadResult("Saved to Drive!"); }
        else { setUploadResult(`Error: ${data.error}`); }
      } else if (driveAction.type === "all") {
        const downloadable = attachments.filter((a: any) => !a.isInline);
        let saved = 0;
        for (const att of downloadable) {
          const res = await fetch("/api/drive", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "upload_attachment",
              messageId, attachmentId: att.id,
              fileName: att.name,
              folderId: targetFolderId, driveId: selectedDrive.id,
            }),
          });
          const data = await res.json();
          if (data.success) saved++;
        }
        const label = saved === 1 ? "1 file" : `${saved} files`;
        setUploadResult(`Saved ${label} to Drive!`);
      }
    } catch (e: any) {
      setUploadResult(`Error: ${e.message}`);
    }
    setUploading(false);
  };

  // Compute non-inline attachments for display
  const visibleAttachments = loaded ? attachments.filter((a: any) => !a.isInline) : [];

  return (
    <div className="mt-3">
      {!loaded ? (
        <button
          onClick={loadAttachments}
          disabled={loading}
          className="flex items-center gap-1.5 text-[11px] text-[var(--info)] hover:text-[#79B8FF] transition-colors"
        >
          <Paperclip size={12} />
          {loading ? "Loading attachments..." : "Show attachments"}
        </button>
      ) : visibleAttachments.length === 0 ? (
        <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1">
          <Paperclip size={11} /> No downloadable attachments
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--text-muted)] font-semibold flex items-center gap-1">
              <Paperclip size={11} /> {visibleAttachments.length} attachment{visibleAttachments.length !== 1 ? "s" : ""}
              {uploading && <span className="text-[10px] text-[var(--info)] ml-2">Uploading to Drive...</span>}
              {uploadResult && !showDrivePicker && (
                <span className={`text-[10px] ml-2 ${uploadResult.startsWith("Error") ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>
                  {uploadResult}
                </span>
              )}
            </span>
            {visibleAttachments.length > 1 && (
              <div className="flex gap-2">
                <button
                  onClick={() => openDrivePicker("all")}
                  className="flex items-center gap-1 text-[10px] text-[var(--info)] hover:text-[#79B8FF] font-semibold transition-colors"
                >
                  <ExternalLink size={10} />
                  Save All to Drive
                </button>
                <button
                  onClick={downloadAllAttachments}
                  disabled={downloadingAll}
                  className="flex items-center gap-1 text-[10px] text-[var(--accent)] hover:text-[#3BC96E] font-semibold transition-colors"
                >
                  <Download size={10} />
                  {downloadingAll ? "Downloading..." : "Download All"}
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {visibleAttachments.map((att: any) => (
              <div key={att.id} className="flex items-center gap-1">
                <button
                  onClick={() => downloadAttachment(att.id, att.name)}
                  disabled={downloading === att.id}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]/30 hover:bg-[var(--surface)] transition-all group"
                >
                  {getFileIcon(att.name, att.contentType)}
                  <span className="text-[11px] text-[var(--text-primary)] max-w-[150px] truncate">{att.name}</span>
                  <span className="text-[9px] text-[var(--text-muted)]">{formatSize(att.size)}</span>
                  <Download size={10} className="text-[var(--text-muted)] group-hover:text-[var(--accent)] transition-colors" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); openDrivePicker("single", att.id, att.name); }}
                  title="Save to Google Drive"
                  className="w-7 h-7 rounded-lg bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--info)]/30 flex items-center justify-center transition-all"
                >
                  <ExternalLink size={10} className="text-[var(--text-muted)] hover:text-[var(--info)]" />
                </button>
              </div>
            ))}
          </div>
        </div>
        )}

      {/* Drive Picker Modal */}
      {showDrivePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDrivePicker(false)}>
          <div className="w-full max-w-md bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[var(--text-primary)]">
                  {driveAction?.type === "all" ? "Save All to Google Drive" : `Save "${driveAction?.attName}" to Drive`}
                </div>
                <div className="text-[10px] text-[var(--text-muted)]">Choose a shared drive and folder</div>
              </div>
              <button onClick={() => setShowDrivePicker(false)} className="w-7 h-7 rounded-md text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--border)] flex items-center justify-center">
                <X size={16} />
              </button>
            </div>

            <div className="p-4 max-h-[350px] overflow-y-auto">
              {!selectedDrive ? (
                <>
                  <div className="text-[11px] text-[var(--text-muted)] font-semibold mb-2">Select a Shared Drive:</div>
                  {loadingDrives ? (
                    <div className="text-center py-6 text-[var(--text-muted)] text-[12px]">Loading drives...</div>
                  ) : drives.length === 0 ? (
                    <div className="text-center py-6 text-[var(--text-muted)] text-[12px]">No shared drives found. Make sure the service account has access.</div>
                  ) : (
                    <div className="space-y-1">
                      {drives.map((d) => (
                        <button key={d.id} onClick={() => selectDrive(d)}
                          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg hover:bg-[var(--border)] text-left transition-colors">
                          <FolderOpen size={16} className="text-[var(--warning)]" />
                          <span className="text-[12px] text-[var(--text-primary)] font-medium">{d.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Breadcrumb */}
                  <div className="flex items-center gap-1 mb-3 text-[11px] flex-wrap">
                    <button onClick={() => { setSelectedDrive(null); setFolderPath([]); setFolders([]); }}
                      className="text-[var(--info)] hover:underline">Drives</button>
                    <span className="text-[var(--text-muted)]">/</span>
                    <button onClick={() => navigateToPathIndex(-1)}
                      className="text-[var(--info)] hover:underline">{selectedDrive.name}</button>
                    {folderPath.map((fp, i) => (
                      <span key={fp.id} className="flex items-center gap-1">
                        <span className="text-[var(--text-muted)]">/</span>
                        <button onClick={() => navigateToPathIndex(i)}
                          className="text-[var(--info)] hover:underline">{fp.name}</button>
                      </span>
                    ))}
                  </div>

                  {loadingFolders ? (
                    <div className="text-center py-4 text-[var(--text-muted)] text-[12px]">Loading folders...</div>
                  ) : (
                    <div className="space-y-0.5">
                      {folders.map((f) => (
                        <button key={f.id} onClick={() => openFolder(f)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[var(--border)] text-left transition-colors">
                          <FolderOpen size={14} className="text-[var(--warning)]" />
                          <span className="text-[12px] text-[var(--text-primary)]">{f.name}</span>
                        </button>
                      ))}
                      {/* New Folder button */}
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
                              // Add to list and navigate into it
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

            {uploadResult && (
              <div className={`mx-4 mb-2 px-3 py-2 rounded-lg text-[11px] ${
                uploadResult.startsWith("Error") ? "bg-[rgba(248,81,73,0.1)] text-[var(--danger)]" : "bg-[rgba(74,222,128,0.1)] text-[var(--accent)]"
              }`}>
                {uploadResult}
              </div>
            )}

            {(selectedDrive || folderPath.length > 0) && (
              <div className="px-4 py-3 border-t border-[var(--border)] flex justify-between items-center">
                <div className="text-[10px] text-[var(--text-muted)]">
                  Saving to: {folderPath.length > 0 ? folderPath.map((p) => p.name).join(" / ") : selectedDrive?.name || "Drive root"}
                </div>
                <button
                  onClick={saveToDrive}
                  disabled={uploading}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent)] text-[var(--bg)] text-[11px] font-bold disabled:opacity-50"
                >
                  <ExternalLink size={12} />
                  {uploading ? "Uploading..." : "Save Here"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}