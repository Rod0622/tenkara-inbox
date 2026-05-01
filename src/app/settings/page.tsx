"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Mail, Users, Tag, Shield, Plus, Trash2, Edit2,
  CheckCircle, AlertCircle, RefreshCw, Settings as SettingsIcon,
  Globe, Loader2, Eye, EyeOff, X, Zap, GripVertical, ChevronDown,
  FileSignature, Check, ClipboardList, ClipboardCheck
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";

// Lazy-init supabase client (avoid module-level call that breaks static generation)
let _supabase: ReturnType<typeof createBrowserClient> | null = null;
function getSupabase() {
  if (!_supabase) _supabase = createBrowserClient();
  return _supabase;
}

// ── Provider definitions matching the DB presets ─────
const PROVIDERS = [
  { id: "microsoft_consent", name: "Microsoft 365 / GoDaddy / Outlook", icon: "🟠", color: "#D83B01",
    imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 587,
    help: "Sign in with your Microsoft account. Works with any Microsoft 365, GoDaddy, or Outlook email." },
  { id: "microsoft_oauth", name: "Microsoft 365 (Azure AD - Admin)", icon: "🟡", color: "#F0883E",
    imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 587,
    help: "Connect via Azure AD app credentials. For accounts where you have admin access." },
  { id: "google_oauth", name: "Gmail / Google Workspace", icon: "🔵", color: "#4285F4",
    imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 587,
    help: "Sign in with your Google account. Works with any Gmail or Google Workspace email." },
  { id: "gmail", name: "Gmail (App Password)", icon: "🔵", color: "#4285F4",
    imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 587,
    help: "Manual setup with App Password. Go to myaccount.google.com → Security → App Passwords." },
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
  { id: "task_templates", label: "Task Templates", icon: ClipboardList },
  { id: "forms", label: "Forms", icon: ClipboardCheck },
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

  // Check if user is admin
  const isAdmin = (session as any)?.teamMember?.role === "admin";
  if (!isAdmin) {
    redirect("/");
  }

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
        {activeTab === "task_templates" && <TaskTemplatesTab />}
        {activeTab === "forms" && <FormsTab />}
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
    const { error } = await getSupabase()
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
    getSupabase()
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
      const { data: convos } = await getSupabase()
        .from("conversations")
        .select("id")
        .eq("email_account_id", id);

      const convoIds = (convos || []).map((c: any) => c.id);

      if (convoIds.length > 0) {
        // Delete in batches of 100 to avoid Supabase .in() limits
        for (let i = 0; i < convoIds.length; i += 100) {
          const batch = convoIds.slice(i, i + 100);
          
          // Delete conversation labels
          await getSupabase().from("conversation_labels").delete().in("conversation_id", batch);
          
          // Delete task assignees via tasks
          const { data: batchTasks } = await getSupabase().from("tasks").select("id").in("conversation_id", batch);
          const taskIds = (batchTasks || []).map((t: any) => t.id);
          if (taskIds.length > 0) {
            await getSupabase().from("task_assignees").delete().in("task_id", taskIds);
          }
          
          // Delete tasks, notes, messages, activity, summaries
          await getSupabase().from("tasks").delete().in("conversation_id", batch);
          await getSupabase().from("notes").delete().in("conversation_id", batch);
          await getSupabase().from("messages").delete().in("conversation_id", batch);
          await getSupabase().from("activity_log").delete().in("conversation_id", batch);
          await getSupabase().from("thread_summaries").delete().in("conversation_id", batch);
        }
        
        // Delete all conversations for this account
        const { error: convoErr } = await getSupabase().from("conversations").delete().eq("email_account_id", id);
        if (convoErr) {
          alert("Failed to delete conversations: " + convoErr.message);
          return;
        }
      }

      // Delete account access entries
      await getSupabase().from("account_access").delete().eq("email_account_id", id);

      // Finally delete the account
      const { error } = await getSupabase().from("email_accounts").delete().eq("id", id);
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
    if (provider.id === "google_oauth") {
      // Redirect to Google OAuth login
      const name = prompt("Display name for this account (e.g. Rove Essentials):") || "";
      window.location.href = "/api/connect/google?name=" + encodeURIComponent(name);
      return;
    }
    if (provider.id === "microsoft_consent") {
      // Redirect to Microsoft OAuth login
      const name = prompt("Display name for this account (e.g. Bobber Labs):") || "";
      window.location.href = "/api/connect/microsoft?name=" + encodeURIComponent(name);
      return;
    }
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
      const { data, error: dbError } = await getSupabase().from("email_accounts").insert({
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
      getSupabase().from("team_members").select("*").order("created_at"),
      getSupabase().from("email_accounts").select("id, name, email, icon, color").eq("is_active", true).order("created_at"),
      getSupabase().from("account_access").select("*"),
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
      await getSupabase().from("account_access").delete()
        .eq("team_member_id", memberId).eq("email_account_id", accountId);
    } else {
      await getSupabase().from("account_access").insert({
        team_member_id: memberId, email_account_id: accountId,
      });
    }
    fetchMembers();
  };

  const grantAllAccounts = async (memberId: string) => {
    const current = accessMap[memberId] || [];
    const toAdd = emailAccounts.filter((a) => !current.includes(a.id));
    if (toAdd.length > 0) {
      await getSupabase().from("account_access").insert(
        toAdd.map((a) => ({ team_member_id: memberId, email_account_id: a.id }))
      );
    }
    fetchMembers();
  };

  const revokeAllAccounts = async (memberId: string) => {
    await getSupabase().from("account_access").delete().eq("team_member_id", memberId);
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
    const { data } = await getSupabase().from("labels").select("*").order("sort_order");
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
  { value: "from_email", label: "From", group: "Address" },
  { value: "sender_domain", label: "Sender domain", group: "Address" },
  { value: "to_addresses", label: "To", group: "Address" },
  { value: "to_cc_bcc", label: "To / Cc / Bcc", group: "Address" },
  { value: "cc_addresses", label: "Cc", group: "Address" },
  { value: "bcc_addresses", label: "Bcc", group: "Address" },
  { value: "subject", label: "Subject", group: "Content" },
  { value: "any_field", label: "Message content (all fields)", group: "Content" },
  { value: "body_text", label: "Message body", group: "Content" },
  { value: "has_attachments", label: "Has attachments?", group: "Content" },
  { value: "headers", label: "Headers", group: "Content" },
  { value: "email_account", label: "Email account", group: "More" },
  { value: "conversation_status", label: "Conversation state", group: "More" },
  { value: "assignee", label: "Assignee", group: "More" },
  { value: "assignee_is_ooo", label: "Assignee is OOO", group: "More" },
  { value: "watching_user", label: "Watching user", group: "More" },
  { value: "folder", label: "Team / Folder", group: "More" },
  { value: "has_label", label: "Label", group: "More" },
  { value: "message_count", label: "Number of messages in conversation", group: "More" },
  { value: "has_reply", label: "Has been replied to?", group: "More" },
  { value: "delay", label: "Delay (period of time)", group: "Time-based" },
  { value: "time_since_last_outbound", label: "Time since last sent email", group: "Time-based" },
  { value: "time_since_created", label: "Time since conversation created", group: "Time-based" },
  { value: "follow_up_count", label: "Follow-up count", group: "Time-based" },
  { value: "added_label_name", label: "Added label name", group: "Event" },
  { value: "removed_label_name", label: "Removed label name", group: "Event" },
  { value: "comment_text", label: "Comment text", group: "Event" },
  { value: "comment_type", label: "Comment type (note/task/comment)", group: "Event" },
  { value: "comment_mention", label: "Comment mentions user", group: "Event" },
  { value: "action_initiator", label: "Action initiator", group: "Event" },
  { value: "new_team", label: "New team (after team change)", group: "Event" },
  { value: "previous_team", label: "Previous team (before team change)", group: "Event" },
  { value: "added_assignee", label: "Added assignee", group: "Event" },
  { value: "removed_assignee", label: "Removed assignee", group: "Event" },
];

const CONDITION_OPERATORS = [
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Does not contain" },
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "is", label: "Is" },
  { value: "is_not", label: "Is not" },
  { value: "starts_with", label: "Starts with" },
  { value: "ends_with", label: "Ends with" },
  { value: "is_true", label: "Is true" },
  { value: "is_false", label: "Is false" },
  { value: "greater_than", label: "Greater than" },
  { value: "less_than", label: "Less than" },
  { value: "is_present", label: "Is present" },
  { value: "is_absent", label: "Is absent" },
];

