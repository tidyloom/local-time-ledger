/**
 * Timesheet export (Pro). Pure code: builds a timesheet from segments and renders it as CSV,
 * Markdown or a printable HTML page. No file, editor or network calls here.
 */

import { clip, splitByDay, unionLength } from './report';
import type { Segment } from './segment';
import { dayKey, formatDuration, HOUR, MINUTE, startOfDay, startOfNextDay, startOfWeek } from './time';

export type TimesheetFormat = 'csv' | 'markdown' | 'html';

export const TIMESHEET_EXTENSIONS: Readonly<Record<TimesheetFormat, string>> = {
  csv: 'csv',
  markdown: 'md',
  html: 'html',
};

export interface TimesheetRow {
  /** Local day, YYYY-MM-DD. */
  readonly day: string;
  readonly project: string;
  readonly total: number;
}

export interface Timesheet {
  readonly title: string;
  /** Inclusive first local day, YYYY-MM-DD. */
  readonly firstDay: string;
  /** Inclusive last local day, YYYY-MM-DD. */
  readonly lastDay: string;
  /** Empty for all projects. */
  readonly project: string;
  /** One row per day and project with tracked time, oldest day first. */
  readonly rows: TimesheetRow[];
  /** Time per project over the whole range, largest first. */
  readonly byProject: Array<[string, number]>;
  /** Wall clock time over the whole range. Overlapping time in two projects is counted once. */
  readonly total: number;
}

export interface DateRange {
  readonly label: string;
  /** Local midnight of the first day. */
  readonly from: number;
  /** Local midnight after the last day (exclusive). */
  readonly to: number;
}

/**
 * Builds a timesheet for [from, to). Each project is totalled on its own, so a row is the time
 * spent on that project that day. With project set, only that project is included.
 */
