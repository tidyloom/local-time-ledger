/**
 * Timesheet export (Pro). Pure code: builds a timesheet from segments and renders it as CSV,
 * Markdown or a printable HTML page. No file, editor or network calls here.
 */

import {
  amountCents,
  billTimesheet,
  formatMoney,
  rowBillable,
  rowClient,
  summarizeClients,
  type Bill,
  type BillableDefault,
  type ClientSummary,
  type ProjectRate,
  type Rates,
} from './billing';
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
  /** Client label set on the sessions in the session editor. Undefined when they have none. */
  readonly client?: string;
  /** Time in sessions tagged billable. */
  readonly billableTagged: number;
  /** Time in sessions tagged billable or not tagged, used when untagged time counts as billable. */
  readonly billableWithUntagged: number;
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
  /** True when a session in the range has a client label or a billable tag. */
  readonly hasSessionBilling: boolean;
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
 * spent on that project that day. Sessions with a client label get their own row per client.
 * Ledgers without labels or tags give exactly the rows they gave before. With project set, only
 * that project is included.
 */
export function buildTimesheet(segments: readonly Segment[], range: DateRange, project = ''): Timesheet {
  const selected = project === '' ? segments : segments.filter((s) => s.project === project);
  const rows: TimesheetRow[] = [];
  // Per project totals come from the project's own union each day, so a client split never counts time twice.
  const totals = new Map<string, number>();
  const days = [...splitByDay(selected, range.from, range.to).entries()].sort((a, b) => a[0] - b[0]);
  for (const [day, pieces] of days) {
    const byKey = new Map<string, Segment[]>();
    const byProject = new Map<string, Segment[]>();
    for (const p of pieces) {
      byProject.set(p.project, [...(byProject.get(p.project) ?? []), p]);
      const key = `${p.project}\u0000${p.client ?? ''}`;
      const list = byKey.get(key);
      if (list) {
        list.push(p);
      } else {
        byKey.set(key, [p]);
      }
    }
    const dayRows = [...byKey.values()]
      .map((list): TimesheetRow => {
        const first = list[0] as Segment;
        return {
          day: dayKey(day),
          project: first.project,
          total: unionLength(list),
          ...(first.client !== undefined ? { client: first.client } : {}),
          billableTagged: unionLength(list.filter((s) => s.billable === true)),
          billableWithUntagged: unionLength(list.filter((s) => s.billable !== false)),
        };
      })
      .filter((r) => r.total > 0)
      .sort((a, b) => a.project.localeCompare(b.project) || (a.client ?? '').localeCompare(b.client ?? ''));
    rows.push(...dayRows);
    for (const [name, list] of byProject) {
      totals.set(name, (totals.get(name) ?? 0) + unionLength(list));
    }
  }
  return {
    title: range.label,
    firstDay: dayKey(range.from),
    lastDay: dayKey(range.to - 1),
    project,
    rows,
    byProject: [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    total: unionLength(clip(selected, range.from, range.to)),
    hasSessionBilling: clip(selected, range.from, range.to).some((s) => s.client !== undefined || s.billable !== undefined),
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

/**
 * With billing data (a priced project, a client label or a billable tag), every row also gets
 * client, rate, currency, billable amount, billable hours and billable minutes. Rate, currency
 * and amount stay empty for projects without a rate. Without billing data the old four columns
 * are written unchanged.
 */
export function renderCsv(t: Timesheet, rates?: Rates, bill?: Bill, clients?: ClientSummary): string {
  const billing = bill !== undefined || clients !== undefined;
  const table: Rates = rates ?? new Map<string, ProjectRate>();
  const mode = clients?.mode ?? 'withClient';
  const lines = [
    billing
      ? ['Date', 'Project', 'Hours', 'Minutes', 'Client', 'Hourly rate', 'Currency', 'Amount', 'Billable hours', 'Billable minutes']
      : ['Date', 'Project', 'Hours', 'Minutes'],
  ];
  for (const r of t.rows) {
    const base = [r.day, r.project, decimalHours(r.total), minutes(r.total)];
    if (!billing) {
      lines.push(base);
      continue;
    }
    const rate = table.get(r.project);
    const billable = rowBillable(r, table, mode);
    const priced = rate ? [String(rate.hourlyRate), rate.currency, (amountCents(billable, rate.hourlyRate) / 100).toFixed(2)] : ['', '', ''];
    lines.push([...base, rowClient(r, table), ...priced, decimalHours(billable), minutes(billable)]);
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

const UNRATED_NOTE = 'Not priced (no hourly rate set):';

const NO_CLIENT = '(no client)';

const NO_RATE = 'no rate';

const DEFAULT_NOTE: Readonly<Record<BillableDefault, string>> = {
  withClient: 'Billable time follows the billable tag of each session. Untagged sessions are billable when they have a client.',
  always: 'Billable time follows the billable tag of each session. Untagged sessions are billable.',
  never: 'Billable time follows the billable tag of each session. Untagged sessions are not billable.',
};

const CLIENTS_TITLE = 'Billable time per client';

function clientAmount(l: ClientSummary['lines'][number]): string {
  return l.currency === undefined || l.amountCents === undefined ? NO_RATE : formatMoney(l.amountCents, l.currency);
}

function clientsMarkdown(c: ClientSummary): string[] {
  const lines = [
    '',
    `## ${CLIENTS_TITLE}`,
    '',
    '| Client | Hours | Billable hours | Non-billable hours | Billable amount |',
    '| --- | ---: | ---: | ---: | ---: |',
  ];
  for (const l of c.lines) {
    lines.push(
      `| ${mdCell(l.client === '' ? NO_CLIENT : l.client)} | ${decimalHours(l.total)} | ${decimalHours(l.billable)} | ${decimalHours(l.total - l.billable)} | ${mdCell(clientAmount(l))} |`,
    );
  }
  lines.push('', DEFAULT_NOTE[c.mode]);
  return lines;
}

function billMarkdown(bill: Bill): string[] {
  const lines = ['', '## Billing', '', '| Client | Project | Hours | Billable hours | Rate | Amount |', '| --- | --- | ---: | ---: | ---: | ---: |'];
  for (const l of bill.lines) {
    lines.push(
      `| ${mdCell(l.client)} | ${mdCell(l.project)} | ${decimalHours(l.total)} | ${decimalHours(l.billable)} | ${mdCell(formatMoney(Math.round(l.hourlyRate * 100), l.currency))} | ${mdCell(formatMoney(l.amountCents, l.currency))} |`,
    );
  }
  lines.push('');
  for (const c of bill.totals) {
    lines.push(`**Amount due: ${mdCell(formatMoney(c.amountCents, c.currency))}**`, '');
  }
  if (bill.unrated.length > 0) {
    lines.push(`${UNRATED_NOTE} ${bill.unrated.map(mdCell).join(', ')}.`, '');
  }
  lines.pop();
  return lines;
}

export function renderTimesheetMarkdown(t: Timesheet, generatedAt: number, bill?: Bill, clients?: ClientSummary): string {
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
    ...(clients ? clientsMarkdown(clients) : []),
    ...(bill ? billMarkdown(bill) : []),
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

function clientsHtml(c: ClientSummary): string[] {
  const e = escapeHtml;
  return [
    `<h2>${CLIENTS_TITLE}</h2>`,
    '<table>',
    '<thead><tr><th>Client</th><th class="num">Hours</th><th class="num">Billable hours</th><th class="num">Non-billable hours</th><th class="num">Billable amount</th></tr></thead>',
    '<tbody>',
    ...c.lines.map(
      (l) =>
        `<tr><td>${e(l.client === '' ? NO_CLIENT : l.client)}</td><td class="num">${decimalHours(l.total)}</td><td class="num">${decimalHours(l.billable)}</td><td class="num">${decimalHours(l.total - l.billable)}</td><td class="num">${e(clientAmount(l))}</td></tr>`,
    ),
    '</tbody>',
    '</table>',
    `<p class="meta">${e(DEFAULT_NOTE[c.mode])}</p>`,
  ];
}

function billHtml(bill: Bill): string[] {
  const e = escapeHtml;
  const out = [
    '<h2>Billing</h2>',
    '<table>',
    '<thead><tr><th>Client</th><th>Project</th><th class="num">Hours</th><th class="num">Billable hours</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>',
    '<tbody>',
    ...bill.lines.map(
      (l) =>
        `<tr><td>${e(l.client)}</td><td>${e(l.project)}</td><td class="num">${decimalHours(l.total)}</td><td class="num">${decimalHours(l.billable)}</td><td class="num">${e(formatMoney(Math.round(l.hourlyRate * 100), l.currency))}</td><td class="num">${e(formatMoney(l.amountCents, l.currency))}</td></tr>`,
    ),
    '</tbody>',
    `<tfoot>${bill.totals.map((c) => `<tr><td colspan="5">Amount due</td><td class="num">${e(formatMoney(c.amountCents, c.currency))}</td></tr>`).join('')}</tfoot>`,
    '</table>',
  ];
  if (bill.unrated.length > 0) {
    out.push(`<p class="meta">${e(`${UNRATED_NOTE} ${bill.unrated.join(', ')}.`)}</p>`);
  }
  return out;
}

export function renderTimesheetHtml(t: Timesheet, generatedAt: number, bill?: Bill, clients?: ClientSummary): string {
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
      ...(clients ? clientsHtml(clients) : []),
      ...(bill ? billHtml(bill) : []),
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

/**
 * Renders a timesheet. With rates the billable time of priced projects gets amounts. The per
 * client billable section appears when a project is priced or a session has a client label or a
 * billable tag. Otherwise the output is exactly the plain timesheet.
 */
export function renderTimesheet(t: Timesheet, format: TimesheetFormat, generatedAt: number, rates?: Rates, mode: BillableDefault = 'withClient'): string {
  const bill = rates ? billTimesheet(t, rates, mode) : undefined;
  const clients = bill !== undefined || t.hasSessionBilling ? summarizeClients(t, rates ?? new Map<string, ProjectRate>(), mode) : undefined;
  switch (format) {
    case 'csv':
      return renderCsv(t, rates, bill, clients);
    case 'markdown':
      return renderTimesheetMarkdown(t, generatedAt, bill, clients);
    case 'html':
      return renderTimesheetHtml(t, generatedAt, bill, clients);
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
