/**
 * Pro: the manual session editor. Quick pick based, fully local. It reads and rewrites the
 * ledger files through the host and never touches the network.
 */

import * as vscode from 'vscode';
import {
  deleteSession,
  editSession,
  formatLocalDateTime,
  mergeSessions,
  parseLocalDateTime,
  splitSession,
  MAX_CLIENT_LENGTH,
  MAX_NOTE_LENGTH,
  type EditResult,
} from './core/edit';
import type { Segment } from './core/segment';
import { dayKey, formatDuration } from './core/time';

/** What the editor needs from the extension. */
export interface SessionHost {
  isPro(): boolean;
  /** Writes pending time to disk first, so every session shown is a stored one. */
  flush(): Promise<void>;
  /** Every stored session, all time, oldest first. Not the stretch that is still running. */
  readStored(): Promise<Segment[]>;
  apply(removed: readonly Segment[], added: readonly Segment[]): void;
  undo(): boolean;
  /** Reload the views after the ledger changed. */
  changed(): Promise<void>;
  offerPro(feature: string): Promise<void>;
}

/** Lets a caller (or a test) skip the pickers. Times are ISO strings. */
export interface SessionEditArgs {
  readonly start: string;
  readonly project: string;
  readonly op: 'edit' | 'split' | 'merge-next' | 'merge-previous' | 'delete';
  readonly newStart?: string;
  readonly newEnd?: string;
  readonly note?: string;
  readonly client?: string;
  readonly splitAt?: string;
}

type Action = 'start' | 'end' | 'note' | 'client' | 'split' | 'merge-previous' | 'merge-next' | 'delete';

function describe(s: Segment): string {
  const t = (ms: number): string => formatLocalDateTime(ms).slice(11);
  return `${t(s.start)} to ${t(s.end)}`;
}

function detail(s: Segment): string {
  return [s.project, s.language, s.client ? `client: ${s.client}` : '', s.note ? `note: ${s.note}` : ''].filter((p) => p !== '').join(', ');
}

function byStart(a: Segment, b: Segment): number {
  return a.start - b.start || a.end - b.end;
}

