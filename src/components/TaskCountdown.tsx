"use client";

import { useEffect, useState } from "react";
import { AlarmClock } from "lucide-react";

interface TaskCountdownProps {
  dueDate: string;       // "YYYY-MM-DD"
  dueTime?: string | null; // "HH:MM" or null
  isCompleted?: boolean;
  compact?: boolean;     // smaller variant for inline use
}

function computeCountdown(dueDate: string, dueTime?: string | null) {
  const target = dueTime
    ? new Date(`${dueDate}T${dueTime.slice(0, 5)}:00`)
    : new Date(`${dueDate}T23:59:59`);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const overdue = diffMs < 0;
  const absDiff = Math.abs(diffMs);

  const totalMinutes = Math.floor(absDiff / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const minutes = totalMinutes % 60;

  let label: string;
  if (days > 0) {
    label = `${days}d ${hours}h`;
  } else if (hours > 0) {
    label = `${hours}h ${minutes}m`;
  } else {
    label = `${minutes}m`;
  }

  // Urgency levels
  let urgency: "ok" | "warning" | "critical" | "overdue";
  if (overdue) {
    urgency = "overdue";
  } else if (totalHours < 2) {
    urgency = "critical";
  } else if (totalHours < 8) {
    urgency = "warning";
  } else {
    urgency = "ok";
  }

  return { label, overdue, urgency, totalHours, totalMinutes };
}

const URGENCY_STYLES = {
  ok: {
    bg: "rgba(88,166,255,0.10)",
    text: "#58A6FF",
    pulse: false,
  },
  warning: {
    bg: "rgba(240,136,62,0.12)",
    text: "#F0883E",
    pulse: false,
  },
  critical: {
    bg: "rgba(248,81,73,0.15)",
    text: "#F85149",
    pulse: true,
  },
  overdue: {
    bg: "rgba(248,81,73,0.20)",
    text: "#F85149",
    pulse: true,
  },
};

export default function TaskCountdown({ dueDate, dueTime, isCompleted, compact }: TaskCountdownProps) {
  const [countdown, setCountdown] = useState(() => computeCountdown(dueDate, dueTime));

  useEffect(() => {
    // Update immediately
    setCountdown(computeCountdown(dueDate, dueTime));

    // Tick every 30 seconds for a responsive feel
    const interval = setInterval(() => {
      setCountdown(computeCountdown(dueDate, dueTime));
    }, 30000);

    return () => clearInterval(interval);
  }, [dueDate, dueTime]);

  // Don't show countdown for completed tasks
  if (isCompleted) return null;

  const style = URGENCY_STYLES[countdown.urgency];

  if (compact) {
    return (
      <span
        className="inline-flex items-center gap-0.5 text-[10px] font-semibold"
        style={{ color: style.text }}
        title={`${countdown.overdue ? "Overdue by " : "Due in "}${countdown.label}`}
      >
        {countdown.overdue ? "−" : ""}{countdown.label}
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold transition-colors ${style.pulse ? "animate-pulse" : ""}`}
      style={{ background: style.bg, color: style.text }}
      title={`${countdown.overdue ? "Overdue by " : "Due in "}${countdown.label}${dueTime ? ` (${dueDate} ${dueTime.slice(0, 5)})` : ` (${dueDate})`}`}
    >
      <AlarmClock size={11} />
      {countdown.overdue ? `${countdown.label} overdue` : countdown.label}
    </span>
  );
}
