/**
 * Opening hours. Windows are minutes after local midnight in the platform timezone (Africa/Lagos,
 * UTC+1, no daylight saving). Several windows per day are allowed; overnight opening is entered as
 * two windows (e.g. Fri 18:00–24:00 and Sat 00:00–02:00).
 */
export const PLATFORM_TIMEZONE = 'Africa/Lagos';

export interface OpeningWindow {
  /** 0 = Sunday … 6 = Saturday */
  dayOfWeek: number;
  opensAt: number;
  closesAt: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Day of week and minutes after midnight for an instant, in the given IANA timezone. */
export function localDayAndMinute(at: Date, timeZone = PLATFORM_TIMEZONE): { dayOfWeek: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { dayOfWeek: WEEKDAYS.indexOf(get('weekday')), minute: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function isOpenAt(windows: readonly OpeningWindow[], at: Date, timeZone = PLATFORM_TIMEZONE): boolean {
  const { dayOfWeek, minute } = localDayAndMinute(at, timeZone);
  return windows.some((w) => w.dayOfWeek === dayOfWeek && minute >= w.opensAt && minute < w.closesAt);
}

/** Returns a message for the first problem in a set of windows, or null if valid. */
export function validateOpeningWindows(windows: readonly OpeningWindow[]): string | null {
  for (const w of windows) {
    if (!Number.isInteger(w.dayOfWeek) || w.dayOfWeek < 0 || w.dayOfWeek > 6) return 'dayOfWeek must be 0–6';
    if (!Number.isInteger(w.opensAt) || !Number.isInteger(w.closesAt)) return 'times must be whole minutes';
    if (w.opensAt < 0 || w.closesAt > 1440 || w.opensAt >= w.closesAt) return 'each window must open before it closes, within one day';
  }
  const byDay = [...windows].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt - b.opensAt);
  for (let i = 1; i < byDay.length; i++) {
    const prev = byDay[i - 1]!;
    const cur = byDay[i]!;
    if (prev.dayOfWeek === cur.dayOfWeek && cur.opensAt < prev.closesAt) return 'opening windows on the same day must not overlap';
  }
  return null;
}

/** "08:00" ↔ 480 helpers for forms. */
export function minutesToHHMM(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export function hhmmToMinutes(s: string): number {
  const match = /^([01]\d|2[0-4]):([0-5]\d)$/.exec(s);
  if (!match) throw new RangeError(`Invalid time "${s}"`);
  const value = Number(match[1]) * 60 + Number(match[2]);
  if (value > 1440) throw new RangeError(`Invalid time "${s}"`);
  return value;
}
