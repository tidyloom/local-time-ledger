/**
 * Clients, hourly rates and billable time (Pro). Pure code: reads the user's rate table and
 * billable default from settings and prices a timesheet. No file, editor or network calls here.
 */

import type { Timesheet, TimesheetRow } from './export';
import { MINUTE } from './time';

export interface ProjectRate {
  /** Client name shown on the timesheet. Empty when the user gave none. */
  readonly client: string;
  /** Price for one hour, in the given currency. */
  readonly hourlyRate: number;
  /** Free text currency label such as EUR or USD. Empty when the user gave none. */
  readonly currency: string;
}

/** Project name to its client and rate. */
export type Rates = ReadonlyMap<string, ProjectRate>;

export interface ParsedRates {
  readonly rates: Rates;
  /** One plain sentence per entry that was skipped. */
  readonly problems: string[];
}

const MAX_RATE = 1_000_000;
const MAX_TEXT = 80;

function cleanText(value: unknown): string | undefined {
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.trim().slice(0, MAX_TEXT);
}

/**
 * Parses the localTimeLedger.clients setting: an object that maps a project name to
 * { "client": "Example Client", "hourlyRate": 50, "currency": "EUR" }. Bad entries are skipped
 * and reported, never guessed.
 */
export function parseRates(raw: unknown): ParsedRates {
  const rates = new Map<string, ProjectRate>();
  const problems: string[] = [];
  if (raw === undefined || raw === null) {
    return { rates, problems };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { rates, problems: ['The clients setting must be an object that maps project names to a client and an hourly rate.'] };
  }
  for (const [project, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = project.trim();
    if (name === '') {
      continue;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      problems.push(`Skipped "${name}": the entry must be an object with an hourlyRate.`);
      continue;
    }
    const entry = value as Record<string, unknown>;
    const rate = entry.hourlyRate;
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) {
      problems.push(`Skipped "${name}": hourlyRate must be a number from 0 to ${String(MAX_RATE)}.`);
      continue;
    }
    const client = cleanText(entry.client);
    const currency = cleanText(entry.currency);
    if (client === undefined || currency === undefined) {
      problems.push(`Skipped "${name}": client and currency must be text.`);
      continue;
    }
    rates.set(name, { client, hourlyRate: rate, currency: currency.toUpperCase() });
  }
  return { rates, problems };
}

/** Price of a duration in cents, billed per whole minute (rounded to the nearest minute). */
export function amountCents(ms: number, hourlyRate: number): number {
  const minutes = Math.round(Math.max(0, ms) / MINUTE);
  return Math.round((minutes * hourlyRate * 100) / 60);
}

export function formatMoney(cents: number, currency: string): string {
  const text = (cents / 100).toFixed(2);
  return currency === '' ? text : `${text} ${currency}`;
}

/**
 * What untagged sessions count as. withClient: billable when the session has a client label or its
 * project is listed in the clients setting. always: billable. never: non-billable.
 */
export type BillableDefault = 'withClient' | 'always' | 'never';

export const BILLABLE_DEFAULTS: readonly BillableDefault[] = ['withClient', 'always', 'never'];

/** Reads the billableDefault setting. Anything unknown falls back to withClient. */
export function parseBillableDefault(raw: unknown): BillableDefault {
  return BILLABLE_DEFAULTS.find((d) => d === raw) ?? 'withClient';
}

/** Whether an untagged session of this project, with this client label, counts as billable. */
export function billableByDefault(project: string, client: string | undefined, rates: Rates, mode: BillableDefault): boolean {
  switch (mode) {
    case 'always':
      return true;
    case 'never':
      return false;
    case 'withClient':
      return (client !== undefined && client !== '') || rates.has(project);
  }
}

/** Billable time in one timesheet row: tagged billable time plus untagged time when that counts. */
export function rowBillable(r: TimesheetRow, rates: Rates, mode: BillableDefault): number {
  return billableByDefault(r.project, r.client, rates, mode) ? r.billableWithUntagged : r.billableTagged;
}

/** The client a row is billed to: the session label, else the project's client from settings. */
export function rowClient(r: TimesheetRow, rates: Rates): string {
  return r.client ?? rates.get(r.project)?.client ?? '';
}

export interface BillLine {
  readonly client: string;
  readonly project: string;
  /** Time on this project for this client over the range. */
  readonly total: number;
  /** The billable part of total. Only this part is priced. */
  readonly billable: number;
  readonly hourlyRate: number;
  readonly currency: string;
  /** Sum of the per day row amounts, so the lines always add up to the rows. */
  readonly amountCents: number;
}

