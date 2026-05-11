"use client";

import { useState, useRef, useEffect } from "react";
import { Send, X, Sparkles, Loader2 } from "lucide-react";

/**
 * KaraAssistant - floating AI helper for the Settings page.
 *
 * UX: collapsed bubble in the bottom-right corner. Click -> expands to a chat
 * panel that scrolls independently of the settings page underneath. Persists
 * conversation history during the session (resets on full page reload).
 *
 * Backend: /api/ai/kara - see that route for the system prompt that gives Kara
 * its expertise (Tenkara Inbox app knowledge + complete Rule Engine schema).
 *
 * Intentionally NOT tied to a conversation or any other UI state. Kara answers
 * questions about the app itself; she has no access to live data.
 */
export default function KaraAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || loading) return;

    const nextMessages = [...messages, { role: "user" as const, text: q }];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/kara", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({
            role: m.role,
            content: m.text,
          })),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            text: `Sorry, Kara hit an error: ${data?.error || "Unknown"}`,
          },
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: data.text || "(empty response)" },
        ]);
      }
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `Connection error: ${e?.message || "could not reach Kara"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const examplePrompts = [
    "How do I auto-assign emails from acme.com to Maria?",
    "Build a rule that sends a Slack notification when an urgent label is added",
    "Can I auto-trash newsletters from a specific sender?",
    "How do I forward emails to a different address when they have attachments?",
  ];

  return (
    <>
      {/* Floating bubble (collapsed) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-gradient-to-br from-[var(--accent)] to-[#39D2C0] flex items-center justify-center shadow-lg shadow-black/30 hover:scale-105 active:scale-95 transition-all"
          title="Ask Kara"
        >
          <Sparkles size={22} className="text-[var(--bg)]" />
        </button>
      )}

      {/* Expanded chat panel */}
      {open && (
        <div className="fixed bottom-6 right-6 z-40 w-[400px] max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-3rem)] rounded-2xl bg-[var(--surface)] border border-[var(--border)] shadow-2xl shadow-black/40 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--accent)] to-[#39D2C0] flex items-center justify-center">
                <Sparkles size={15} className="text-[var(--bg)]" />
              </div>
              <div>
                <div className="text-[13px] font-bold text-[var(--text-primary)]">Kara</div>
                <div className="text-[10px] text-[var(--text-muted)]">
                  Rules &amp; App Assistant
                </div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="w-7 h-7 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-2)] transition-colors"
              title="Close"
            >
              <X size={16} />
            </button>
          </div>

          {/* Empty state with example prompts */}
          {messages.length === 0 && !loading && (
            <div className="flex-1 overflow-y-auto px-4 py-4">
              <div className="text-[12px] text-[var(--text-secondary)] mb-3 leading-relaxed">
                Hi - I&apos;m Kara. I can walk you through building automation rules,
                or answer general questions about how Tenkara Inbox works.
                <br />
                <br />
                Try one of these, or just describe what you want to automate:
              </div>
              <div className="space-y-1.5">
                {examplePrompts.map((p, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setInput(p);
                      setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    className="w-full text-left px-3 py-2 rounded-lg text-[11px] text-[var(--text-secondary)] bg-[var(--surface-2)] border border-[var(--border)] hover:border-[var(--accent)]/40 hover:text-[var(--text-primary)] transition-all"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages area */}
          {(messages.length > 0 || loading) && (
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] px-3 py-2 rounded-xl text-[12.5px] leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-[var(--accent)] text-[var(--bg)] rounded-br-sm"
                        : "bg-[var(--surface-2)] text-[var(--text-primary)] border border-[var(--border)] rounded-bl-sm"
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              ))}

              {loading && (
                <div className="flex justify-start">
                  <div className="bg-[var(--surface-2)] border border-[var(--border)] rounded-xl rounded-bl-sm px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "0ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "150ms" }} />
                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-bounce" style={{ animationDelay: "300ms" }} />
                    </div>
                  </div>
                </div>
              )}

              <div ref={endRef} />
            </div>
          )}

          {/* Input area */}
          <div className="px-3 py-3 border-t border-[var(--border)] shrink-0">
            <div className="flex items-end gap-2 px-3 py-2 rounded-xl border border-[var(--border)] bg-[var(--bg)] focus-within:border-[var(--accent)]/40 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe what you want to automate..."
                rows={1}
                className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] text-[12.5px] placeholder:text-[var(--text-muted)] resize-none max-h-24"
                disabled={loading}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                  input.trim() && !loading
                    ? "bg-[var(--accent)] text-[var(--bg)] hover:opacity-90 active:scale-95"
                    : "text-[var(--text-muted)] cursor-not-allowed"
                }`}
                title="Send"
              >
                {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
              </button>
            </div>
            <div className="text-[9.5px] text-[var(--text-muted)] mt-1.5 px-1">
              Kara only sees your messages, not your inbox data. For draft help inside an email, use <span className="text-[var(--text-secondary)]">Inky</span> (Sparkles button in the editor).
            </div>
          </div>
        </div>
      )}
    </>
  );
}
