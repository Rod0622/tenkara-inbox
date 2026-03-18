"use client";

import { useState } from "react";
import { X, Send, ChevronDown } from "lucide-react";
import { useActions, useEmailAccounts } from "@/lib/hooks";
import RichTextEditor, { getCleanHtml, htmlToPlainText } from "@/components/RichTextEditor";

interface ComposeEmailProps {
  onClose: () => void;
  onSent?: () => void;
}

export default function ComposeEmail({ onClose, onSent }: ComposeEmailProps) {
  const accounts = useEmailAccounts();
  const { sendEmail } = useActions();

  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const accountId = selectedAccount || accounts[0]?.id || "";
  const currentAccount = accounts.find((a) => a.id === accountId);

  const handleSend = async () => {
    const plainText = htmlToPlainText(bodyHtml);
    if (!to.trim() || !subject.trim() || !plainText.trim()) {
      setError("Please fill in To, Subject, and Body");
      return;
    }
    if (!accountId) {
      setError("Please select an email account");
      return;
    }

    setSending(true);
    setError("");

    try {
      const cleanHtml = getCleanHtml(bodyHtml);
      const result = await sendEmail({
        account_id: accountId,
        to: to.trim(),
        cc: cc.trim() || undefined,
        subject: subject.trim(),
        body: cleanHtml,
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
            disabled={sending || !to.trim() || !subject.trim()}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-bold transition-all ${
              !sending && to.trim() && subject.trim()
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
                <div className="fixed inset-0 z-40" onClick={() => setShowAccountPicker(false)} />
                <div className="absolute left-0 top-full mt-1 z-50 w-full bg-[#161B22] border border-[#1E242C] rounded-lg shadow-xl py-1">
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

        {/* To */}
        <div className="px-5 py-2.5 border-b border-[#161B22] flex items-center gap-3">
          <span className="text-[12px] font-semibold text-[#484F58] w-12 shrink-0">To</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
            className="flex-1 bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] placeholder:text-[#484F58]"
          />
          {!showCc && (
            <button onClick={() => setShowCc(true)} className="text-[11px] text-[#484F58] hover:text-[#7D8590] transition-colors">
              Cc
            </button>
          )}
        </div>

        {/* CC */}
        {showCc && (
          <div className="px-5 py-2.5 border-b border-[#161B22] flex items-center gap-3">
            <span className="text-[12px] font-semibold text-[#484F58] w-12 shrink-0">Cc</span>
            <input
              value={cc}
              onChange={(e) => setCc(e.target.value)}
              placeholder="cc@example.com"
              className="flex-1 bg-transparent border-none outline-none text-[#E6EDF3] text-[13px] placeholder:text-[#484F58]"
            />
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
          <RichTextEditor
            onChange={setBodyHtml}
            placeholder="Write your message..."
            minHeight={300}
            autoFocus
          />
        </div>
      </div>
    </div>
  );
}