export interface CurrencyTotal {
  readonly currency: string;
  readonly amountCents: number;
}

export interface Bill {
  /** One line per client and project with a rate, sorted by client then project. */
  readonly lines: BillLine[];
  /** Amount per currency. Currencies are never added together. */
  readonly totals: CurrencyTotal[];
  /** Projects in the timesheet that have no rate, so they are not priced. */
  readonly unrated: string[];
}

function sumByCurrency(items: ReadonlyArray<{ currency: string; amountCents: number }>): CurrencyTotal[] {
  const totals = new Map<string, number>();
  for (const l of items) {
    totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.amountCents);
  }
  return [...totals.entries()].map(([currency, cents]) => ({ currency, amountCents: cents })).sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * Prices the billable time of a timesheet. Undefined when no project in it has a rate, so the
 * output stays as before. Without billable tags every priced session is billable by default, so
 * amounts match the ones from before billable tags existed.
 */
export function billTimesheet(t: Timesheet, rates: Rates, mode: BillableDefault = 'withClient'): Bill | undefined {
  const perLine = new Map<string, { client: string; project: string; total: number; billable: number; cents: number }>();
  for (const r of t.rows) {
    const rate = rates.get(r.project);
    if (!rate) {
      continue;
    }
    const client = rowClient(r, rates);
    const key = `${client}\u0000${r.project}`;
    const billable = rowBillable(r, rates, mode);
    const cur = perLine.get(key) ?? { client, project: r.project, total: 0, billable: 0, cents: 0 };
    cur.total += r.total;
    cur.billable += billable;
    cur.cents += amountCents(billable, rate.hourlyRate);
    perLine.set(key, cur);
  }
  if (perLine.size === 0) {
    return undefined;
  }
  const lines: BillLine[] = [...perLine.values()]
    .map((v): BillLine => {
      const rate = rates.get(v.project) as ProjectRate;
      return { client: v.client, project: v.project, total: v.total, billable: v.billable, hourlyRate: rate.hourlyRate, currency: rate.currency, amountCents: v.cents };
    })
    .sort((a, b) => a.client.localeCompare(b.client) || a.project.localeCompare(b.project));
  return {
    lines,
    totals: sumByCurrency(lines),
    unrated: t.byProject.map(([name]) => name).filter((name) => !rates.has(name)),
  };
}

export interface ClientLine {
  /** Empty for time with no client. */
  readonly client: string;
  /** Currency of the priced part. Undefined for time in projects without a rate. */
  readonly currency: string | undefined;
  readonly total: number;
  readonly billable: number;
  /** Billable amount. Undefined when the projects have no rate. */
  readonly amountCents: number | undefined;
}

export interface ClientSummary {
  /**
   * One line per client and currency (plus one for unpriced time), sorted by client with
   * "no client" last. A client billed in two currencies gets two lines, never one mixed sum.
   */
  readonly lines: ClientLine[];
  /** Billable amount per currency over all clients. */
  readonly totals: CurrencyTotal[];
  readonly mode: BillableDefault;
}

/** Total, billable and non-billable time and billable amounts per client. */
export function summarizeClients(t: Timesheet, rates: Rates, mode: BillableDefault = 'withClient'): ClientSummary {
  const perKey = new Map<string, { client: string; currency: string | undefined; total: number; billable: number; cents: number }>();
  for (const r of t.rows) {
    const rate = rates.get(r.project);
    const client = rowClient(r, rates);
    const currency = rate?.currency;
    const key = `${client}\u0000${rate ? `r:${rate.currency}` : 'u'}`;
    const billable = rowBillable(r, rates, mode);
    const cur = perKey.get(key) ?? { client, currency, total: 0, billable: 0, cents: 0 };
    cur.total += r.total;
    cur.billable += billable;
    cur.cents += rate ? amountCents(billable, rate.hourlyRate) : 0;
    perKey.set(key, cur);
  }
  const lines = [...perKey.values()]
    .map((v): ClientLine => ({ client: v.client, currency: v.currency, total: v.total, billable: v.billable, amountCents: v.currency === undefined ? undefined : v.cents }))
    .sort(
      (a, b) =>
        Number(a.client === '') - Number(b.client === '') ||
        a.client.localeCompare(b.client) ||
        Number(a.currency === undefined) - Number(b.currency === undefined) ||
        (a.currency ?? '').localeCompare(b.currency ?? ''),
    );
  const priced = lines.flatMap((l) => (l.currency !== undefined && l.amountCents !== undefined ? [{ currency: l.currency, amountCents: l.amountCents }] : []));
  return { lines, totals: sumByCurrency(priced), mode };
}
