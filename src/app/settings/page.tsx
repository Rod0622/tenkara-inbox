"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Mail, Users, Tag, Shield, Plus, Trash2, Edit2,
  CheckCircle, AlertCircle, RefreshCw, Settings as SettingsIcon,
  Globe, Loader2, Eye, EyeOff, X, Zap, GripVertical, ChevronDown,
  FileSignature, Check
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";

const supabase = createBrowserClient();

// ── Provider definitions matching the DB presets ─────
const PROVIDERS = [
  { id: "microsoft_oauth", name: "Microsoft 365 / GoDaddy (Our Company)", icon: "🟠", color: "#D83B01",
    imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 587,
    help: "Connects via Microsoft Graph API. For accounts where we have Azure AD admin access." },
  { id: "microsoft_password", name: "Microsoft 365 / GoDaddy (Client Email)", icon: "🟡", color: "#F0883E",
    imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587,
    help: "Connect using client's email + password. Tries OAuth2 password flow first, then IMAP." },
  { id: "gmail", name: "Gmail or Google Workspace", icon: "🔵", color: "#4285F4",
    imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 587,
    help: "Requires an App Password. Go to myaccount.google.com → Security → 2-Step Verification → App Passwords → Generate one for 'Mail'." },
  { id: "outlook_com", name: "Outlook.com (personal)", icon: "🔷", color: "#0078D4",
    imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587,
    help: "Use your full Outlook.com email as username." },
  { id: "icloud", name: "iCloud", icon: "⚪", color: "#A2AAAD",
    imap_host: "imap.mail.me.com", imap_port: 993, smtp_host: "smtp.mail.me.com", smtp_port: 587,
    help: "Requires an App-Specific Password. Go to appleid.apple.com → Sign-In and Security → App-Specific Passwords." },
  { id: "imap", name: "IMAP (Other)", icon: "⚙️", color: "#7D8590",
    imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 587,
    help: "Enter your email provider's IMAP and SMTP server details manually." },
];

// ── Settings tabs ────────────────────────────────────
const TABS = [
  { id: "accounts", label: "Accounts", icon: Mail },
  { id: "team", label: "Team Members", icon: Users },
  { id: "groups", label: "User Groups", icon: Users },
  { id: "labels", label: "Labels", icon: Tag },
  { id: "rules", label: "Rules", icon: Zap },
  { id: "categories", label: "Task Categories", icon: Tag },
  { id: "templates", label: "Email Templates", icon: FileSignature },
];

// ── Main Settings Page ───────────────────────────────
export default function SettingsPage() {
  const { data: session, status } = useSession();
  const [activeTab, setActiveTab] = useState("accounts");
  const [showConnectModal, setShowConnectModal] = useState(false);

  if (status === "loading") {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
        <Loader2 className="w-8 h-8 animate-spin text-[#4ADE80]" />
      </div>
    );
  }

  if (!session) redirect("/login");

  return (
    <div className="h-screen w-screen flex bg-[#0B0E11] text-[#E6EDF3]">
      {/* Sidebar */}
      <div className="w-[220px] min-w-[220px] border-r border-[#1E242C] flex flex-col">
        <div className="p-4 border-b border-[#1E242C]">
          <Link href="/" className="flex items-center gap-2 text-[#7D8590] hover:text-[#E6EDF3] transition-colors text-sm">
            <ArrowLeft size={16} /> Back to Inbox
          </Link>
        </div>
        <div className="p-3 flex flex-col gap-0.5">
          <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-widest px-3 pb-2">Settings</div>
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all w-full text-left ${
                  activeTab === tab.id ? "bg-[#1E242C] text-[#E6EDF3]" : "text-[#7D8590] hover:bg-[#12161B]"
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "accounts" && <AccountsTab onConnect={() => setShowConnectModal(true)} />}
        {activeTab === "team" && <TeamTab />}
        {activeTab === "groups" && <UserGroupsTab />}
        {activeTab === "labels" && <LabelsTab />}
        {activeTab === "rules" && <RulesTab />}
        {activeTab === "categories" && <TaskCategoriesTab />}
        {activeTab === "templates" && <EmailTemplatesTab />}
      </div>

      {/* Connect Email Modal */}
      {showConnectModal && <ConnectEmailModal onClose={() => setShowConnectModal(false)} />}
    </div>
  );
}

