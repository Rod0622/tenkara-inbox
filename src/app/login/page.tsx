"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError("Invalid email or password, or invite has not been accepted yet.");
    } else {
      router.push("/");
    }
  };

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-[#0B0E11]">
      <div className="w-full max-w-sm px-6">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center text-3xl font-black text-[#0B0E11] mx-auto mb-4">
            T
          </div>
          <h1 className="text-2xl font-bold text-[#E6EDF3] tracking-tight">
            Tenkara Inbox
          </h1>
          <p className="text-[#7D8590] text-sm mt-1">
            Sign in with your invited team account
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
              className="w-full px-3.5 py-2.5 rounded-lg bg-[#12161B] border border-[#1E242C] text-[#E6EDF3] text-sm outline-none focus:border-[#4ADE80] transition-colors placeholder:text-[#484F58]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#7D8590] mb-1.5">
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
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
            disabled={loading || !email || !password}
            className="w-full py-2.5 rounded-lg bg-[#4ADE80] text-[#0B0E11] font-semibold text-sm hover:bg-[#3FCC73] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>

          <div className="text-center pt-1">
            <Link
              href="/forgot-password"
              className="text-[#7D8590] text-xs hover:text-[#E6EDF3] transition-colors"
            >
              Forgot password?
            </Link>
          </div>
        </form>

        <p className="text-[#484F58] text-xs text-center mt-6">
          New team members must accept their invite link first before signing in.
        </p>
      </div>
    </div>
  );
}