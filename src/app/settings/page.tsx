"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Mail, Users, Tag, Shield, Plus, Trash2, Edit2,
  CheckCircle, AlertCircle, RefreshCw, Settings as SettingsIcon,
  Globe, Loader2, Eye, EyeOff, X
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

  useEffect(() => {
    supabase
      .from("team_members")
      .select("*")
      .order("created_at")
      .then(({ data }) => {
        setMembers(data || []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Team Members</h1>
          <p className="text-sm text-[#7D8590] mt-1">Manage who has access to the shared inbox</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <div key={m.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#12161B] border border-[#1E242C]">
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
              <span className="text-[10px] font-medium text-[#484F58] bg-[#1E242C] px-2 py-1 rounded">{m.department}</span>
              <span className={`text-[10px] font-bold px-2 py-1 rounded ${
                m.role === "admin" ? "bg-[rgba(74,222,128,0.12)] text-[#4ADE80]" : "bg-[#1E242C] text-[#7D8590]"
              }`}>{m.role}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Labels Tab ───────────────────────────────────────
function LabelsTab() {
  const [labels, setLabels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("labels")
      .select("*")
      .order("sort_order")
      .then(({ data }) => {
        setLabels(data || []);
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-3xl mx-auto p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Labels</h1>
          <p className="text-sm text-[#7D8590] mt-1">Organize conversations with labels</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16"><Loader2 className="w-6 h-6 animate-spin text-[#4ADE80] mx-auto" /></div>
      ) : (
        <div className="space-y-2">
          {labels.map((l) => (
            <div key={l.id} className="flex items-center gap-3 p-3 rounded-xl bg-[#12161B] border border-[#1E242C]">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: l.color }} />
              <span className="text-sm font-medium flex-1">{l.name}</span>
              <span
                className="text-[11px] font-semibold px-2 py-0.5 rounded"
                style={{ background: l.bg_color, color: l.color }}
              >
                {l.name}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