async function report(result: EditResult, host: SessionHost, done: string): Promise<boolean> {
  if (!result.ok) {
    void vscode.window.showErrorMessage(`Session not changed. ${result.error}`);
    return false;
  }
  try {
    host.apply(result.removed, result.added);
  } catch (err) {
    void vscode.window.showErrorMessage(`Session not changed. ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  await host.changed();
  void vscode.window.showInformationMessage(`${done} Use "Local Time Ledger: Undo Last Session Edit (Pro)" to take it back.`);
  return true;
}

function neighbour(all: readonly Segment[], target: Segment, dir: 1 | -1): Segment | undefined {
  const same = all.filter((s) => s.project === target.project).sort(byStart);
  const i = same.findIndex((s) => s === target);
  return i < 0 ? undefined : same[i + dir];
}

async function chooseSession(all: readonly Segment[]): Promise<Segment | undefined> {
  if (all.length === 0) {
    void vscode.window.showInformationMessage('There are no recorded sessions to edit yet.');
    return undefined;
  }
  const days = new Map<string, Segment[]>();
  for (const s of [...all].sort(byStart).reverse()) {
    const key = dayKey(s.start);
    days.set(key, [...(days.get(key) ?? []), s]);
  }
  const dayItems = [...days].map(([key, list]) => ({
    label: key,
    description: `${String(list.length)} session${list.length === 1 ? '' : 's'}, ${formatDuration(list.reduce((n, s) => n + (s.end - s.start), 0))}`,
  }));
  const day = await vscode.window.showQuickPick(dayItems, { title: 'Edit Sessions: pick a day', ignoreFocusOut: true });
  if (!day) {
    return undefined;
  }
  const list = [...(days.get(day.label) ?? [])].sort(byStart);
  const pick = await vscode.window.showQuickPick(
    list.map((s) => ({ label: describe(s), description: formatDuration(s.end - s.start), detail: detail(s), seg: s })),
    { title: `Edit Sessions: ${day.label}`, ignoreFocusOut: true },
  );
  return pick?.seg;
}

async function chooseAction(target: Segment, all: readonly Segment[]): Promise<Action | undefined> {
  const items: Array<vscode.QuickPickItem & { action: Action }> = [
    { label: 'Change start', description: formatLocalDateTime(target.start), action: 'start' },
    { label: 'Change end', description: formatLocalDateTime(target.end), action: 'end' },
    { label: 'Edit note', description: target.note ?? 'none', action: 'note' },
    { label: 'Edit client label', description: target.client ?? 'none', action: 'client' },
    { label: 'Split in two', description: 'at a time you choose', action: 'split' },
  ];
  if (neighbour(all, target, -1)) {
    items.push({ label: 'Merge with the previous session', description: 'same project', action: 'merge-previous' });
  }
  if (neighbour(all, target, 1)) {
    items.push({ label: 'Merge with the next session', description: 'same project', action: 'merge-next' });
  }
  items.push({ label: 'Delete this session', description: 'can be undone', action: 'delete' });
  const picked = await vscode.window.showQuickPick(items, {
    title: `Edit Session ${describe(target)} (${target.project})`,
    ignoreFocusOut: true,
  });
  return picked?.action;
}

async function askTime(prompt: string, current: number): Promise<number | undefined> {
  const text = await vscode.window.showInputBox({
    title: 'Edit Sessions',
    prompt: `${prompt} Use HH:MM for the same day or YYYY-MM-DD HH:MM. Local time.`,
    value: formatLocalDateTime(current),
    ignoreFocusOut: true,
    validateInput: (v) => (parseLocalDateTime(v, current) === undefined ? 'Use HH:MM or YYYY-MM-DD HH:MM, for example 14:30.' : undefined),
  });
  return text === undefined ? undefined : parseLocalDateTime(text, current);
}

async function askText(prompt: string, current: string, max: number): Promise<string | undefined> {
  return vscode.window.showInputBox({
    title: 'Edit Sessions',
    prompt: `${prompt} Leave empty to clear it.`,
    value: current,
    ignoreFocusOut: true,
    validateInput: (v) => (v.length > max ? `At most ${String(max)} characters.` : undefined),
  });
}

async function interactive(host: SessionHost, all: Segment[], now: number): Promise<boolean | undefined> {
  const target = await chooseSession(all);
  if (!target) {
    return undefined;
  }
  const action = await chooseAction(target, all);
  if (!action) {
    return undefined;
  }
  switch (action) {
    case 'start':
    case 'end': {
      const t = await askTime(action === 'start' ? 'New start.' : 'New end.', action === 'start' ? target.start : target.end);
      if (t === undefined) {
        return undefined;
      }
      return report(editSession(target, action === 'start' ? { start: t } : { end: t }, all, now), host, 'Session updated.');
    }
    case 'note':
    case 'client': {
      const v =
        action === 'note'
          ? await askText('Note for this session.', target.note ?? '', MAX_NOTE_LENGTH)
          : await askText('Client label for this session.', target.client ?? '', MAX_CLIENT_LENGTH);
      if (v === undefined) {
        return undefined;
      }
      return report(editSession(target, action === 'note' ? { note: v } : { client: v }, all, now), host, 'Session updated.');
    }
    case 'split': {
      const mid = target.start + Math.floor((target.end - target.start) / 2 / 60_000) * 60_000;
      const t = await askTime('Split at.', mid);
      if (t === undefined) {
        return undefined;
      }
      return report(splitSession(target, t), host, 'Session split in two.');
    }
    case 'merge-previous':
    case 'merge-next': {
      const other = neighbour(all, target, action === 'merge-next' ? 1 : -1);
      if (!other) {
        return undefined;
      }
      const go = 'Merge';
      const ok = await vscode.window.showWarningMessage(
        `Merge ${describe(target)} with ${describe(other)} into one session? The gap between them is counted as work time.`,
        { modal: true },
        go,
      );
      return ok === go ? report(mergeSessions(target, other, all, now), host, 'Sessions merged.') : undefined;
    }
    case 'delete': {
      const go = 'Delete';
      const ok = await vscode.window.showWarningMessage(
        `Delete the session ${describe(target)} (${formatDuration(target.end - target.start)}, ${target.project})?`,
        { modal: true },
        go,
      );
      return ok === go ? report(deleteSession(target), host, 'Session deleted.') : undefined;
    }
  }
}

async function scripted(host: SessionHost, all: Segment[], args: SessionEditArgs, now: number): Promise<boolean> {
  const start = Date.parse(args.start);
  const target = all.find((s) => s.start === start && s.project === args.project);
  if (!target) {
    throw new Error('No stored session starts at that time in that project.');
  }
  const time = (v: string | undefined): number | undefined => (v === undefined ? undefined : Date.parse(v));
  switch (args.op) {
    case 'edit': {
      const changes = {
        ...(args.newStart !== undefined ? { start: Date.parse(args.newStart) } : {}),
        ...(args.newEnd !== undefined ? { end: Date.parse(args.newEnd) } : {}),
        ...(args.note !== undefined ? { note: args.note } : {}),
        ...(args.client !== undefined ? { client: args.client } : {}),
      };
      return report(editSession(target, changes, all, now), host, 'Session updated.');
    }
    case 'split':
      return report(splitSession(target, time(args.splitAt) ?? Number.NaN), host, 'Session split in two.');
    case 'merge-next':
    case 'merge-previous': {
      const other = neighbour(all, target, args.op === 'merge-next' ? 1 : -1);
      if (!other) {
        throw new Error('There is no session to merge with.');
      }
      return report(mergeSessions(target, other, all, now), host, 'Sessions merged.');
    }
    case 'delete':
      return report(deleteSession(target), host, 'Session deleted.');
  }
}

/** Returns true when the ledger changed. */
export async function editSessions(host: SessionHost, args?: SessionEditArgs): Promise<boolean> {
  if (!host.isPro()) {
    void host.offerPro('The session editor');
    return false;
  }
  await host.flush();
  const all = await host.readStored();
  const now = Date.now();
  if (args) {
    return scripted(host, all, args, now);
  }
  return (await interactive(host, all, now)) === true;
}

export async function undoSessionEdit(host: SessionHost): Promise<boolean> {
  if (!host.isPro()) {
    void host.offerPro('The session editor');
    return false;
  }
  await host.flush();
  let undone: boolean;
  try {
    undone = host.undo();
  } catch (err) {
    void vscode.window.showErrorMessage(`Nothing was undone. ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  if (!undone) {
    void vscode.window.showInformationMessage('There is no session edit to undo.');
    return false;
  }
  await host.changed();
  void vscode.window.showInformationMessage('The last session edit was undone.');
  return true;
}

