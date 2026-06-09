"use client";

/**
 * /conversations/[id]/print — printable, save-as-PDF view of a conversation.
 *
 * Triggered from the overflow (⋯) menu on the conversation detail. Three
 * modes via ?content= query param:
 *   • conversation       → just the email thread, no internal notes
 *   • full (default)     → email thread + Internal Notes section at bottom
 *   • notes              → just the internal notes, no email thread
 *
 * Renders a minimal, print-friendly layout (no inbox chrome, no sidebars).
 * After data loads, auto-fires window.print() so the user gets the browser's
 * native print dialog (with "Save as PDF" as one of the destinations).
 *
 * Auth: relies on the existing Supabase RLS configuration for the inbox
 * schema. If the user isn't authenticated, queries return null and we
 * render a "not found" message.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase";

type ContentMode = "conversation" | "full" | "notes";

interface ConvRow {
  id: string;
  subject: string | null;
  from_name: string | null;
  from_email: string | null;
  primary_contact_email: string | null;
  primary_contact_name: string | null;
  status: string;
  created_at: string;
  last_message_at: string | null;
  email_account_id: string | null;
  assignee_id: string | null;
}

interface MessageRow {
  id: string;
  from_name: string | null;
  from_email: string | null;
  to_addresses: unknown;
  cc_addresses: unknown;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_at: string;
  is_outbound: boolean | null;
}

interface NoteRow {
  id: string;
  text: string | null;
  created_at: string;
  author_id: string | null;
}

interface LabelRow {
  name: string | null;
  color: string | null;
  bg_color: string | null;
}

interface AccountRow {
  name: string | null;
  email: string | null;
}

interface MemberRow {
  id: string;
  name: string | null;
}

export default function PrintConversationPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const convId = (params?.id as string) || "";
  const contentMode = useMemo<ContentMode>(() => {
    const c = searchParams?.get("content") || "full";
    if (c === "conversation" || c === "notes") return c;
    return "full";
  }, [searchParams]);

  const [conv, setConv] = useState<ConvRow | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [labels, setLabels] = useState<LabelRow[]>([]);
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [assignee, setAssignee] = useState<MemberRow | null>(null);
  const [authorMap, setAuthorMap] = useState<Record<string, MemberRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!convId) {
      setError("Missing conversation id");
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const sb = createBrowserClient();

        // 1. Conversation row
        const { data: convRow, error: convErr } = await sb
          .from("conversations")
          .select(
            "id, subject, from_name, from_email, primary_contact_email, primary_contact_name, status, created_at, last_message_at, email_account_id, assignee_id"
          )
          .eq("id", convId)
          .maybeSingle();

        if (convErr || !convRow) {
          if (!cancelled) {
            setError(convErr?.message || "Conversation not found");
            setLoading(false);
          }
          return;
        }
        if (cancelled) return;
        setConv(convRow as ConvRow);

        // 2. Parallel fetches: account, assignee, labels, messages, notes
        const accountPromise = convRow.email_account_id
          ? sb
              .from("email_accounts")
              .select("name, email")
              .eq("id", convRow.email_account_id)
              .maybeSingle()
          : Promise.resolve({ data: null });

        const assigneePromise = convRow.assignee_id
          ? sb
              .from("team_members")
              .select("id, name")
              .eq("id", convRow.assignee_id)
              .maybeSingle()
          : Promise.resolve({ data: null });

        const labelsPromise = sb
          .from("conversation_labels")
          .select("label:labels(name, color, bg_color)")
          .eq("conversation_id", convId);

        const messagesPromise =
          contentMode === "notes"
            ? Promise.resolve({ data: [] })
            : sb
                .from("messages")
                .select(
                  "id, from_name, from_email, to_addresses, cc_addresses, subject, body_text, body_html, sent_at, is_outbound"
                )
                .eq("conversation_id", convId)
                .order("sent_at", { ascending: true });

        const notesPromise =
          contentMode === "conversation"
            ? Promise.resolve({ data: [] })
            : sb
                .from("notes")
                .select("id, text, created_at, author_id")
                .eq("conversation_id", convId)
                .order("created_at", { ascending: true });

        const [
          accRes,
          asnRes,
          lblRes,
          msgRes,
          noteRes,
        ] = await Promise.all([
          accountPromise,
          assigneePromise,
          labelsPromise,
          messagesPromise,
          notesPromise,
        ]);

        if (cancelled) return;

        setAccount((accRes as any)?.data || null);
        setAssignee((asnRes as any)?.data || null);

        const rawLabels = ((lblRes as any)?.data || []) as Array<{
          label: LabelRow | null;
        }>;
        setLabels(
          rawLabels.map((r) => r.label).filter((l): l is LabelRow => !!l)
        );

        const msgs = ((msgRes as any)?.data || []) as MessageRow[];
        setMessages(msgs);

        const ns = ((noteRes as any)?.data || []) as NoteRow[];
        setNotes(ns);

        // 3. Resolve note authors in one query
        const authorIds = Array.from(
          new Set(ns.map((n) => n.author_id).filter((id): id is string => !!id))
        );
        if (authorIds.length > 0) {
          const { data: members } = await sb
            .from("team_members")
            .select("id, name")
            .in("id", authorIds);
          if (!cancelled && members) {
            const map: Record<string, MemberRow> = {};
            (members as MemberRow[]).forEach((m) => {
              map[m.id] = m;
            });
            setAuthorMap(map);
          }
        }

        if (!cancelled) setLoading(false);
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message || "Failed to load conversation");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [convId, contentMode]);

  // After data settles, fire the browser print dialog. Small delay so
  // images and fonts have a moment to lay out — otherwise the printed
  // PDF can have missing or half-rendered content.
  useEffect(() => {
    if (loading || error) return;
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        /* user can also Cmd/Ctrl+P manually */
      }
    }, 600);
    return () => clearTimeout(t);
  }, [loading, error]);

  if (error) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif" }}>
        <h2>Could not load conversation</h2>
        <p style={{ color: "#666" }}>{error}</p>
      </div>
    );
  }

  if (loading || !conv) {
    return (
      <div style={{ padding: 24, fontFamily: "sans-serif", color: "#666" }}>
        Preparing print view…
      </div>
    );
  }

  const supplierLine = (() => {
    const email = conv.primary_contact_email || conv.from_email || "";
    const name = conv.primary_contact_name || conv.from_name || "";
    if (email && name) return `${name} <${email}>`;
    if (email) return email;
    if (name) return name;
    return "—";
  })();

  return (
    <>
      <style>{`
        @page { margin: 0.5in; }
        html, body { background: #fff; margin: 0; padding: 0; }
        .print-root {
          max-width: 7.5in;
          margin: 0 auto;
          padding: 0.5in;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          color: #111;
          line-height: 1.45;
          font-size: 12px;
        }
        .print-header {
          border-bottom: 2px solid #333;
          padding-bottom: 14px;
          margin-bottom: 22px;
        }
        .print-header h1 {
          font-size: 18px;
          margin: 0 0 10px 0;
          line-height: 1.3;
        }
        .meta-row {
          font-size: 11px;
          color: #555;
          line-height: 1.7;
        }
        .meta-row b { color: #111; font-weight: 600; }
        .label-chips { margin-top: 6px; }
        .label-chip {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 10px;
          font-size: 10px;
          font-weight: 500;
          margin-right: 4px;
          margin-bottom: 3px;
          border: 1px solid #d0d0d0;
          background: #f4f4f4;
          color: #333;
        }
        .section-title {
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #444;
          margin: 28px 0 12px 0;
          padding-bottom: 4px;
          border-bottom: 1px solid #aaa;
        }
        .message {
          page-break-inside: avoid;
          border-bottom: 1px solid #ddd;
          padding: 14px 0 16px 0;
        }
        .message:last-child { border-bottom: none; }
        .message .hdr {
          font-size: 10.5px;
          color: #555;
          margin-bottom: 10px;
          line-height: 1.5;
        }
        .message .hdr b { color: #111; font-weight: 600; }
        .message .body {
          font-size: 12px;
          line-height: 1.55;
          color: #1a1a1a;
          word-wrap: break-word;
        }
        .message .body img { max-width: 100% !important; height: auto !important; }
        .message .body table { max-width: 100% !important; }
        .message .body pre {
          font-family: inherit;
          white-space: pre-wrap;
          word-wrap: break-word;
          margin: 0;
        }
        .note {
          page-break-inside: avoid;
          padding: 10px 14px;
          background: #fffbe6;
          border-left: 3px solid #f6c200;
          margin-bottom: 10px;
          border-radius: 2px;
        }
        .note .hdr {
          color: #555;
          font-size: 10px;
          margin-bottom: 5px;
        }
        .note .hdr b { color: #111; font-weight: 600; }
        .note .body {
          font-size: 12px;
          white-space: pre-wrap;
          color: #1a1a1a;
        }
        .empty-state {
          font-style: italic;
          color: #888;
          margin: 14px 0;
          font-size: 11px;
        }
        .footer {
          font-size: 9px;
          color: #888;
          margin-top: 36px;
          text-align: center;
          border-top: 1px solid #ddd;
          padding-top: 10px;
        }
        @media print {
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="print-root">
        {/* ── Header ── */}
        <div className="print-header">
          <h1>{conv.subject || "(no subject)"}</h1>
          <div className="meta-row">
            <div>
              <b>Account:</b>{" "}
              {account?.email
                ? `${account.email}${account.name ? ` (${account.name})` : ""}`
                : "—"}
            </div>
            <div>
              <b>Supplier:</b> {supplierLine}
            </div>
            <div>
              <b>Status:</b> {conv.status}
            </div>
            <div>
              <b>Created:</b> {formatDate(conv.created_at)}
            </div>
            {conv.last_message_at && (
              <div>
                <b>Last message:</b> {formatDate(conv.last_message_at)}
              </div>
            )}
            {assignee?.name && (
              <div>
                <b>Assignee:</b> {assignee.name}
              </div>
            )}
            {labels.length > 0 && (
              <div className="label-chips">
                <b>Labels:</b>{" "}
                {labels.map((l, i) => (
                  <span
                    key={i}
                    className="label-chip"
                    style={
                      l.bg_color && l.color
                        ? {
                            background: l.bg_color,
                            color: l.color,
                            border: `1px solid ${l.color}`,
                          }
                        : undefined
                    }
                  >
                    {l.name || "—"}
                  </span>
                ))}
              </div>
            )}
            <div style={{ marginTop: 6, color: "#888", fontSize: 10 }}>
              Print mode:{" "}
              <b>
                {contentMode === "conversation"
                  ? "Conversation only"
                  : contentMode === "notes"
                  ? "Notes only"
                  : "Conversation + Internal Notes"}
              </b>
            </div>
          </div>
        </div>

        {/* ── Messages (if mode includes them) ── */}
        {contentMode !== "notes" && (
          <>
            {contentMode === "full" && (
              <div className="section-title">Conversation</div>
            )}
            {messages.length === 0 ? (
              <div className="empty-state">
                (No email messages in this conversation.)
              </div>
            ) : (
              messages.map((m) => (
                <div key={m.id} className="message">
                  <div className="hdr">
                    <div>
                      <b>From:</b> {formatSender(m)}
                    </div>
                    {formatRecipients(m.to_addresses) && (
                      <div>
                        <b>To:</b> {formatRecipients(m.to_addresses)}
                      </div>
                    )}
                    {formatRecipients(m.cc_addresses) && (
                      <div>
                        <b>Cc:</b> {formatRecipients(m.cc_addresses)}
                      </div>
                    )}
                    <div>
                      <b>Date:</b> {formatDate(m.sent_at)}
                    </div>
                    {m.subject && m.subject !== conv.subject && (
                      <div>
                        <b>Subject:</b> {m.subject}
                      </div>
                    )}
                  </div>
                  <div
                    className="body"
                    dangerouslySetInnerHTML={{
                      __html: m.body_html
                        ? m.body_html
                        : `<pre>${escapeHtml(m.body_text || "")}</pre>`,
                    }}
                  />
                </div>
              ))
            )}
          </>
        )}

        {/* ── Notes (if mode includes them) ── */}
        {contentMode !== "conversation" && (
          <>
            {contentMode === "full" && (
              <div className="section-title">Internal Notes</div>
            )}
            {notes.length === 0 ? (
              <div className="empty-state">
                (No internal notes on this conversation.)
              </div>
            ) : (
              notes.map((n) => (
                <div key={n.id} className="note">
                  <div className="hdr">
                    <b>{n.author_id ? authorMap[n.author_id]?.name || "—" : "—"}</b>{" "}
                    · {formatDate(n.created_at)}
                  </div>
                  <div className="body">{n.text || ""}</div>
                </div>
              ))
            )}
          </>
        )}

        <div className="footer">
          Printed from Tenkara Inbox · {new Date().toLocaleString()}
        </div>
      </div>
    </>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatSender(m: MessageRow): string {
  const name = m.from_name || "";
  const email = m.from_email || "";
  if (name && email) return `${name} <${email}>`;
  if (email) return email;
  if (name) return name;
  return "—";
}

/**
 * Normalize a JSONB address field (could be string[], object[], or string)
 * into a comma-separated display string. Returns empty string if there's
 * nothing renderable so the caller can hide the row entirely.
 */
function formatRecipients(addrs: unknown): string {
  if (!addrs) return "";
  if (typeof addrs === "string") return addrs;
  if (Array.isArray(addrs)) {
    const parts = addrs
      .map((a) => {
        if (!a) return "";
        if (typeof a === "string") return a;
        if (typeof a === "object") {
          const obj = a as { name?: string; email?: string; address?: string };
          const email = obj.email || obj.address || "";
          const name = obj.name || "";
          if (name && email) return `${name} <${email}>`;
          return email || name || "";
        }
        return String(a);
      })
      .filter(Boolean);
    return parts.join(", ");
  }
  return "";
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
