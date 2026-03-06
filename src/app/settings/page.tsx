"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Mail, Users, Tag, Shield, Plus, Trash2, Edit2,
  CheckCircle, AlertCircle, RefreshCw, Settings as SettingsIcon,
  Globe, Loader2, Eye, EyeOff, X, Zap, GripVertical, ChevronDown
} from "lucide-react";
import { createBrowserClient } from "@/lib/supabase";

const supabase = createBrowserClient();

// ── Provider definitions matching the DB presets ─────
const PROVIDERS = [
  { id: "gmail", name: "Gmail or Google Workspace", icon: "🔵", color: "#4285F4",
    imap_host: "imap.gmail.com", imap_port: 993, smtp_host: "smtp.gmail.com", smtp_port: 587,
    help: "Requires an App Password. Go to myaccount.google.com → Security → 2-Step Verification → App Passwords → Generate one for 'Mail'." },
  { id: "microsoft", name: "Office 365", icon: "🟠", color: "#D83B01",
    imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587,
    help: "Use your full email address as username and your regular password." },
  { id: "godaddy", name: "GoDaddy (Microsoft-hosted)", icon: "🟢", color: "#00A4A6",
    imap_host: "outlook.office365.com", imap_port: 993, smtp_host: "smtp.office365.com", smtp_port: 587,
    help: "GoDaddy email is hosted on Microsoft 365. Use your full email as username and your email password." },
  { id: "outlook_com", name: "Outlook.com", icon: "🔷", color: "#0078D4",
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
  { id: "labels", label: "Labels", icon: Tag },
  { id: "rules", label: "Rules", icon: Zap },
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
        {activeTab === "labels" && <LabelsTab />}
        {activeTab === "rules" && <RulesTab />}
      </div>

      {/* Connect Email Modal */}
      {showConnectModal && <ConnectEmailModal onClose={() => setShowConnectModal(false)} />}
    </div>
  );
}

