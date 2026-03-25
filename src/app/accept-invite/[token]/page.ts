"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

export default function AcceptInvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = String(params?.token || "");

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState<any>(null);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    async function loadInvite() {
      try {
        const res = await fetch(`/api/invite/${token}`);
        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Invalid invite");
        }

        setInvite(data.invite);
      } catch (err: any) {
        setError(err.message || "Failed to load invite");
      } finally {
        setLoading(false);
      }
    }

    if (token) loadInvite();
  }, [token]);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      setSaving(true);

      const res = await fetch(`/api/invite/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, confirmPassword }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to accept invite");
      }

      setSuccess(true);
      setTimeout(() => {
        router.push("/login");
      }, 1200);
    } catch (err: any) {
      setError(err.message || "Failed to accept invite");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11] px-4">
      <div className="w-full max-w-md rounded-2xl border border-[#1E242C] bg-[#0F1318] p-6">
        <div className="text-center mb-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center text-3xl font-black text-[#0B0E11] mx-auto mb-4">
            T
          </div>
          <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight">
            Accept Invite
          </h1>
          <p className="text-[#7D8590] text-sm mt-1">
            Create your password to access Tenkara Inbox
          </p>
        </div>

        {loading && <div className="text-sm text-[#7D8590]">Loading invite...</div>}

        {!loading && error && (
          <div className="text-[#F85149] text-xs bg-[rgba(248,81,73,0.08)] border border-[rgba(248,81,73,0.2)] rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {!loading && invite && !success && (
          <form className="space-y-4" onSubmit={handleAccept}>
            <div className="rounded-lg border border-[#1E242C] bg-[#12161B] px-3 py-3 text-sm text-[#E6EDF3]">
              <div className="font-semibold">{invite.name}</div>
              <div className="text-[#7D8590] text-xs mt-1">{invite.email}</div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#7D8590] mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-[#E6EDF3] text-sm outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#7D8590] mb-1.5">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-[#E6EDF3] text-sm outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
              />
            </div>

            <button
              type="submit"
              disabled={saving || !password || !confirmPassword}
              className="w-full py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3FCC73] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Creating account..." : "Accept Invite"}
            </button>
          </form>
        )}

        {!loading && success && (
          <div className="text-[#4ADE80] text-sm bg-[rgba(74,222,128,0.08)] border border-[rgba(74,222,128,0.2)] rounded-lg px-3 py-3">
            Invite accepted. Redirecting to login...
          </div>
        )}
      </div>
    </div>
  );
}