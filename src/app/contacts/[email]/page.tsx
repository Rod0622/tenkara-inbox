"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileText,
  Mail,
  MessageSquare,
  ShieldAlert,
} from "lucide-react";

type CommandCenterResponse = {
  contact: {
    email: string;
    name: string | null;
  };
  summary: {
    total_threads: number;
    open_threads: number;
    closed_threads: number;
    open_tasks: number;
    completed_tasks: number;
    notes_count: number;
    activity_count: number;
    last_activity: string | null;
    risk_signals: string[];
    rollup: string;
  };
  threads: any[];
  tasks: any[];
  notes: any[];
  activities: any[];
  thread_summaries: any[];
};

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatDateTime(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export default function ContactCommandCenterPage({
  params,
}: {
  params: { email: string };
}) {
  const decodedEmail = useMemo(() => safeDecode(params.email || ""), [params.email]);

  const [data, setData] = useState<CommandCenterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const account =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("account") || ""
      : "";

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!decodedEmail) {
        setError("Missing email");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const qs = new URLSearchParams();
        qs.set("email", decodedEmail);
        if (account) qs.set("account", account);

        const res = await fetch(`/api/contact-command-center?${qs.toString()}`, {
          method: "GET",
          cache: "no-store",
        });

        const json = await res.json();

        if (!res.ok) {
          throw new Error(json?.error || "Failed to load command center");
        }

        if (!cancelled) {
          setData(json);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err?.message || "Failed to load command center");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [decodedEmail, account]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3]">
        <div className="mx-auto max-w-7xl px-6 py-10">
          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-6">
            <div className="text-sm text-[#7D8590]">Loading command center...</div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3]">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 text-[#F87171]" size={20} />
              <div>
                <div className="text-lg font-semibold text-[#F87171]">
                  Unable to load command center
                </div>
                <div className="mt-2 text-sm text-[#9BA7B4]">
                  {error || "Unknown error"}
                </div>

                <Link
                  href="/"
                  className="mt-5 inline-flex items-center gap-2 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-4 py-2 text-sm font-semibold text-[#58A6FF] hover:bg-[#151A21]"
                >
                  <ArrowLeft size={16} />
                  Back to inbox
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const { contact, summary, threads, tasks, notes, thread_summaries } = data;

  const openTasks = tasks.filter(
    (task: any) => !(task?.status === "completed" || task?.status === "done" || task?.is_done)
  );

  return (
    <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3]">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="mb-4 inline-flex items-center gap-2 text-sm font-medium text-[#58A6FF] hover:text-[#79B8FF]"
            >
              <ArrowLeft size={16} />
              Back to inbox
            </Link>

            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#12161B] border border-[#1E242C]">
                <Mail size={20} className="text-[#58A6FF]" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-[#E6EDF3]">
                  {contact.name || contact.email}
                </h1>
                <div className="text-sm text-[#7D8590]">{contact.email}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4">
            <div className="text-xs uppercase tracking-wide text-[#7D8590]">Threads</div>
            <div className="mt-2 text-2xl font-bold">{summary.total_threads}</div>
          </div>

          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4">
            <div className="text-xs uppercase tracking-wide text-[#7D8590]">Open Threads</div>
            <div className="mt-2 text-2xl font-bold text-[#4ADE80]">{summary.open_threads}</div>
          </div>

          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4">
            <div className="text-xs uppercase tracking-wide text-[#7D8590]">Open Tasks</div>
            <div className="mt-2 text-2xl font-bold text-[#F5D547]">{summary.open_tasks}</div>
          </div>

          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4">
            <div className="text-xs uppercase tracking-wide text-[#7D8590]">Notes</div>
            <div className="mt-2 text-2xl font-bold">{summary.notes_count}</div>
          </div>

          <div className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-4">
            <div className="text-xs uppercase tracking-wide text-[#7D8590]">Last Activity</div>
            <div className="mt-2 text-sm font-semibold">{formatDateTime(summary.last_activity)}</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2 space-y-6">
            <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-3 flex items-center gap-2">
                <MessageSquare size={16} className="text-[#58A6FF]" />
                <div className="text-sm font-semibold">Command Center Summary</div>
              </div>
              <div className="text-sm leading-6 text-[#C9D1D9]">
                {summary.rollup || "No summary available."}
              </div>

              {summary.risk_signals?.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#F5D547]">
                    <ShieldAlert size={16} />
                    Risk Signals
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {summary.risk_signals.map((risk) => (
                      <span
                        key={risk}
                        className="inline-flex items-center rounded-full border border-[rgba(245,213,71,0.24)] bg-[rgba(245,213,71,0.1)] px-3 py-1 text-xs font-semibold text-[#F5D547]"
                      >
                        {risk}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-4 flex items-center gap-2">
                <Mail size={16} className="text-[#58A6FF]" />
                <div className="text-sm font-semibold">Related Threads</div>
              </div>

              <div className="space-y-3">
                {threads.length === 0 && (
                  <div className="text-sm text-[#7D8590]">No related threads found.</div>
                )}

                {threads.map((thread: any) => {
                  const href = `/#conversation=${thread.id}&mailbox=${thread.email_account_id || ""}&folder=${thread.folder_id || ""}`;

                  return (
                    <div
                      key={thread.id}
                      className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="truncate text-sm font-semibold text-[#E6EDF3]">
                              {thread.subject || "(No subject)"}
                            </div>

                            {thread.is_unread && (
                              <span className="inline-flex rounded-full bg-[rgba(74,222,128,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[#4ADE80]">
                                Unread
                              </span>
                            )}
                          </div>

                          <div className="mt-1 text-xs text-[#7D8590]">
                            {thread.preview || "No preview available"}
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            <span className="rounded-full border border-[#1E242C] bg-[#0B0E11] px-2 py-1 text-[#9BA7B4]">
                              Status: {thread.status || "open"}
                            </span>
                            <span className="rounded-full border border-[#1E242C] bg-[#0B0E11] px-2 py-1 text-[#9BA7B4]">
                              Folder: {thread.folder?.name || "Inbox"}
                            </span>
                            <span className="rounded-full border border-[#1E242C] bg-[#0B0E11] px-2 py-1 text-[#9BA7B4]">
                              Last message: {formatDateTime(thread.last_message_at)}
                            </span>
                          </div>
                        </div>

                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-xs font-semibold text-[#58A6FF] hover:bg-[#151A21]"
                        >
                          <ExternalLink size={13} />
                          Open
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-4 flex items-center gap-2">
                <FileText size={16} className="text-[#58A6FF]" />
                <div className="text-sm font-semibold">Thread Summaries</div>
              </div>

              <div className="space-y-3">
                {thread_summaries.length === 0 && (
                  <div className="text-sm text-[#7D8590]">No thread summaries available.</div>
                )}

                {thread_summaries.map((item: any) => (
                  <div
                    key={item.conversation_id}
                    className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4"
                  >
                    <div className="text-xs text-[#7D8590] mb-2">
                      Generated: {formatDateTime(item.generated_at)}
                    </div>
                    <div className="text-sm font-semibold text-[#E6EDF3]">
                      {item.summary?.status || "No status"}
                    </div>
                    <div className="mt-2 text-sm leading-6 text-[#C9D1D9]">
                      {item.summary?.overview || "No overview available"}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-4 flex items-center gap-2">
                <Clock3 size={16} className="text-[#58A6FF]" />
                <div className="text-sm font-semibold">Open Tasks</div>
              </div>

              <div className="space-y-3">
                {openTasks.length === 0 && (
                  <div className="text-sm text-[#7D8590]">No open tasks.</div>
                )}

                {openTasks.map((task: any) => (
                  <div
                    key={task.id}
                    className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4"
                  >
                    <div className="text-sm font-medium text-[#E6EDF3]">{task.text}</div>

                    {task.assignees?.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {task.assignees.map((person: any) => (
                          <span
                            key={person.id}
                            className="inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold"
                            style={{
                              background: `${person.color || "#58A6FF"}20`,
                              color: person.color || "#58A6FF",
                            }}
                          >
                            {person.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-[#1E242C] bg-[#0F1318] p-5">
              <div className="mb-4 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-[#58A6FF]" />
                <div className="text-sm font-semibold">Recent Notes</div>
              </div>

              <div className="space-y-3">
                {notes.length === 0 && (
                  <div className="text-sm text-[#7D8590]">No notes found.</div>
                )}

                {notes.slice(0, 8).map((note: any) => (
                  <div
                    key={note.id}
                    className="rounded-xl border border-[#1E242C] bg-[#12161B] p-4"
                  >
                    <div className="mb-2 text-xs text-[#7D8590]">
                      {formatDateTime(note.created_at)}
                    </div>
                    <div className="text-sm leading-6 text-[#C9D1D9] whitespace-pre-wrap">
                      {note.text}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}