// ── Accounts Tab ─────────────────────────────────────
function AccountsTab({ onConnect }: { onConnect: () => void }) {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("email_accounts")
      .select("*")
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setAccounts(data || []);
        setLoading(false);
      });
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this email account? This won't delete any emails from the provider.")) return;
    await supabase.from("email_accounts").delete().eq("id", id);
    setAccounts((prev) => prev.filter((a) => a.id !== id));
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
            return (
              <div key={account.id} className="flex items-center gap-4 p-4 rounded-xl bg-[#12161B] border border-[#1E242C]">
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
  });
  const [showPassword, setShowPassword] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const handleSelectProvider = (provider: typeof PROVIDERS[0]) => {
    setSelectedProvider(provider);
    setFormData((prev) => ({
      ...prev,
      imap_host: provider.imap_host,
      imap_port: provider.imap_port,
      smtp_host: provider.smtp_host,
      smtp_port: provider.smtp_port,
    }));
    setStep("credentials");
  };

  const handleConnect = async () => {
    if (!formData.email || !formData.password) {
      setError("Email and password are required");
      return;
    }

    setTesting(true);
    setError("");

    try {
      // Save to Supabase
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

        {/* Credentials Form */}
        {step === "credentials" && selectedProvider && (
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
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteData, setInviteData] = useState({ email: "", name: "", role: "member", department: "Uncategorized" });
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ success: boolean; message: string } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const DEPARTMENTS = ["Operations", "Management", "Dev", "Sales", "Support", "Uncategorized"];

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    const { data } = await supabase.from("team_members").select("*").order("created_at");
    setMembers(data || []);
    setLoading(false);
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
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
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
  { value: "set_status", label: "Set status" },
];

function RulesTab() {
  const [rules, setRules] = useState<any[]>([]);
  const [labels, setLabels] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const emptyRule = {
    name: "",
    condition_field: "subject",
    condition_operator: "contains",
    condition_value: "",
    action_type: "add_label",
    action_value: "",
  };

  const [newRule, setNewRule] = useState(emptyRule);
  const [editRule, setEditRule] = useState(emptyRule);

  useEffect(() => {
    Promise.all([
      fetch("/api/rules").then((r) => r.json()),
      supabase.from("labels").select("*").order("sort_order"),
      supabase.from("team_members").select("*").eq("is_active", true),
    ]).then(([rulesData, labelsRes, membersRes]) => {
      setRules(rulesData.rules || []);
      setLabels(labelsRes.data || []);
      setMembers(membersRes.data || []);
      setLoading(false);
    });
  }, []);

  const fetchRules = async () => {
    const res = await fetch("/api/rules");
    const data = await res.json();
    setRules(data.rules || []);
  };

  // Get display name for action_value
  const getActionValueLabel = (type: string, value: string) => {
    if (type === "add_label" || type === "remove_label") {
      return labels.find((l) => l.id === value)?.name || value;
    }
    if (type === "assign_to") {
      return members.find((m) => m.id === value)?.name || value;
    }
    if (type === "set_status") return value;
    return "";
  };

  // Render the action_value selector based on action_type
  const renderActionValueInput = (actionType: string, value: string, onChange: (v: string) => void) => {
    if (actionType === "add_label" || actionType === "remove_label") {
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-2.5 py-2 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="">Select label...</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      );
    }
    if (actionType === "assign_to") {
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-2.5 py-2 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="">Select member...</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
      );
    }
    if (actionType === "set_status") {
      return (
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-2.5 py-2 rounded-md bg-[#0B0E11] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="snoozed">Snoozed</option>
        </select>
      );
    }
    return null; // star/read don't need a value
  };

  const needsActionValue = (type: string) => ["add_label", "remove_label", "assign_to", "set_status"].includes(type);

  const handleAdd = async () => {
    if (!newRule.name.trim() || !newRule.condition_value.trim()) return;
    if (needsActionValue(newRule.action_type) && !newRule.action_value) return;
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRule),
      });
      const data = await res.json();
      if (res.ok) {
        setNewRule(emptyRule);
        setShowAdd(false);
        fetchRules();
      } else { setError(data.error); }
    } catch { setError("Network error"); }
    setSaving(false);
  };

  const handleUpdate = async (id: string) => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, ...editRule }),
      });
      if (res.ok) { setEditingId(null); fetchRules(); }
      else { const d = await res.json(); setError(d.error); }
    } catch { setError("Network error"); }
    setSaving(false);
  };

  const handleToggle = async (id: string, isActive: boolean) => {
    await fetch("/api/rules", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, is_active: !isActive }),
    });
    fetchRules();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete rule "${name}"?`)) return;
    await fetch(`/api/rules?id=${id}`, { method: "DELETE" });
    fetchRules();
  };

  const RuleForm = ({ rule, setRule, onSave, onCancel, saveLabel }: {
    rule: typeof emptyRule; setRule: (r: typeof emptyRule) => void;
    onSave: () => void; onCancel: () => void; saveLabel: string;
  }) => (
    <div className="space-y-3">
      <input
        value={rule.name}
        onChange={(e) => setRule({ ...rule, name: e.target.value })}
        placeholder="Rule name (e.g. 'Auto-label RFQ emails')"
        className="w-full px-3 py-2 rounded-lg bg-[#0B0E11] border border-[#1E242C] text-sm text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
      />

      {/* Condition */}
      <div className="p-3 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
        <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider mb-2">When (condition)</div>
        <div className="flex gap-2 flex-wrap">
          <select value={rule.condition_field} onChange={(e) => setRule({ ...rule, condition_field: e.target.value })}
            className="px-2.5 py-2 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
            {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <select value={rule.condition_operator} onChange={(e) => setRule({ ...rule, condition_operator: e.target.value })}
            className="px-2.5 py-2 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
            {CONDITION_OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <input
            value={rule.condition_value}
            onChange={(e) => setRule({ ...rule, condition_value: e.target.value })}
            placeholder="Value to match..."
            className="flex-1 min-w-[150px] px-2.5 py-2 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80] placeholder:text-[#484F58]"
          />
        </div>
      </div>

      {/* Action */}
      <div className="p-3 rounded-lg bg-[#0B0E11] border border-[#1E242C]">
        <div className="text-[10px] font-bold text-[#484F58] uppercase tracking-wider mb-2">Then (action)</div>
        <div className="flex gap-2 flex-wrap">
          <select value={rule.action_type} onChange={(e) => setRule({ ...rule, action_type: e.target.value, action_value: "" })}
            className="px-2.5 py-2 rounded-md bg-[#12161B] border border-[#1E242C] text-xs text-[#E6EDF3] outline-none focus:border-[#4ADE80]">
            {ACTION_TYPES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          {needsActionValue(rule.action_type) && renderActionValueInput(
            rule.action_type,
            rule.action_value,
            (v) => setRule({ ...rule, action_value: v })
          )}
        </div>
      </div>

      {error && <div className="text-[#F85149] text-xs">{error}</div>}

      <div className="flex gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-[#1E242C] text-xs text-[#7D8590]">Cancel</button>
        <button onClick={onSave} disabled={saving || !rule.name.trim() || !rule.condition_value.trim()}
          className="px-4 py-1.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] text-xs font-semibold disabled:opacity-40">
          {saving ? "Saving..." : saveLabel}
        </button>
      </div>
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rules</h1>
          <p className="text-sm text-[#7D8590] mt-1">Automate actions on incoming emails based on conditions</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setError(""); setNewRule(emptyRule); }}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3BC96E] transition-colors"
        >
          <Plus size={16} /> New Rule
        </button>
      </div>

      {/* Add new rule */}
      {showAdd && (
        <div className="mb-6 p-4 rounded-xl bg-[#12161B] border border-[#4ADE80]/30 animate-fade-in">
          <div className="text-xs font-bold text-[#484F58] uppercase tracking-wider mb-3">New Rule</div>
          <RuleForm
            rule={newRule}
            setRule={setNewRule}
            onSave={handleAdd}
            onCancel={() => { setShowAdd(false); setError(""); }}
            saveLabel="Create Rule"
          />
        </div>
      )}

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className={`p-4 rounded-xl bg-[#12161B] border border-[#1E242C] group transition-opacity ${r.is_active ? "" : "opacity-50"}`}>
              {editingId === r.id ? (
                <RuleForm
                  rule={editRule}
                  setRule={setEditRule}
                  onSave={() => handleUpdate(r.id)}
                  onCancel={() => { setEditingId(null); setError(""); }}
                  saveLabel="Save Changes"
                />
              ) : (
                <div className="flex items-start gap-3">
                  {/* Toggle */}
                  <button
                    onClick={() => handleToggle(r.id, r.is_active)}
                    className={`mt-0.5 w-8 h-[18px] rounded-full flex items-center transition-all flex-shrink-0 ${
                      r.is_active ? "bg-[#4ADE80] justify-end" : "bg-[#1E242C] justify-start"
                    }`}
                  >
                    <div className="w-3.5 h-3.5 rounded-full bg-white mx-0.5 shadow-sm" />
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-[#E6EDF3] mb-1">{r.name}</div>
                    <div className="text-[11px] text-[#7D8590] leading-relaxed">
                      <span className="text-[#484F58]">When</span>{" "}
                      <span className="text-[#58A6FF] font-medium">{CONDITION_FIELDS.find((f) => f.value === r.condition_field)?.label}</span>{" "}
                      <span className="text-[#484F58]">{CONDITION_OPERATORS.find((o) => o.value === r.condition_operator)?.label?.toLowerCase()}</span>{" "}
                      <span className="text-[#E6EDF3] font-medium">"{r.condition_value}"</span>{" "}
                      <span className="text-[#484F58]">→</span>{" "}
                      <span className="text-[#4ADE80] font-medium">{ACTION_TYPES.find((a) => a.value === r.action_type)?.label}</span>
                      {r.action_value && (
                        <span className="text-[#BC8CFF] font-medium"> {getActionValueLabel(r.action_type, r.action_value)}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingId(r.id); setEditRule({ name: r.name, condition_field: r.condition_field, condition_operator: r.condition_operator, condition_value: r.condition_value, action_type: r.action_type, action_value: r.action_value }); setError(""); }}
                      className="p-1 rounded text-[#484F58] hover:text-[#7D8590] hover:bg-[#1E242C] transition-all"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(r.id, r.name)}
                      className="p-1 rounded text-[#484F58] hover:text-[#F85149] hover:bg-[rgba(248,81,73,0.08)] transition-all"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {rules.length === 0 && !showAdd && (
            <div className="text-center py-16 border-2 border-dashed border-[#1E242C] rounded-xl">
              <Zap className="w-12 h-12 text-[#484F58] mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No rules yet</h3>
              <p className="text-sm text-[#7D8590] mb-4">Create rules to auto-label, assign, or organize emails</p>
              <button
                onClick={() => setShowAdd(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm"
              >
                <Plus size={16} /> Create First Rule
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}