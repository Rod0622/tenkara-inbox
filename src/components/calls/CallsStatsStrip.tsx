// src/components/calls/CallsStatsStrip.tsx
//
// Small dashboard strip rendered above the calls list. Shows:
//   - Sparkline: calls/day for the last 14 days (independent of date filter)
//   - Direction breakdown bar
//   - Outcome breakdown bar
//   - Top team members bar list
//
// All visualizations are pure SVG, no chart library. Keeps bundle small.

"use client";

interface StatsProps {
  stats: {
    by_day: Array<{ date: string; count: number }>;
    by_direction: { inbound: number; outbound: number };
    by_outcome: { answered: number; voicemail: number; missed: number; no_answer: number; other?: number };
    by_team_member: Array<{ id: string; name: string; initials: string; color: string; count: number }>;
    total_filtered: number;
  };
}

export default function CallsStatsStrip({ stats }: StatsProps) {
  const { by_day, by_direction, by_outcome, by_team_member, total_filtered } = stats;

  return (
    <div className="px-5 py-3 border-b border-[var(--border)] bg-[var(--bg)]">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Sparkline */}
        <Card title="Calls per day (14 days)" subtitle="Independent of date filter">
          <Sparkline data={by_day} />
        </Card>

        {/* Direction */}
        <Card title="Direction" subtitle={`${total_filtered} total in filter`}>
          <DirectionBar inbound={by_direction.inbound} outbound={by_direction.outbound} />
        </Card>

        {/* Outcome */}
        <Card title="Outcome" subtitle="">
          <OutcomeBar
            answered={by_outcome.answered}
            voicemail={by_outcome.voicemail}
            missed={by_outcome.missed}
            no_answer={by_outcome.no_answer}
            other={by_outcome.other || 0}
          />
        </Card>

        {/* Team members */}
        <Card title="Top handlers" subtitle="In filter">
          <TeamMemberList members={by_team_member.slice(0, 4)} />
        </Card>
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-lg p-3">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{title}</h3>
        {subtitle && <span className="text-[9px] text-[var(--text-muted)]">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

function Sparkline({ data }: { data: Array<{ date: string; count: number }> }) {
  if (data.length === 0) return <EmptyState label="No data" />;
  const max = Math.max(1, ...data.map((d) => d.count));
  const W = 240;
  const H = 56;
  const pad = 4;
  const bw = (W - pad * 2) / data.length;

  return (
    <div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {data.map((d, i) => {
          const x = pad + i * bw;
          const h = max > 0 ? ((d.count / max) * (H - pad * 2)) : 0;
          const y = H - pad - h;
          return (
            <g key={d.date}>
              <rect
                x={x + 1}
                y={y}
                width={Math.max(1, bw - 2)}
                height={Math.max(1, h)}
                rx={1}
                fill="var(--accent)"
                opacity={d.count > 0 ? 0.85 : 0.15}
              >
                <title>{`${d.date}: ${d.count}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="flex justify-between text-[9px] text-[var(--text-muted)] font-mono mt-0.5">
        <span>{data[0]?.date.slice(5)}</span>
        <span>{data[data.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}

function DirectionBar({ inbound, outbound }: { inbound: number; outbound: number }) {
  const total = inbound + outbound;
  if (total === 0) return <EmptyState label="No calls" />;
  const inPct = (inbound / total) * 100;
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-[var(--bg)]">
        <div style={{ width: `${inPct}%` }} className="bg-[var(--info)]" />
        <div style={{ width: `${100 - inPct}%` }} className="bg-[var(--accent)]" />
      </div>
      <div className="flex justify-between text-[10px] mt-1.5">
        <span className="text-[var(--info)]">↓ {inbound} in</span>
        <span className="text-[var(--accent)]">↑ {outbound} out</span>
      </div>
    </div>
  );
}

function OutcomeBar({ answered, voicemail, missed, no_answer, other }: {
  answered: number; voicemail: number; missed: number; no_answer: number; other: number;
}) {
  const total = answered + voicemail + missed + no_answer + other;
  if (total === 0) return <EmptyState label="No outcomes" />;
  const seg = (n: number, color: string) => n > 0 ? (
    <div style={{ width: `${(n / total) * 100}%` }} className={color}><title>{n}</title></div>
  ) : null;
  return (
    <div>
      <div className="flex h-2 rounded-full overflow-hidden bg-[var(--bg)]">
        {seg(answered, "bg-[var(--accent)]")}
        {seg(voicemail, "bg-[var(--warning)]")}
        {seg(missed, "bg-[var(--danger)]")}
        {seg(no_answer, "bg-[var(--text-muted)]")}
        {seg(other, "bg-[var(--info)]")}
      </div>
      <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px] mt-1.5">
        {answered > 0 && <Legend color="bg-[var(--accent)]" label={`Answered ${answered}`} />}
        {voicemail > 0 && <Legend color="bg-[var(--warning)]" label={`Voicemail ${voicemail}`} />}
        {missed > 0 && <Legend color="bg-[var(--danger)]" label={`Missed ${missed}`} />}
        {no_answer > 0 && <Legend color="bg-[var(--text-muted)]" label={`No answer ${no_answer}`} />}
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1 text-[var(--text-secondary)]">
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      <span>{label}</span>
    </div>
  );
}

function TeamMemberList({ members }: { members: Array<{ id: string; name: string; initials: string; color: string; count: number }> }) {
  if (members.length === 0) return <EmptyState label="No attribution data" />;
  const max = Math.max(1, ...members.map((m) => m.count));
  return (
    <div className="space-y-1">
      {members.map((m) => (
        <div key={m.id} className="flex items-center gap-2">
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-[var(--bg)] shrink-0"
            style={{ background: m.color || "var(--text-muted)" }}
          >
            {m.initials}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] text-[var(--text-primary)] truncate">{m.name}</span>
              <span className="text-[10px] font-mono text-[var(--text-muted)] shrink-0">{m.count}</span>
            </div>
            <div className="h-1 rounded-full bg-[var(--bg)] overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${(m.count / max) * 100}%`, background: m.color || "var(--accent)" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return <div className="text-[10px] text-[var(--text-muted)] italic py-3 text-center">{label}</div>;
}
