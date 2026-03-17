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
  FolderOpen,
  Loader2,
  Mail,
  MessageSquare,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  UserCircle2,
} from "lucide-react";

function formatDateTime(value?: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#1E242C] bg-[#12161B] p-4">
      <div className="text-[11px] uppercase tracking-wider text-[#7D8590]">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-[#E6EDF3]">{value}</div>
      {hint ? <div className="mt-1 text-xs text-[#7D8590]">{hint}</div> : null}
    </div>
  );
}

export default function ContactCommandCenterPage({
  params,
  searchParams,
}: {
  params: { email: string };
  searchParams: { account?: string };
}) {
  const externalEmail = decodeURIComponent(params.email || "");
  const accountId = searchParams.account || "";

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async (isRefresh = false) => {
    if (!externalEmail || !accountId) {
      setError("Missing contact or shared account identifier.");
      setLoading(false);
      return;
    }

    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const search = new URLSearchParams({
        external_email: externalEmail,
        email_account_id: accountId,
      });
      const res = await fetch(`/api/contact-command-center?${search.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Failed to load command center");
      }
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Failed to load command center");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [externalEmail, accountId]);

  const sortedOpenTasks = useMemo(() => {
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];
    return [...tasks]
      .filter((task: any) => task.status !== "completed" && !task.is_done)
      .sort((a: any, b: any) => {
        if (a.due_date && b.due_date) return String(a.due_date).localeCompare(String(b.due_date));
        if (a.due_date) return -1;
        if (b.due_date) return 1;
        return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
      });
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3] flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-[#7D8590]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading contact command center...
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3] p-6">
        <div className="mx-auto max-w-5xl rounded-2xl border border-[#1E242C] bg-[#12161B] p-6">
          <div className="flex items-center gap-3 text-[#F87171]">
            <AlertTriangle className="h-5 w-5" />
            <div className="text-sm font-semibold">Unable to load command center</div>
          </div>
          <div className="mt-2 text-sm text-[#7D8590]">{error || "Unknown error"}</div>
          <div className="mt-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-lg border border-[#1E242C] bg-[#0B0E11] px-3 py-2 text-sm text-[#58A6FF] hover:bg-[#181D24]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to inbox
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0B0E11] text-[#E6EDF3]">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="flex flex-col gap-4 rounded-3xl border border-[#1E242C] bg-[#12161B] p-6 md:flex-row md:items-start md:justify-between">
          <div>
            <Link
              href="/"
              className="mb-4 inline-flex items-center gap-2 text-xs font-semibold text-[#58A6FF] hover:text-[#7CC0FF]"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to inbox
            </Link>
            <div className="flex items-center gap-3">
              <UserCircle2 className="h-9 w-9 text-[#58A6FF]" />
              <div>
                <div className="text-2xl font-semibold tracking-tight">Supplier / Contact Command Center</div>
                <div className="mt-1 text-sm text-[#7D8590]">{data.contact.external_email}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border border-[#1E242C] bg-[#0B0E11] px-3 py-1 text-[#C9D1D9]">
                Shared inbox: {data.contact.shared_account_name}
              </span>
              <span className="rounded-full border border-[#1E242C] bg-[#0B0E11] px-3 py-1 text-[#C9D1D9]">
                Last contact: {formatDateTime(data.stats.last_contact_at)}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-[#1E242C] bg-[#0B0E11] px-4 py-2 text-sm font-semibold text-[#58A6FF] hover:bg-[#181D24] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Open threads" value={data.stats.open_threads} hint={`${data.stats.total_threads} total threads`} />
          <StatCard label="Open tasks" value={data.stats.open_tasks} hint={`${data.stats.completed_tasks} completed`} />
          <StatCard label="Unread threads" value={data.stats.unread_threads} hint="Need review or reply" />
          <StatCard label="Internal notes" value={data.stats.total_notes} hint="Context collected across threads" />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <section className="rounded-3xl border border-[#1E242C] bg-[#12161B] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <Sparkles className="h-4 w-4 text-[#F5D547]" />
                AI / Operational Summary
              </div>
              <p className="mt-3 text-sm leading-6 text-[#C9D1D9]">{data.summary.overview}</p>

              {data.summary.statuses?.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {data.summary.statuses.map((status: string) => (
                    <span key={status} className="rounded-full bg-[rgba(88,166,255,0.12)] px-3 py-1 text-xs font-semibold text-[#58A6FF]">
                      {status}
                    </span>
                  ))}
                </div>
              )}

              {data.summary.intents?.length > 0 && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-wider text-[#7D8590]">Detected intents</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {data.summary.intents.map((intent: string) => (
                      <span key={intent} className="rounded-full border border-[#1E242C] bg-[#0B0E11] px-3 py-1 text-xs text-[#E6EDF3]">
                        {intent.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-[#1E242C] bg-[#12161B] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <Mail className="h-4 w-4 text-[#58A6FF]" />
                All Threads
              </div>
              <div className="mt-4 space-y-3">
                {data.threads.map((thread: any) => {
                  const href = `/#conversation=${thread.id}&mailbox=${thread.email_account_id || ""}&folder=${thread.folder_id || ""}`;
                  return (
                    <div key={thread.id} className="rounded-2xl border border-[#1E242C] bg-[#0B0E11] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="truncate text-sm font-semibold text-[#E6EDF3]">{thread.subject || "(No subject)"}</div>
                            {thread.is_unread ? (
                              <span className="rounded-full bg-[rgba(74,222,128,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[#4ADE80]">Unread</span>
                            ) : null}
                            <span className="rounded-full border border-[#1E242C] bg-[#12161B] px-2 py-0.5 text-[10px] text-[#7D8590]">
                              {thread.status || "open"}
                            </span>
                            {thread.folder?.name ? (
                              <span className="rounded-full border border-[#1E242C] bg-[#12161B] px-2 py-0.5 text-[10px] text-[#7D8590]">
                                {thread.folder.name}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-2 text-xs text-[#7D8590] line-clamp-2">{thread.preview || "No preview available"}</div>
                          <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[#7D8590]">
                            <span>Last activity: {formatDateTime(thread.last_message_at)}</span>
                            <span>From: {thread.from_email || thread.from_name || "Unknown"}</span>
                          </div>
                        </div>
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-lg border border-[#1E242C] bg-[#12161B] px-3 py-1.5 text-xs font-semibold text-[#58A6FF] hover:bg-[#181D24]"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          Open
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="rounded-3xl border border-[#1E242C] bg-[#12161B] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <MessageSquare className="h-4 w-4 text-[#58A6FF]" />
                Recent Internal Notes
              </div>
              <div className="mt-4 space-y-3">
                {data.notes.length === 0 ? (
                  <div className="text-sm text-[#7D8590]">No internal notes yet for this contact.</div>
                ) : (
                  data.notes.slice(0, 8).map((note: any) => (
                    <div key={note.id} className="rounded-2xl border border-[#1E242C] bg-[#0B0E11] p-4">
                      <div className="text-xs text-[#7D8590]">
                        {note.author?.name || "Unknown"} · {formatDateTime(note.created_at)}
                      </div>
                      <div className="mt-2 whitespace-pre-wrap text-sm text-[#E6EDF3]">{note.text}</div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-[#1E242C] bg-[#12161B] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <ShieldAlert className="h-4 w-4 text-[#F5D547]" />
                Risk Signals
              </div>
              <div className="mt-4 space-y-2">
                {data.risk_signals.length === 0 ? (
                  <div className="text-sm text-[#7D8590]">No major risk signals detected.</div>
                ) : (
                  data.risk_signals.map((signal: string) => (
                    <div key={signal} className="rounded-2xl border border-[rgba(245,213,71,0.25)] bg-[rgba(245,213,71,0.08)] px-4 py-3 text-sm text-[#F5D547]">
                      {signal}
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-[#1E242C] bg-[#12161B] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <Clock3 className="h-4 w-4 text-[#58A6FF]" />
                Open Tasks
              </div>
              <div className="mt-4 space-y-3">
                {sortedOpenTasks.length === 0 ? (
                  <div className="text-sm text-[#7D8590]">No open tasks for this contact.</div>
                ) : (
                  sortedOpenTasks.map((task: any) => (
                    <div key={task.id} className="rounded-2xl border border-[#1E242C] bg-[#0B0E11] p-4">
                      <div className="text-sm font-medium text-[#E6EDF3]">{task.text}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#7D8590]">
                        {task.due_date ? (
                          <span className="rounded-full bg-[rgba(245,213,71,0.12)] px-2 py-1 text-[#F5D547]">Due {task.due_date}</span>
                        ) : null}
                        {task.status ? (
                          <span className="rounded-full border border-[#1E242C] bg-[#12161B] px-2 py-1">{task.status.replace(/_/g, " ")}</span>
                        ) : null}
                        {task.conversation?.subject ? (
                          <span className="rounded-full border border-[#1E242C] bg-[#12161B] px-2 py-1">{task.conversation.subject}</span>
                        ) : null}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-[#1E242C] bg-[#12161B] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <FileText className="h-4 w-4 text-[#58A6FF]" />
                Action Tracking
              </div>
              <div className="mt-4 space-y-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[#7D8590]">Open action items</div>
                  <div className="mt-2 space-y-2">
                    {data.summary.open_action_items?.length ? (
                      data.summary.open_action_items.map((item: string) => (
                        <div key={item} className="rounded-2xl border border-[#1E242C] bg-[#0B0E11] px-4 py-3 text-sm text-[#E6EDF3]">
                          {item}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-[#7D8590]">No open action items found.</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] uppercase tracking-wider text-[#7D8590]">Completed items</div>
                  <div className="mt-2 space-y-2">
                    {data.summary.completed_items?.length ? (
                      data.summary.completed_items.map((item: string) => (
                        <div key={item} className="flex items-start gap-2 rounded-2xl border border-[#1E242C] bg-[#0B0E11] px-4 py-3 text-sm text-[#E6EDF3]">
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#4ADE80]" />
                          <span>{item}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-[#7D8590]">No completed items recorded yet.</div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-[#1E242C] bg-[#12161B] p-5">
              <div className="flex items-center gap-2 text-sm font-semibold text-[#E6EDF3]">
                <FolderOpen className="h-4 w-4 text-[#58A6FF]" />
                Recent Activity
              </div>
              <div className="mt-4 space-y-3">
                {data.activities.length === 0 ? (
                  <div className="text-sm text-[#7D8590]">No recent activity logged.</div>
                ) : (
                  data.activities.slice(0, 10).map((activity: any) => (
                    <div key={activity.id} className="rounded-2xl border border-[#1E242C] bg-[#0B0E11] px-4 py-3">
                      <div className="text-sm text-[#E6EDF3]">{String(activity.action || "activity").replace(/_/g, " ")}</div>
                      <div className="mt-1 text-[11px] text-[#7D8590]">
                        {activity.actor?.name || "System"} · {formatDateTime(activity.created_at)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
