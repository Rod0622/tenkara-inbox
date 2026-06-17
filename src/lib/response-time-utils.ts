// ════════════════════════════════════════════════════════════════
// Shared helpers for supplier/team response-time computation.
//
// Used by both the backfill route (/api/response-times) and the hourly
// incremental cron (/api/cron/response-times) so the two paths stay in
// lockstep. Two concerns live here:
//
//   1. isAutoReply() — exclude out-of-office / "we received your
//      message" / noreply bot messages from counting as a real
//      response (they otherwise make a supplier look instantly fast).
//
//   2. businessMinutesBetween() — count only working minutes between a
//      trigger and its response, using the responder's timezone and
//      work hours. This removes the nights/weekends penalty (a reply at
//      8am after a 6pm email is ~1 business hour, not ~14 clock hours)
//      and, where real per-supplier timezones are set, scores overseas
//      suppliers against their own hours instead of ours.
// ════════════════════════════════════════════════════════════════

// ─── Auto-reply detection ───────────────────────────────────────
const AUTOREPLY_SENDER_RE = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|automated?|notifications?)@/i;
const AUTOREPLY_SUBJECT_RE = /\b(out of office|out-of-office|automatic reply|auto-?reply|automatic response|away from (the |my )?office|on vacation|on leave|we have received your|thank you for (your|contacting)|this is an automated|undeliverable|delivery (status|failure)|mail delivery)/i;

export interface AutoReplyCheckMsg {
  from_email?: string | null;
  subject?: string | null;
}

/**
 * Heuristic: is this message an automated reply rather than a genuine
 * human response? We have no raw headers (no Auto-Submitted), so we match
 * on sender and subject patterns. Tunable — err toward NOT flagging, so a
 * real reply is never dropped; a few auto-replies slipping through is less
 * harmful than discarding genuine responses.
 */
export function isAutoReply(msg: AutoReplyCheckMsg): boolean {
  const from = (msg.from_email || "").toLowerCase();
  if (from && AUTOREPLY_SENDER_RE.test(from)) return true;
  const subject = msg.subject || "";
  if (subject && AUTOREPLY_SUBJECT_RE.test(subject)) return true;
  return false;
}

// ─── Business-hours elapsed time ────────────────────────────────
export interface WorkHours {
  timezone: string | null;        // IANA tz, e.g. "America/New_York"
  work_start: string | null;      // "HH:MM:SS"
  work_end: string | null;        // "HH:MM:SS"
  work_days: number[] | null;     // ISO weekdays worked: 1=Mon .. 7=Sun
}

const DEFAULT_HOURS: { timezone: string; work_start: string; work_end: string; work_days: number[] } = {
  timezone: "America/New_York",
  work_start: "09:00:00",
  work_end: "17:00:00",
  work_days: [1, 2, 3, 4, 5],
};

// Parse "HH:MM:SS" → minutes since midnight. Falls back to a default.
function hmsToMinutes(hms: string | null, fallback: number): number {
  if (!hms) return fallback;
  const parts = hms.split(":");
  const h = parseInt(parts[0] || "0", 10);
  const m = parseInt(parts[1] || "0", 10);
  if (isNaN(h) || isNaN(m)) return fallback;
  return h * 60 + m;
}

// Get {year, month, day, weekday(1-7 Mon-Sun), minutesSinceMidnight} for a
// UTC Date as seen in a given IANA timezone, using Intl (no external deps).
function zonedParts(date: Date, timezone: string): {
  ymd: string; weekdayIso: number; minutes: number;
} {
  // en-CA gives YYYY-MM-DD; we also pull weekday + h/m in the target tz.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const year = get("year"), month = get("month"), day = get("day");
  let hour = parseInt(get("hour") || "0", 10);
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  const minute = parseInt(get("minute") || "0", 10);
  const wdMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const weekdayIso = wdMap[get("weekday")] ?? 1;
  return { ymd: `${year}-${month}-${day}`, weekdayIso, minutes: hour * 60 + minute };
}

/**
 * Count working minutes between two instants, in the responder's timezone
 * and work schedule. Walks day by day from start to end, summing only the
 * overlap with each working day's [work_start, work_end] window. Caps the
 * walk at 60 days as a safety bound.
 *
 * Returns whole minutes (rounded). If the elapsed span is entirely outside
 * working hours (e.g. a Saturday-to-Sunday gap), the result can be 0 — that
 * is intentional and correct.
 */
export function businessMinutesBetween(start: Date, end: Date, hours: WorkHours): number {
  if (end.getTime() <= start.getTime()) return 0;

  const tz = hours.timezone || DEFAULT_HOURS.timezone;
  const workStartMin = hmsToMinutes(hours.work_start, 9 * 60);
  const workEndMin = hmsToMinutes(hours.work_end, 17 * 60);
  const workDays = (hours.work_days && hours.work_days.length > 0)
    ? hours.work_days
    : DEFAULT_HOURS.work_days;

  if (workEndMin <= workStartMin) {
    // Misconfigured window — fall back to raw clock minutes so we never
    // silently zero out a real response.
    return Math.round((end.getTime() - start.getTime()) / 60000);
  }

  let total = 0;
  // Iterate calendar days in the target tz. Step by 1 day from the start
  // date through the end date; for each, intersect [start,end] with that
  // day's working window.
  const MS_DAY = 24 * 60 * 60 * 1000;
  let cursor = new Date(start.getTime());
  let guard = 0;

  const startParts = zonedParts(start, tz);
  const endParts = zonedParts(end, tz);

  while (guard < 62) {
    guard++;
    const cp = zonedParts(cursor, tz);
    const isWorkDay = workDays.indexOf(cp.weekdayIso) !== -1;

    if (isWorkDay) {
      // Determine the [from, to] minute window for this calendar day.
      const dayIsStart = cp.ymd === startParts.ymd;
      const dayIsEnd = cp.ymd === endParts.ymd;

      const fromMin = dayIsStart ? Math.max(startParts.minutes, workStartMin) : workStartMin;
      const toMin = dayIsEnd ? Math.min(endParts.minutes, workEndMin) : workEndMin;

      if (toMin > fromMin) total += (toMin - fromMin);
    }

    if (cp.ymd === endParts.ymd) break;
    cursor = new Date(cursor.getTime() + MS_DAY);
  }

  return Math.round(total);
}