/** Local calendar helpers. All day and week boundaries use the machine's local time zone. */

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

function pad(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local month as YYYY-MM. */
export function monthKey(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}`;
}

/** Local midnight at the start of the day containing ms. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Local midnight at the start of the next day. Safe across daylight saving changes. */
export function startOfNextDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

/** Local midnight on the Monday of the week containing ms. */
export function startOfWeek(ms: number): number {
  const d = new Date(ms);
  const offset = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset).getTime();
}

/** Local midnight n days before the day containing ms. */
export function daysBefore(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n).getTime();
}

/** Human friendly duration, for example "2h 05m" or "14m". */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / MINUTE);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${String(h)}h ${pad(m)}m` : `${String(m)}m`;
}
