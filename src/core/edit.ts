/**
 * Pure rules for the Pro session editor: edit, split, merge and delete one recorded session.
 * Nothing here touches the file system or the network. Every function returns what to remove
 * and what to add, so the store can apply the change in one step and undo it later.
 */

import type { Segment } from './segment';
import { MINUTE } from './time';

export const MIN_SESSION_MS = MINUTE;
export const MAX_NOTE_LENGTH = 200;
export const MAX_CLIENT_LENGTH = 100;

export type EditResult = { readonly ok: true; readonly removed: Segment[]; readonly added: Segment[] } | { readonly ok: false; readonly error: string };

export interface SessionChanges {
  readonly start?: number;
  readonly end?: number;
  /** Empty string clears the note. */
  readonly note?: string;
  /** Empty string clears the client. */
  readonly client?: string;
}

function fail(error: string): EditResult {
  return { ok: false, error };
}

export function sameSegment(a: Segment, b: Segment): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.project === b.project &&
    a.language === b.language &&
    (a.note ?? '') === (b.note ?? '') &&
    (a.client ?? '') === (b.client ?? '')
  );
}

/** Removes control characters and trims. Returns an error text when the value is too long. */
export function cleanText(value: string, max: number, what: string): { value: string } | { error: string } {
  // eslint-disable-next-line no-control-regex
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (cleaned.length > max) {
    return { error: `The ${what} can be at most ${String(max)} characters.` };
  }
  return { value: cleaned };
}

function withText(seg: Segment, note: string | undefined, client: string | undefined): Segment {
  const base: Segment = { start: seg.start, end: seg.end, project: seg.project, language: seg.language };
  return { ...base, ...(note !== undefined && note !== '' ? { note } : {}), ...(client !== undefined && client !== '' ? { client } : {}) };
}

function overlapsOther(candidate: Segment, all: readonly Segment[], skip: readonly Segment[]): Segment | undefined {
  const skipped = [...skip];
  for (const s of all) {
    const i = skipped.findIndex((k) => sameSegment(k, s));
    if (i >= 0) {
      skipped.splice(i, 1);
      continue;
    }
    if (s.project === candidate.project && s.start < candidate.end && s.end > candidate.start) {
      return s;
    }
  }
  return undefined;
}

function checkTimes(start: number, end: number, now: number): string | undefined {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return 'The start and the end must be valid times.';
  }
  if (end <= start) {
    return 'The end must be after the start.';
  }
  if (end - start < MIN_SESSION_MS) {
    return 'A session must be at least one minute long.';
  }
  if (end > now) {
    return 'A session cannot end in the future.';
  }
  return undefined;
}

/** Edit start, end, note and client of one session. */
export function editSession(target: Segment, changes: SessionChanges, all: readonly Segment[], now: number): EditResult {
  const start = changes.start ?? target.start;
  const end = changes.end ?? target.end;
  const timesChanged = start !== target.start || end !== target.end;
  let note = target.note;
  let client = target.client;
  if (changes.note !== undefined) {
    const c = cleanText(changes.note, MAX_NOTE_LENGTH, 'note');
    if ('error' in c) {
      return fail(c.error);
    }
    note = c.value;
  }
  if (changes.client !== undefined) {
    const c = cleanText(changes.client, MAX_CLIENT_LENGTH, 'client');
    if ('error' in c) {
      return fail(c.error);
    }
    client = c.value;
  }
  if (timesChanged) {
    const bad = checkTimes(start, end, now);
    if (bad) {
      return fail(bad);
    }
  }
  const next = withText({ ...target, start, end }, note, client);
  if (timesChanged) {
    const other = overlapsOther(next, all, [target]);
    if (other) {
      return fail('The new times overlap another session of the same project. Change that session first or merge them.');
    }
  }
  if (sameSegment(next, target)) {
    return fail('Nothing changed.');
  }
  return { ok: true, removed: [target], added: [next] };
}

/** Split one session at a time inside it. Both parts keep project, language, note and client. */
export function splitSession(target: Segment, at: number): EditResult {
  if (!Number.isFinite(at) || at - target.start < MIN_SESSION_MS || target.end - at < MIN_SESSION_MS) {
    return fail('Split inside the session, at least one minute from both ends.');
  }
  return {
    ok: true,
    removed: [target],
    added: [withText({ ...target, end: at }, target.note, target.client), withText({ ...target, start: at }, target.note, target.client)],
  };
}

/** Merge two sessions of the same project into one that covers both and the gap between them. */
export function mergeSessions(a: Segment, b: Segment, all: readonly Segment[], now: number): EditResult {
  if (a === b) {
    return fail('Pick two different sessions to merge.');
  }
  if (a.project !== b.project) {
    return fail('Only sessions of the same project can be merged.');
  }
  if (a.client !== undefined && b.client !== undefined && a.client !== b.client) {
    return fail('These sessions have different clients. Give them the same client first.');
  }
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  const start = first.start;
  const end = Math.max(first.end, second.end);
  const bad = checkTimes(start, end, now);
  if (bad) {
    return fail(bad);
  }
  const notes = [first.note, second.note].filter((n): n is string => n !== undefined && n !== '');
  const note = [...new Set(notes)].join(' / ');
  if (note.length > MAX_NOTE_LENGTH) {
    return fail(`The joined note would be longer than ${String(MAX_NOTE_LENGTH)} characters. Shorten a note first.`);
  }
  const language = first.end - first.start >= second.end - second.start ? first.language : second.language;
  const merged = withText({ start, end, project: first.project, language }, note, first.client ?? second.client);
  const other = overlapsOther(merged, all, [a, b]);
  if (other) {
    return fail('Another session of the same project lies between them. Merge or delete it first.');
  }
  return { ok: true, removed: [first, second], added: [merged] };
}

export function deleteSession(target: Segment): EditResult {
  return { ok: true, removed: [target], added: [] };
}

function pad(n: number): string {
  return n < 10 ? `0${String(n)}` : String(n);
}

/** Local "YYYY-MM-DD HH:MM". */
export function formatLocalDateTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Parses "HH:MM" (on the same local day as base) or "YYYY-MM-DD HH:MM", in local time.
 * Returns undefined when the text is not a real time.
 */
export function parseLocalDateTime(text: string, base: number): number | undefined {
  const t = text.trim();
  const full = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/.exec(t);
  const short = /^(\d{1,2}):(\d{2})$/.exec(t);
  let y: number, mo: number, d: number, h: number, mi: number;
  if (full) {
    [y, mo, d, h, mi] = [Number(full[1]), Number(full[2]), Number(full[3]), Number(full[4]), Number(full[5])];
  } else if (short) {
    const b = new Date(base);
    [y, mo, d, h, mi] = [b.getFullYear(), b.getMonth() + 1, b.getDate(), Number(short[1]), Number(short[2])];
  } else {
    return undefined;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) {
    return undefined;
  }
  const date = new Date(y, mo - 1, d, h, mi);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d || date.getHours() !== h) {
    return undefined;
  }
  return date.getTime();
}
