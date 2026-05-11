"use client";

import { useEffect, useState } from "react";
import { AlarmClock } from "lucide-react";

interface TaskCountdownProps {
  dueDate: string;       // "YYYY-MM-DD"
  dueTime?: string | null; // "HH:MM" or null
  isCompleted?: boolean;
  compact?: boolean;     // smaller variant for inline use
}

// Stored due dates are always in EST per team decision (see addBusinessHours
// in @/lib/business-hours). This countdown component must therefore parse the
// dueDate/dueTime strings as EST wall-clock, NOT as browser-local time
// (which would silently shift the deadline by the user's UTC offset).
const DUE_TIMEZONE = "America/New_York";

/**
 * Given a wall-clock date+time string assumed to be in the given timezone,
 * return the corresponding UTC moment as a Date.
 *
 * Works by formatting a "guess" Date back to that tz, measuring how far off
 * the wall-clock components are, and applying that delta. One iteration is
 * enough for non-DST-edge cases; a second covers DST transitions cleanly.
 */
function zonedWallClockToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, tz: string
): Date {
  // Initial guess: interpret the wall-clock as if it were UTC. Will be off by
  // the tz offset.
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));

  // Iterate twice to handle DST-transition edge cases.
  let result = guess;
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    }).formatToParts(result);

    let y = 0, mo = 0, d = 0, h = 0, mi = 0;
    for (const p of parts) {
      const v = parseInt(p.value, 10);
      if (p.type === "year") y = v;
      else if (p.type === "month") mo = v;
      else if (p.type === "day") d = v;
      else if (p.type === "hour") h = v === 24 ? 0 : v;
      else if (p.type === "minute") mi = v;
    }
    // Compute the diff in minutes between what we wanted and what we got.
    const wantMs = Date.UTC(year, month - 1, day, hour, minute, 0);
    const gotMs = Date.UTC(y, mo - 1, d, h, mi, 0);
    const deltaMs = wantMs - gotMs;
    if (deltaMs === 0) break;
    result = new Date(result.getTime() + deltaMs);
  }
  return result;
}

function computeCountdown(dueDate: string, dueTime?: string | null) {
  // Parse dueDate ("YYYY-MM-DD") + dueTime ("HH:MM") as EST wall-clock.
  // Fall back to end-of-day EST when no dueTime present.
  const [yStr, mStr, dStr] = dueDate.split("-");
  const year = parseInt(yStr, 10);
  const month = parseInt(mStr, 10);
  const day = parseInt(dStr, 10);

  let hour = 23, minute = 59;
  if (dueTime) {
    const [hStr, miStr] = dueTime.slice(0, 5).split(":");
    hour = parseInt(hStr, 10);
    minute = parseInt(miStr, 10);
  }

  const target = zonedWallClockToUtc(year, month, day, hour, minute, DUE_TIMEZONE);
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