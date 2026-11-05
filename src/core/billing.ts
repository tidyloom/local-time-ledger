/**
 * Clients and hourly rates (Pro). Pure code: reads the user's rate table from settings and
 * prices a timesheet. No file, editor or network calls here.
 */

import type { Timesheet } from './export';
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

export interface BillLine {
  readonly client: string;
  readonly project: string;
  /** Time on this project over the range. */
  readonly total: number;
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
  /** One line per project with a rate, sorted by client then project. */
  readonly lines: BillLine[];
  /** Amount per currency. Currencies are never added together. */
  readonly totals: CurrencyTotal[];
  /** Projects in the timesheet that have no rate, so they are not priced. */
  readonly unrated: string[];
}

/** Prices a timesheet. Undefined when no project in it has a rate, so the output stays as before. */
export function billTimesheet(t: Timesheet, rates: Rates): Bill | undefined {
  const perProject = new Map<string, { total: number; cents: number }>();
  for (const r of t.rows) {
    const rate = rates.get(r.project);
    if (!rate) {
      continue;
    }
    const cur = perProject.get(r.project) ?? { total: 0, cents: 0 };
    cur.total += r.total;
    cur.cents += amountCents(r.total, rate.hourlyRate);
    perProject.set(r.project, cur);
  }
  if (perProject.size === 0) {
    return undefined;
  }
  const lines: BillLine[] = [...perProject.entries()]
    .map(([project, v]): BillLine => {
      const rate = rates.get(project) as ProjectRate;
      return { client: rate.client, project, total: v.total, hourlyRate: rate.hourlyRate, currency: rate.currency, amountCents: v.cents };
    })
    .sort((a, b) => a.client.localeCompare(b.client) || a.project.localeCompare(b.project));
  const totals = new Map<string, number>();
  for (const l of lines) {
    totals.set(l.currency, (totals.get(l.currency) ?? 0) + l.amountCents);
  }
  return {
    lines,
    totals: [...totals.entries()].map(([currency, cents]) => ({ currency, amountCents: cents })).sort((a, b) => a.currency.localeCompare(b.currency)),
    unrated: t.byProject.map(([name]) => name).filter((name) => !rates.has(name)),
  };
}
