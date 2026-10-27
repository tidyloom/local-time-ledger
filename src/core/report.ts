import type { Segment } from './segment';
import { dayKey, daysBefore, formatDuration, startOfDay, startOfNextDay, startOfWeek } from './time';

/** Days of history shown by the free views. */
export const FREE_HISTORY_DAYS = 30;

interface Interval {
  start: number;
  end: number;
}

/** Total length of the union of intervals, so overlapping windows are never counted twice. */
export function unionLength(intervals: readonly Interval[]): number {
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  let total = 0;
  let curStart = Number.NEGATIVE_INFINITY;
  let curEnd = Number.NEGATIVE_INFINITY;
  for (const iv of sorted) {
    if (iv.start > curEnd) {
      if (curEnd > curStart) {
        total += curEnd - curStart;
      }
      curStart = iv.start;
      curEnd = iv.end;
    } else if (iv.end > curEnd) {
      curEnd = iv.end;
    }
  }
  if (curEnd > curStart) {
    total += curEnd - curStart;
  }
  return total;
}

export function clip(segments: readonly Segment[], from: number, to: number): Segment[] {
  const out: Segment[] = [];
  for (const s of segments) {
    const start = Math.max(s.start, from);
    const end = Math.min(s.end, to);
    if (end > start) {
      out.push({ ...s, start, end });
    }
  }
  return out;
}

function totalsBy(segments: readonly Segment[], key: (s: Segment) => string): Array<[string, number]> {
  const groups = new Map<string, Segment[]>();
  for (const s of segments) {
    const k = key(s);
    const list = groups.get(k);
    if (list) {
      list.push(s);
    } else {
      groups.set(k, [s]);
    }
  }
  return [...groups.entries()]
    .map(([k, list]): [string, number] => [k, unionLength(list)])
    .filter(([, ms]) => ms > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export interface PeriodSummary {
  readonly label: string;
  readonly from: number;
  readonly to: number;
  readonly total: number;
  readonly byProject: Array<[string, number]>;
  readonly byLanguage: Array<[string, number]>;
}

export function summarizePeriod(segments: readonly Segment[], label: string, from: number, to: number): PeriodSummary {
  const clipped = clip(segments, from, to);
  return {
    label,
    from,
    to,
    total: unionLength(clipped),
    byProject: totalsBy(clipped, (s) => s.project),
    byLanguage: totalsBy(clipped, (s) => s.language),
  };
}

export interface DayTotal {
  readonly day: string;
  readonly total: number;
}

export interface Summary {
  readonly today: PeriodSummary;
  readonly week: PeriodSummary;
  readonly history: PeriodSummary;
  /** One entry per day, newest first, only days with tracked time. */
  readonly days: DayTotal[];
}

export function historyStart(now: number, days: number = FREE_HISTORY_DAYS): number {
  return daysBefore(now, days - 1);
}

/** The window shown as "history": the free 30 days, or all time for Pro. */
export interface HistoryWindow {
  readonly from: number;
  readonly label: string;
}

export function freeHistory(now: number): HistoryWindow {
  return { from: historyStart(now), label: `Last ${String(FREE_HISTORY_DAYS)} days` };
}

/** All tracked time, from the local day of the earliest segment (or today when there is none). */
export function allTimeHistory(segments: readonly Segment[], now: number): HistoryWindow {
  let earliest = now;
  for (const s of segments) {
    if (s.start < earliest) {
      earliest = s.start;
    }
  }
  return { from: startOfDay(earliest), label: 'All time' };
}

/**
 * Splits every segment at local midnights and groups the pieces by day, so each day can be
 * totalled with one union. Linear in the number of segments, not in the number of days.
 */
export function splitByDay(segments: readonly Segment[], from: number, to: number): Map<number, Segment[]> {
  const byDay = new Map<number, Segment[]>();
  for (const s of clip(segments, from, to)) {
    let dayStart = startOfDay(s.start);
    while (dayStart < s.end) {
      const next = startOfNextDay(dayStart);
      const start = Math.max(s.start, dayStart);
      const end = Math.min(s.end, next);
      if (end > start) {
        const list = byDay.get(dayStart);
        const piece = { ...s, start, end };
        if (list) {
          list.push(piece);
        } else {
          byDay.set(dayStart, [piece]);
        }
      }
      dayStart = next;
    }
  }
  return byDay;
}

export function summarize(segments: readonly Segment[], now: number, history: HistoryWindow = freeHistory(now)): Summary {
  const todayStart = startOfDay(now);
  const end = startOfNextDay(now);
  const dayTotals: DayTotal[] = [...splitByDay(segments, history.from, end).entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([d, list]) => ({ day: dayKey(d), total: unionLength(list) }))
    .filter((d) => d.total > 0);
  return {
    today: summarizePeriod(segments, 'Today', todayStart, end),
    week: summarizePeriod(segments, 'This week', startOfWeek(now), end),
    history: summarizePeriod(segments, history.label, history.from, end),
    days: dayTotals,
  };
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function table(title: string, rows: Array<[string, number]>): string[] {
  if (rows.length === 0) {
    return [];
  }
  return ['', `| ${title} | Time |`, '| --- | ---: |', ...rows.map(([k, ms]) => `| ${escapeCell(k)} | ${formatDuration(ms)} |`)];
}

function periodSection(p: PeriodSummary): string[] {
  const lines = ['', `## ${p.label}: ${formatDuration(p.total)}`];
  if (p.total === 0) {
    lines.push('', 'Nothing tracked yet.');
    return lines;
  }
  return [...lines, ...table('Project', p.byProject), ...table('Language', p.byLanguage)];
}

export function renderMarkdown(summary: Summary, generatedAt: number, dataFolder: string, edition = 'Free edition'): string {
  const lines = [
    '# Local Time Ledger report',
    '',
    `Generated ${new Date(generatedAt).toLocaleString()} (${edition}). Weeks start on Monday. All times use your local time zone.`,
    ...periodSection(summary.today),
    ...periodSection(summary.week),
    ...periodSection(summary.history),
  ];
  if (summary.days.length > 0) {
    lines.push('', '## Per day', '', '| Day | Time |', '| --- | ---: |');
    for (const d of summary.days) {
      lines.push(`| ${d.day} | ${formatDuration(d.total)} |`);
    }
  }
  lines.push('', `Your data is plain JSON Lines in ${dataFolder} and never leaves this machine.`, '');
  return lines.join('\n');
}