// ── Accounts Tab ─────────────────────────────────────
// ── Signature Editor ─────────────────────────────────
function SignatureEditor({
  accountId, initialSignature, initialEnabled, onSaved,
}: {
  accountId: string; initialSignature: string;
  initialEnabled: boolean; onSaved: () => void;
}) {
  const [signature, setSignature] = useState(initialSignature);
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
  const [imgWidth, setImgWidth] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editorRef.current && initialSignature) {
      editorRef.current.innerHTML = initialSignature;
    }
  }, [initialSignature]);

  const handleSave = async () => {
    setSaving(true);
    const html = editorRef.current?.innerHTML || "";
    const { error } = await supabase
      .from("email_accounts")
      .update({ signature: html, signature_enabled: enabled })
      .eq("id", accountId);

    if (!error) {
      setSaved(true);
      setTimeout(() => { setSaved(false); onSaved(); }, 1200);
    }
    setSaving(false);
  };

  return (
    <div className="px-4 pb-4 border-t border-[#1E242C]">
      <div className="flex items-center justify-between py-3">
        <div className="text-[12px] font-semibold text-[#7D8590]">Email Signature</div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-[11px] text-[#484F58]">{enabled ? "Enabled" : "Disabled"}</span>
          <button
            onClick={() => setEnabled(!enabled)}
            className={`w-8 h-[18px] rounded-full flex items-center transition-all flex-shrink-0 ${
              enabled ? "bg-[#4ADE80] justify-end" : "bg-[#1E242C] justify-start"
            }`}
          >
            <div className="w-3.5 h-3.5 rounded-full bg-white mx-0.5 shadow-sm" />
          </button>
        </label>
      </div>

      <div className="text-[10px] text-[#484F58] mb-2">
        Write your signature below or paste a rich HTML signature. It will be auto-appended to all outgoing emails from this account.
      </div>

      <div className="rounded-lg border border-[#1E242C] bg-[#0B0E11] overflow-hidden">
        {/* Mini toolbar */}
        <div className="flex items-center gap-0.5 px-2 py-1 border-b border-[#161B22] bg-[#0D1117]">
          <button onMouseDown={(e) => { e.preventDefault(); document.execCommand("bold"); }}
            className="w-6 h-6 rounded flex items-center justify-center text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C] text-[11px] font-bold">B</button>
          <button onMouseDown={(e) => { e.preventDefault(); document.execCommand("italic"); }}
            className="w-6 h-6 rounded flex items-center justify-center text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C] text-[11px] italic">I</button>
          <button onMouseDown={(e) => { e.preventDefault(); document.execCommand("underline"); }}
            className="w-6 h-6 rounded flex items-center justify-center text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C] text-[11px] underline">U</button>
          <div className="w-px h-3 bg-[#1E242C] mx-0.5" />
          <button onMouseDown={(e) => { e.preventDefault(); const url = prompt("Link URL:"); if (url) document.execCommand("createLink", false, url); }}
            className="w-6 h-6 rounded flex items-center justify-center text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C] text-[10px]">🔗</button>
          <button onMouseDown={(e) => { e.preventDefault(); const url = prompt("Image URL:"); if (url) document.execCommand("insertImage", false, url); }}
            className="w-6 h-6 rounded flex items-center justify-center text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#1E242C] text-[10px]">🖼</button>
        </div>

        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={() => setSignature(editorRef.current?.innerHTML || "")}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.tagName === "IMG") {
              const img = target as HTMLImageElement;
              setSelectedImg(img);
              setImgWidth(String(img.width || img.naturalWidth || 100));
              // Add visual selection
              editorRef.current?.querySelectorAll("img").forEach((i) => i.style.outline = "none");
              img.style.outline = "2px solid #4ADE80";
            } else {
              setSelectedImg(null);
              editorRef.current?.querySelectorAll("img").forEach((i) => i.style.outline = "none");
            }
          }}
          onPaste={(e) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.startsWith("image/")) {
                e.preventDefault();
                const file = items[i].getAsFile();
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const base64 = ev.target?.result as string;
                  document.execCommand("insertImage", false, base64);
                  // Auto-size pasted images to 200px width
                  const imgs = editorRef.current?.querySelectorAll("img");
                  if (imgs) {
                    const last = imgs[imgs.length - 1];
                    if (last && !last.style.width) {
                      last.style.width = "200px";
                      last.style.height = "auto";
                    }
                  }
                  setSignature(editorRef.current?.innerHTML || "");
                };
                reader.readAsDataURL(file);
                return;
              }
            }
          }}
          data-placeholder="Your email signature... (paste images here)"
          className="px-3 py-2 text-[12px] text-[#E6EDF3] leading-relaxed outline-none min-h-[80px] max-h-[250px] overflow-y-auto empty:before:content-[attr(data-placeholder)] empty:before:text-[#484F58] empty:before:pointer-events-none [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded [&_img]:cursor-pointer"
          style={{ fontFamily: "Arial, sans-serif" }}
        />
      </div>

      {/* Image resize controls */}
      {selectedImg && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-[#161B22] border border-[#1E242C]">
          <span className="text-[10px] text-[#484F58] font-semibold">Image size:</span>
          <div className="flex gap-1">
            {[50, 80, 100, 150, 200, 300].map((w) => (
              <button
                key={w}
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectedImg.style.width = `${w}px`;
                  selectedImg.style.height = "auto";
                  setImgWidth(String(w));
                  setSignature(editorRef.current?.innerHTML || "");
                }}
                className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                  imgWidth === String(w)
                    ? "bg-[#4ADE80] text-[#0B0E11] font-bold"
                    : "bg-[#1E242C] text-[#7D8590] hover:text-[#E6EDF3]"
                }`}
              >
                {w}px
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-1">
            <input
              type="number"
              value={imgWidth}
              onChange={(e) => {
                const w = e.target.value;
                setImgWidth(w);
                if (parseInt(w) > 0) {
                  selectedImg.style.width = `${w}px`;
                  selectedImg.style.height = "auto";
                  setSignature(editorRef.current?.innerHTML || "");
                }
              }}
              className="w-16 px-1.5 py-0.5 rounded bg-[#0B0E11] border border-[#1E242C] text-[10px] text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
            />
            <span className="text-[10px] text-[#484F58]">px</span>
          </div>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              selectedImg.remove();
              setSelectedImg(null);
              setSignature(editorRef.current?.innerHTML || "");
            }}
            className="ml-auto px-2 py-0.5 rounded text-[10px] text-[#F85149] hover:bg-[rgba(248,81,73,0.1)] transition-colors"
          >
            Remove
          </button>
        </div>
      )}

      {/* Preview */}
      {signature && (
        <div className="mt-2">
          <div className="text-[10px] text-[#484F58] mb-1">Preview:</div>
          <div
            className="px-3 py-2 rounded-lg bg-[#0D1117] border border-[#1E242C] text-[12px] text-[#7D8590]"
            dangerouslySetInnerHTML={{ __html: signature }}
          />
        </div>
      )}

      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onSaved} className="px-3 py-1.5 rounded-lg text-[11px] text-[#7D8590] border border-[#1E242C] hover:bg-[#1E242C]">Cancel</button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-[11px] font-semibold disabled:opacity-50"
        >
          {saved ? <><Check size={12} /> Saved!</> : saving ? "Saving..." : "Save Signature"}
        </button>
      </div>
    </div>
  );
}

function AccountsTab({ onConnect }: { onConnect: () => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSignatureId, setEditingSignatureId] = useState<string | null>(null);

  const fetchAccounts = () => {
    supabase
      .from("email_accounts")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setAccounts(data || []);
        setLoading(false);
      });
  };

  useEffect(() => { fetchAccounts(); }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this email account and ALL its conversations, messages, and data? This cannot be undone.")) return;

    try {
      // Get all conversation IDs for this account
      const { data: convos } = await supabase
        .from("conversations")
        .select("id")
        .eq("email_account_id", id);

      const convoIds = (convos || []).map((c: any) => c.id);

      if (convoIds.length > 0) {
        // Delete in batches of 100 to avoid Supabase .in() limits
        for (let i = 0; i < convoIds.length; i += 100) {
          const batch = convoIds.slice(i, i + 100);
          
          // Delete conversation labels
          await supabase.from("conversation_labels").delete().in("conversation_id", batch);
          
          // Delete task assignees via tasks
          const { data: batchTasks } = await supabase.from("tasks").select("id").in("conversation_id", batch);
          const taskIds = (batchTasks || []).map((t: any) => t.id);
          if (taskIds.length > 0) {
            await supabase.from("task_assignees").delete().in("task_id", taskIds);
          }
          
          // Delete tasks, notes, messages, activity, summaries
          await supabase.from("tasks").delete().in("conversation_id", batch);
          await supabase.from("notes").delete().in("conversation_id", batch);
          await supabase.from("messages").delete().in("conversation_id", batch);
          await supabase.from("activity_log").delete().in("conversation_id", batch);
          await supabase.from("thread_summaries").delete().in("conversation_id", batch);
        }
        
        // Delete all conversations for this account
        const { error: convoErr } = await supabase.from("conversations").delete().eq("email_account_id", id);
        if (convoErr) {
          alert("Failed to delete conversations: " + convoErr.message);
          return;
        }
      }

      // Delete account access entries
      await supabase.from("account_access").delete().eq("email_account_id", id);

      // Finally delete the account
      const { error } = await supabase.from("email_accounts").delete().eq("id", id);
      if (error) {
        alert("Failed to delete account: " + error.message);
        return;
      }
      setAccounts((prev) => prev.filter((a) => a.id !== id));
    } catch (err: any) {
      alert("Delete failed: " + (err.message || "Unknown error"));
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Accounts</h1>
          <p className="text-sm text-[#7D8590] mt-1">Connect shared email accounts your team can access</p>
        </div>
        <button
          onClick={onConnect}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E] transition-colors"
        >
          <Plus size={16} /> Connect Account
        </button>
      </div>

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : accounts.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-[#1E242C] rounded-xl">
          <Mail className="w-12 h-12 text-[#484F58] mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">No email accounts connected</h3>
          <p className="text-sm text-[#7D8590] mb-6">Connect your first shared email to start receiving messages</p>
          <button
            onClick={onConnect}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm"
          >
            <Plus size={16} /> Connect Account
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => {
            const provider = PROVIDERS.find((p) => p.id === account.provider);
            const isEditingSig = editingSignatureId === account.id;
            return (
              <div key={account.id} className="rounded-xl bg-[#12161B] border border-[#1E242C] overflow-hidden">
                <div className="flex items-center gap-4 p-4">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                    style={{ background: `${provider?.color}20` }}
                  >
                    {provider?.icon || "📧"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{account.name}</span>
                      {account.is_active && !account.sync_error && (
                        <CheckCircle size={14} className="text-[#4ADE80]" />
                      )}
                      {account.sync_error && (
                        <AlertCircle size={14} className="text-[#F85149]" />
                      )}
                    </div>
                    <div className="text-xs text-[#7D8590]">{account.email}</div>
                    {account.last_sync_at && (
                      <div className="text-[10px] text-[#484F58] mt-0.5">
                        Last synced: {new Date(account.last_sync_at).toLocaleString()}
                      </div>
                    )}
                    {account.sync_error && (
                      <div className="text-[10px] text-[#F85149] mt-0.5">{account.sync_error}</div>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setEditingSignatureId(isEditingSig ? null : account.id)}
                      title="Edit signature"
                      className={`w-8 h-8 rounded-md flex items-center justify-center transition-colors ${
                        isEditingSig ? "text-[#4ADE80] bg-[#1E242C]" : "text-[#7D8590] hover:bg-[#1E242C]"
                      }`}
                    >
                      <FileSignature size={14} />
                    </button>
                    <button className="w-8 h-8 rounded-md flex items-center justify-center text-[#7D8590] hover:bg-[#1E242C] transition-colors">
                      <RefreshCw size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(account.id)}
                      className="w-8 h-8 rounded-md flex items-center justify-center text-[#7D8590] hover:text-[#F85149] hover:bg-[#1E242C] transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Signature Editor */}
                {isEditingSig && (
                  <SignatureEditor
                    accountId={account.id}
                    initialSignature={account.signature || ""}
                    initialEnabled={account.signature_enabled ?? false}
                    onSaved={() => { setEditingSignatureId(null); fetchAccounts(); }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Connect Email Modal ──────────────────────────────
function ConnectEmailModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"provider" | "credentials">("provider");
  const [selectedProvider, setSelectedProvider] = useState<typeof PROVIDERS[0] | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    imap_host: "",
    imap_port: 993,
    smtp_host: "",
    smtp_port: 587,
    ms_client_id: "",
    ms_tenant_id: "",
    ms_client_secret: "",
    showAzureCreds: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSelectProvider = (provider: typeof PROVIDERS[0]) => {
    setSelectedProvider(provider);
    if (provider.id === "microsoft_oauth") {
      // Microsoft OAuth doesn't need IMAP/SMTP settings
      setStep("credentials");
      return;
    }
    setFormData((prev) => ({
      ...prev,
      imap_host: provider.imap_host,
      imap_port: provider.imap_port,
      smtp_host: provider.smtp_host,
      smtp_port: provider.smtp_port,
    }));
    setStep("credentials");
  };

  const handleConnectMicrosoft = async () => {
    if (!formData.email) {
      setError("Email address is required");
      return;
    }
    setTesting(true);
    setError("");

    try {
      const payload: any = {
        email: formData.email.trim(),
        name: formData.name || formData.email.split("@")[0],
      };

      // Include per-account credentials if provided
      if (formData.ms_client_id && formData.ms_tenant_id && formData.ms_client_secret) {
        payload.microsoft_client_id = formData.ms_client_id.trim();
        payload.microsoft_tenant_id = formData.ms_tenant_id.trim();
        payload.microsoft_client_secret = formData.ms_client_secret.trim();
      }

      const res = await fetch("/api/auth/microsoft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (res.ok) {
        setSuccess(true);
        setTimeout(() => onClose(), 1500);
        window.location.reload();
      } else {
        setError(data.error || "Connection failed");
      }
    } catch (_e) {
      setError("Network error — check your connection");
    }
    setTesting(false);
  };

  const handleConnect = async () => {
    if (!formData.email || !formData.password) {
      setError("Email and password are required");
      return;
    }

    setTesting(true);
    setError("");

    try {
      if (selectedProvider?.id === "microsoft_password") {
        // Try password-based Microsoft connection
        const res = await fetch("/api/auth/microsoft/password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: formData.email.trim(),
            password: formData.password,
            name: formData.name || formData.email.split("@")[0],
          }),
        });
        const data = await res.json().catch(() => ({}));

        if (res.ok) {
          setSuccess(true);
          setTimeout(() => { onClose(); window.location.reload(); }, 1500);
        } else {
          setError(data.error || "Connection failed — but account may have been saved. Try refreshing.");
        }
        setTesting(false);
        return;
      }

      // Standard IMAP/SMTP connection
      const { data, error: dbError } = await supabase.from("email_accounts").insert({
        name: formData.name || formData.email.split("@")[0],
        email: formData.email,
        provider: selectedProvider?.id || "imap",
        imap_host: formData.imap_host,
        imap_port: formData.imap_port,
        imap_user: formData.email,
        imap_password: formData.password,
        imap_tls: true,
        smtp_host: formData.smtp_host,
        smtp_port: formData.smtp_port,
        smtp_user: formData.email,
        smtp_password: formData.password,
        smtp_tls: true,
        is_active: true,
        icon: selectedProvider?.icon || "📧",
        color: selectedProvider?.color || "#4ADE80",
      }).select().single();

      if (dbError) throw dbError;

      setSuccess(true);
      setTimeout(() => {
        onClose();
        window.location.reload();
      }, 1500);
    } catch (err: any) {
      setError(err.message || "Failed to connect account");
    }

    setTesting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-lg bg-[#12161B] border border-[#1E242C] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#1E242C]">
          <div>
            <h2 className="text-lg font-bold">
              {step === "provider" ? "Connect Email Account" : `Connect ${selectedProvider?.name}`}
            </h2>
            <p className="text-xs text-[#7D8590]">
              {step === "provider" ? "Choose your email provider" : "Enter your account credentials"}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-md flex items-center justify-center text-[#7D8590] hover:bg-[#1E242C]">
            <X size={18} />
          </button>
        </div>

        {/* Provider Selection */}
        {step === "provider" && (
          <div className="p-6">
            <div className="grid grid-cols-1 gap-2">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => handleSelectProvider(provider)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border border-[#1E242C] bg-[#0B0E11] hover:border-[#4ADE80] hover:bg-[#0B0E11]/80 transition-all text-left"
                >
                  <span className="text-xl">{provider.icon}</span>
                  <span className="font-medium text-sm">{provider.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Microsoft OAuth - email + optional credentials form */}
        {step === "credentials" && selectedProvider?.id === "microsoft_oauth" && (
          <div className="p-6 space-y-4">
            <div className="px-3 py-2.5 rounded-lg bg-[rgba(88,166,255,0.08)] border border-[rgba(88,166,255,0.15)] text-xs text-[#58A6FF] leading-relaxed">
              {selectedProvider.help}
            </div>

            <div>
              <label className="block text-xs font-medium text-[#7D8590] mb-1.5">Display Name</label>
              <input
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Bobber Labs, Support"
                className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#7D8590] mb-1.5">Email Address</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                placeholder="info@yourcompany.com"
                className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
              />
            </div>

            {/* Azure AD Credentials - for different tenants */}
            <div className="border border-[#1E242C] rounded-lg overflow-hidden">
              <button
                onClick={() => setFormData((p) => ({ ...p, showAzureCreds: !p.showAzureCreds }))}
                className="w-full flex items-center justify-between px-3 py-2.5 text-xs text-[#7D8590] hover:text-[#E6EDF3] hover:bg-[#12161B] transition-colors"
              >
                <span>Azure AD Credentials (for different tenant)</span>
                <ChevronDown size={12} className={formData.showAzureCreds ? "rotate-180 transition-transform" : "transition-transform"} />
              </button>
              {formData.showAzureCreds && (
                <div className="px-3 pb-3 space-y-3 border-t border-[#1E242C]">
                  <div className="pt-2 text-[10px] text-[#484F58] leading-relaxed">
                    Leave blank to use the default Bobber Labs credentials. Fill in if connecting a mailbox from a different Microsoft 365 tenant.
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-[#484F58] mb-1">Client ID</label>
                    <input
                      value={formData.ms_client_id || ""}
                      onChange={(e) => setFormData((p) => ({ ...p, ms_client_id: e.target.value }))}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-[#484F58] mb-1">Tenant ID</label>
                    <input
                      value={formData.ms_tenant_id || ""}
                      onChange={(e) => setFormData((p) => ({ ...p, ms_tenant_id: e.target.value }))}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-medium text-[#484F58] mb-1">Client Secret</label>
                    <input
                      type="password"
                      value={formData.ms_client_secret || ""}
                      onChange={(e) => setFormData((p) => ({ ...p, ms_client_secret: e.target.value }))}
                      placeholder="Secret value from Azure AD"
                      className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58] font-mono"
                    />
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-[rgba(248,81,73,0.08)] border border-[rgba(248,81,73,0.15)] text-xs text-[#F85149]">
                {error}
              </div>
            )}

            {success && (
              <div className="px-3 py-2 rounded-lg bg-[rgba(74,222,128,0.08)] border border-[rgba(74,222,128,0.15)] text-xs text-[#4ADE80] flex items-center gap-2">
                <CheckCircle size={14} /> Connected successfully! Syncing emails...
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep("provider")}
                className="px-4 py-2.5 rounded-lg border border-[#1E242C] text-sm text-[#7D8590] hover:bg-[#1E242C] transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleConnectMicrosoft}
                disabled={testing || !formData.email}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  testing || !formData.email
                    ? "bg-[#1E242C] text-[#484F58]"
                    : "bg-[#4ADE80] text-[#0B0E11] hover:bg-[#3BC96E]"
                }`}
              >
                {testing ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                {testing ? "Connecting..." : "Connect via Microsoft Graph"}
              </button>
            </div>
          </div>
        )}

        {/* Credentials Form (IMAP/SMTP providers) */}
        {step === "credentials" && selectedProvider && selectedProvider.id !== "microsoft_oauth" && (
          <div className="p-6 space-y-4">
            {/* Provider help text */}
            <div className="px-3 py-2.5 rounded-lg bg-[rgba(88,166,255,0.08)] border border-[rgba(88,166,255,0.15)] text-xs text-[#58A6FF] leading-relaxed">
              {selectedProvider.help}
            </div>

            {/* Display Name */}
            <div>
              <label className="block text-xs font-medium text-[#7D8590] mb-1.5">Display Name</label>
              <input
                value={formData.name}
                onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Bobber Labs, General Inquiries"
                className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-xs font-medium text-[#7D8590] mb-1.5">Email Address</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
                placeholder="info@bobberlabs.com"
                className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-[#7D8590] mb-1.5">
                {selectedProvider.id === "gmail" || selectedProvider.id === "icloud" ? "App Password" : "Password"}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                  placeholder={selectedProvider.id === "gmail" ? "xxxx xxxx xxxx xxxx" : "••••••••"}
                  className="w-full px-3 py-2.5 pr-10 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#484F58] hover:text-[#7D8590]"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* IMAP/SMTP for custom provider */}
            {selectedProvider.id === "imap" && (
              <div className="space-y-3 pt-2 border-t border-[#1E242C]">
                <div className="text-xs font-medium text-[#7D8590]">Server Settings</div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[10px] text-[#484F58] mb-1">IMAP Host</label>
                    <input
                      value={formData.imap_host}
                      onChange={(e) => setFormData((p) => ({ ...p, imap_host: e.target.value }))}
                      placeholder="imap.example.com"
                      className="w-full px-2.5 py-2 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#484F58] mb-1">Port</label>
                    <input
                      type="number"
                      value={formData.imap_port}
                      onChange={(e) => setFormData((p) => ({ ...p, imap_port: parseInt(e.target.value) }))}
                      className="w-full px-2.5 py-2 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-[10px] text-[#484F58] mb-1">SMTP Host</label>
                    <input
                      value={formData.smtp_host}
                      onChange={(e) => setFormData((p) => ({ ...p, smtp_host: e.target.value }))}
                      placeholder="smtp.example.com"
                      className="w-full px-2.5 py-2 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[#484F58] mb-1">Port</label>
                    <input
                      type="number"
                      value={formData.smtp_port}
                      onChange={(e) => setFormData((p) => ({ ...p, smtp_port: parseInt(e.target.value) }))}
                      className="w-full px-2.5 py-2 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="px-3 py-2 rounded-lg bg-[rgba(248,81,73,0.08)] border border-[rgba(248,81,73,0.15)] text-xs text-[#F85149]">
                {error}
              </div>
            )}

            {/* Success */}
            {success && (
              <div className="px-3 py-2 rounded-lg bg-[rgba(74,222,128,0.08)] border border-[rgba(74,222,128,0.15)] text-xs text-[#4ADE80] flex items-center gap-2">
                <CheckCircle size={14} /> Account connected successfully! Redirecting...
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setStep("provider")}
                className="px-4 py-2.5 rounded-lg border border-[#1E242C] text-sm text-[#7D8590] hover:bg-[#1E242C] transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleConnect}
                disabled={testing || !formData.email || !formData.password}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                  testing || !formData.email || !formData.password
                    ? "bg-[#1E242C] text-[#484F58]"
                    : "bg-[#4ADE80] text-[#0B0E11] hover:bg-[#3BC96E]"
                }`}
              >
                {testing ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
                {testing ? "Connecting..." : "Connect Account"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Team Members Tab ─────────────────────────────────
function TeamTab() {
  const [members, setMembers] = useState<any[]>([]);
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [accessMap, setAccessMap] = useState<Record<string, string[]>>({}); // memberId -> accountIds[]
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteData, setInviteData] = useState({ email: "", name: "", role: "member", department: "Uncategorized" });
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ success: boolean; message: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [managingAccessId, setManagingAccessId] = useState<string | null>(null);

  const DEPARTMENTS = ["Operations", "Management", "Dev", "Sales", "Support", "Uncategorized"];

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    const [membersRes, accountsRes, accessRes] = await Promise.all([
      supabase.from("team_members").select("*").order("created_at"),
      supabase.from("email_accounts").select("id, name, email, icon, color").eq("is_active", true).order("created_at"),
      supabase.from("account_access").select("*"),
    ]);
    setMembers(membersRes.data || []);
    setEmailAccounts(accountsRes.data || []);
    // Build access map by member
    const map: Record<string, string[]> = {};
    for (const row of (accessRes.data || [])) {
      if (!map[row.team_member_id]) map[row.team_member_id] = [];
      map[row.team_member_id].push(row.email_account_id);
    }
    setAccessMap(map);
    setLoading(false);
  };

  const toggleAccountAccess = async (memberId: string, accountId: string) => {
    const current = accessMap[memberId] || [];
    if (current.includes(accountId)) {
      await supabase.from("account_access").delete()
        .eq("team_member_id", memberId).eq("email_account_id", accountId);
    } else {
      await supabase.from("account_access").insert({
        team_member_id: memberId, email_account_id: accountId,
      });
    }
    fetchMembers();
  };

  const grantAllAccounts = async (memberId: string) => {
    const current = accessMap[memberId] || [];
    const toAdd = emailAccounts.filter((a) => !current.includes(a.id));
    if (toAdd.length > 0) {
      await supabase.from("account_access").insert(
        toAdd.map((a) => ({ team_member_id: memberId, email_account_id: a.id }))
      );
    }
    fetchMembers();
  };

  const revokeAllAccounts = async (memberId: string) => {
    await supabase.from("account_access").delete().eq("team_member_id", memberId);
    fetchMembers();
  };

  const handleInvite = async () => {
    if (!inviteData.email.trim() || !inviteData.name.trim()) return;
    setInviting(true);
    setInviteResult(null);

    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inviteData),
      });
      const data = await res.json();

      if (res.ok) {
        setInviteResult({ success: true, message: data.message });
        setInviteData({ email: "", name: "", role: "member", department: "Uncategorized" });
        fetchMembers();
        setTimeout(() => {
          setShowInvite(false);
          setInviteResult(null);
        }, 3000);
      } else {
        setInviteResult({ success: false, message: data.error });
      }
    } catch {
      setInviteResult({ success: false, message: "Network error" });
    }
    setInviting(false);
  };

  const handleUpdateMember = async (id: string, update: any) => {
    try {
      const res = await fetch("/api/invite", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: id, ...update }),
      });
      if (res.ok) {
        fetchMembers();
        setEditingId(null);
      }
    } catch {
      console.error("Update failed");
    }
  };

  const handleDeactivate = async (id: string, name: string) => {
    if (!confirm(`Deactivate ${name}? They will no longer be able to sign in.`)) return;
    try {
      const res = await fetch("/api/invite", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ member_id: id }),
      });
      if (res.ok) fetchMembers();
    } catch {
      console.error("Deactivate failed");
    }
  };

  const handleReactivate = async (id: string) => {
    await handleUpdateMember(id, { is_active: true });
  };

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Members</h1>
          <p className="text-sm text-[#7D8590] mt-1">Manage who has access to the shared inbox</p>
        </div>
        <button
          onClick={() => { setShowInvite(true); setInviteResult(null); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E] transition-colors"
        >
          <Plus size={16} /> Invite Member
        </button>
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md bg-[#12161B] border border-[#1E242C] rounded-2xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">Invite Team Member</h2>
              <button onClick={() => setShowInvite(false)} className="text-[#484F58] hover:text-[#7D8590]">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-[10px] font-semibold text-[#484F58] mb-1 uppercase tracking-wider">Email Address</label>
                <input
                  type="email"
                  value={inviteData.email}
                  onChange={(e) => setInviteData((p) => ({ ...p, email: e.target.value }))}
                  placeholder="teammate@trytenkara.com"
                  className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-[#484F58] mb-1 uppercase tracking-wider">Full Name</label>
                <input
                  value={inviteData.name}
                  onChange={(e) => setInviteData((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Jane Doe"
                  className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-semibold text-[#484F58] mb-1 uppercase tracking-wider">Role</label>
                  <select
                    value={inviteData.role}
                    onChange={(e) => setInviteData((p) => ({ ...p, role: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-[#484F58] mb-1 uppercase tracking-wider">Department</label>
                  <select
                    value={inviteData.department}
                    onChange={(e) => setInviteData((p) => ({ ...p, department: e.target.value }))}
                    className="w-full px-3 py-2.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
                  >
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>

              {inviteResult && (
                <div className={`px-3 py-2.5 rounded-lg text-xs flex items-center gap-2 ${
                  inviteResult.success
                    ? "bg-[rgba(74,222,128,0.08)] border border-[rgba(74,222,128,0.15)] text-[#4ADE80]"
                    : "bg-[rgba(248,81,73,0.08)] border border-[rgba(248,81,73,0.15)] text-[#F85149]"
                }`}>
                  {inviteResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {inviteResult.message}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowInvite(false)}
                  className="px-4 py-2.5 rounded-lg border border-[#1E242C] text-sm text-[#7D8590] hover:bg-[#1E242C] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleInvite}
                  disabled={inviting || !inviteData.email.trim() || !inviteData.name.trim()}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                    inviting || !inviteData.email.trim() || !inviteData.name.trim()
                      ? "bg-[#1E242C] text-[#484F58]"
                      : "bg-[#4ADE80] text-[#0B0E11] hover:bg-[#3BC96E]"
                  }`}
                >
                  {inviting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                  {inviting ? "Sending Invite..." : "Send Invitation"}
                </button>
              </div>

              <p className="text-[10px] text-[#484F58] text-center leading-relaxed">
                An email invitation will be sent. On first sign-in, they choose their own password.
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <div className="space-y-2">
          {/* Active members */}
          {members.filter((m) => m.is_active !== false).map((m) => (
            <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#12161B] border border-[#1E242C] group">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-[#0B0E11] flex-shrink-0"
                style={{ background: m.color }}
              >
                {m.initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{m.name}</span>
                  {!m.password_hash && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-[rgba(245,213,71,0.12)] text-[#F5D547] uppercase tracking-wider">
                      Pending
                    </span>
                  )}
                </div>
                <div className="text-xs text-[#7D8590]">{m.email}</div>
              </div>

              {editingId === m.id ? (
                <div className="flex items-center gap-2">
                  <select
                    defaultValue={m.department}
                    onChange={(e) => handleUpdateMember(m.id, { department: e.target.value })}
                    className="px-2 py-1 rounded bg-[#0B0E11] border border-[#1E242C] text-[10px] text-[#E6EDF3] outline-none"
                  >
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select
                    defaultValue={m.role}
                    onChange={(e) => handleUpdateMember(m.id, { role: e.target.value })}
                    className="px-2 py-1 rounded bg-[#0B0E11] border border-[#1E242C] text-[10px] text-[#E6EDF3] outline-none"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <label className="flex items-center gap-1 text-[10px] text-[#7D8590] cursor-pointer">
                    <input type="checkbox" defaultChecked={m.has_call_skillset}
                      onChange={(e) => handleUpdateMember(m.id, { has_call_skillset: e.target.checked })}
                      className="accent-[#4ADE80]" />
                    📞 Caller
                  </label>
                  <button onClick={() => setEditingId(null)} className="text-[#484F58] hover:text-[#7D8590]">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <span className="text-[10px] font-medium text-[#484F58] bg-[#1E242C] px-2 py-1 rounded">{m.department}</span>
                  <span className={`text-[10px] font-bold px-2 py-1 rounded ${
                    m.role === "admin" ? "bg-[rgba(74,222,128,0.12)] text-[#4ADE80]" : "bg-[#1E242C] text-[#7D8590]"
                  }`}>{m.role}</span>
                  {m.has_call_skillset && (
                    <span className="text-[10px] font-bold px-2 py-1 rounded bg-[rgba(88,166,255,0.12)] text-[#58A6FF]">📞 Caller</span>
                  )}
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => setManagingAccessId(managingAccessId === m.id ? null : m.id)}
                      title="Manage account access"
                      className={`px-1.5 py-1 rounded text-[10px] font-semibold transition-all ${
                        managingAccessId === m.id ? "text-[#58A6FF] bg-[#1E242C]" : "text-[#484F58] hover:text-[#58A6FF] hover:bg-[#1E242C]"
                      }`}
                    >
                      <Mail size={13} />
                    </button>
                    <button
                      onClick={() => setEditingId(m.id)}
                      className="p-1 rounded text-[#484F58] hover:text-[#7D8590] hover:bg-[#1E242C] transition-all"
                      title="Edit"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => handleDeactivate(m.id, m.name)}
                      className="p-1 rounded text-[#484F58] hover:text-[#F85149] hover:bg-[rgba(248,81,73,0.08)] transition-all"
                      title="Deactivate"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}

              {/* Account Access Panel */}
              {managingAccessId === m.id && (
                <div className="col-span-full mt-2 pt-2 border-t border-[#1E242C]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">
                      Email Account Access
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => grantAllAccounts(m.id)}
                        className="text-[10px] text-[#4ADE80] hover:text-[#3BC96E] font-semibold">Grant all</button>
                      <button onClick={() => revokeAllAccounts(m.id)}
                        className="text-[10px] text-[#F85149] hover:text-[#FF6B6B] font-semibold">Revoke all</button>
                    </div>
                  </div>
                  <div className="text-[10px] text-[#484F58] mb-2">
                    {(accessMap[m.id] || []).length === 0
                      ? "No restrictions — sees all accounts. Add access to restrict."
                      : `Has access to ${(accessMap[m.id] || []).length} of ${emailAccounts.length} account${emailAccounts.length !== 1 ? "s" : ""}`}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {emailAccounts.map((acc) => {
                      const hasAccess = (accessMap[m.id] || []).includes(acc.id);
                      return (
                        <button key={acc.id} onClick={() => toggleAccountAccess(m.id, acc.id)}
                          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] text-left transition-all ${
                            hasAccess ? "bg-[rgba(74,222,128,0.1)] border border-[rgba(74,222,128,0.3)]" : "bg-[#0B0E11] border border-[#1E242C] hover:border-[#484F58]"
                          }`}>
                          <span className="text-[13px]">{acc.icon || "📬"}</span>
                          <span style={{ color: hasAccess ? "#4ADE80" : "#7D8590" }}>{acc.name}</span>
                          {hasAccess && <Check size={11} className="text-[#4ADE80]" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Deactivated members */}
          {members.filter((m) => m.is_active === false).length > 0 && (
            <>
              <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-widest pt-4 pb-1 px-1">
                Deactivated
              </div>
              {members.filter((m) => m.is_active === false).map((m) => (
                <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#12161B] border border-[#1E242C] opacity-50">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold text-[#0B0E11] flex-shrink-0"
                    style={{ background: m.color }}
                  >
                    {m.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{m.name}</div>
                    <div className="text-xs text-[#7D8590]">{m.email}</div>
                  </div>
                  <button
                    onClick={() => handleReactivate(m.id)}
                    className="text-[10px] font-semibold px-3 py-1.5 rounded-lg bg-[#1E242C] text-[#7D8590] hover:text-[#4ADE80] hover:bg-[rgba(74,222,128,0.08)] transition-all"
                  >
                    Reactivate
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Color Picker Palette ────────────────────────────
const LABEL_COLORS = [
  "#4ADE80", "#39D2C0", "#58A6FF", "#BC8CFF", "#F5D547",
  "#F0883E", "#F85149", "#7D8590", "#FF6B6B", "#48BFE3",
  "#64DFDF", "#6930C3", "#E0AAFF", "#FFD166", "#06D6A0",
];

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className="w-6 h-6 rounded-md transition-all hover:scale-110 flex items-center justify-center"
          style={{ background: c, outline: value === c ? "2px solid #E6EDF3" : "none", outlineOffset: "2px" }}
        >
          {value === c && <CheckCircle size={12} className="text-[#0B0E11]" />}
        </button>
      ))}
    </div>
  );
}

// ── Labels Tab ───────────────────────────────────────
function LabelsTab() {
  const [labels, setLabels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState({ name: "", color: "#58A6FF" });
  const [editLabel, setEditLabel] = useState({ name: "", color: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { fetchLabels(); }, []);

  const fetchLabels = async () => {
    const { data } = await supabase.from("labels").select("*").order("sort_order");
    setLabels(data || []);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newLabel.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/labels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newLabel),
      });
      const data = await res.json();
      if (res.ok) {
        setNewLabel({ name: "", color: "#58A6FF" });
        setShowAdd(false);
        fetchLabels();
      } else {
        setError(data.error);
      }
    } catch { setError("Network error"); }
    setSaving(false);
  };

  const handleUpdate = async (id: string) => {
    if (!editLabel.name.trim()) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/labels", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name: editLabel.name, color: editLabel.color }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingId(null);
        fetchLabels();
      } else {
        setError(data.error);
      }
    } catch { setError("Network error"); }
    setSaving(false);
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete label "${name}"? It will be removed from all conversations.`)) return;
    try {
      const res = await fetch(`/api/labels?id=${id}`, { method: "DELETE" });
      if (res.ok) fetchLabels();
    } catch { /* ignore */ }
  };

  const startEditing = (l: any) => {
    setEditingId(l.id);
    setEditLabel({ name: l.name, color: l.color });
    setError("");
  };

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Labels</h1>
          <p className="text-sm text-[#7D8590] mt-1">Create and manage labels to organize conversations</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setError(""); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E] transition-colors"
        >
          <Plus size={16} /> New Label
        </button>
      </div>

      {/* Add new label form */}
      {showAdd && (
        <div className="mb-6 p-4 rounded-xl bg-[#12161B] border border-[#4ADE80]/30 animate-fade-in">
          <div className="text-xs font-bold text-[#484F58] uppercase tracking-wider mb-3">New Label</div>
          <div className="flex items-start gap-3 mb-3">
            <div className="flex-1">
              <input
                value={newLabel.name}
                onChange={(e) => setNewLabel((p) => ({ ...p, name: e.target.value }))}
                placeholder="Label name..."
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleAdd()}
                className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
              />
            </div>
            <span
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-[11px] font-semibold whitespace-nowrap flex-shrink-0"
              style={{ background: `${newLabel.color}1F`, color: newLabel.color }}
            >
              <span className="w-2 h-2 rounded-full" style={{ background: newLabel.color }} />
              {newLabel.name || "Preview"}
            </span>
          </div>
          <div className="mb-3">
            <div className="text-[10px] text-[#484F58] mb-1.5">Color</div>
            <ColorPicker value={newLabel.color} onChange={(c) => setNewLabel((p) => ({ ...p, color: c }))} />
          </div>
          {error && <div className="text-[#F85149] text-xs mb-2">{error}</div>}
          <div className="flex gap-2">
            <button onClick={() => { setShowAdd(false); setError(""); }} className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-xs text-[#7D8590]">Cancel</button>
            <button
              onClick={handleAdd}
              disabled={saving || !newLabel.name.trim()}
              className="px-4 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold disabled:opacity-40"
            >
              {saving ? "Creating..." : "Create Label"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <div className="space-y-2">
          {labels.map((l) => (
            <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#12161B] border border-[#1E242C] group">
              {editingId === l.id ? (
                /* Editing mode */
                <div className="flex-1 space-y-2.5">
                  <div className="flex items-center gap-3">
                    <input
                      value={editLabel.name}
                      onChange={(e) => setEditLabel((p) => ({ ...p, name: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === "Enter") handleUpdate(l.id); if (e.key === "Escape") setEditingId(null); }}
                      autoFocus
                      className="flex-1 px-3 py-1.5 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
                    />
                    <span
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold whitespace-nowrap"
                      style={{ background: `${editLabel.color}1F`, color: editLabel.color }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: editLabel.color }} />
                      {editLabel.name || "Preview"}
                    </span>
                  </div>
                  <ColorPicker value={editLabel.color} onChange={(c) => setEditLabel((p) => ({ ...p, color: c }))} />
                  {error && <div className="text-[#F85149] text-xs">{error}</div>}
                  <div className="flex gap-2">
                    <button onClick={() => { setEditingId(null); setError(""); }} className="px-3 py-1 rounded text-xs text-[#7D8590] border border-[#1E242C]">Cancel</button>
                    <button
                      onClick={() => handleUpdate(l.id)}
                      disabled={saving || !editLabel.name.trim()}
                      className="px-3 py-1 rounded bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold disabled:opacity-40"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              ) : (
                /* Display mode */
                <>
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: l.color }} />
                  <span className="text-sm font-medium flex-1">{l.name}</span>
                  <span
                    className="text-[11px] font-semibold px-2 py-0.5 rounded"
                    style={{ background: l.bg_color, color: l.color }}
                  >
                    {l.name}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEditing(l)}
                      className="p-1 rounded text-[#484F58] hover:text-[#7D8590] hover:bg-[#1E242C] transition-all"
                      title="Edit"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(l.id, l.name)}
                      className="p-1 rounded text-[#484F58] hover:text-[#F85149] hover:bg-[rgba(248,81,73,0.08)] transition-all"
                      title="Delete"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {labels.length === 0 && !showAdd && (
            <div className="text-center py-16 border-2 border-dashed border-[#1E242C] rounded-xl">
              <Tag className="w-12 h-12 text-[#484F58] mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No labels yet</h3>
              <p className="text-sm text-[#7D8590] mb-4">Create labels to organize your conversations</p>
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm"
              >
                <Plus size={16} /> Create First Label
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Rules Tab ───────────────────────────────────────
const CONDITION_FIELDS = [
  { value: "subject", label: "Subject" },
  { value: "from_email", label: "From Email" },
  { value: "from_name", label: "From Name" },
  { value: "to_addresses", label: "To / CC" },
  { value: "body_text", label: "Body" },
];

const CONDITION_OPERATORS = [
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Does not contain" },
  { value: "equals", label: "Equals" },
  { value: "starts_with", label: "Starts with" },
  { value: "ends_with", label: "Ends with" },
];

const ACTION_TYPES = [
  { value: "add_label", label: "Add label" },
  { value: "remove_label", label: "Remove label" },
  { value: "assign_to", label: "Assign to" },
  { value: "mark_starred", label: "Star conversation" },
  { value: "mark_read", label: "Mark as read" },
  { value: "move_to_folder", label: "Move to folder" },
  { value: "set_status", label: "Set status" },
];

const TRIGGER_TYPES = [
  { value: "incoming", label: "Incoming", icon: "📥", description: "Runs when a new email arrives" },
  { value: "outgoing", label: "Outgoing", icon: "📤", description: "Runs when an email is sent" },
  { value: "user_action", label: "User Action", icon: "👤", description: "Runs when a user performs an action" },
];

interface RuleCondition { field: string; operator: string; value: string; required?: boolean; }
interface RuleAction { type: string; value: string; }

function RulesTab() {
  const [rules, setRules] = useState<any[]>([]);
  const [labels, setLabels] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [allFolders, setAllFolders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [activeTrigger, setActiveTrigger] = useState("incoming");

  // Form state — kept at this level so nested inputs don't lose focus
  const [formName, setFormName] = useState("");
  const [formMatchMode, setFormMatchMode] = useState<"all" | "any" | "none">("all");
  const [formConditions, setFormConditions] = useState<RuleCondition[]>([{ field: "subject", operator: "contains", value: "" }]);
  const [formActions, setFormActions] = useState<RuleAction[]>([{ type: "add_label", value: "" }]);

  useEffect(() => {
    Promise.all([
      fetch("/api/rules").then((r) => r.json()),
      supabase.from("labels").select("*").order("sort_order"),
      supabase.from("team_members").select("*").eq("is_active", true),
      supabase.from("folders").select("*").order("sort_order"),
    ]).then(([rulesData, labelsRes, membersRes, foldersRes]) => {
      setRules(rulesData.rules || []);
      setLabels(labelsRes.data || []);
      setMembers(membersRes.data || []);
      setAllFolders(foldersRes.data || []);
      setLoading(false);
    });
  }, []);

  const fetchRules = async () => {
    const res = await fetch("/api/rules");
    const data = await res.json();
    setRules(data.rules || []);
  };

  const resetForm = () => {
    setFormName("");
    setFormMatchMode("all");
    setFormConditions([{ field: "subject", operator: "contains", value: "" }]);
    setFormActions([{ type: "add_label", value: "" }]);
    setError("");
  };

  const loadRuleIntoForm = (r: any) => {
    setFormName(r.name || "");
    setFormMatchMode(r.match_mode || "all");
    // Load conditions from JSONB or legacy fields
    if (r.conditions?.length) {
      setFormConditions(r.conditions);
    } else if (r.condition_field) {
      setFormConditions([{ field: r.condition_field, operator: r.condition_operator, value: r.condition_value || "" }]);
    } else {
      setFormConditions([{ field: "subject", operator: "contains", value: "" }]);
    }
    // Load actions from JSONB or legacy fields
    if (r.actions?.length) {
      setFormActions(r.actions);
    } else if (r.action_type) {
      setFormActions([{ type: r.action_type, value: r.action_value || "" }]);
    } else {
      setFormActions([{ type: "add_label", value: "" }]);
    }
    setError("");
  };

  const handleAdd = async () => {
    if (!formName.trim() || formConditions.some((c) => !c.value.trim())) return;
    const needsVal = (t: string) => ["add_label", "remove_label", "assign_to", "set_status", "move_to_folder"].includes(t);
    if (formActions.some((a) => needsVal(a.type) && !a.value)) return;
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          trigger_type: activeTrigger,
          match_mode: formMatchMode,
          conditions: formConditions,
          actions: formActions,
        }),
      });
      const data = await res.json();
      if (res.ok) { resetForm(); setShowAdd(false); fetchRules(); }
      else { setError(data.error); }
    } catch { setError("Network error"); }
    setSaving(false);
  };

  const handleUpdate = async (id: string) => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: formName,
          match_mode: formMatchMode,
          conditions: formConditions,
          actions: formActions,
        }),
      });
      if (res.ok) { setEditingId(null); resetForm(); fetchRules(); }
      else { const d = await res.json(); setError(d.error); }
    } catch { setError("Network error"); }
    setSaving(false);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await fetch("/api/rules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, is_active: !isActive }) });
    fetchRules();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete rule "${name}"?`)) return;
    await fetch(`/api/rules?id=${id}`, { method: "DELETE" });
    fetchRules();
  };

  // Condition helpers
  const updateCondition = (idx: number, patch: Partial<RuleCondition>) => {
    setFormConditions((prev) => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
  };
  const addCondition = () => {
    setFormConditions((prev) => [...prev, { field: "subject", operator: "contains", value: "" }]);
  };
  const removeCondition = (idx: number) => {
    if (formConditions.length <= 1) return;
    setFormConditions((prev) => prev.filter((_, i) => i !== idx));
  };

  // Action helpers
  const updateAction = (idx: number, patch: Partial<RuleAction>) => {
    setFormActions((prev) => prev.map((a, i) => i === idx ? { ...a, ...patch } : a));
  };
  const addAction = () => {
    setFormActions((prev) => [...prev, { type: "add_label", value: "" }]);
  };
  const removeAction = (idx: number) => {
    if (formActions.length <= 1) return;
    setFormActions((prev) => prev.filter((_, i) => i !== idx));
  };

  // Action value selector
  const renderActionValue = (action: RuleAction, idx: number) => {
    const t = action.type;
    if (t === "add_label" || t === "remove_label") {
      return (
        <select value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="">Select label...</option>
          {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      );
    }
    if (t === "assign_to") {
      return (
        <select value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="">Select member...</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      );
    }
    if (t === "move_to_folder") {
      return (
        <select value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="">Select folder...</option>
          {allFolders.map((f) => <option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}
        </select>
      );
    }
    if (t === "set_status") {
      return (
        <select value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="snoozed">Snoozed</option>
        </select>
      );
    }
    return null;
  };

  const getActionLabel = (type: string, value: string) => {
    if (type === "add_label" || type === "remove_label") return labels.find((l) => l.id === value)?.name || "";
    if (type === "assign_to") return members.find((m) => m.id === value)?.name || "";
    if (type === "move_to_folder") { const f = allFolders.find((f) => f.id === value); return f ? `${f.icon} ${f.name}` : ""; }
    if (type === "set_status") return value;
    return "";
  };

  // ── Render the form (used for both add and edit) ────
  const renderForm = (isEdit: boolean, ruleId?: string) => (
    <div className="space-y-3">
      {/* Rule name */}
      <input
        value={formName}
        onChange={(e) => setFormName(e.target.value)}
        placeholder="Rule name (e.g. 'Auto-label RFQ emails')"
        className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
      />

      {/* Conditions */}
      <div className="p-3 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
        <div className="flex items-center gap-2 mb-2">
          <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">Conditions</div>
          <div className="flex-1" />
          <select
            value={formMatchMode}
            onChange={(e) => setFormMatchMode(e.target.value as any)}
            className="px-2 py-1 rounded-md bg-[#12161B] border border-[#1E242C] text-[10px] font-semibold text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
          >
            <option value="all">All must match</option>
            <option value="any">At least one matches</option>
            <option value="none">None must match</option>
          </select>
        </div>

        {formConditions.map((cond, idx) => (
          <div key={idx} className="flex gap-1.5 mb-1.5 items-center">
            <select value={cond.field} onChange={(e) => updateCondition(idx, { field: e.target.value })}
              className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
              {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select value={cond.operator} onChange={(e) => updateCondition(idx, { operator: e.target.value })}
              className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
              {CONDITION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input
              value={cond.value}
              onChange={(e) => updateCondition(idx, { value: e.target.value })}
              placeholder="Value..."
              className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
            />
            <button
              onClick={() => updateCondition(idx, { required: !cond.required })}
              title={cond.required ? "Required — must match" : "Optional — click to make required"}
              className={`px-1.5 py-1 rounded-md text-[9px] font-bold transition-all shrink-0 ${
                cond.required
                  ? "bg-[rgba(248,81,73,0.12)] text-[#F85149] border border-[rgba(248,81,73,0.3)]"
                  : "bg-[#12161B] text-[#484F58] border border-[#1E242C] hover:text-[#7D8590]"
              }`}
            >
              {cond.required ? "REQ" : "OPT"}
            </button>
            <button onClick={() => removeCondition(idx)} disabled={formConditions.length <= 1}
              className="p-1 rounded text-[#484F58] hover:text-[#F85149] disabled:opacity-30 transition-colors" title="Remove">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button onClick={addCondition}
          className="flex items-center gap-1 text-[10px] text-[#4ADE80] hover:text-[#3BC96E] font-semibold mt-1 transition-colors">
          <Plus size={11} /> Add condition
        </button>
      </div>

      {/* Actions */}
      <div className="p-3 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
        <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider mb-2">Actions</div>

        {formActions.map((act, idx) => (
          <div key={idx} className="flex gap-1.5 mb-1.5 items-center">
            <select value={act.type} onChange={(e) => updateAction(idx, { type: e.target.value, value: "" })}
              className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
              {ACTION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            {renderActionValue(act, idx)}
            <button onClick={() => removeAction(idx)} disabled={formActions.length <= 1}
              className="p-1 rounded text-[#484F58] hover:text-[#F85149] disabled:opacity-30 transition-colors" title="Remove">
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <button onClick={addAction}
          className="flex items-center gap-1 text-[10px] text-[#4ADE80] hover:text-[#3BC96E] font-semibold mt-1 transition-colors">
          <Plus size={11} /> Add action
        </button>
      </div>

      {error && <div className="text-[#F85149] text-xs">{error}</div>}

      <div className="flex gap-2">
        <button onClick={() => { isEdit ? setEditingId(null) : setShowAdd(false); resetForm(); }}
          className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-xs text-[#7D8590]">Cancel</button>
        <button onClick={() => isEdit && ruleId ? handleUpdate(ruleId) : handleAdd()}
          disabled={saving || !formName.trim()}
          className="px-4 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold disabled:opacity-40">
          {saving ? "Saving..." : isEdit ? "Save Changes" : "Create Rule"}
        </button>
      </div>
    </div>
  );

  // ── Get summary text for a rule ─────────────────────
  const getRuleSummary = (r: any) => {
    const conds: RuleCondition[] = r.conditions?.length ? r.conditions : r.condition_field ? [{ field: r.condition_field, operator: r.condition_operator, value: r.condition_value }] : [];
    const acts: RuleAction[] = r.actions?.length ? r.actions : r.action_type ? [{ type: r.action_type, value: r.action_value }] : [];
    const mode = r.match_mode || "all";
    const modeLabel = mode === "all" ? "All" : mode === "any" ? "Any" : "None";

    return { conds, acts, modeLabel };
  };

  const filteredRules = rules.filter((r) => (r.trigger_type || "incoming") === activeTrigger);

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rules</h1>
          <p className="text-sm text-[#7D8590] mt-1">Automate actions based on email events</p>
        </div>
        <button
          onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E] transition-colors"
        >
          <Plus size={16} /> New Rule
        </button>
      </div>

      {/* Trigger type tabs */}
      <div className="flex gap-1 mb-6 p-1 rounded-lg bg-[#12161B] border border-[#1E242C]">
        {TRIGGER_TYPES.map((t) => {
          const count = rules.filter((r) => (r.trigger_type || "incoming") === t.value).length;
          return (
            <button key={t.value} onClick={() => setActiveTrigger(t.value)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-[12px] font-semibold transition-all ${
                activeTrigger === t.value ? "bg-[#1E242C] text-[#E6EDF3] shadow-sm" : "text-[#7D8590] hover:text-[#E6EDF3]"
              }`}>
              <span>{t.icon}</span><span>{t.label}</span>
              {count > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${activeTrigger === t.value ? "bg-[#4ADE80] text-[#0B0E11]" : "bg-[#1E242C] text-[#484F58]"}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      <div className="text-[11px] text-[#484F58] mb-4">
        {TRIGGER_TYPES.find((t) => t.value === activeTrigger)?.description}
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="mb-6 p-4 rounded-xl bg-[#12161B] border border-[#4ADE80]/30 animate-fade-in">
          <div className="text-xs font-bold text-[#484F58] uppercase tracking-wider mb-3">
            New {TRIGGER_TYPES.find((t) => t.value === activeTrigger)?.label} Rule
          </div>
          {renderForm(false)}
        </div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <div className="space-y-2">
          {filteredRules.map((r) => {
            const { conds, acts, modeLabel } = getRuleSummary(r);

            return (
              <div key={r.id} className={`p-4 rounded-xl bg-[#12161B] border border-[#1E242C] group transition-opacity ${r.is_active ? "" : "opacity-50"}`}>
                {editingId === r.id ? (
                  renderForm(true, r.id)
                ) : (
                  <div className="flex items-start gap-3">
                    {/* Toggle */}
                    <button onClick={() => handleToggle(r.id, r.is_active)}
                      className={`mt-0.5 w-8 h-[18px] rounded-full flex items-center transition-all flex-shrink-0 ${r.is_active ? "bg-[#4ADE80] justify-end" : "bg-[#1E242C] justify-start"}`}>
                      <div className="w-3.5 h-3.5 rounded-full bg-white mx-0.5 shadow-sm" />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-[#E6EDF3] mb-1">{r.name}</div>

                      {/* Conditions summary */}
                      <div className="text-[11px] text-[#7D8590] leading-relaxed mb-0.5">
                        <span className="text-[10px] font-bold text-[#484F58] bg-[#1E242C] px-1.5 py-0.5 rounded mr-1">{modeLabel}</span>
                        {conds.map((c, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-[#484F58]"> · </span>}
                            {c.required && <span className="text-[8px] font-bold text-[#F85149] bg-[rgba(248,81,73,0.12)] px-1 py-0.5 rounded mr-0.5">REQ</span>}
                            <span className="text-[#58A6FF]">{CONDITION_FIELDS.find((f) => f.value === c.field)?.label}</span>{" "}
                            <span className="text-[#484F58]">{CONDITION_OPERATORS.find((o) => o.value === c.operator)?.label?.toLowerCase()}</span>{" "}
                            <span className="text-[#E6EDF3]">"{c.value}"</span>
                          </span>
                        ))}
                      </div>

                      {/* Actions summary */}
                      <div className="text-[11px]">
                        <span className="text-[#484F58]">→ </span>
                        {acts.map((a, i) => (
                          <span key={i}>
                            {i > 0 && <span className="text-[#484F58]">, </span>}
                            <span className="text-[#4ADE80]">{ACTION_TYPES.find((at) => at.value === a.type)?.label}</span>
                            {a.value && <span className="text-[#BC8CFF]"> {getActionLabel(a.type, a.value)}</span>}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => { setEditingId(r.id); loadRuleIntoForm(r); }}
                        className="p-1 rounded text-[#484F58] hover:text-[#7D8590] hover:bg-[#1E242C] transition-all">
                        <Edit2 size={13} />
                      </button>
                      <button onClick={() => handleDelete(r.id, r.name)}
                        className="p-1 rounded text-[#484F58] hover:text-[#F85149] hover:bg-[rgba(248,81,73,0.08)] transition-all">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {filteredRules.length === 0 && !showAdd && (
            <div className="text-center py-16 border-2 border-dashed border-[#1E242C] rounded-xl">
              <Zap className="w-12 h-12 text-[#484F58] mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No {TRIGGER_TYPES.find((t) => t.value === activeTrigger)?.label?.toLowerCase()} rules yet</h3>
              <p className="text-sm text-[#7D8590] mb-4">Create rules to auto-label, assign, or organize emails</p>
              <button onClick={() => { resetForm(); setShowAdd(true); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm">
                <Plus size={16} /> Create First Rule
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
// ── User Groups Tab ─────────────────────────────────
const GROUP_COLORS = ["#58A6FF", "#4ADE80", "#F0883E", "#BC8CFF", "#F5D547", "#F85149", "#39D2C0", "#E6EDF3"];
const GROUP_ICONS = ["👥", "🏢", "🔧", "📦", "💼", "🎯", "⚡", "🌐"];

function UserGroupsTab() {
  const [groups, setGroups] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [managingId, setManagingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formColor, setFormColor] = useState("#58A6FF");
  const [formIcon, setFormIcon] = useState("👥");

  const fetchGroups = async () => {
    const [groupsRes, membersRes] = await Promise.all([
      supabase.from("user_groups").select("*, user_group_members(team_member_id, team_member:team_members(*))").order("created_at"),
      supabase.from("team_members").select("*").eq("is_active", true).order("name"),
    ]);
    setGroups(groupsRes.data || []);
    setTeamMembers(membersRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchGroups(); }, []);

  const resetForm = () => { setFormName(""); setFormDesc(""); setFormColor("#58A6FF"); setFormIcon("👥"); };

  const handleAdd = async () => {
    if (!formName.trim()) return;
    await supabase.from("user_groups").insert({ name: formName.trim(), description: formDesc.trim(), color: formColor, icon: formIcon });
    resetForm(); setShowAdd(false); fetchGroups();
  };

  const handleUpdate = async (id: string) => {
    await supabase.from("user_groups").update({ name: formName.trim(), description: formDesc.trim(), color: formColor, icon: formIcon }).eq("id", id);
    setEditingId(null); resetForm(); fetchGroups();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete group "${name}"? Members won't be deleted.`)) return;
    await supabase.from("user_groups").delete().eq("id", id);
    fetchGroups();
  };

  const startEdit = (g: any) => {
    setEditingId(g.id); setFormName(g.name); setFormDesc(g.description || ""); setFormColor(g.color); setFormIcon(g.icon);
  };

  const toggleMember = async (groupId: string, memberId: string, isMember: boolean) => {
    if (isMember) {
      await supabase.from("user_group_members").delete().eq("group_id", groupId).eq("team_member_id", memberId);
    } else {
      await supabase.from("user_group_members").insert({ group_id: groupId, team_member_id: memberId });
    }
    fetchGroups();
  };

  const getGroupMembers = (group: any) => (group.user_group_members || []).map((m: any) => m.team_member).filter(Boolean);

  const renderForm = (isEdit: boolean, groupId?: string) => (
    <div className="space-y-3 p-4 rounded-xl bg-[#12161B] border border-[#1E242C]">
      <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Group name (e.g. Operations Team, Sales Team)"
        className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      <input value={formDesc} onChange={(e) => setFormDesc(e.target.value)} placeholder="Description (optional)"
        className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      <div className="flex gap-4">
        <div>
          <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Icon</div>
          <div className="flex flex-wrap gap-1">
            {GROUP_ICONS.map((icon) => (
              <button key={icon} onClick={() => setFormIcon(icon)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-[16px] transition-all ${formIcon === icon ? "bg-[#1E242C] ring-2 ring-[#4ADE80]" : "hover:bg-[#1E242C]"}`}>
                {icon}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Color</div>
          <div className="flex flex-wrap gap-1">
            {GROUP_COLORS.map((c) => (
              <button key={c} onClick={() => setFormColor(c)}
                className={`w-6 h-6 rounded-md transition-all ${formColor === c ? "ring-2 ring-white scale-110" : "hover:scale-110"}`} style={{ background: c }} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#0B0E11]">
          <span className="text-[16px]">{formIcon}</span>
          <span className="text-[12px] font-semibold" style={{ color: formColor }}>{formName || "Preview"}</span>
        </div>
        <div className="flex-1" />
        <button onClick={() => { isEdit ? setEditingId(null) : setShowAdd(false); resetForm(); }}
          className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-xs text-[#7D8590]">Cancel</button>
        <button onClick={() => isEdit && groupId ? handleUpdate(groupId) : handleAdd()} disabled={!formName.trim()}
          className="px-4 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold disabled:opacity-40">
          {isEdit ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Groups</h1>
          <p className="text-sm text-[#7D8590] mt-1">Create groups to quickly assign tasks to teams</p>
        </div>
        <button onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E]">
          <Plus size={16} /> New Group
        </button>
      </div>

      {showAdd && <div className="mb-4">{renderForm(false)}</div>}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const members = getGroupMembers(group);
            if (editingId === group.id) return <div key={group.id}>{renderForm(true, group.id)}</div>;

            return (
              <div key={group.id} className="rounded-xl bg-[#12161B] border border-[#1E242C] overflow-hidden">
                <div className="flex items-center gap-3 p-4 group">
                  <span className="text-[20px]">{group.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold" style={{ color: group.color }}>{group.name}</div>
                    {group.description && <div className="text-[11px] text-[#484F58]">{group.description}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] text-[#484F58] mr-2">{members.length} member{members.length !== 1 ? "s" : ""}</span>
                    <button onClick={() => setManagingId(managingId === group.id ? null : group.id)}
                      className="px-2 py-1 rounded text-[11px] text-[#58A6FF] hover:bg-[#1E242C] font-semibold">
                      {managingId === group.id ? "Done" : "Manage"}
                    </button>
                    <button onClick={() => startEdit(group)}
                      className="p-1 rounded text-[#484F58] hover:text-[#7D8590] hover:bg-[#1E242C] opacity-0 group-hover:opacity-100 transition-opacity">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(group.id, group.name)}
                      className="p-1 rounded text-[#484F58] hover:text-[#F85149] hover:bg-[rgba(248,81,73,0.08)] opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                {/* Member badges */}
                {members.length > 0 && managingId !== group.id && (
                  <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                    {members.map((m: any) => (
                      <span key={m.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px]"
                        style={{ background: `${m.color}20`, color: m.color }}>
                        <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-[#0B0E11]" style={{ background: m.color }}>{m.initials}</span>
                        {m.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Manage members panel */}
                {managingId === group.id && (
                  <div className="px-4 pb-4 border-t border-[#1E242C] pt-3">
                    <div className="text-[10px] text-[#484F58] font-semibold mb-2">
                      Toggle members:
                      <button onClick={async () => {
                        const currentIds = new Set(members.map((m: any) => m.id));
                        const allActive = teamMembers.filter((m: any) => m.is_active);
                        if (currentIds.size === allActive.length) {
                          // Remove all
                          await supabase.from("user_group_members").delete().eq("group_id", group.id);
                        } else {
                          // Add missing
                          const toAdd = allActive.filter((m: any) => !currentIds.has(m.id));
                          if (toAdd.length > 0) {
                            await supabase.from("user_group_members").insert(toAdd.map((m: any) => ({ group_id: group.id, team_member_id: m.id })));
                          }
                        }
                        fetchGroups();
                      }} className="ml-2 text-[#58A6FF] hover:text-[#79B8FF]">
                        {members.length === teamMembers.length ? "Remove all" : "Add all"}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1">
                      {teamMembers.map((m: any) => {
                        const isMember = members.some((mem: any) => mem.id === m.id);
                        return (
                          <button key={m.id} onClick={() => toggleMember(group.id, m.id, isMember)}
                            className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12px] text-left transition-all ${
                              isMember ? "bg-[rgba(74,222,128,0.1)] border border-[rgba(74,222,128,0.3)]" : "bg-[#0B0E11] border border-[#1E242C] hover:border-[#484F58]"
                            }`}>
                            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-[#0B0E11] shrink-0" style={{ background: m.color }}>{m.initials}</span>
                            <span className="flex-1 truncate" style={{ color: isMember ? "#4ADE80" : "#7D8590" }}>{m.name}</span>
                            {isMember && <Check size={12} className="text-[#4ADE80] shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {groups.length === 0 && !showAdd && (
            <div className="text-center py-16 border-2 border-dashed border-[#1E242C] rounded-xl">
              <h3 className="text-lg font-semibold mb-2">No user groups yet</h3>
              <p className="text-sm text-[#7D8590] mb-4">Create groups like &quot;Operations Team&quot; or &quot;Sales Team&quot; to assign tasks faster</p>
              <button onClick={() => { resetForm(); setShowAdd(true); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm">
                <Plus size={16} /> Create First Group
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Task Categories Tab ─────────────────────────────
const CATEGORY_COLORS = [
  "#4ADE80", "#58A6FF", "#F0883E", "#BC8CFF", "#F5D547",
  "#F85149", "#39D2C0", "#7D8590", "#E6EDF3", "#D83B01",
];
const CATEGORY_ICONS = ["📋", "📞", "🔍", "↩️", "📄", "✅", "⚡", "🎯", "💼", "🔔", "📊", "🛠️"];

function TaskCategoriesTab() {
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState("#58A6FF");
  const [formIcon, setFormIcon] = useState("📋");

  const fetchCategories = () => {
    supabase.from("task_categories").select("*").order("sort_order")
      .then(({ data }) => { setCategories(data || []); setLoading(false); });
  };

  useEffect(() => { fetchCategories(); }, []);

  const resetForm = () => { setFormName(""); setFormColor("#58A6FF"); setFormIcon("📋"); };

  const handleAdd = async () => {
    if (!formName.trim()) return;
    await supabase.from("task_categories").insert({
      name: formName.trim(), color: formColor, icon: formIcon,
      sort_order: categories.length,
    });
    resetForm(); setShowAdd(false); fetchCategories();
  };

  const handleUpdate = async (id: string) => {
    await supabase.from("task_categories").update({
      name: formName.trim(), color: formColor, icon: formIcon,
    }).eq("id", id);
    setEditingId(null); resetForm(); fetchCategories();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete category "${name}"?`)) return;
    await supabase.from("task_categories").delete().eq("id", id);
    fetchCategories();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await supabase.from("task_categories").update({ is_active: !isActive }).eq("id", id);
    fetchCategories();
  };

  const startEdit = (cat: any) => {
    setEditingId(cat.id); setFormName(cat.name); setFormColor(cat.color); setFormIcon(cat.icon);
  };

  const renderForm = (isEdit: boolean, catId?: string) => (
    <div className="space-y-3 p-4 rounded-xl bg-[#12161B] border border-[#1E242C]">
      <input value={formName} onChange={(e) => setFormName(e.target.value)}
        placeholder="Category name (e.g. Call Task, Research Task)"
        className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      <div className="flex gap-4">
        <div>
          <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Icon</div>
          <div className="flex flex-wrap gap-1">
            {CATEGORY_ICONS.map((icon) => (
              <button key={icon} onClick={() => setFormIcon(icon)}
                className={`w-8 h-8 rounded-lg flex items-center justify-center text-[16px] transition-all ${
                  formIcon === icon ? "bg-[#1E242C] ring-2 ring-[#4ADE80]" : "hover:bg-[#1E242C]"}`}>
                {icon}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Color</div>
          <div className="flex flex-wrap gap-1">
            {CATEGORY_COLORS.map((c) => (
              <button key={c} onClick={() => setFormColor(c)}
                className={`w-6 h-6 rounded-md transition-all ${
                  formColor === c ? "ring-2 ring-white scale-110" : "hover:scale-110"}`}
                style={{ background: c }} />
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-[#1E242C] bg-[#0B0E11]">
          <span className="text-[16px]">{formIcon}</span>
          <span className="text-[12px] font-semibold" style={{ color: formColor }}>{formName || "Preview"}</span>
        </div>
        <div className="flex-1" />
        <button onClick={() => { isEdit ? setEditingId(null) : setShowAdd(false); resetForm(); }}
          className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-xs text-[#7D8590]">Cancel</button>
        <button onClick={() => isEdit && catId ? handleUpdate(catId) : handleAdd()}
          disabled={!formName.trim()}
          className="px-4 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold disabled:opacity-40">
          {isEdit ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Task Categories</h1>
          <p className="text-sm text-[#7D8590] mt-1">Define categories to organize and classify tasks</p>
        </div>
        <button onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E]">
          <Plus size={16} /> New Category
        </button>
      </div>

      {showAdd && <div className="mb-4">{renderForm(false)}</div>}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <div className="space-y-2">
          {categories.map((cat) => (
            editingId === cat.id ? (
              <div key={cat.id}>{renderForm(true, cat.id)}</div>
            ) : (
              <div key={cat.id} className={`flex items-center gap-3 p-4 rounded-xl bg-[#12161B] border border-[#1E242C] group transition-opacity ${cat.is_active ? "" : "opacity-50"}`}>
                <button onClick={() => handleToggle(cat.id, cat.is_active)}
                  className={`w-8 h-[18px] rounded-full flex items-center transition-all flex-shrink-0 ${
                    cat.is_active ? "bg-[#4ADE80] justify-end" : "bg-[#1E242C] justify-start"}`}>
                  <div className="w-3.5 h-3.5 rounded-full bg-white mx-0.5 shadow-sm" />
                </button>
                <span className="text-[18px]">{cat.icon}</span>
                <span className="text-sm font-semibold flex-1" style={{ color: cat.color }}>{cat.name}</span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => startEdit(cat)}
                    className="p-1 rounded text-[#484F58] hover:text-[#7D8590] hover:bg-[#1E242C]">
                    <Edit2 size={13} />
                  </button>
                  <button onClick={() => handleDelete(cat.id, cat.name)}
                    className="p-1 rounded text-[#484F58] hover:text-[#F85149] hover:bg-[rgba(248,81,73,0.08)]">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          ))}
          {categories.length === 0 && !showAdd && (
            <div className="text-center py-16 border-2 border-dashed border-[#1E242C] rounded-xl">
              <h3 className="text-lg font-semibold mb-2">No task categories yet</h3>
              <p className="text-sm text-[#7D8590] mb-4">Create categories to organize tasks</p>
              <button onClick={() => { resetForm(); setShowAdd(true); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm">
                <Plus size={16} /> Create First Category
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Email Templates Tab ─────────────────────────────
const TEMPLATE_CATEGORIES = ["General", "Sales", "Procurement", "Follow-up", "Introduction", "Compliance", "Shipping"];

function EmailTemplatesTab() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");
  const [formScope, setFormScope] = useState<"personal" | "organization">("organization");
  const [formCategory, setFormCategory] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchTemplates = async () => {
    const { data } = await supabase.from("email_templates").select("*, owner:team_members(name)").order("scope").order("sort_order");
    setTemplates(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchTemplates();
    // Get current user ID
    supabase.from("team_members").select("id, email").then(({ data }) => {
      // Will be set properly when we know the session email
      if (data && data.length > 0) setCurrentUserId(data[0].id);
    });
  }, []);

  const resetForm = () => { setFormName(""); setFormSubject(""); setFormBody(""); setFormScope("organization"); setFormCategory(""); };

  const handleAdd = async () => {
    if (!formName.trim() || !formBody.trim()) return;
    await supabase.from("email_templates").insert({
      name: formName.trim(), subject: formSubject.trim(), body: formBody.trim(),
      scope: formScope, category: formCategory, owner_id: currentUserId,
      sort_order: templates.length,
    });
    resetForm(); setShowAdd(false); fetchTemplates();
  };

  const handleUpdate = async (id: string) => {
    await supabase.from("email_templates").update({
      name: formName.trim(), subject: formSubject.trim(), body: formBody.trim(),
      scope: formScope, category: formCategory,
    }).eq("id", id);
    setEditingId(null); resetForm(); fetchTemplates();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    await supabase.from("email_templates").delete().eq("id", id);
    fetchTemplates();
  };

  const startEdit = (t: any) => {
    setEditingId(t.id); setFormName(t.name); setFormSubject(t.subject || "");
    setFormBody(t.body); setFormScope(t.scope); setFormCategory(t.category || "");
  };

  const renderForm = (isEdit: boolean, tplId?: string) => (
    <div className="space-y-3 p-4 rounded-xl bg-[#12161B] border border-[#1E242C]">
      <div className="grid grid-cols-2 gap-3">
        <input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Template name"
          className="px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
        <input value={formSubject} onChange={(e) => setFormSubject(e.target.value)} placeholder="Subject line (optional)"
          className="px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      </div>
      <textarea value={formBody} onChange={(e) => setFormBody(e.target.value)} placeholder="Template body (supports HTML)"
        rows={8}
        className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58] resize-none" />
      <div className="flex items-center gap-3">
        <div>
          <div className="text-[10px] text-[#484F58] font-semibold mb-1">Scope</div>
          <div className="flex gap-1">
            {(["organization", "personal"] as const).map((s) => (
              <button key={s} onClick={() => setFormScope(s)}
                className={`px-3 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  formScope === s ? "bg-[#1E242C] text-[#E6EDF3] ring-1 ring-[#4ADE80]" : "bg-[#0B0E11] text-[#484F58] border border-[#1E242C]"
                }`}>
                {s === "organization" ? "🏢 Organization" : "👤 Personal"}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1">
          <div className="text-[10px] text-[#484F58] font-semibold mb-1">Category</div>
          <select value={formCategory} onChange={(e) => setFormCategory(e.target.value)}
            className="h-8 rounded-lg bg-[#0B0E11] border border-[#1E242C] px-2 text-[12px] text-[#E6EDF3] outline-none">
            <option value="">None</option>
            {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={() => { isEdit ? setEditingId(null) : setShowAdd(false); resetForm(); }}
          className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-xs text-[#7D8590]">Cancel</button>
        <button onClick={() => isEdit && tplId ? handleUpdate(tplId) : handleAdd()}
          disabled={!formName.trim() || !formBody.trim()}
          className="px-4 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold disabled:opacity-40">
          {isEdit ? "Save" : "Create"}
        </button>
      </div>
    </div>
  );

  const orgTemplates = templates.filter((t) => t.scope === "organization");
  const personalTemplates = templates.filter((t) => t.scope === "personal");

  const renderSection = (title: string, icon: string, list: any[]) => (
    <div className="mb-6">
      <div className="text-[11px] font-bold text-[#484F58] uppercase tracking-widest mb-2 flex items-center gap-1.5">
        <span>{icon}</span> {title}
      </div>
      {list.length === 0 ? (
        <div className="text-[12px] text-[#484F58] py-3 px-4 border border-dashed border-[#1E242C] rounded-lg text-center">
          No {title.toLowerCase()} yet
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((tpl) => (
            editingId === tpl.id ? (
              <div key={tpl.id}>{renderForm(true, tpl.id)}</div>
            ) : (
              <div key={tpl.id} className="rounded-xl bg-[#12161B] border border-[#1E242C] overflow-hidden group">
                <div className="flex items-center gap-3 p-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#E6EDF3]">{tpl.name}</span>
                      {tpl.category && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-[rgba(88,166,255,0.12)] text-[#58A6FF]">{tpl.category}</span>
                      )}
                    </div>
                    {tpl.subject && <div className="text-[11px] text-[#484F58] mt-0.5">Subject: {tpl.subject}</div>}
                    {tpl.owner?.name && tpl.scope === "personal" && (
                      <div className="text-[10px] text-[#484F58]">By {tpl.owner.name}</div>
                    )}
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setPreviewId(previewId === tpl.id ? null : tpl.id)}
                      className="px-2 py-1 rounded text-[10px] text-[#58A6FF] hover:bg-[#1E242C] font-semibold">
                      {previewId === tpl.id ? "Hide" : "Preview"}
                    </button>
                    <button onClick={() => startEdit(tpl)}
                      className="p-1 rounded text-[#484F58] hover:text-[#7D8590] hover:bg-[#1E242C]">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => handleDelete(tpl.id, tpl.name)}
                      className="p-1 rounded text-[#484F58] hover:text-[#F85149] hover:bg-[rgba(248,81,73,0.08)]">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                {previewId === tpl.id && (
                  <div className="px-4 pb-3 border-t border-[#1E242C] pt-2">
                    <div className="text-[12px] text-[#7D8590] bg-[#0B0E11] rounded-lg p-3 whitespace-pre-wrap max-h-[200px] overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: tpl.body }} />
                  </div>
                )}
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Email Templates</h1>
          <p className="text-sm text-[#7D8590] mt-1">Create reusable templates for common emails</p>
        </div>
        <button onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E]">
          <Plus size={16} /> New Template
        </button>
      </div>

      {showAdd && <div className="mb-4">{renderForm(false)}</div>}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <>
          {renderSection("Organization Templates", "🏢", orgTemplates)}
          {renderSection("Personal Templates", "👤", personalTemplates)}
          {templates.length === 0 && !showAdd && (
            <div className="text-center py-16 border-2 border-dashed border-[#1E242C] rounded-xl">
              <h3 className="text-lg font-semibold mb-2">No email templates yet</h3>
              <p className="text-sm text-[#7D8590] mb-4">Create templates for common replies like pricing requests, follow-ups, and introductions</p>
              <button onClick={() => { resetForm(); setShowAdd(true); }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm">
                <Plus size={16} /> Create First Template
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}