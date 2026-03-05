"use client";

import { useState } from "react";
import { Send, Sparkles } from "lucide-react";
import { useActions } from "@/lib/hooks";
import type { AiSidebarProps } from "@/types";

export default function AISidebar({ conversation: convo }: AiSidebarProps) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState("");
  const [loading, setLoading] = useState(false);
  const { askAi } = useActions();

  const handleAsk = async () => {
    if (!query.trim() || !convo) return;
    setLoading(true);
    setResponse("");

    try {
      const result = await askAi(convo, query);
      setResponse(result.text || "Sorry, I couldn't process that.");
    } catch {
      setResponse("Connection error. Please try again.");
    }

    setLoading(false);
  };

  const quickActions = [
    { label: "Draft reply", query: "Draft a professional reply to this email" },
    { label: "Summarize thread", query: "Summarize this email thread briefly" },
    { label: "Extract action items", query: "What action items can you identify?" },
    { label: "Classify priority", query: "What priority level should this be and why?" },
  ];

  return (
    <div className="w-[280px] min-w-[280px] h-full bg-[#12161B] border-l border-[#1E242C] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-[#161B22] flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#4ADE80] to-[#39D2C0] flex items-center justify-center">
          <Sparkles size={14} className="text-[#0B0E11]" />
        </div>
        <div>
          <div className="text-[13px] font-bold text-[#E6EDF3]">Kara</div>
          <div className="text-[10px] text-[#484F58]">AI Assistant</div>
        </div>
      </div>

      {/* Quick actions */}
      {convo && (
        <div className="px-3 py-2.5 border-b border-[#161B22]">
          <div className="text-[10px] font-semibold text-[#484F58] uppercase tracking-wider mb-1.5">
            Quick Actions
          </div>
          {quickActions.map((action, i) => (
            <button
              key={i}
              onClick={() => setQuery(action.query)}
              className="block w-full text-left px-2.5 py-1.5 mb-0.5 rounded text-[11px] font-medium text-[#7D8590] bg-[#0B0E11] border border-[#1E242C] hover:border-[#4ADE80] hover:text-[#4ADE80] transition-all"
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Response */}
      <div className="flex-1 overflow-y-auto p-3">
        {response && (
          <div className="p-3 rounded-lg bg-[rgba(74,222,128,0.06)] border border-[rgba(74,222,128,0.15)] text-[12.5px] text-[#E6EDF3] leading-relaxed whitespace-pre-wrap animate-fade-in">
            {response}
          </div>
        )}
        {loading && (
          <div className="py-8 text-center text-[#4ADE80] text-xs">
            <div className="w-6 h-6 rounded-full border-2 border-[rgba(74,222,128,0.12)] border-t-[#4ADE80] animate-spin mx-auto mb-2" />
            Kara is thinking...
          </div>
        )}
        {!convo && !loading && !response && (
          <div className="text-center py-8 text-[#484F58] text-xs">
            Select a conversation to get AI assistance
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-[#161B22]">
        <div className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg border border-[#1E242C] bg-[#0B0E11]">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAsk()}
            placeholder="Ask Kara..."
            className="flex-1 bg-transparent border-none outline-none text-[#E6EDF3] text-xs placeholder:text-[#484F58]"
          />
          <button
            onClick={handleAsk}
            disabled={loading || !query.trim()}
            className={`w-7 h-7 rounded-md flex items-center justify-center transition-all ${
              query.trim() && !loading
                ? "bg-[#4ADE80] text-[#0B0E11]"
                : "text-[#484F58]"
            }`}
          >
            <Send size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