export function buildTimesheet(segments: readonly Segment[], range: DateRange, project = ''): Timesheet {
  const selected = project === '' ? segments : segments.filter((s) => s.project === project);
  const rows: TimesheetRow[] = [];
  const days = [...splitByDay(selected, range.from, range.to).entries()].sort((a, b) => a[0] - b[0]);
  for (const [day, pieces] of days) {
    const byProject = new Map<string, Segment[]>();
    for (const p of pieces) {
      const list = byProject.get(p.project);
      if (list) {
        list.push(p);
      } else {
        byProject.set(p.project, [p]);
      }
    }
    const dayRows = [...byProject.entries()]
      .map(([name, list]): TimesheetRow => ({ day: dayKey(day), project: name, total: unionLength(list) }))
      .filter((r) => r.total > 0)
      .sort((a, b) => a.project.localeCompare(b.project));
    rows.push(...dayRows);
  }
  const totals = new Map<string, number>();
  for (const r of rows) {
    totals.set(r.project, (totals.get(r.project) ?? 0) + r.total);
  }
  return {
    title: range.label,
    firstDay: dayKey(range.from),
    lastDay: dayKey(range.to - 1),
    project,
    rows,
    byProject: [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    total: unionLength(clip(selected, range.from, range.to)),
  };
}

/** Decimal hours with two places, for invoices. Rounded to the nearest minute first. */
export function decimalHours(ms: number): string {
  const minutes = Math.round(Math.max(0, ms) / MINUTE);
  return ((minutes * MINUTE) / HOUR).toFixed(2);
}

function minutes(ms: number): string {
  return String(Math.round(Math.max(0, ms) / MINUTE));
}

/** One CSV cell per RFC 4180, with a guard against spreadsheet formula injection. */
export function csvCell(text: string): string {
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function renderCsv(t: Timesheet): string {
  const lines = [['Date', 'Project', 'Hours', 'Minutes']];
  for (const r of t.rows) {
    lines.push([r.day, r.project, decimalHours(r.total), minutes(r.total)]);
  }
  return lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

function mdCell(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
}

function scopeLine(t: Timesheet): string {
  const who = t.project === '' ? 'All projects' : `Project: ${t.project}`;
  return `${t.firstDay} to ${t.lastDay}. ${who}.`;
}

const OVERLAP_NOTE = 'Each project is totalled on its own. The overall total counts time that overlaps in two projects once.';

export function renderTimesheetMarkdown(t: Timesheet, generatedAt: number): string {
  const lines = [`# Timesheet: ${mdCell(t.title)}`, '', mdCell(scopeLine(t)), ''];
  if (t.rows.length === 0) {
    lines.push('Nothing tracked in this range.', '');
    return lines.join('\n');
  }
  lines.push('| Date | Project | Hours | Time |', '| --- | --- | ---: | ---: |');
  for (const r of t.rows) {
    lines.push(`| ${r.day} | ${mdCell(r.project)} | ${decimalHours(r.total)} | ${formatDuration(r.total)} |`);
  }
  lines.push('', '## Per project', '', '| Project | Hours | Time |', '| --- | ---: | ---: |');
  for (const [name, ms] of t.byProject) {
    lines.push(`| ${mdCell(name)} | ${decimalHours(ms)} | ${formatDuration(ms)} |`);
  }
  lines.push(
    '',
    `**Total: ${decimalHours(t.total)} hours (${formatDuration(t.total)})**`,
    '',
    `${OVERLAP_NOTE} Generated ${new Date(generatedAt).toLocaleString()} by Local Time Ledger. Times use your local time zone.`,
    '',
  );
  return lines.join('\n');
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const STYLE = `
body { font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 2rem auto; max-width: 52rem; padding: 0 1rem; }
h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
h2 { font-size: 1.1rem; margin-top: 2rem; }
p.meta { color: #444; margin-top: 0; }
table { border-collapse: collapse; width: 100%; }
th, td { border-bottom: 1px solid #ccc; padding: 0.35rem 0.5rem; text-align: left; }
th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
tfoot td { font-weight: 600; border-top: 2px solid #111; border-bottom: none; }
footer { color: #555; font-size: 12px; margin-top: 2rem; }
@media print { body { margin: 0; max-width: none; } @page { margin: 15mm; } tr { break-inside: avoid; } }
`;

export function renderTimesheetHtml(t: Timesheet, generatedAt: number): string {
  const e = escapeHtml;
  const body: string[] = [`<h1>Timesheet: ${e(t.title)}</h1>`, `<p class="meta">${e(scopeLine(t))}</p>`];
  if (t.rows.length === 0) {
    body.push('<p>Nothing tracked in this range.</p>');
  } else {
    body.push(
      '<table>',
      '<thead><tr><th>Date</th><th>Project</th><th class="num">Hours</th><th class="num">Time</th></tr></thead>',
      '<tbody>',
      ...t.rows.map(
        (r) =>
          `<tr><td>${e(r.day)}</td><td>${e(r.project)}</td><td class="num">${decimalHours(r.total)}</td><td class="num">${e(formatDuration(r.total))}</td></tr>`,
      ),
      '</tbody>',
      `<tfoot><tr><td colspan="2">Total</td><td class="num">${decimalHours(t.total)}</td><td class="num">${e(formatDuration(t.total))}</td></tr></tfoot>`,
      '</table>',
      '<h2>Per project</h2>',
      '<table>',
      '<thead><tr><th>Project</th><th class="num">Hours</th><th class="num">Time</th></tr></thead>',
      '<tbody>',
      ...t.byProject.map(
        ([name, ms]) => `<tr><td>${e(name)}</td><td class="num">${decimalHours(ms)}</td><td class="num">${e(formatDuration(ms))}</td></tr>`,
      ),
      '</tbody>',
      '</table>',
    );
  }
  body.push(`<footer>${e(OVERLAP_NOTE)} Generated ${e(new Date(generatedAt).toLocaleString())} by Local Time Ledger. Times use your local time zone.</footer>`);
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>Timesheet ${e(t.firstDay)} to ${e(t.lastDay)}</title>`,
    `<style>${STYLE}</style>`,
    '</head>',
    '<body>',
    ...body,
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

export function renderTimesheet(t: Timesheet, format: TimesheetFormat, generatedAt: number): string {
  switch (format) {
    case 'csv':
      return renderCsv(t);
    case 'markdown':
      return renderTimesheetMarkdown(t, generatedAt);
    case 'html':
      return renderTimesheetHtml(t, generatedAt);
  }
}

/** Preset ranges offered by the export command. All are whole local days. */
export function presetRanges(now: number): DateRange[] {
  const d = new Date(now);
  const tomorrow = startOfNextDay(now);
  const weekStart = startOfWeek(now);
  const lastWeekStart = startOfWeek(weekStart - 1);
  const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  const lastMonthStart = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
  return [
    { label: 'This week', from: weekStart, to: tomorrow },
    { label: 'Last week', from: lastWeekStart, to: weekStart },
    { label: 'This month', from: monthStart, to: tomorrow },
    { label: 'Last month', from: lastMonthStart, to: monthStart },
    { label: 'Last 30 days', from: new Date(d.getFullYear(), d.getMonth(), d.getDate() - 29).getTime(), to: tomorrow },
  ];
}

/** Parses a local YYYY-MM-DD day. Returns local midnight, or undefined for anything else. */
export function parseDay(text: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!m) {
    return undefined;
  }
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, da);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== da) {
    return undefined;
  }
  return startOfDay(date.getTime());
}

/** A custom range from two inclusive local days. Undefined when invalid or reversed. */
export function customRange(firstDay: string, lastDay: string): DateRange | undefined {
  const from = parseDay(firstDay);
  const last = parseDay(lastDay);
  if (from === undefined || last === undefined || last < from) {
    return undefined;
  }
  return { label: `${dayKey(from)} to ${dayKey(last)}`, from, to: startOfNextDay(last) };
}

export function defaultFileName(t: Timesheet, format: TimesheetFormat): string {
  return `timesheet-${t.firstDay}-to-${t.lastDay}.${TIMESHEET_EXTENSIONS[format]}`;
}
