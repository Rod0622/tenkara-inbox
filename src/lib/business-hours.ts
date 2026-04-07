// ═══════════════════════════════════════════════════════
// Shared Business Hours Utility
// Supports per-supplier timezone, work hours, and work days
// Falls back to defaults: America/New_York, 9am–8pm, Mon–Fri
// ═══════════════════════════════════════════════════════

export interface SupplierHours {
  timezone?: string | null;    // e.g. "Asia/Manila", "America/New_York"
  work_start?: string | null;  // e.g. "09:00"
  work_end?: string | null;    // e.g. "20:00"
  work_days?: number[] | null; // e.g. [1,2,3,4,5] = Mon–Fri (0=Sun,6=Sat)
}

// Defaults used when no supplier contact is linked
const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_WORK_START = 9;   // 9am
const DEFAULT_WORK_END = 20;    // 8pm (20:00)
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri

function parseHour(timeStr: string | null | undefined): number | null {
  if (!timeStr) return null;
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  return isNaN(h) ? null : h;
}

function resolveHours(supplier?: SupplierHours | null) {
  const tz = supplier?.timezone || DEFAULT_TIMEZONE;
  const startHour = parseHour(supplier?.work_start) ?? DEFAULT_WORK_START;
  const endHour = parseHour(supplier?.work_end) ?? DEFAULT_WORK_END;
  const workDays = (supplier?.work_days && supplier.work_days.length > 0)
    ? supplier.work_days
    : DEFAULT_WORK_DAYS;
  return { tz, startHour, endHour, workDays };
}

/**
 * Calculate business hours between two dates using supplier's schedule.
 * If no supplier provided, uses EST 9am–8pm Mon–Fri.
 */
export function calcBusinessHours(
  start: Date,
  end: Date,
  supplier?: SupplierHours | null
): number {
  if (end <= start) return 0;
  const { tz, startHour, endHour, workDays } = resolveHours(supplier);

  let hours = 0;
  const current = new Date(start);

  while (current < end) {
    try {
      const locStr = current.toLocaleString("en-US", { timeZone: tz });
      const loc = new Date(locStr);
      const hour = loc.getHours();
      const day = loc.getDay();

      if (workDays.includes(day) && hour >= startHour && hour < endHour) {
        hours++;
      }
    } catch (_e) {
      // If timezone is invalid, fall back to counting all hours
      hours++;
    }
    current.setTime(current.getTime() + 60 * 60 * 1000);
    if (hours > 1000) break; // Safety limit
  }
  return hours;
}

/**
 * Calculate business hours remaining from now until a due date.
 * If past due, returns negative elapsed business hours.
 */
export function getBusinessHoursRemaining(
  dueDate: string,
  supplier?: SupplierHours | null
): number {
  const due = new Date(dueDate);
  const now = new Date();
  if (due <= now) return -getBusinessHoursElapsed(dueDate, supplier);
  return calcBusinessHours(now, due, supplier);
}

/**
 * Calculate business hours elapsed since a due date (for overdue tasks).
 */
export function getBusinessHoursElapsed(
  dueDate: string,
  supplier?: SupplierHours | null
): number {
  const due = new Date(dueDate);
  const now = new Date();
  if (due >= now) return 0;
  return calcBusinessHours(due, now, supplier);
}

/**
 * Given a start time and a number of business hours, compute the target date/time
 * by advancing only during business hours.
 * Returns { dueDate: "YYYY-MM-DD", dueTime: "HH:MM" }
 */
export function addBusinessHours(
  startFrom: Date,
  businessHours: number,
  supplier?: SupplierHours | null
): { dueDate: string; dueTime: string } {
  const { tz, startHour, endHour, workDays } = resolveHours(supplier);

  let hoursToAdd = businessHours;
  const target = new Date(startFrom);

  while (hoursToAdd > 0) {
    target.setTime(target.getTime() + 60 * 60 * 1000);
    try {
      const locStr = target.toLocaleString("en-US", { timeZone: tz });
      const loc = new Date(locStr);
      const hour = loc.getHours();
      const day = loc.getDay();

      if (workDays.includes(day) && hour >= startHour && hour < endHour) {
        hoursToAdd--;
      }
    } catch (_e) {
      hoursToAdd--; // Fallback
    }
    if (hoursToAdd > 1000) break; // Safety
  }

  return {
    dueDate: target.toISOString().slice(0, 10),
    dueTime: target.toTimeString().slice(0, 5),
  };
}

/**
 * Format business hours into a readable string (e.g. "2d 3h", "45m", "11h")
 */
export function formatBusinessTime(hours: number): string {
  if (hours === 0) return "0h";
  const negative = hours < 0;
  const abs = Math.abs(hours);
  if (abs < 1) return `${negative ? "-" : ""}${Math.round(abs * 60)}m`;
  if (abs >= 24) {
    const d = Math.floor(abs / 11); // ~11 business hours per day
    const h = Math.round(abs % 11);
    return `${negative ? "-" : ""}${d}d ${h}h`;
  }
  return `${negative ? "-" : ""}${Math.round(abs)}h`;
}

/**
 * Server-side helper: look up supplier hours from a conversation ID.
 * Returns SupplierHours or null if no linked supplier contact.
 */
export async function getSupplierHoursForConversation(
  supabase: any,
  conversationId: string
): Promise<SupplierHours | null> {
  if (!conversationId) return null;

  const { data: convo } = await supabase
    .from("conversations")
    .select("supplier_contact_id")
    .eq("id", conversationId)
    .single();

  if (!convo?.supplier_contact_id) return null;

  const { data: contact } = await supabase
    .from("supplier_contacts")
    .select("timezone, work_start, work_end, work_days")
    .eq("id", convo.supplier_contact_id)
    .single();

  if (!contact) return null;

  return {
    timezone: contact.timezone,
    work_start: contact.work_start,
    work_end: contact.work_end,
    work_days: contact.work_days,
  };
}
