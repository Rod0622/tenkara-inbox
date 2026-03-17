"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Reply, Forward, Trash2, Send, X } from "lucide-react";

export default function ConversationDetail({
  convo,
  messages,
  currentUser,
}: any) {
  const [replyText, setReplyText] = useState("");
  const replyRef = useRef<HTMLTextAreaElement | null>(null);

  const [showForward, setShowForward] = useState(false);
  const [forwardTo, setForwardTo] = useState("");
  const [forwardSubject, setForwardSubject] = useState("");
  const [forwardBody, setForwardBody] = useState("");
  const [sendingForward, setSendingForward] = useState(false);

  const [trashing, setTrashing] = useState(false);

  // =========================
  // Reply
  // =========================
  const handleReply = () => {
    const lastMsg = messages?.[messages.length - 1];

    const quoted =
      lastMsg?.body_text
        ?.split("\n")
        .map((l: string) => `> ${l}`)
        .join("\n") || "";

    setReplyText(`\n\n---\n${quoted}`);

    setTimeout(() => {
      replyRef.current?.focus();
    }, 50);
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;

    await fetch("/api/send", {
      method: "POST",
      body: JSON.stringify({
        conversation_id: convo.id,
        body: replyText,
      }),
    });

    setReplyText("");
  };

  // =========================
  // Forward
  // =========================
  const handleOpenForward = () => {
    const lastMsg = messages?.[messages.length - 1];

    setForwardSubject(`Fwd: ${convo.subject}`);
    setForwardBody(lastMsg?.body_text || "");
    setShowForward(true);
  };

  const handleSendForward = async () => {
    if (!forwardTo || !forwardBody) return;

    try {
      setSendingForward(true);

      await fetch("/api/send", {
        method: "POST",
        body: JSON.stringify({
          account_id: convo.email_account_id,
          to: forwardTo,
          subject: forwardSubject,
          body: forwardBody,
        }),
      });

      setShowForward(false);
      setForwardTo("");
      setForwardSubject("");
      setForwardBody("");
    } finally {
      setSendingForward(false);
    }
  };

  // =========================
  // Trash (FIXED)
  // =========================
  const handleTrash = async () => {
    if (!convo) return;

    const ok = confirm("Move to trash?");
    if (!ok) return;

    try {
      setTrashing(true);

      await fetch("/api/conversations/status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation_id: convo.id,
          status: "closed", // ✅ FIXED
        }),
      });

      window.location.reload();
    } finally {
      setTrashing(false);
    }
  };

  // =========================
  // UI
  // =========================
  return (
    <div className="flex flex-col h-full">

      {/* HEADER ACTIONS */}
      <div className="flex gap-2 p-3 border-b border-[#1E242C]">
        <button onClick={handleReply}>
          <Reply size={16} />
        </button>

        <button onClick={handleOpenForward}>
          <Forward size={16} />
        </button>

        <button onClick={handleTrash} disabled={trashing}>
          <Trash2 size={16} />
        </button>
      </div>

      {/* MESSAGES */}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {messages?.map((m: any) => (
          <div key={m.id} className="text-sm text-white">
            {m.body_text}
          </div>
        ))}
      </div>

      {/* REPLY BOX */}
      <div className="p-3 border-t border-[#1E242C] flex gap-2">
        <textarea
          ref={replyRef}
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          className="flex-1 bg-[#0B0E11] border border-[#1E242C] p-2 text-white"
        />
        <button onClick={handleSendReply}>
          <Send size={16} />
        </button>
      </div>

      {/* FORWARD MODAL */}
      {showForward && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center">
          <div className="bg-[#0F1318] p-4 w-[600px] rounded-xl flex flex-col gap-3">

            <div className="flex justify-between">
              <div className="text-white font-semibold">Forward</div>
              <button onClick={() => setShowForward(false)}>
                <X size={16} />
              </button>
            </div>

            <input
              placeholder="To"
              value={forwardTo}
              onChange={(e) => setForwardTo(e.target.value)}
              className="bg-[#0B0E11] p-2 text-white"
            />

            <input
              value={forwardSubject}
              onChange={(e) => setForwardSubject(e.target.value)}
              className="bg-[#0B0E11] p-2 text-white"
            />

            <textarea
              value={forwardBody}
              onChange={(e) => setForwardBody(e.target.value)}
              className="bg-[#0B0E11] p-2 text-white h-[200px]"
            />

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForward(false)}>Cancel</button>

              <button onClick={handleSendForward} disabled={sendingForward}>
                {sendingForward ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}