const ACTION_TYPES = [
  { value: "add_label", label: "Add label", group: "Labels" },
  { value: "remove_label", label: "Remove label", group: "Labels" },
  { value: "set_priority", label: "Set priority (add Urgent label)", group: "Labels" },
  { value: "assign_to", label: "Assign to", group: "Assignment" },
  { value: "assign_sender", label: "Assign sender", group: "Assignment" },
  { value: "unassign", label: "Unassign", group: "Assignment" },
  { value: "unassign_all", label: "Unassign all (event rules)", group: "Assignment" },
  { value: "move_to_folder", label: "Move to folder / team", group: "Organization" },
  { value: "set_status", label: "Set status", group: "Organization" },
  { value: "archive", label: "Archive (close)", group: "Organization" },
  { value: "close_conversation", label: "Close conversation", group: "Organization" },
  { value: "snooze", label: "Snooze", group: "Organization" },
  { value: "discard_snooze", label: "Discard snooze (wake up)", group: "Organization" },
  { value: "trash", label: "Trash", group: "Organization" },
  { value: "add_watcher", label: "Add watcher", group: "Watchers" },
  { value: "remove_watcher", label: "Remove watcher", group: "Watchers" },
  { value: "mark_starred", label: "Star", group: "Flags" },
  { value: "unstar", label: "Unstar", group: "Flags" },
  { value: "mark_read", label: "Mark as read", group: "Flags" },
  { value: "mark_unread", label: "Mark as unread", group: "Flags" },
  { value: "add_note", label: "Add note", group: "Tasks & Notes" },
  { value: "add_task", label: "Add task", group: "Tasks & Notes" },
  { value: "create_task_template", label: "Create task from template", group: "Tasks & Notes" },
  { value: "forward_email", label: "Forward to email address", group: "Integration" },
  { value: "slack_notify", label: "Send Slack notification", group: "Integration" },
  { value: "webhook", label: "Webhook (HTTP POST)", group: "Integration" },
  { value: "stop_processing", label: "Stop processing more rules", group: "Flow" },
  { value: "send_follow_up", label: "Send follow-up email (template)", group: "Follow-up" },
  { value: "create_draft", label: "Create draft & notify", group: "Follow-up" },
  { value: "notify_assignee", label: "Notify user", group: "Follow-up" },
];

const TRIGGER_TYPES = [
  { value: "incoming", label: "Incoming", icon: "📥", description: "Runs when a new email arrives" },
  { value: "outgoing", label: "Outgoing", icon: "📤", description: "Runs when an email is sent" },
  { value: "unreplied", label: "Unreplied", icon: "⏰", description: "Runs automatically when we're waiting for a supplier reply (checked hourly)" },
  { value: "user_action", label: "User Action", icon: "👤", description: "Runs when a user performs an action (see 'Triggers on' dropdown)" },
];

// Sub-triggers that live under the "User Action" tab.
// The "any" option maps to the legacy trigger_type = "user_action".
// All others map to their own trigger_type value in the database.
const USER_ACTION_SUBTYPES = [
  { value: "user_action", label: "Any user action", icon: "👤", description: "Generic user-triggered rule" },
  { value: "label_added", label: "Label added", icon: "🏷️", description: "Runs when a label is added to a conversation" },
  { value: "label_removed", label: "Label removed", icon: "❌", description: "Runs when a label is removed from a conversation" },
  { value: "new_comment", label: "New comment (note or task)", icon: "💬", description: "Runs when someone posts an internal note or task" },
  { value: "assignee_changed", label: "Assignee changed", icon: "👥", description: "Runs when a conversation's assignee changes" },
  { value: "team_changed", label: "Team changed", icon: "🔀", description: "Runs when a conversation moves between team folders" },
  { value: "conversation_closed", label: "Conversation closed", icon: "✅", description: "Runs when a conversation is closed" },
  { value: "conversation_reopened", label: "Conversation reopened", icon: "♻️", description: "Runs when a closed conversation is reopened" },
];

// The event-based trigger types that appear in the UI under "User Action" tab.
const EVENT_TRIGGER_TYPES = new Set([
  "label_added", "label_removed", "new_comment",
  "assignee_changed", "conversation_closed",
  "team_changed", "conversation_reopened",
]);

interface RuleCondition { field: string; operator: string; value: string; required?: boolean; }
interface RuleConditionGroup { match_mode: "all" | "any" | "none"; conditions: (RuleCondition | RuleConditionGroup)[]; }
interface RuleAction { type: string; value: string; task_description?: string; task_assignee_mode?: string; task_assignee_ids?: string[]; task_due_days?: number; task_due_hours?: number; webhook_secret?: string; webhook_run_once?: boolean; }

