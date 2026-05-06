"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import Avatar from "./Avatar";

export default function MessageHeader({ msg, convo }: { msg: any; convo: any }) {
  const [expanded, setExpanded] = useState(false);
  const toAddr = msg.to_addresses || (msg.is_outbound ? (convo.from_name ? convo.from_name + " <" + convo.from_email + ">" : convo.from_email) : "");

  return (
    <div className="flex items-start gap-2 mb-2.5">
      <Avatar
        initials={(msg.from_name || "?").slice(0, 2).toUpperCase()}
        color={msg.is_outbound ? "var(--accent)" : "var(--info)"}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[13px] font-semibold text-[var(--text-primary)]">{msg.from_name || msg.from_email}</span>
          {msg.is_outbound && <span className="text-[10px] text-[var(--accent)]">Sent</span>}
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <span className="text-[10px] text-[var(--text-muted)] truncate">
            to {toAddr ? toAddr.split(",")[0].trim() : "—"}
            {toAddr && toAddr.includes(",") ? `, +${toAddr.split(",").length - 1} more` : ""}
            {msg.cc_addresses ? `, cc: ${msg.cc_addresses.split(",")[0].trim()}` : ""}
          </span>
          <button onClick={() => setExpanded(!expanded)}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] flex-shrink-0 ml-0.5">
            <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
        {expanded && (
          <div className="mt-2 p-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-[10px] space-y-1.5">
            <div className="flex gap-2">
              <span className="text-[var(--text-secondary)] font-semibold w-10 shrink-0">From</span>
              <span className="text-[var(--text-primary)]">{msg.from_name ? `${msg.from_name} <${msg.from_email}>` : msg.from_email}</span>
            </div>
            {toAddr && (
              <div className="flex gap-2">
                <span className="text-[var(--text-secondary)] font-semibold w-10 shrink-0">To</span>
                <span className="text-[var(--text-primary)] break-all">{toAddr}</span>
              </div>
            )}
            {msg.cc_addresses && (
              <div className="flex gap-2">
                <span className="text-[var(--text-secondary)] font-semibold w-10 shrink-0">Cc</span>
                <span className="text-[var(--text-primary)] break-all">{msg.cc_addresses}</span>
              </div>
            )}
            {msg.bcc_addresses && (
              <div className="flex gap-2">
                <span className="text-[var(--text-secondary)] font-semibold w-10 shrink-0">Bcc</span>
                <span className="text-[var(--text-primary)] break-all">{msg.bcc_addresses}</span>
              </div>
            )}
            <div className="flex gap-2">
              <span className="text-[var(--text-secondary)] font-semibold w-10 shrink-0">Date</span>
              <span className="text-[var(--text-primary)]">{msg.sent_at ? new Date(msg.sent_at).toLocaleString() : "—"}</span>
            </div>
            {msg.subject && (
              <div className="flex gap-2">
                <span className="text-[var(--text-secondary)] font-semibold w-10 shrink-0">Sub</span>
                <span className="text-[var(--text-primary)]">{msg.subject}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <span className="text-[11px] text-[var(--text-muted)] flex-shrink-0">
        {msg.sent_at ? new Date(msg.sent_at).toLocaleString() : ""}
      </span>
    </div>
  );
}