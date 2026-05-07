"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

export default function ResetPasswordPage() {
  const params = useParams();
  const router = useRouter();
  const token = String(params?.token || "");

  const [loading, setLoading] = useState(true);
  const [reset, setReset] = useState<{ name: string; email: string } | null>(null);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadReset() {
      try {
        const res = await fetch(`/api/auth/reset-password/${token}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Invalid reset link");
        }
        setReset(data.reset);
      } catch (err: any) {
        setError(err.message || "Failed to load reset link");
      } finally {
        setLoading(false);
      }
    }
    if (token) loadReset();
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch(`/api/auth/reset-password/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to reset password");
      }
      setSuccess(true);
      // Redirect to login after a short pause so the user can read the success state
      setTimeout(() => router.push("/login"), 1500);
    } catch (err: any) {
      setError(err.message || "Failed to reset password");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="text-[#7D8590] text-sm">Loading…</div>
      </div>
    );
  }

  if (error && !reset) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="w-full max-w-sm px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center text-3xl font-black text-[#0B0E11] mx-auto mb-4">
            T
          </div>
          <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight mb-2">
            Reset link unavailable
          </h1>
          <p className="text-[#F85149] text-sm mb-6">{error}</p>
          <Link
            href="/forgot-password"
            className="inline-block py-2.5 px-4 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3FCC73] transition-colors"
          >
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
        <div className="w-full max-w-sm px-6 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center text-3xl font-black text-[#0B0E11] mx-auto mb-4">
            ✓
          </div>
          <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight mb-2">
            Password reset
          </h1>
          <p className="text-[#7D8590] text-sm">Redirecting to sign in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
      <div className="w-full max-w-sm px-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center text-3xl font-black text-[#0B0E11] mx-auto mb-4">
            T
          </div>
          <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight">
            Reset password
          </h1>
          {reset && (
            <p className="text-[#7D8590] text-sm mt-1">
              for <span className="text-[#E6EDF3]">{reset.email}</span>
            </p>
          )}
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="block text-xs font-medium text-[#7D8590] mb-1.5">
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoFocus
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-[#E6EDF3] text-sm outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#7D8590] mb-1.5">
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat the password"
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-[#E6EDF3] text-sm outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
            />
          </div>

          {error && (
            <div className="text-[#F85149] text-xs bg-[rgba(248,81,73,0.08)] border border-[rgba(248,81,73,0.2)] rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !password || !confirmPassword}
            className="w-full py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3FCC73] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Reset Password"}
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
