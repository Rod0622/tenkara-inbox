"use client";

import { useState, useRef } from "react";
import { X, Send, ChevronDown, Paperclip, File, Trash2, FolderOpen } from "lucide-react";
import { useActions, useEmailAccounts } from "@/lib/hooks";
import RichTextEditor, { getCleanHtml, htmlToPlainText } from "@/components/RichTextEditor";

interface AttachmentFile {
  name: string;
  size: number;
  type: string;
  data: string; // base64
}

interface ComposeEmailProps {
  onClose: () => void;
  onSent?: () => void;
}

export default function ComposeEmail({ onClose, onSent }: ComposeEmailProps) {
  const accounts = useEmailAccounts();
  const { sendEmail } = useActions();

  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [to, setTo] = useState<string[]>([]);
  const [toInput, setToInput] = useState("");
  const [cc, setCc] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState("");
  const [bcc, setBcc] = useState<string[]>([]);
  const [bccInput, setBccInput] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const [showDriveModal, setShowDriveModal] = useState(false);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [templates, setTemplates] = useState<any[]>([]);
  const [driveFolders, setDriveFolders] = useState<any[]>([]);
  const [driveFiles, setDriveFiles] = useState<any[]>([]);
  const [drivePath, setDrivePath] = useState<{ id: string; name: string }[]>([]);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveDefaultFolder, setDriveDefaultFolder] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const accountId = selectedAccount || accounts[0]?.id || "";
  const currentAccount = accounts.find((a) => a.id === accountId);
  const accountSignature = currentAccount?.signature_enabled ? currentAccount?.signature : "";

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newAttachments: AttachmentFile[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 25 * 1024 * 1024) {
        setError(`File "${file.name}" is too large (max 25MB)`);
        continue;
      }
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(",")[1]); // strip data:...;base64, prefix
        };
        reader.readAsDataURL(file);
      });
      newAttachments.push({ name: file.name, size: file.size, type: file.type || "application/octet-stream", data });
    }
    setAttachments((prev) => [...prev, ...newAttachments]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const openTemplatePicker = async () => {
    setShowTemplateModal(true);
    if (templates.length === 0) {
      const { createBrowserClient } = await import("@/lib/supabase");
      const sb = createBrowserClient();
      const { data } = await sb.from("email_templates").select("*").eq("is_active", true).order("scope").order("sort_order");
      setTemplates(data || []);
    }
  };

  const insertTemplate = (tpl: any) => {
    if (tpl.subject && !subject) setSubject(tpl.subject);
    setBodyHtml(tpl.body);
    setShowTemplateModal(false);
  };

  const openDrivePicker = async () => {
    setShowDriveModal(true);
    setDriveFolders([]);
    setDriveFiles([]);
    setDrivePath([]);
    setDriveLoading(true);
    try {
      const configRes = await fetch("/api/drive?action=config");
      const config = await configRes.json();
      if (config.mode === "direct" && config.folderId) {
        setDriveDefaultFolder(config.folderId);
        setDrivePath([{ id: config.folderId, name: "Training Files" }]);
        const [foldersRes, filesRes] = await Promise.all([
          fetch(`/api/drive?action=folders&folder_id=${config.folderId}`),
          fetch(`/api/drive?action=files&folder_id=${config.folderId}`),
        ]);
        const foldersData = await foldersRes.json();
        const filesData = await filesRes.json();
        setDriveFolders(foldersData.folders || []);
        setDriveFiles(filesData.files || []);
      }
    } catch (e) { console.error(e); }
    setDriveLoading(false);
  };

  const navigateDriveFolder = async (folder: any) => {
    setDrivePath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setDriveLoading(true);
    try {
      const [foldersRes, filesRes] = await Promise.all([
        fetch(`/api/drive?action=folders&folder_id=${folder.id}`),
        fetch(`/api/drive?action=files&folder_id=${folder.id}`),
      ]);
      const foldersData = await foldersRes.json();
      const filesData = await filesRes.json();
      setDriveFolders(foldersData.folders || []);
      setDriveFiles(filesData.files || []);
    } catch (e) { console.error(e); }
    setDriveLoading(false);
  };

  const navigateDrivePath = async (index: number) => {
    const newPath = index < 0 ? [{ id: driveDefaultFolder!, name: "Training Files" }] : drivePath.slice(0, index + 1);
    setDrivePath(newPath);
    setDriveLoading(true);
    try {
      const fId = newPath[newPath.length - 1].id;
      const [foldersRes, filesRes] = await Promise.all([
        fetch(`/api/drive?action=folders&folder_id=${fId}`),
        fetch(`/api/drive?action=files&folder_id=${fId}`),
      ]);
      setDriveFolders((await foldersRes.json()).folders || []);
      setDriveFiles((await filesRes.json()).files || []);
    } catch (e) { console.error(e); }
    setDriveLoading(false);
  };

  const attachDriveFile = async (file: any) => {
    // Download file content via Drive API and add as attachment
    try {
      const res = await fetch(`/api/drive?action=download&file_id=${file.id}`);
      if (!res.ok) { setError("Failed to download from Drive"); return; }
      const blob = await res.blob();
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]);
        reader.readAsDataURL(blob);
      });
      setAttachments((prev) => [...prev, {
        name: file.name, size: file.size || 0,
        type: file.mimeType || "application/octet-stream", data,
      }]);
    } catch (e) { setError("Failed to attach file from Drive"); }
  };

  const handleSend = async () => {
    const plainText = htmlToPlainText(bodyHtml);
    const allTo = [...to, ...(toInput.trim() ? [toInput.trim()] : [])];
    const allCc = [...cc, ...(ccInput.trim() ? [ccInput.trim()] : [])];
    const allBcc = [...bcc, ...(bccInput.trim() ? [bccInput.trim()] : [])];

    if (allTo.length === 0 || !subject.trim() || !plainText.trim()) {
      setError("Please fill in To, Subject, and Body");
      return;
    }
    if (!accountId) {
      setError("Please select an email account");
      return;
    }

    // Check for missing attachments
    const bodyLower = plainText.toLowerCase();
    const attachmentKeywords = [
      "attached", "attachment", "attachments", "attaching", "enclosed", "enclosing",
      "find attached", "see attached", "please find", "i have attached", "i've attached",
      "sending you the file", "here is the file", "here are the files",
    ];
    const imageKeywords = ["image", "images", "photo", "photos", "picture", "pictures", "screenshot", "screenshots"];
    const infoKeywords = ["my address", "our address", "my phone", "our phone", "phone number", "contact number", "my number"];
    if (attachments.length === 0) {
      const matchedAtt = attachmentKeywords.find(kw => bodyLower.includes(kw));
      const matchedImg = !matchedAtt ? imageKeywords.find(kw => bodyLower.includes(kw)) : null;
      const matchedInfo = !matchedAtt && !matchedImg ? infoKeywords.find(kw => bodyLower.includes(kw)) : null;
      const matched = matchedAtt || matchedImg || matchedInfo;
      if (matched) {
        const msg = matchedInfo
          ? `Your message mentions "${matched}" — did you include the details?`
          : `Your message mentions "${matched}" but no files are attached.`;
        if (!confirm(msg + "\n\nSend anyway?")) return;
      }
    }

    setSending(true);
    setError("");

    try {
      const cleanHtml = getCleanHtml(bodyHtml);
      const result = await sendEmail({
        account_id: accountId,
        to: allTo.join(", "),
        cc: allCc.length > 0 ? allCc.join(", ") : undefined,
        bcc: allBcc.length > 0 ? allBcc.join(", ") : undefined,
        subject: subject.trim(),
        body: cleanHtml,
        attachments: attachments.length > 0 ? attachments : undefined,
      });

      if (result.error) {
        setError(result.error);
        setSending(false);
        return;
      }

      onSent?.();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to send");
      setSending(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[#0B0E11] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[#1E242C] flex items-center justify-between">
        <div className="text-base font-bold text-[#E6EDF3] tracking-tight">
          New Email
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSend}
            disabled={sending || (to.length === 0 && !toInput.trim()) || !subject.trim()}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-bold transition-all ${
              !sending && (to.length > 0 || toInput.trim()) && subject.trim()
                ? "bg-[#4ADE80] text-[#0B0E11] hover:bg-[#3FCF73] active:scale-[0.98]"
                : "bg-[#1E242C] text-[#484F58] cursor-not-allowed"
            }`}
          >
            <Send size={14} />
            {sending ? "Sending..." : "Send"}
          </button>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-md text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C] flex items-center justify-center transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-[rgba(248,81,73,0.1)] border border-[rgba(248,81,73,0.2)] text-[#F85149] text-[12px]">
            {error}
          </div>
        )}

        {/* From */}
        <div className="px-5 py-2.5 border-b border-[#161B22] flex items-center gap-3">
          <span className="text-[12px] font-semibold text-[#484F58] w-12 shrink-0">From</span>
          <div className="relative flex-1">
            <button
              ref={(el) => { (el as any)?.__btnRef && delete (el as any).__btnRef; if (el) (el as any).__btnRef = el; }}
              onClick={() => setShowAccountPicker(!showAccountPicker)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#12161B] text-[12px] text-[#E6EDF3] hover:bg-[#181D24] transition-all w-full"
            >
              <span className="text-[14px]">{currentAccount?.icon || "📬"}</span>
              <span className="flex-1 text-left truncate">
                {currentAccount?.email || "Select account..."}
              </span>
              <ChevronDown size={12} className="text-[#484F58]" />
            </button>
            {showAccountPicker && (
              <>
                <div className="fixed inset-0 z-[60]" onClick={() => setShowAccountPicker(false)} />
                <div className="fixed z-[61] bg-[#161B22] border border-[#1E242C] rounded-lg shadow-xl py-1"
                  style={{ width: 320 }}
                  ref={(el) => {
                    if (!el) return;
                    const btn = el.parentElement?.querySelector("button");
                    if (btn) {
                      const rect = btn.getBoundingClientRect();
                      el.style.top = (rect.bottom + 4) + "px";
                      el.style.left = rect.left + "px";
                    }
                  }}
                >
                  {accounts.map((acc) => (
                    <button
                      key={acc.id}
                      onClick={() => { setSelectedAccount(acc.id); setShowAccountPicker(false); }}
                      className={`flex items-center gap-2 w-full px-3 py-2 text-[12px] hover:bg-[#1E242C] transition-colors ${
                        acc.id === accountId ? "text-[#4ADE80]" : "text-[#E6EDF3]"
                      }`}
                    >
                      <span className="text-[14px]">{acc.icon || "📬"}</span>
                      <div className="flex-1 text-left">
                        <div className="font-medium">{acc.name}</div>
                        <div className="text-[10px] text-[#484F58]">{acc.email}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* To — tag style */}
        <div className="px-5 py-2 border-b border-[#161B22] flex items-center gap-3">
          <span className="text-[12px] font-semibold text-[#484F58] w-12 shrink-0">To</span>
          <div className="flex-1 flex flex-wrap items-center gap-1">
            {to.map((email, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1E242C] text-[11px] text-[#E6EDF3]">
                {email}
                <button onClick={() => setTo((prev) => prev.filter((_, j) => j !== i))} className="text-[#484F58] hover:text-[#F85149]">
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === "," || e.key === "Tab") && toInput.trim()) {
                  e.preventDefault();
                  const email = toInput.trim().replace(/,$/, "");
                  if (email && !to.includes(email)) setTo((prev) => [...prev, email]);
                  setToInput("");
                }
                if (e.key === "Backspace" && !toInput && to.length > 0) {
                  setTo((prev) => prev.slice(0, -1));
                }
              }}
              onBlur={() => {
                if (toInput.trim()) {
                  const email = toInput.trim().replace(/,$/, "");
                  if (email && !to.includes(email)) setTo((prev) => [...prev, email]);
                  setToInput("");
                }
              }}
              placeholder={to.length === 0 ? "recipient@example.com" : "Add another..."}
              className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] placeholder:text-[#484F58]"
            />
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!showCc && (
              <button onClick={() => setShowCc(true)} className="text-[11px] text-[#484F58] hover:text-[#7D8590]">Cc</button>
            )}
            {!showBcc && (
              <button onClick={() => setShowBcc(true)} className="text-[11px] text-[#484F58] hover:text-[#7D8590]">Bcc</button>
            )}
          </div>
        </div>

        {/* CC — tag style */}
        {showCc && (
          <div className="px-5 py-2 border-b border-[#161B22] flex items-center gap-3">
            <span className="text-[12px] font-semibold text-[#484F58] w-12 shrink-0">Cc</span>
            <div className="flex-1 flex flex-wrap items-center gap-1">
              {cc.map((email, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1E242C] text-[11px] text-[#E6EDF3]">
                  {email}
                  <button onClick={() => setCc((prev) => prev.filter((_, j) => j !== i))} className="text-[#484F58] hover:text-[#F85149]"><X size={10} /></button>
                </span>
              ))}
              <input
                value={ccInput}
                onChange={(e) => setCcInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === "," || e.key === "Tab") && ccInput.trim()) {
                    e.preventDefault();
                    const email = ccInput.trim().replace(/,$/, "");
                    if (email && !cc.includes(email)) setCc((prev) => [...prev, email]);
                    setCcInput("");
                  }
                  if (e.key === "Backspace" && !ccInput && cc.length > 0) setCc((prev) => prev.slice(0, -1));
                }}
                onBlur={() => { if (ccInput.trim()) { const e = ccInput.trim().replace(/,$/, ""); if (e && !cc.includes(e)) setCc((prev) => [...prev, e]); setCcInput(""); }}}
                placeholder="cc@example.com"
                className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] placeholder:text-[#484F58]"
              />
            </div>
          </div>
        )}

        {/* BCC — tag style */}
        {showBcc && (
          <div className="px-5 py-2 border-b border-[#161B22] flex items-center gap-3">
            <span className="text-[12px] font-semibold text-[#484F58] w-12 shrink-0">Bcc</span>
            <div className="flex-1 flex flex-wrap items-center gap-1">
              {bcc.map((email, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#1E242C] text-[11px] text-[#E6EDF3]">
                  {email}
                  <button onClick={() => setBcc((prev) => prev.filter((_, j) => j !== i))} className="text-[#484F58] hover:text-[#F85149]"><X size={10} /></button>
                </span>
              ))}
              <input
                value={bccInput}
                onChange={(e) => setBccInput(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.key === "Enter" || e.key === "," || e.key === "Tab") && bccInput.trim()) {
                    e.preventDefault();
                    const email = bccInput.trim().replace(/,$/, "");
                    if (email && !bcc.includes(email)) setBcc((prev) => [...prev, email]);
                    setBccInput("");
                  }
                  if (e.key === "Backspace" && !bccInput && bcc.length > 0) setBcc((prev) => prev.slice(0, -1));
                }}
                onBlur={() => { if (bccInput.trim()) { const e = bccInput.trim().replace(/,$/, ""); if (e && !bcc.includes(e)) setBcc((prev) => [...prev, e]); setBccInput(""); }}}
                placeholder="bcc@example.com"
                className="flex-1 min-w-[120px] bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] placeholder:text-[#484F58]"
              />
            </div>
          </div>
        )}

        {/* Subject */}
        <div className="px-5 py-2.5 border-b border-[#161B22] flex items-center gap-3">
          <span className="text-[12px] font-semibold text-[#484F58] w-12 shrink-0">Subject</span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject"
            className="flex-1 bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] placeholder:text-[#484F58]"
          />
        </div>

        {/* Rich Text Body */}
        <div className="px-5 py-3">
          <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
          <RichTextEditor
            value={bodyHtml}
            onChange={setBodyHtml}
            placeholder="Write your message..."
            minHeight={300}
            autoFocus
            signature={accountSignature}
            onAttach={() => fileInputRef.current?.click()}
            onDrive={() => openDrivePicker()}
            onTemplate={() => openTemplatePicker()}
          />
        </div>

        {/* Attachments list */}
        {attachments.length > 0 && (
          <div className="px-5 pb-3">
            <div className="flex flex-wrap gap-2">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-[11px]">
                  <File size={12} className="text-[#58A6FF] shrink-0" />
                  <span className="text-[#E6EDF3] max-w-[150px] truncate">{att.name}</span>
                  <span className="text-[#484F58]">{formatSize(att.size)}</span>
                  <button onClick={() => removeAttachment(i)} className="text-[#484F58] hover:text-[#F85149] transition-colors ml-0.5">
                    <X size={11} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Template Picker Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowTemplateModal(false)}>
          <div className="w-full max-w-lg bg-[#12161B] border border-[#1E242C] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[#1E242C] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[#E6EDF3]">Insert Template</div>
                <div className="text-[10px] text-[#484F58]">Click a template to insert it</div>
              </div>
              <button onClick={() => setShowTemplateModal(false)} className="w-7 h-7 rounded-md text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C] flex items-center justify-center">
                <X size={16} />
              </button>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              {templates.length === 0 ? (
                <div className="text-center py-8 text-[#484F58] text-[12px]">No templates yet. Create them in Settings.</div>
              ) : (
                <div className="p-2 space-y-0.5">
                  {["organization", "personal"].map((scope) => {
                    const scopeTemplates = templates.filter((t) => t.scope === scope);
                    if (scopeTemplates.length === 0) return null;
                    return (
                      <div key={scope}>
                        <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-widest px-3 pt-2 pb-1">
                          {scope === "organization" ? "🏢 Organization" : "👤 Personal"}
                        </div>
                        {scopeTemplates.map((tpl) => (
                          <button key={tpl.id} onClick={() => insertTemplate(tpl)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-[#1E242C] text-left transition-colors">
                            <div className="flex-1 min-w-0">
                              <div className="text-[12px] font-semibold text-[#E6EDF3]">{tpl.name}</div>
                              {tpl.subject && <div className="text-[10px] text-[#484F58] truncate">Subject: {tpl.subject}</div>}
                              <div className="text-[10px] text-[#484F58] truncate mt-0.5">
                                {tpl.body.replace(/<[^>]*>/g, "").slice(0, 80)}...
                              </div>
                            </div>
                            {tpl.category && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] bg-[rgba(88,166,255,0.12)] text-[#58A6FF] shrink-0">{tpl.category}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Drive Picker Modal */}
      {showDriveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowDriveModal(false)}>
          <div className="w-full max-w-md bg-[#12161B] border border-[#1E242C] rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-[#1E242C] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold text-[#E6EDF3]">Insert from Google Drive</div>
                <div className="text-[10px] text-[#484F58]">Click a file to attach it</div>
              </div>
              <button onClick={() => setShowDriveModal(false)} className="w-7 h-7 rounded-md text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#1E242C] flex items-center justify-center">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 max-h-[400px] overflow-y-auto">
              {drivePath.length > 0 && (
                <div className="flex items-center gap-1 mb-3 text-[11px] flex-wrap">
                  {drivePath.map((fp, i) => (
                    <span key={fp.id} className="flex items-center gap-1">
                      {i > 0 && <span className="text-[#484F58]">/</span>}
                      <button onClick={() => navigateDrivePath(i)} className="text-[#58A6FF] hover:underline">{fp.name}</button>
                    </span>
                  ))}
                </div>
              )}
              {driveLoading ? (
                <div className="text-center py-6 text-[#484F58] text-[12px]">Loading...</div>
              ) : (
                <div className="space-y-0.5">
                  {driveFolders.map((f) => (
                    <button key={f.id} onClick={() => navigateDriveFolder(f)}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[#1E242C] text-left transition-colors">
                      <FolderOpen size={14} className="text-[#F0883E]" />
                      <span className="text-[12px] text-[#E6EDF3]">{f.name}</span>
                    </button>
                  ))}
                  {driveFiles.map((f) => (
                    <button key={f.id} onClick={() => { attachDriveFile(f); setShowDriveModal(false); }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-[rgba(74,222,128,0.08)] text-left transition-colors">
                      <File size={14} className="text-[#58A6FF]" />
                      <span className="text-[12px] text-[#E6EDF3] flex-1 truncate">{f.name}</span>
                      <span className="text-[10px] text-[#484F58]">{f.size ? formatSize(f.size) : ""}</span>
                    </button>
                  ))}
                  {driveFolders.length === 0 && driveFiles.length === 0 && (
                    <div className="text-[11px] text-[#484F58] py-4 text-center">No files in this folder</div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}