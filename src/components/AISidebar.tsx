"use client";

import { useState, useRef, useEffect } from "react";
import { Send, X, Sparkles, ChevronRight } from "lucide-react";
import { useActions } from "@/lib/hooks";
import type { AiSidebarProps } from "@/types";

export default function AISidebar({ conversation: convo }: AiSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<
    { role: "user" | "assistant"; text: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const { askAi } = useActions();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [isOpen]);

  // Clear chat when conversation changes
  useEffect(() => {
    setMessages([]);
    setQuery("");
  }, [convo?.id]);

  const handleAsk = async (text?: string) => {
    const q = (text || query).trim();
    if (!q || !convo) return;

    setMessages((prev) => [...prev, { role: "user", text: q }]);
    setQuery("");
    setLoading(true);

    try {
      const result = await askAi(convo, q);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: result.text || "Sorry, I couldn't process that." },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Connection error. Please try again." },
      ]);
    }

    setLoading(false);
  };

  const quickActions = [
    { label: "Draft reply", icon: "✏️", query: "Draft a professional reply to this email" },
    { label: "Summarize", icon: "📋", query: "Summarize this email thread briefly" },
    { label: "Action items", icon: "✅", query: "What action items can you identify?" },
    { label: "Priority", icon: "🔥", query: "What priority level should this be and why?" },
  ];

  return (
    <>
      {/* ── Thin Right Tool Rail ── */}
      {!isOpen && (
        <div className="w-10 min-w-[40px] h-full bg-[#0B0E11] border-l border-[#1E242C] flex flex-col items-center py-3 gap-2 shrink-0">
          <button
            onClick={() => setIsOpen(true)}
            className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center hover:opacity-90 hover:scale-105 active:scale-95 transition-all relative"
            title="Ask Kara"
          >
            <Sparkles size={15} className="text-[#0B0E11]" />
            {convo && (
              <div className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#4ADE80] border-2 border-[#0B0E11]" />
            )}
          </button>
        </div>
      )}

      {/* ── Slide-out Panel ── */}
      {isOpen && (
      <div
        className="w-[340px] min-w-[340px] h-full bg-[#0D1117] border-l border-[#1E242C] flex flex-col shrink-0"
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-[#1E242C] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center">
              <Sparkles size={15} className="text-[#0B0E11]" />
            </div>
            <div>
              <div className="text-[13px] font-bold text-[#E6EDF3]">Kara</div>
              <div className="text-[10px] text-[#484F58]">
                {convo ? `Re: ${convo.subject?.slice(0, 30)}${(convo.subject?.length || 0) > 30 ? "…" : ""}` : "AI Assistant"}
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="w-7 h-7 rounded-md flex items-center justify-center text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#161B22] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Quick Actions (show when no messages yet) */}
        {convo && messages.length === 0 && !loading && (
          <div className="px-4 py-3 border-b border-[#1E242C] shrink-0">
            <div className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wider mb-2">
              Quick Actions
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {quickActions.map((action, i) => (
                <button
                  key={i}
                  onClick={() => handleAsk(action.query)}
                  className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-medium text-[#7D8590] bg-[#161B22] border border-[#1E242C] hover:border-[#4ADE80]/40 hover:text-[#4ADE80] transition-all text-left"
                >
                  <span>{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {!convo && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-12 h-12 rounded-full bg-[#161B22] flex items-center justify-center mb-3">
                <Sparkles size={20} className="text-[#484F58]" />
              </div>
              <div className="text-[13px] text-[#484F58]">
                Select a conversation to get AI assistance
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-xl text-[12.5px] leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[#1F6FEB] text-white rounded-br-sm"
                    : "bg-[#161B22] text-[#E6EDF3] border border-[#1E242C] rounded-bl-sm"
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.text}</div>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-[#161B22] border border-[#1E242C] rounded-xl rounded-bl-sm px-4 py-2.5">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-[#4ADE80] animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="px-3 py-3 border-t border-[#1E242C] shrink-0">
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[#1E242C] bg-[#0B0E11] focus-within:border-[#4ADE80]/40 transition-colors">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleAsk()}
              placeholder={convo ? "Ask Kara about this conversation…" : "Select a conversation first"}
              disabled={!convo}
              className="flex-1 bg-transparent border-none outline-none text-[#E6EDF3] text-[12.5px] placeholder:text-[#484F58] disabled:opacity-40"
            />
            <button
              onClick={() => handleAsk()}
              disabled={loading || !query.trim() || !convo}
              className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-all ${
                query.trim() && !loading && convo
                  ? "bg-[#4ADE80] text-[#0B0E11] hover:bg-[#3FCF73] active:scale-95"
                  : "text-[#484F58]"
              }`}
            >
              <Send size={13} />
            </button>
          </div>
        </div>
      </div>
      )}
    </>
  );
}