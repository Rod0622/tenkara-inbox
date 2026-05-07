"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    inviteUrl?: string | null;
  } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({
          success: true,
          message: data.message,
          inviteUrl: data.inviteUrl, // present only when email failed
        });
      } else {
        setResult({ success: false, message: data.error || "Request failed" });
      }
    } catch {
      setResult({ success: false, message: "Network error" });
    }
    setLoading(false);
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
      <div className="w-full max-w-sm px-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center text-3xl font-black text-[#0B0E11] mx-auto mb-4">
            T
          </div>
          <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight">
            Forgot password
          </h1>
          <p className="text-[#7D8590] text-sm mt-1">
            We&apos;ll email you a link to reset it.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-medium text-[#7D8590] mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-[#E6EDF3] text-sm outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
            />
          </div>

          {result && !result.success && (
            <div className="text-[#F85149] text-xs bg-[rgba(248,81,73,0.08)] border border-[rgba(248,81,73,0.2)] rounded-lg px-3 py-2">
              {result.message}
            </div>
          )}

          {result && result.success && (
            <div className="space-y-2">
              <div className="text-[#4ADE80] text-xs bg-[rgba(74,222,128,0.08)] border border-[rgba(74,222,128,0.2)] rounded-lg px-3 py-2">
                {result.message}
              </div>
              {result.inviteUrl && (
                <div className="text-[10px] text-[#7D8590] bg-[#12161B] border border-[#1E242C] rounded-lg px-3 py-2 break-all font-mono">
                  {result.inviteUrl}
                </div>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3FCC73] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Sending..." : "Send Reset Link"}
          </button>
        </form>

        <div className="text-center mt-6">
          <Link
            href="/login"
            className="text-[#484F58] text-xs hover:text-[#7D8590] transition-colors"
          >
            ← Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