function isGroup(item: any): item is RuleConditionGroup {
  return item && "match_mode" in item && "conditions" in item && Array.isArray(item.conditions);
}

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
  const [formConditions, setFormConditions] = useState<(RuleCondition | RuleConditionGroup)[]>([{ field: "subject", operator: "contains", value: "" }]);
  const [formActions, setFormActions] = useState<RuleAction[]>([{ type: "add_label", value: "" }]);
  const [formAccountIds, setFormAccountIds] = useState<string[]>([]);
  // When activeTrigger === "user_action", this can narrow the rule to a specific event sub-type.
  // Defaults to "user_action" (generic user-action rule).
  const [formSubTrigger, setFormSubTrigger] = useState<string>("user_action");
  const [emailAccounts, setEmailAccounts] = useState<any[]>([]);
  const [userGroups, setUserGroups] = useState<any[]>([]);
  const [taskCategories, setTaskCategories] = useState<any[]>([]);
  const [emailTemplates, setEmailTemplates] = useState<any[]>([]);
  const [taskTemplates, setTaskTemplates] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      fetch("/api/rules").then((r) => r.json()),
      getSupabase().from("labels").select("*").order("sort_order"),
      getSupabase().from("team_members").select("*").eq("is_active", true),
      getSupabase().from("folders").select("*").order("sort_order"),
      getSupabase().from("email_accounts").select("id, name, email").eq("is_active", true),
      getSupabase().from("user_groups").select("id, name").order("created_at"),
      getSupabase().from("task_categories").select("id, name").order("sort_order"),
      getSupabase().from("email_templates").select("id, name, subject").order("sort_order"),
      getSupabase().from("task_templates").select("id, name").order("sort_order"),
    ]).then(([rulesData, labelsRes, membersRes, foldersRes, accountsRes, groupsRes, categoriesRes, templatesRes, taskTplRes]) => {
      setRules(rulesData.rules || []);
      setLabels(labelsRes.data || []);
      setMembers(membersRes.data || []);
      setAllFolders(foldersRes.data || []);
      setEmailAccounts(accountsRes.data || []);
      setUserGroups(groupsRes.data || []);
      setTaskCategories(categoriesRes.data || []);
      setEmailTemplates(templatesRes.data || []);
      setTaskTemplates(taskTplRes.data || []);
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
    setFormAccountIds([]);
    setFormSubTrigger("user_action");
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
    setFormAccountIds(r.account_ids || []);
    // If this is an event-based rule (label_added, etc.), remember its sub-type.
    if (EVENT_TRIGGER_TYPES.has(r.trigger_type)) {
      setFormSubTrigger(r.trigger_type);
    } else {
      setFormSubTrigger("user_action");
    }
    setError("");
  };

  const handleAdd = async () => {
    if (!formName.trim()) return;
    // Validate flat conditions only (groups validated separately)
    const flatConds = formConditions.filter((c) => !isGroup(c)) as RuleCondition[];
    if (flatConds.some((c) => !["has_attachments", "has_reply", "delay", "assignee_is_ooo"].includes(c.field) && !c.value?.trim())) return;
    const needsVal = (t: string) => ["add_label", "remove_label", "assign_to", "set_status", "move_to_folder", "add_note", "add_task", "webhook", "send_follow_up", "create_draft"].includes(t);
    if (formActions.some((a) => needsVal(a.type) && !a.value)) return;
    setSaving(true); setError("");
    try {
      // When the active tab is User Action, let the sub-trigger narrow to a specific event type.
      const effectiveTriggerType = activeTrigger === "user_action" ? formSubTrigger : activeTrigger;
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formName,
          trigger_type: effectiveTriggerType,
          match_mode: formMatchMode,
          conditions: formConditions,
          actions: formActions,
          account_ids: formAccountIds.length > 0 ? formAccountIds : null,
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
      // Allow editing a rule to change its sub-trigger when on User Action tab.
      const effectiveTriggerType = activeTrigger === "user_action" ? formSubTrigger : activeTrigger;
      const res = await fetch("/api/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: formName,
          trigger_type: effectiveTriggerType,
          match_mode: formMatchMode,
          conditions: formConditions,
          actions: formActions,
          account_ids: formAccountIds.length > 0 ? formAccountIds : null,
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
  // Tree-aware condition helpers — use path arrays to address nested items
  const updateConditionAtPath = (path: number[], patch: Partial<RuleCondition>) => {
    setFormConditions((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      let target: any = clone;
      for (let i = 0; i < path.length - 1; i++) {
        target = isGroup(target[path[i]]) ? target[path[i]].conditions : target;
        if (i < path.length - 2) target = target[path[i + 1]] !== undefined ? target : target;
      }
      const idx = path[path.length - 1];
      if (target[idx] && !isGroup(target[idx])) target[idx] = { ...target[idx], ...patch };
      return clone;
    });
  };
  // Simpler: flat update for top-level (backward compat used by existing renderers)
  const updateCondition = (idx: number, patch: Partial<RuleCondition>) => {
    setFormConditions((prev) => prev.map((c, i) => i === idx ? { ...(c as any), ...patch } : c));
  };
  const addCondition = () => {
    setFormConditions((prev) => [...prev, { field: "subject", operator: "contains", value: "" }]);
  };
  const addConditionGroup = () => {
    setFormConditions((prev) => [...prev, { match_mode: "any" as const, conditions: [{ field: "subject", operator: "contains", value: "" }] }]);
  };
  const removeCondition = (idx: number) => {
    if (formConditions.length <= 1) return;
    setFormConditions((prev) => prev.filter((_, i) => i !== idx));
  };
  // Add condition inside a group
  const addConditionToGroup = (groupIdx: number) => {
    setFormConditions((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      const g = clone[groupIdx];
      if (isGroup(g)) g.conditions.push({ field: "subject", operator: "contains", value: "" });
      return clone;
    });
  };
  // Add nested group inside a group
  const addNestedGroup = (groupIdx: number) => {
    setFormConditions((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      const g = clone[groupIdx];
      if (isGroup(g)) g.conditions.push({ match_mode: "any" as const, conditions: [{ field: "subject", operator: "contains", value: "" }] });
      return clone;
    });
  };
  // Remove condition inside a group
  const removeConditionFromGroup = (groupIdx: number, condIdx: number) => {
    setFormConditions((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      const g = clone[groupIdx];
      if (isGroup(g) && g.conditions.length > 1) g.conditions.splice(condIdx, 1);
      return clone;
    });
  };
  // Update condition inside a group
  const updateConditionInGroup = (groupIdx: number, condIdx: number, patch: Partial<RuleCondition>) => {
    setFormConditions((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      const g = clone[groupIdx];
      if (isGroup(g) && g.conditions[condIdx] && !isGroup(g.conditions[condIdx])) {
        g.conditions[condIdx] = { ...g.conditions[condIdx], ...patch };
      }
      return clone;
    });
  };
  // Update group match mode
  const updateGroupMatchMode = (groupIdx: number, mode: "all" | "any" | "none") => {
    setFormConditions((prev) => {
      const clone = JSON.parse(JSON.stringify(prev));
      const g = clone[groupIdx];
      if (isGroup(g)) g.match_mode = mode;
      return clone;
    });
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
      const isAuto = action.value.startsWith("auto:");
      const isInitiator = action.value === "__initiator__";
      const autoParts = isAuto ? action.value.split(":") : [];
      const autoStrategy = autoParts[1] || "";
      const autoPool = autoParts[2] || "all";
      const autoExtra = autoParts[3] || "all";

      const buildAutoValue = (strategy: string, pool: string, extra?: string) => {
        let v = `auto:${strategy}:${pool}`;
        if (strategy === "least_tasks" && extra) v += `:${extra}`;
        return v;
      };

      return (
        <div className="flex-1 flex flex-col gap-1.5">
          {/* Mode selector */}
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => updateAction(idx, { value: "" })}
              className={`px-2 py-1 rounded text-[10px] font-medium ${!isAuto && !isInitiator ? "bg-[#4ADE80]/12 text-[#4ADE80] border border-[#4ADE80]/30" : "text-[#7D8590] border border-[#1E242C]"}`}>
              Specific person</button>
            <button onClick={() => updateAction(idx, { value: "auto:random:all" })}
              className={`px-2 py-1 rounded text-[10px] font-medium ${isAuto ? "bg-[#58A6FF]/12 text-[#58A6FF] border border-[#58A6FF]/30" : "text-[#7D8590] border border-[#1E242C]"}`}>
              Auto-assign</button>
            <button onClick={() => updateAction(idx, { value: "__initiator__" })}
              className={`px-2 py-1 rounded text-[10px] font-medium ${isInitiator ? "bg-[#D9822B]/12 text-[#D9822B] border border-[#D9822B]/30" : "text-[#7D8590] border border-[#1E242C]"}`}
              title="Assign to the user who triggered the event (only works for event-based rules)">
              Action initiator</button>
          </div>
          {isInitiator ? (
            <div className="text-[10px] text-[#7D8590] italic py-1">
              Conversation will be assigned to whoever triggered the rule (only fires for event-based triggers: label changes, comments, assignment changes, etc.).
            </div>
          ) : !isAuto ? (
            <select value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
              className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
              <option value="">Select member...</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          ) : (
            <div className="flex flex-col gap-1.5">
              {/* Strategy */}
              <select value={autoStrategy} onChange={(e) => updateAction(idx, { value: buildAutoValue(e.target.value, autoPool, autoExtra) })}
                className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="random">Random</option>
                <option value="round_robin">Round Robin</option>
                <option value="least_conversations">Least Open Conversations</option>
                <option value="least_tasks">Least Open Tasks</option>
              </select>
              {/* Pool: all or group */}
              <select value={autoPool} onChange={(e) => updateAction(idx, { value: buildAutoValue(autoStrategy, e.target.value, autoExtra) })}
                className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="all">From: All members</option>
                {userGroups.map((g) => <option key={g.id} value={g.id}>From: {g.name}</option>)}
              </select>
              {/* Extra: task category (only for least_tasks) */}
              {autoStrategy === "least_tasks" && (
                <select value={autoExtra} onChange={(e) => updateAction(idx, { value: buildAutoValue(autoStrategy, autoPool, e.target.value) })}
                  className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                  <option value="all">Count: All task categories</option>
                  {taskCategories.map((c) => <option key={c.id} value={c.id}>Count: {c.name} tasks only</option>)}
                </select>
              )}
            </div>
          )}
        </div>
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
    if (t === "add_note") {
      return (
        <input value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          placeholder="Note text..."
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      );
    }
    if (t === "add_task") {
      return (
        <div className="flex-1 space-y-1.5">
          <input value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
            placeholder="Task description..."
            className="w-full px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
          <input value={(action as any).task_description || ""} onChange={(e) => updateAction(idx, { task_description: e.target.value } as any)}
            placeholder="Description (optional)"
            className="w-full px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
          <div className="flex items-center gap-2">
            <select value={(action as any).task_assignee_mode || ""} onChange={(e) => updateAction(idx, { task_assignee_mode: e.target.value } as any)}
              className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
              <option value="">No assignees</option>
              <option value="assigned_users">Assigned users</option>
              <option value="all">Everyone</option>
              <option value="initiator">Action initiator (event rules only)</option>
              <option value="specific">Specific users...</option>
            </select>
            {(action as any).task_assignee_mode === "specific" && (
              <select multiple value={(action as any).task_assignee_ids || []} onChange={(e) => updateAction(idx, { task_assignee_ids: Array.from(e.target.selectedOptions, o => o.value) } as any)}
                className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] max-h-20">
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#7D8590]">Due in</span>
            <input type="number" min="0" value={(action as any).task_due_days || ""} onChange={(e) => updateAction(idx, { task_due_days: parseInt(e.target.value) || 0 } as any)}
              placeholder="Days" className="w-16 px-2 py-1 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
            <span className="text-[10px] text-[#7D8590]">days</span>
            <input type="number" min="0" value={(action as any).task_due_hours || ""} onChange={(e) => updateAction(idx, { task_due_hours: parseInt(e.target.value) || 0 } as any)}
              placeholder="Hours" className="w-16 px-2 py-1 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
            <span className="text-[10px] text-[#7D8590]">hours</span>
          </div>
        </div>
      );
    }
    if (t === "webhook") {
      return (
        <div className="flex-1 space-y-1.5">
          <input value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
            placeholder="https://example.com/webhook"
            className="w-full px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
          <input value={(action as any).webhook_secret || ""} onChange={(e) => updateAction(idx, { webhook_secret: e.target.value } as any)}
            placeholder="Signature secret (optional)"
            className="w-full px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
          <label className="flex items-center gap-1.5 text-[10px] text-[#7D8590] cursor-pointer">
            <input type="checkbox" checked={(action as any).webhook_run_once || false} onChange={(e) => updateAction(idx, { webhook_run_once: e.target.checked } as any)}
              className="rounded border-[#1E242C]" />
            Run only once per message
          </label>
          <div className="text-[9px] text-[#484F58]">URL will receive POST requests with JSON payloads.</div>
        </div>
      );
    }
    if (t === "assign_sender") {
      return <div className="flex-1 text-[10px] text-[#7D8590] italic py-1">Conversation will be assigned to the message sender.</div>;
    }
    if (t === "unassign_all") {
      const exceptInitiator = action.value === "__except_initiator__";
      return (
        <div className="flex-1 flex flex-col gap-1.5">
          <div className="flex gap-1">
            <button onClick={() => updateAction(idx, { value: "" })}
              className={`px-2 py-1 rounded text-[10px] font-medium ${!exceptInitiator ? "bg-[#4ADE80]/12 text-[#4ADE80] border border-[#4ADE80]/30" : "text-[#7D8590] border border-[#1E242C]"}`}>
              Always unassign</button>
            <button onClick={() => updateAction(idx, { value: "__except_initiator__" })}
              className={`px-2 py-1 rounded text-[10px] font-medium ${exceptInitiator ? "bg-[#D9822B]/12 text-[#D9822B] border border-[#D9822B]/30" : "text-[#7D8590] border border-[#1E242C]"}`}>
              Keep initiator</button>
          </div>
          <div className="text-[10px] text-[#7D8590] italic">
            {exceptInitiator
              ? "Unassign unless the current assignee is the user who triggered the rule."
              : "Clear the conversation's assignee."}
          </div>
        </div>
      );
    }
    if (t === "close_conversation") {
      return <div className="flex-1 text-[10px] text-[#7D8590] italic py-1">Conversation status will be set to closed.</div>;
    }
    if (t === "discard_snooze") {
      return <div className="flex-1 text-[10px] text-[#7D8590] italic py-1">Wakes up the conversation if it's currently snoozed (no-op otherwise).</div>;
    }
    if (t === "add_watcher" || t === "remove_watcher") {
      return (
        <select value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="">Select user...</option>
          <option value="__initiator__">Action initiator (event rules)</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      );
    }
    if (t === "send_follow_up" || t === "create_draft") {
      return (
        <select value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="">Select email template...</option>
          {emailTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.subject ? ` — ${t.subject}` : ""}</option>)}
        </select>
      );
    }
    if (t === "notify_assignee") {
      return (
        <select value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="assignee">Notify assignee</option>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      );
    }
    if (t === "create_task_template") {
      return (
        <select value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="">Select task template...</option>
          {taskTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      );
    }
    if (t === "forward_email") {
      return (
        <input value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          placeholder="forward-to@example.com"
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      );
    }
    if (t === "slack_notify") {
      return (
        <input value={action.value} onChange={(e) => updateAction(idx, { value: e.target.value })}
          placeholder="Slack webhook URL (leave empty for default)"
          className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      );
    }
    return null;
  };

  const getActionLabel = (type: string, value: string) => {
    if (type === "add_label" || type === "remove_label") return labels.find((l) => l.id === value)?.name || "";
    if (type === "assign_to") {
      if (value === "__initiator__") return "action initiator";
      return members.find((m) => m.id === value)?.name || "";
    }
    if (type === "unassign_all") return value === "__except_initiator__" ? "(keep initiator)" : "";
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

      {/* Triggers on — only visible under User Action tab */}
      {activeTrigger === "user_action" && (
        <div className="p-3 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
          <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider mb-2">Triggers on</div>
          <div className="flex flex-wrap gap-1.5">
            {USER_ACTION_SUBTYPES.map((sub) => (
              <button
                key={sub.value}
                onClick={() => setFormSubTrigger(sub.value)}
                title={sub.description}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                  formSubTrigger === sub.value
                    ? "bg-[#D9822B]/12 text-[#D9822B] border border-[#D9822B]/30"
                    : "text-[#7D8590] hover:text-[#E6EDF3] border border-[#1E242C]"
                }`}
              >
                <span className="mr-1">{sub.icon}</span>{sub.label}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-[#484F58] mt-1.5">
            {USER_ACTION_SUBTYPES.find((s) => s.value === formSubTrigger)?.description}
          </div>
        </div>
      )}

      {/* Account scope */}
      <div className="p-3 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
        <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider mb-2">Applies to</div>
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setFormAccountIds([])}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
              formAccountIds.length === 0
                ? "bg-[#4ADE80]/12 text-[#4ADE80] border border-[#4ADE80]/30"
                : "text-[#7D8590] hover:text-[#E6EDF3] border border-[#1E242C]"
            }`}
          >All Accounts</button>
          {emailAccounts.map((acc) => (
            <button
              key={acc.id}
              onClick={() => {
                setFormAccountIds((prev) =>
                  prev.includes(acc.id)
                    ? prev.filter((id) => id !== acc.id)
                    : [...prev, acc.id]
                );
              }}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all ${
                formAccountIds.includes(acc.id)
                  ? "bg-[#58A6FF]/12 text-[#58A6FF] border border-[#58A6FF]/30"
                  : "text-[#7D8590] hover:text-[#E6EDF3] border border-[#1E242C]"
              }`}
            >{acc.name || acc.email}</button>
          ))}
        </div>
        {formAccountIds.length > 0 && (
          <div className="text-[10px] text-[#484F58] mt-1.5">
            This rule will only apply to conversations from {formAccountIds.length} selected account{formAccountIds.length > 1 ? "s" : ""}
          </div>
        )}
      </div>

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

        {formConditions.map((item, idx) => (
          isGroup(item) ? (
            /* ── Nested Condition Group ── */
            <div key={idx} className="mb-2 ml-4 p-2.5 rounded-lg border border-[#1E242C] bg-[#12161B]/50 relative">
              <div className="flex items-center gap-2 mb-2">
                <select value={item.match_mode} onChange={(e) => updateGroupMatchMode(idx, e.target.value as any)}
                  className="px-2 py-1 rounded-md bg-[#12161B] border border-[#1E242C] text-[10px] font-semibold text-[#58A6FF] outline-none focus:border-[#4ADE80]">
                  <option value="all">All must match</option>
                  <option value="any">At least one matches</option>
                  <option value="none">None must match</option>
                </select>
                <span className="text-[9px] text-[#484F58]">of these {item.conditions.length} conditions</span>
                <div className="flex-1" />
                <button onClick={() => removeCondition(idx)}
                  className="p-1 rounded text-[#484F58] hover:text-[#F85149] transition-colors" title="Remove group">
                  <Trash2 size={12} />
                </button>
              </div>
              {item.conditions.map((subItem: any, subIdx: number) => (
                !isGroup(subItem) ? (
                  <div key={subIdx} className="flex gap-1.5 mb-1.5 items-center">
                    <select value={subItem.field} onChange={(e) => updateConditionInGroup(idx, subIdx, { field: e.target.value })}
                      className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                      {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                    <select value={subItem.operator} onChange={(e) => updateConditionInGroup(idx, subIdx, { operator: e.target.value })}
                      className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                      {CONDITION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {subItem.field === "assignee_is_ooo" || subItem.field === "has_attachments" ? (
                      <span className="text-[10px] text-[#484F58] px-2 flex-1">(use Is true / Is false)</span>
                    ) : subItem.operator === "is_present" || subItem.operator === "is_absent" ? (
                      <span className="text-[10px] text-[#484F58] px-2 flex-1">(no value needed)</span>
                    ) : subItem.field === "action_initiator" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Any user</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    ) : subItem.field === "added_assignee" || subItem.field === "removed_assignee" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Any user</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    ) : subItem.field === "comment_mention" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Any mention</option>
                        <option value="@everyone">@everyone</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    ) : subItem.field === "watching_user" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Any watcher</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    ) : subItem.field === "new_team" || subItem.field === "previous_team" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Select team / folder...</option>
                        {allFolders.map((f) => <option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}
                      </select>
                    ) : subItem.field === "comment_type" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Select...</option>
                        <option value="note">Note</option>
                        <option value="task">Task</option>
                      </select>
                    ) : subItem.field === "added_label_name" || subItem.field === "removed_label_name" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Select label...</option>
                        {labels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
                      </select>
                    ) : subItem.field === "has_label" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Select label...</option>
                        {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                      </select>
                    ) : subItem.field === "assignee" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Select...</option>
                        <option value="__unassigned__">Unassigned</option>
                        {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    ) : subItem.field === "email_account" ? (
                      <select value={subItem.value} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                        <option value="">Select...</option>
                        {emailAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
                      </select>
                    ) : (
                      <input value={subItem.value || ""} onChange={(e) => updateConditionInGroup(idx, subIdx, { value: e.target.value })}
                        placeholder="Value..." className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
                    )}
                    <button onClick={() => removeConditionFromGroup(idx, subIdx)} disabled={item.conditions.length <= 1}
                      className="p-1 rounded text-[#484F58] hover:text-[#F85149] disabled:opacity-30 transition-colors" title="Remove"><Trash2 size={12} /></button>
                  </div>
                ) : (
                  <div key={subIdx} className="text-[9px] text-[#484F58] italic py-1">Deeply nested groups must be edited via API</div>
                )
              ))}
              <button onClick={() => addConditionToGroup(idx)}
                className="flex items-center gap-1 text-[9px] text-[#58A6FF] hover:text-[#7cc0ff] font-semibold mt-1 transition-colors">
                <Plus size={10} /> Add condition to group
              </button>
            </div>
          ) : (() => {
            const cond = item as RuleCondition;
            return (
            /* ── Flat Condition Row ── */
            <div key={idx} className="flex gap-1.5 mb-1.5 items-center">
            <select value={cond.field} onChange={(e) => updateCondition(idx, { field: e.target.value })}
              className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
              {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select value={cond.operator} onChange={(e) => updateCondition(idx, { operator: e.target.value })}
              className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
              {CONDITION_OPERATORS.filter((o) => {
                // Filter operators based on field type
                const boolFields = ["has_attachments", "has_reply", "assignee_is_ooo"];
                const numFields = ["message_count", "time_since_last_outbound", "time_since_created", "follow_up_count"];
                const delayField = ["delay"];
                const eventTextFields = ["added_label_name", "removed_label_name", "comment_text"];
                const eventIdFields = ["action_initiator", "new_team", "previous_team", "added_assignee", "removed_assignee", "comment_mention", "watching_user"];
                const eventChoiceFields = ["comment_type"];
                if (boolFields.includes(cond.field)) return ["is_true", "is_false"].includes(o.value);
                if (delayField.includes(cond.field)) return ["greater_than"].includes(o.value); // delay just needs "elapsed >= X"
                if (numFields.includes(cond.field)) return ["greater_than", "less_than", "equals"].includes(o.value);
                if (eventIdFields.includes(cond.field)) return ["is_present", "is_absent", "is", "is_not"].includes(o.value);
                if (eventChoiceFields.includes(cond.field)) return ["is", "is_not"].includes(o.value);
                if (eventTextFields.includes(cond.field)) return ["contains", "not_contains", "is", "is_not", "starts_with", "ends_with", "is_present", "is_absent"].includes(o.value);
                if (["email_account", "assignee", "folder", "has_label", "conversation_status"].includes(cond.field)) return ["equals", "not_equals"].includes(o.value);
                return !["is_true", "is_false", "greater_than", "less_than", "is_present", "is_absent"].includes(o.value);
              }).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {/* Smart value input based on field type */}
            {cond.field === "has_attachments" ? (
              <span className="text-[10px] text-[#484F58] px-2">(no value needed)</span>
            ) : cond.field === "assignee_is_ooo" ? (
              <span className="text-[10px] text-[#484F58] px-2">(use Is true / Is false)</span>
            ) : cond.operator === "is_present" || cond.operator === "is_absent" ? (
              <span className="text-[10px] text-[#484F58] px-2">(no value needed)</span>
            ) : cond.field === "action_initiator" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Any user (just checks presence)</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : cond.field === "added_assignee" || cond.field === "removed_assignee" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Any user (just checks presence)</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : cond.field === "comment_mention" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Any mention (just checks presence)</option>
                <option value="@everyone">@everyone</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : cond.field === "watching_user" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Any watcher (just checks presence)</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : cond.field === "new_team" || cond.field === "previous_team" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Select team / folder...</option>
                {allFolders.map((f) => <option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}
              </select>
            ) : cond.field === "comment_type" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Select type...</option>
                <option value="note">Note</option>
                <option value="task">Task</option>
              </select>
            ) : cond.field === "added_label_name" || cond.field === "removed_label_name" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Select label (or leave empty for any)...</option>
                {labels.map((l) => <option key={l.id} value={l.name}>{l.name}</option>)}
              </select>
            ) : cond.field === "email_account" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Select account...</option>
                {emailAccounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.email}</option>)}
              </select>
            ) : cond.field === "assignee" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Select member...</option>
                <option value="__unassigned__">Unassigned</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            ) : cond.field === "folder" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Select folder...</option>
                {allFolders.map((f) => <option key={f.id} value={f.id}>{f.icon} {f.name}</option>)}
              </select>
            ) : cond.field === "has_label" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="">Select label...</option>
                {labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            ) : cond.field === "conversation_status" ? (
              <select value={cond.value} onChange={(e) => updateCondition(idx, { value: e.target.value })}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                <option value="open">Open</option>
                <option value="closed">Closed</option>
                <option value="snoozed">Snoozed</option>
              </select>
            ) : cond.field === "time_since_last_outbound" ? (
              <div className="flex-1 flex gap-1.5 min-w-[100px]">
                <input
                  value={(cond.value || "").split(":")[0] || ""}
                  onChange={(e) => {
                    const unit = (cond.value || "").split(":")[1] || "days";
                    updateCondition(idx, { value: `${e.target.value}:${unit}` });
                  }}
                  placeholder="Amount..."
                  type="number"
                  min="0"
                  step="any"
                  className="flex-1 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                />
                <select
                  value={(cond.value || "").split(":")[1] || "days"}
                  onChange={(e) => {
                    const num = (cond.value || "").split(":")[0] || "0";
                    updateCondition(idx, { value: `${num}:${e.target.value}` });
                  }}
                  className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]"
                >
                  <option value="minutes">Minutes</option>
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </select>
              </div>
            ) : cond.field === "delay" ? (
              <div className="flex-1 flex gap-1.5 items-center min-w-[150px]">
                <span className="text-[10px] text-[#7D8590]">Days:</span>
                <input
                  value={(() => { const m = (cond.value || "").match(/(\d+)\s*d/); return m ? m[1] : (cond.value || "").match(/^\d+$/) ? cond.value : ""; })()}
                  onChange={(e) => {
                    const d = e.target.value || "0";
                    const hm = (cond.value || "").match(/(\d+)\s*h/);
                    const mm = (cond.value || "").match(/(\d+)\s*m/);
                    updateCondition(idx, { value: `${d}d${hm ? ` ${hm[1]}h` : ""}${mm ? ` ${mm[1]}m` : ""}`.trim() });
                  }}
                  type="number" min="0" placeholder="7"
                  className="w-14 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                />
                <span className="text-[10px] text-[#7D8590]">Hours:</span>
                <input
                  value={(() => { const m = (cond.value || "").match(/(\d+)\s*h/); return m ? m[1] : ""; })()}
                  onChange={(e) => {
                    const dm = (cond.value || "").match(/(\d+)\s*d/);
                    const mm = (cond.value || "").match(/(\d+)\s*m/);
                    const d = dm ? dm[1] : (cond.value || "").match(/^\d+$/) ? cond.value : "0";
                    updateCondition(idx, { value: `${d}d${e.target.value ? ` ${e.target.value}h` : ""}${mm ? ` ${mm[1]}m` : ""}`.trim() });
                  }}
                  type="number" min="0" placeholder="0"
                  className="w-14 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                />
                <span className="text-[10px] text-[#7D8590]">Minutes:</span>
                <input
                  value={(() => { const m = (cond.value || "").match(/(\d+)\s*m/); return m ? m[1] : ""; })()}
                  onChange={(e) => {
                    const dm = (cond.value || "").match(/(\d+)\s*d/);
                    const hm = (cond.value || "").match(/(\d+)\s*h/);
                    const d = dm ? dm[1] : (cond.value || "").match(/^\d+$/) ? cond.value : "0";
                    updateCondition(idx, { value: `${d}d${hm ? ` ${hm[1]}h` : ""}${e.target.value ? ` ${e.target.value}m` : ""}`.trim() });
                  }}
                  type="number" min="0" placeholder="0"
                  className="w-14 px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
                />
              </div>
            ) : (
              <input
                value={cond.value}
                onChange={(e) => updateCondition(idx, { value: e.target.value })}
                placeholder={["message_count", "follow_up_count"].includes(cond.field) ? "Number..." : "Value..."}
                type={["message_count", "follow_up_count"].includes(cond.field) ? "number" : "text"}
                className="flex-1 min-w-[100px] px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
              />
            )}
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
            );
          })()
        ))}
        <div className="flex items-center gap-3 mt-1">
          <button onClick={addCondition}
            className="flex items-center gap-1 text-[10px] text-[#4ADE80] hover:text-[#3BC96E] font-semibold transition-colors">
            <Plus size={11} /> Condition
          </button>
          <button onClick={addConditionGroup}
            className="flex items-center gap-1 text-[10px] text-[#58A6FF] hover:text-[#7cc0ff] font-semibold transition-colors">
            <Plus size={11} /> Condition group
          </button>
        </div>
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

  const [filterAccountId, setFilterAccountId] = useState<string>("");

  const filteredRules = rules.filter((r) => {
    const ruleTrigger = r.trigger_type || "incoming";
    // Event-based triggers (label_added, etc.) live under the User Action tab in the UI.
    const effectiveTab = EVENT_TRIGGER_TYPES.has(ruleTrigger) ? "user_action" : ruleTrigger;
    if (effectiveTab !== activeTrigger) return false;
    if (filterAccountId) {
      // Show rules that apply to this account (account_ids includes it) OR are global (no account_ids)
      if (r.account_ids && Array.isArray(r.account_ids) && r.account_ids.length > 0) {
        return r.account_ids.includes(filterAccountId);
      }
      // Global rules always show
      return true;
    }
    return true;
  });

  // Summary stats for filtered view
  const accountFilteredCount = filterAccountId
    ? rules.filter((r) => {
        if (r.account_ids?.length > 0) return r.account_ids.includes(filterAccountId);
        return true; // global
      })
    : rules;
  const scopedCount = filterAccountId
    ? rules.filter((r) => r.account_ids?.length > 0 && r.account_ids.includes(filterAccountId)).length
    : 0;
  const globalCount = rules.filter((r) => !r.account_ids || r.account_ids.length === 0).length;

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
          const count = rules.filter((r) => {
            const rt = r.trigger_type || "incoming";
            const tab = EVENT_TRIGGER_TYPES.has(rt) ? "user_action" : rt;
            return tab === t.value;
          }).length;
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

      {/* Account filter */}
      <div className="flex items-center gap-2 mb-4 p-2.5 rounded-lg bg-[#12161B] border border-[#1E242C]">
        <span className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider shrink-0">Filter by account:</span>
        <div className="flex flex-wrap gap-1">
          <button onClick={() => setFilterAccountId("")}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
              !filterAccountId ? "bg-[#4ADE80]/12 text-[#4ADE80] border border-[#4ADE80]/30" : "text-[#7D8590] border border-[#1E242C] hover:text-[#E6EDF3]"
            }`}>All ({rules.length})</button>
          {emailAccounts.map((acc) => {
            const accRuleCount = rules.filter((r) => r.account_ids?.includes(acc.id)).length;
            return (
              <button key={acc.id} onClick={() => setFilterAccountId(filterAccountId === acc.id ? "" : acc.id)}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
                  filterAccountId === acc.id ? "bg-[#58A6FF]/12 text-[#58A6FF] border border-[#58A6FF]/30" : "text-[#7D8590] border border-[#1E242C] hover:text-[#E6EDF3]"
                }`}>{acc.name || acc.email} ({accRuleCount})</button>
            );
          })}
        </div>
      </div>

      {/* Account summary */}
      {filterAccountId && (
        <div className="mb-4 p-3 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
          <div className="text-xs font-semibold text-[#E6EDF3] mb-2">
            Rules for {emailAccounts.find((a) => a.id === filterAccountId)?.name || "this account"}
          </div>
          <div className="flex gap-4 text-[11px]">
            <div><span className="text-[#58A6FF] font-bold">{scopedCount}</span> <span className="text-[#484F58]">scoped to this account</span></div>
            <div><span className="text-[#7D8590] font-bold">{globalCount}</span> <span className="text-[#484F58]">global (all accounts)</span></div>
            <div><span className="text-[#4ADE80] font-bold">{filteredRules.filter((r) => r.is_active).length}</span> <span className="text-[#484F58]">active</span></div>
            <div><span className="text-[#F85149] font-bold">{filteredRules.filter((r) => !r.is_active).length}</span> <span className="text-[#484F58]">disabled</span></div>
          </div>
        </div>
      )}

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
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <div className="text-sm font-medium text-[#E6EDF3]">{r.name}</div>
                        {EVENT_TRIGGER_TYPES.has(r.trigger_type) && (() => {
                          const sub = USER_ACTION_SUBTYPES.find((s) => s.value === r.trigger_type);
                          return sub ? (
                            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#D9822B]/12 text-[#D9822B] border border-[#D9822B]/30">
                              {sub.icon} {sub.label}
                            </span>
                          ) : null;
                        })()}
                        {r.account_ids && r.account_ids.length > 0 ? (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#58A6FF]/10 text-[#58A6FF] border border-[#58A6FF]/20">
                            {r.account_ids.map((id: string) => emailAccounts.find((a) => a.id === id)?.name || "?").join(", ")}
                          </span>
                        ) : (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#1E242C] text-[#484F58]">All accounts</span>
                        )}
                      </div>

                      {/* Conditions summary */}
                      <div className="text-[11px] text-[#7D8590] leading-relaxed mb-0.5">
                        <span className="text-[10px] font-bold text-[#484F58] bg-[#1E242C] px-1.5 py-0.5 rounded mr-1">{modeLabel}</span>
                        {conds.map((c: any, i: number) => (
                          <span key={i}>
                            {i > 0 && <span className="text-[#484F58]"> · </span>}
                            {isGroup(c) ? (
                              <span className="text-[#F5D547]">[{c.match_mode === "any" ? "Any" : c.match_mode === "none" ? "None" : "All"} of {c.conditions?.length || 0}]</span>
                            ) : (
                              <>
                                {c.required && <span className="text-[8px] font-bold text-[#F85149] bg-[rgba(248,81,73,0.12)] px-1 py-0.5 rounded mr-0.5">REQ</span>}
                                <span className="text-[#58A6FF]">{CONDITION_FIELDS.find((f: any) => f.value === c.field)?.label}</span>{" "}
                                <span className="text-[#484F58]">{CONDITION_OPERATORS.find((o: any) => o.value === c.operator)?.label?.toLowerCase()}</span>{" "}
                                <span className="text-[#E6EDF3]">"{c.value}"</span>
                              </>
                            )}
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
      getSupabase().from("user_groups").select("*, user_group_members(team_member_id, team_member:team_members(*))").order("created_at"),
      getSupabase().from("team_members").select("*").eq("is_active", true).order("name"),
    ]);
    setGroups(groupsRes.data || []);
    setTeamMembers(membersRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchGroups(); }, []);

  const resetForm = () => { setFormName(""); setFormDesc(""); setFormColor("#58A6FF"); setFormIcon("👥"); };

  const handleAdd = async () => {
    if (!formName.trim()) return;
    await getSupabase().from("user_groups").insert({ name: formName.trim(), description: formDesc.trim(), color: formColor, icon: formIcon });
    resetForm(); setShowAdd(false); fetchGroups();
  };

  const handleUpdate = async (id: string) => {
    await getSupabase().from("user_groups").update({ name: formName.trim(), description: formDesc.trim(), color: formColor, icon: formIcon }).eq("id", id);
    setEditingId(null); resetForm(); fetchGroups();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete group "${name}"? Members won't be deleted.`)) return;
    await getSupabase().from("user_groups").delete().eq("id", id);
    fetchGroups();
  };

  const startEdit = (g: any) => {
    setEditingId(g.id); setFormName(g.name); setFormDesc(g.description || ""); setFormColor(g.color); setFormIcon(g.icon);
  };

  const toggleMember = async (groupId: string, memberId: string, isMember: boolean) => {
    if (isMember) {
      await getSupabase().from("user_group_members").delete().eq("group_id", groupId).eq("team_member_id", memberId);
    } else {
      await getSupabase().from("user_group_members").insert({ group_id: groupId, team_member_id: memberId });
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
                          await getSupabase().from("user_group_members").delete().eq("group_id", group.id);
                        } else {
                          // Add missing
                          const toAdd = allActive.filter((m: any) => !currentIds.has(m.id));
                          if (toAdd.length > 0) {
                            await getSupabase().from("user_group_members").insert(toAdd.map((m: any) => ({ group_id: group.id, team_member_id: m.id })));
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
    getSupabase().from("task_categories").select("*").order("sort_order")
      .then(({ data }) => { setCategories(data || []); setLoading(false); });
  };

  useEffect(() => { fetchCategories(); }, []);

  const resetForm = () => { setFormName(""); setFormColor("#58A6FF"); setFormIcon("📋"); };

  const handleAdd = async () => {
    if (!formName.trim()) return;
    await getSupabase().from("task_categories").insert({
      name: formName.trim(), color: formColor, icon: formIcon,
      sort_order: categories.length,
    });
    resetForm(); setShowAdd(false); fetchCategories();
  };

  const handleUpdate = async (id: string) => {
    await getSupabase().from("task_categories").update({
      name: formName.trim(), color: formColor, icon: formIcon,
    }).eq("id", id);
    setEditingId(null); resetForm(); fetchCategories();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete category "${name}"?`)) return;
    await getSupabase().from("task_categories").delete().eq("id", id);
    fetchCategories();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await getSupabase().from("task_categories").update({ is_active: !isActive }).eq("id", id);
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

// ── Task Templates Tab ──────────────────────────────

function TaskTemplatesTab() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formText, setFormText] = useState("");
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formDeadlineHours, setFormDeadlineHours] = useState("");
  const [formAssigneeIds, setFormAssigneeIds] = useState<string[]>([]);

  const fetchData = () => {
    Promise.all([
      getSupabase().from("task_templates").select("*").order("sort_order"),
      getSupabase().from("task_categories").select("*").eq("is_active", true).order("sort_order"),
      getSupabase().from("team_members").select("id, name, email, initials, color, is_active").eq("is_active", true).order("name"),
    ]).then(([tplRes, catRes, memberRes]) => {
      setTemplates(tplRes.data || []);
      setCategories(catRes.data || []);
      setTeamMembers(memberRes.data || []);
      setLoading(false);
    });
  };

  useEffect(() => { fetchData(); }, []);

  const resetForm = () => {
    setFormName(""); setFormText(""); setFormCategoryId("");
    setFormDeadlineHours(""); setFormAssigneeIds([]);
  };

  const handleSave = async (id?: string) => {
    if (!formName.trim()) return;
    const payload = {
      name: formName.trim(),
      text: formText.trim(),
      category_id: formCategoryId || null,
      deadline_hours: formDeadlineHours ? parseInt(formDeadlineHours) : null,
      assignee_ids: formAssigneeIds,
      sort_order: id ? undefined : templates.length,
    };
    if (id) {
      await getSupabase().from("task_templates").update(payload).eq("id", id);
    } else {
      await getSupabase().from("task_templates").insert(payload);
    }
    resetForm(); setShowAdd(false); setEditingId(null); fetchData();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    await getSupabase().from("task_templates").delete().eq("id", id);
    fetchData();
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await getSupabase().from("task_templates").update({ is_active: !isActive }).eq("id", id);
    fetchData();
  };

  const startEdit = (tpl: any) => {
    setEditingId(tpl.id);
    setFormName(tpl.name || "");
    setFormText(tpl.text || "");
    setFormCategoryId(tpl.category_id || "");
    setFormDeadlineHours(tpl.deadline_hours ? String(tpl.deadline_hours) : "");
    setFormAssigneeIds(tpl.assignee_ids || []);
  };

  const getCategoryName = (id: string) => categories.find((c) => c.id === id)?.name || "";
  const getCategoryColor = (id: string) => categories.find((c) => c.id === id)?.color || "#484F58";
  const getCategoryIcon = (id: string) => categories.find((c) => c.id === id)?.icon || "";
  const getMemberName = (id: string) => teamMembers.find((m) => m.id === id)?.name || "Unknown";

  const renderForm = (isEdit: boolean, tplId?: string) => (
    <div className="space-y-3 p-4 rounded-xl bg-[#12161B] border border-[#1E242C]">
      <div>
        <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Template Name</div>
        <input value={formName} onChange={(e) => setFormName(e.target.value)}
          placeholder="e.g., Call Supplier, Follow Up Quote"
          className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      </div>
      <div>
        <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Task Text (pre-filled when used)</div>
        <textarea value={formText} onChange={(e) => setFormText(e.target.value)}
          placeholder="What needs to be done?"
          rows={2}
          className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      </div>
      <div className="flex gap-3">
        <div className="flex-1">
          <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Category</div>
          <select value={formCategoryId} onChange={(e) => setFormCategoryId(e.target.value)}
            className="w-full h-9 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-2 text-[12px] text-[#E6EDF3] outline-none">
            <option value="">None</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.icon} {cat.name}</option>
            ))}
          </select>
        </div>
        <div className="w-40">
          <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Start Within (hours)</div>
          <select value={formDeadlineHours} onChange={(e) => setFormDeadlineHours(e.target.value)}
            className="w-full h-9 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-2 text-[12px] text-[#E6EDF3] outline-none">
            <option value="">No limit</option>
            <option value="1">1 hour</option>
            <option value="2">2 hours</option>
            <option value="3">3 hours</option>
            <option value="4">4 hours</option>
            <option value="6">6 hours</option>
            <option value="8">8 hours</option>
            <option value="12">12 hours</option>
            <option value="24">24 hours</option>
            <option value="48">48 hours</option>
          </select>
        </div>
      </div>
      <div>
        <div className="text-[10px] text-[#484F58] font-semibold mb-1.5">Default Assignees</div>
        <div className="rounded-lg border border-[#1E242C] bg-[#0B0E11] p-2 space-y-1 max-h-32 overflow-y-auto">
          {teamMembers.map((member) => {
            const checked = formAssigneeIds.includes(member.id);
            return (
              <label key={member.id} className="flex items-center gap-2 text-[12px] text-[#E6EDF3] px-1 py-0.5 rounded hover:bg-[#1E242C] cursor-pointer">
                <input type="checkbox" checked={checked}
                  onChange={(e) => {
                    setFormAssigneeIds((prev) =>
                      e.target.checked ? [...prev, member.id] : prev.filter((id) => id !== member.id)
                    );
                  }}
                  className="accent-[#4ADE80]" />
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-[#0B0E11]"
                  style={{ background: member.color }}>{member.initials}</div>
                {member.name}
              </label>
            );
          })}
        </div>
        <div className="text-[9px] text-[#484F58] mt-1">Assignees will be filtered by account access when the template is used.</div>
      </div>
      <div className="flex gap-2">
        <button onClick={() => handleSave(isEdit ? tplId : undefined)}
          disabled={!formName.trim()}
          className="px-4 py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm disabled:opacity-50">
          {isEdit ? "Save Changes" : "Create Template"}
        </button>
        <button onClick={() => { resetForm(); setShowAdd(false); setEditingId(null); }}
          className="px-4 py-2 rounded-lg border border-[#1E242C] text-[#7D8590] text-sm hover:text-[#E6EDF3]">
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold">Task Templates</h2>
          <p className="text-sm text-[#484F58]">Create reusable task templates with pre-filled text, category, deadline, and assignees</p>
        </div>
        {!showAdd && (
          <button onClick={() => { resetForm(); setShowAdd(true); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm">
            <Plus size={16} /> New Template
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-10"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <>
          {showAdd && renderForm(false)}

          {templates.length > 0 ? (
            <div className="space-y-2 mt-4">
              {templates.map((tpl) => (
                editingId === tpl.id ? (
                  <div key={tpl.id}>{renderForm(true, tpl.id)}</div>
                ) : (
                  <div key={tpl.id} className={`flex items-start gap-4 p-4 rounded-xl border transition-all ${
                    tpl.is_active !== false ? "border-[#1E242C] bg-[#0F1318]" : "border-[#1E242C]/50 bg-[#0B0E11] opacity-60"
                  }`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold text-[#E6EDF3]">{tpl.name}</div>
                      {tpl.text && <div className="text-[12px] text-[#7D8590] mt-0.5 truncate">{tpl.text}</div>}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        {tpl.category_id && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium"
                            style={{ background: getCategoryColor(tpl.category_id) + "20", color: getCategoryColor(tpl.category_id) }}>
                            {getCategoryIcon(tpl.category_id)} {getCategoryName(tpl.category_id)}
                          </span>
                        )}
                        {tpl.deadline_hours && (
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-[rgba(245,213,71,0.12)] text-[#F5D547]">
                            Start within {tpl.deadline_hours}h
                          </span>
                        )}
                        {(tpl.assignee_ids || []).length > 0 && (
                          <span className="text-[10px] text-[#484F58]">
                            Assignees: {(tpl.assignee_ids || []).map((id: string) => getMemberName(id)).join(", ")}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => handleToggle(tpl.id, tpl.is_active !== false)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                          tpl.is_active !== false ? "text-[#4ADE80] hover:bg-[#4ADE80]/10" : "text-[#484F58] hover:bg-[#1E242C]"
                        }`} title={tpl.is_active !== false ? "Disable" : "Enable"}>
                        {tpl.is_active !== false ? <Eye size={14} /> : <EyeOff size={14} />}
                      </button>
                      <button onClick={() => startEdit(tpl)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[#484F58] hover:text-[#58A6FF] hover:bg-[#58A6FF]/10">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => handleDelete(tpl.id, tpl.name)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-[#484F58] hover:text-[#F85149] hover:bg-[#F85149]/10">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              ))}
            </div>
          ) : !showAdd && (
            <div className="text-center py-16 border border-dashed border-[#1E242C] rounded-xl">
              <ClipboardList size={40} className="mx-auto text-[#484F58] mb-3" />
              <p className="text-[#484F58] text-sm mb-4">No task templates yet</p>
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

// ── Email Templates Tab ─────────────────────────────
const TEMPLATE_CATEGORIES = ["General", "Sales", "Procurement", "Follow-up", "Introduction", "Compliance", "Shipping"];

// ── Forms Tab ────────────────────────────────────────
const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "select", label: "Dropdown" },
  { value: "multi_select", label: "Multi-select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "date", label: "Date" },
  { value: "time", label: "Time" },
  { value: "number", label: "Number" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

function FormsTab() {
  const [forms, setForms] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategoryId, setFormCategoryId] = useState("");
  const [formFields, setFormFields] = useState<any[]>([
    { label: "", field_type: "text", is_required: false, placeholder: "", options: null, default_value: "" },
  ]);

  useEffect(() => {
    Promise.all([
      fetch("/api/forms").then((r) => r.json()),
      getSupabase().from("task_categories").select("id, name").order("sort_order"),
    ]).then(([formsData, catRes]) => {
      setForms(formsData.forms || []);
      setCategories(catRes.data || []);
      setLoading(false);
    });
  }, []);

  const fetchForms = async () => {
    const res = await fetch("/api/forms");
    const data = await res.json();
    setForms(data.forms || []);
  };

  const resetForm = () => {
    setFormName(""); setFormDesc(""); setFormCategoryId("");
    setFormFields([{ label: "", field_type: "text", is_required: false, placeholder: "", options: null, default_value: "" }]);
    setError("");
  };

  const loadFormIntoEditor = (f: any) => {
    setFormName(f.name || "");
    setFormDesc(f.description || "");
    setFormCategoryId(f.task_category_id || "");
    setFormFields((f.fields || []).length > 0
      ? f.fields.map((fld: any) => ({
          label: fld.label, field_type: fld.field_type, is_required: fld.is_required,
          placeholder: fld.placeholder || "", options: fld.options, default_value: fld.default_value || "",
        }))
      : [{ label: "", field_type: "text", is_required: false, placeholder: "", options: null, default_value: "" }]
    );
  };

  const handleSave = async (id?: string) => {
    if (!formName.trim() || formFields.some((f) => !f.label.trim())) return;
    setSaving(true); setError("");
    try {
      const payload = {
        ...(id ? { id } : {}),
        name: formName, description: formDesc,
        task_category_id: formCategoryId || null,
        fields: formFields.map((f) => ({
          ...f,
          options: (f.field_type === "select" || f.field_type === "multi_select") && typeof f.options === "string"
            ? f.options.split(",").map((o: string) => o.trim()).filter(Boolean)
            : f.options,
        })),
      };
      const res = await fetch("/api/forms", {
        method: id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) { resetForm(); setShowAdd(false); setEditingId(null); fetchForms(); }
      else { const d = await res.json(); setError(d.error); }
    } catch { setError("Network error"); }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this form template?")) return;
    await fetch(`/api/forms?id=${id}`, { method: "DELETE" });
    fetchForms();
  };

  const updateField = (idx: number, patch: any) => {
    setFormFields((prev) => prev.map((f, i) => i === idx ? { ...f, ...patch } : f));
  };

  const addField = () => {
    setFormFields((prev) => [...prev, { label: "", field_type: "text", is_required: false, placeholder: "", options: null, default_value: "" }]);
  };

  const removeField = (idx: number) => {
    if (formFields.length <= 1) return;
    setFormFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= formFields.length) return;
    setFormFields((prev) => {
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  };

  // ── Render form editor ──
  const renderEditor = (isEdit: boolean, formId?: string) => (
    <div className="space-y-3">
      <input value={formName} onChange={(e) => setFormName(e.target.value)}
        placeholder="Form name (e.g. 'Call Log Form')"
        className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      <input value={formDesc} onChange={(e) => setFormDesc(e.target.value)}
        placeholder="Description (optional)"
        className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold text-[#484F58] uppercase">Linked to task category:</span>
        <select value={formCategoryId} onChange={(e) => setFormCategoryId(e.target.value)}
          className="px-2 py-1.5 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="">None (available everywhere)</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Fields */}
      <div className="p-3 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider">Form Fields</span>
          <div className="flex-1" />
          <button onClick={addField} className="text-[10px] text-[#4ADE80] hover:underline font-semibold">+ Add Field</button>
        </div>
        <div className="space-y-2">
          {formFields.map((field, idx) => (
            <div key={idx} className="flex items-start gap-2 p-2.5 rounded-lg bg-[#12161B] border border-[#1E242C]">
              <div className="flex flex-col gap-0.5 mt-1">
                <button onClick={() => moveField(idx, -1)} className="text-[#484F58] hover:text-[#E6EDF3]" title="Move up">▲</button>
                <button onClick={() => moveField(idx, 1)} className="text-[#484F58] hover:text-[#E6EDF3]" title="Move down">▼</button>
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="flex gap-2">
                  <input value={field.label} onChange={(e) => updateField(idx, { label: e.target.value })}
                    placeholder="Field label..."
                    className="flex-1 px-2 py-1.5 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
                  <select value={field.field_type} onChange={(e) => updateField(idx, { field_type: e.target.value })}
                    className="px-2 py-1.5 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
                    {FIELD_TYPES.map((ft) => <option key={ft.value} value={ft.value}>{ft.label}</option>)}
                  </select>
                  <button onClick={() => updateField(idx, { is_required: !field.is_required })}
                    className={`px-2 py-1 rounded text-[9px] font-bold shrink-0 ${field.is_required ? "bg-[rgba(248,81,73,0.12)] text-[#F85149] border border-[rgba(248,81,73,0.3)]" : "text-[#484F58] border border-[#1E242C]"}`}>
                    {field.is_required ? "Required" : "Optional"}
                  </button>
                </div>
                {(field.field_type === "select" || field.field_type === "multi_select") && (
                  <input
                    value={Array.isArray(field.options) ? field.options.join(", ") : field.options || ""}
                    onChange={(e) => updateField(idx, { options: e.target.value })}
                    placeholder="Options (comma-separated): Option 1, Option 2, Option 3"
                    className="w-full px-2 py-1.5 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
                )}
                <input value={field.placeholder || ""} onChange={(e) => updateField(idx, { placeholder: e.target.value })}
                  placeholder="Placeholder text (optional)"
                  className="w-full px-2 py-1.5 rounded-md bg-[#0B0E11] border border-[#1E242C] text-[10px] text-[#7D8590] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]" />
              </div>
              <button onClick={() => removeField(idx)} className="text-[#F85149] hover:text-[#FF8E88] mt-1" title="Remove">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {error && <div className="text-xs text-[#F85149]">{error}</div>}
      <div className="flex gap-2">
        <button onClick={() => handleSave(formId)} disabled={saving || !formName.trim()}
          className="px-4 py-2 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-bold hover:bg-[#3BC96E] disabled:opacity-50">
          {saving ? "Saving..." : isEdit ? "Update" : "Create Form"}
        </button>
        <button onClick={() => { isEdit ? setEditingId(null) : setShowAdd(false); resetForm(); }}
          className="px-3 py-2 rounded-lg border border-[#1E242C] text-xs text-[#7D8590]">Cancel</button>
      </div>
    </div>
  );

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#4ADE80]" size={24} /></div>;

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Form Templates</h1>
          <p className="text-sm text-[#7D8590] mt-1">Create forms for call logs, meeting notes, and other structured data collection</p>
        </div>
        <button onClick={() => { resetForm(); setShowAdd(true); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E] transition-colors">
          <Plus size={16} /> New Form
        </button>
      </div>

      {showAdd && (
        <div className="mb-6 p-4 rounded-xl bg-[#12161B] border border-[#4ADE80]/30">
          <div className="text-sm font-semibold text-[#E6EDF3] mb-3">New Form Template</div>
          {renderEditor(false)}
        </div>
      )}

      <div className="space-y-3">
        {forms.map((f) => (
          <div key={f.id} className={`p-4 rounded-xl bg-[#12161B] border border-[#1E242C] ${!f.is_active ? "opacity-50" : ""}`}>
            {editingId === f.id ? (
              renderEditor(true, f.id)
            ) : (
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-sm font-medium text-[#E6EDF3]">{f.name}</div>
                    {f.task_category?.name && (
                      <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#58A6FF]/10 text-[#58A6FF] border border-[#58A6FF]/20">
                        {f.task_category.name}
                      </span>
                    )}
                    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-[#1E242C] text-[#484F58]">
                      {f.fields?.length || 0} fields
                    </span>
                  </div>
                  {f.description && <div className="text-[11px] text-[#7D8590] mb-2">{f.description}</div>}
                  <div className="flex flex-wrap gap-1">
                    {(f.fields || []).map((fld: any) => (
                      <span key={fld.id} className="text-[10px] px-1.5 py-0.5 rounded bg-[#0B0E11] border border-[#1E242C] text-[#7D8590]">
                        {fld.label} <span className="text-[#484F58]">({fld.field_type})</span>
                        {fld.is_required && <span className="text-[#F85149] ml-0.5">*</span>}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => { setEditingId(f.id); loadFormIntoEditor(f); }}
                    className="p-1.5 rounded-md hover:bg-[#1E242C] text-[#7D8590] hover:text-[#E6EDF3]"><Edit2 size={14} /></button>
                  <button onClick={() => handleDelete(f.id)}
                    className="p-1.5 rounded-md hover:bg-[#1E242C] text-[#7D8590] hover:text-[#F85149]"><Trash2 size={14} /></button>
                </div>
              </div>
            )}
          </div>
        ))}
        {forms.length === 0 && !showAdd && (
          <div className="text-center py-12 text-[#484F58]">
            <ClipboardCheck size={32} className="mx-auto mb-3 opacity-50" />
            <div className="text-sm">No form templates yet</div>
            <div className="text-xs mt-1">Create a form for call logs, meeting notes, or any structured data</div>
          </div>
        )}
      </div>
    </div>
  );
}

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
    const { data } = await getSupabase().from("email_templates").select("*, owner:team_members(name)").order("scope").order("sort_order");
    setTemplates(data || []);
    setLoading(false);
  };

  useEffect(() => {
    fetchTemplates();
    // Get current user ID
    getSupabase().from("team_members").select("id, email").then(({ data }) => {
      // Will be set properly when we know the session email
      if (data && data.length > 0) setCurrentUserId(data[0].id);
    });
  }, []);

  const resetForm = () => { setFormName(""); setFormSubject(""); setFormBody(""); setFormScope("organization"); setFormCategory(""); };

  const handleAdd = async () => {
    if (!formName.trim() || !formBody.trim()) return;
    await getSupabase().from("email_templates").insert({
      name: formName.trim(), subject: formSubject.trim(), body: formBody.trim(),
      scope: formScope, category: formCategory, owner_id: currentUserId,
      sort_order: templates.length,
    });
    resetForm(); setShowAdd(false); fetchTemplates();
  };

  const handleUpdate = async (id: string) => {
    await getSupabase().from("email_templates").update({
      name: formName.trim(), subject: formSubject.trim(), body: formBody.trim(),
      scope: formScope, category: formCategory,
    }).eq("id", id);
    setEditingId(null); resetForm(); fetchTemplates();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete template "${name}"?`)) return;
    await getSupabase().from("email_templates").delete().eq("id", id);
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