import * as fs from 'node:fs';
import * as path from 'node:path';
import { sameSegment } from './edit';
import { parseLedger, parseSegmentLine, serializeSegment, type Segment } from './segment';
import { monthKey } from './time';

export const FORMAT_NOTE = `Local Time Ledger data folder

Each ledger-YYYY-MM.jsonl file holds one JSON object per line:

{"v":1,"start":"2026-01-05T09:00:00.000Z","end":"2026-01-05T09:25:00.000Z","project":"demo","language":"typescript"}

start and end are UTC timestamps (ISO 8601). project is the workspace name. language is the
editor language id. A line goes into the file of the month its start falls in (local time).
Lines changed in the Pro session editor may also carry "note", "client" (text) and "billable"
(true or false). A line without "billable" follows the billable default setting.

You may edit, delete or back up these files at any time. Lines that cannot be read are skipped.
Overlapping lines are counted once. Nothing in this folder is ever sent anywhere.
`;

/** Reads and appends ledger files in one folder. Only local file system calls. */
export class LedgerStore {
  constructor(readonly dir: string) {}

  fileFor(ms: number): string {
    return path.join(this.dir, `ledger-${monthKey(ms)}.jsonl`);
  }

  private ensureDirSync(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const note = path.join(this.dir, 'FORMAT.txt');
    if (!fs.existsSync(note)) {
      fs.writeFileSync(note, FORMAT_NOTE, 'utf8');
    }
  }

  private group(segments: readonly Segment[]): Map<string, string> {
    const byFile = new Map<string, string>();
    for (const s of segments) {
      const file = this.fileFor(s.start);
      byFile.set(file, (byFile.get(file) ?? '') + serializeSegment(s) + '\n');
    }
    return byFile;
  }

  /** Appends segments. Appends are small single writes, so several windows can share a file. */
  async append(segments: readonly Segment[]): Promise<void> {
    if (segments.length === 0) {
      return;
    }
    this.ensureDirSync();
    for (const [file, text] of this.group(segments)) {
      await fs.promises.appendFile(file, text, 'utf8');
    }
  }

  /** Synchronous append for shutdown, when async work may not finish. */
  appendSync(segments: readonly Segment[]): void {
    if (segments.length === 0) {
      return;
    }
    this.ensureDirSync();
    for (const [file, text] of this.group(segments)) {
      fs.appendFileSync(file, text, 'utf8');
    }
  }

  /**
   * Local midnight on the first day of the earliest month that has a ledger file, or undefined
   * when there is none. Used by the Pro all time views.
   */
  async earliestMonth(): Promise<number | undefined> {
    let names: string[];
    try {
      names = await fs.promises.readdir(this.dir);
    } catch {
      return undefined;
    }
    let earliest: number | undefined;
    for (const name of names) {
      const m = /^ledger-(\d{4})-(\d{2})\.jsonl$/.exec(name);
      if (!m) {
        continue;
      }
      const month = Number(m[2]);
      if (month < 1 || month > 12) {
        continue;
      }
      const start = new Date(Number(m[1]), month - 1, 1).getTime();
      if (earliest === undefined || start < earliest) {
        earliest = start;
      }
    }
    return earliest;
  }

  /** Reads every segment that overlaps [from, to). Missing files are fine. */
  async read(from: number, to: number): Promise<{ segments: Segment[]; skipped: number }> {
    const files = new Set<string>();
    const d = new Date(from);
    // Include the previous month, since a segment may start before midnight on the 1st.
    let cursor = new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime();
    while (cursor < to) {
      files.add(this.fileFor(cursor));
      const c = new Date(cursor);
      cursor = new Date(c.getFullYear(), c.getMonth() + 1, 1).getTime();
    }
    const segments: Segment[] = [];
    let skipped = 0;
    for (const file of files) {
      let text: string;
      try {
        text = await fs.promises.readFile(file, 'utf8');
      } catch {
        continue;
      }
      const parsed = parseLedger(text);
      skipped += parsed.skipped;
      for (const s of parsed.segments) {
        if (s.end > from && s.start < to) {
          segments.push(s);
        }
      }
    }
    return { segments, skipped };
  }

  /** The undo journal for session edits. Not a ledger file, so the views never read it. */
  get journalFile(): string {
    return path.join(this.dir, 'session-edits.jsonl');
  }

  /**
   * Replaces whole sessions in the ledger files: removes each segment in `removed` (one matching
   * line each) and adds the `added` ones. Every touched file is checked first and then written to a
   * temporary file and renamed, so a crash never leaves a half written ledger. If a later file fails,
   * the earlier ones are restored. Lines that are not sessions (comments, damaged lines) are kept.
   * Throws when a segment to remove is no longer in the file, for example after a hand edit.
   */
  replaceSync(removed: readonly Segment[], added: readonly Segment[]): void {
    this.ensureDirSync();
    const files = new Map<string, string[]>();
    const load = (file: string): string[] => {
      let lines = files.get(file);
      if (!lines) {
        let text: string;
        try {
          text = fs.readFileSync(file, 'utf8');
        } catch {
          text = '';
        }
        lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
        files.set(file, lines);
      }
      return lines;
    };
    const originals = new Map<string, string | undefined>();
    for (const seg of [...removed, ...added]) {
      const file = this.fileFor(seg.start);
      if (!originals.has(file)) {
        originals.set(file, fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined);
      }
    }
    for (const seg of removed) {
      const lines = load(this.fileFor(seg.start));
      const i = lines.findIndex((line) => {
        const parsed = parseSegmentLine(line);
        return parsed !== undefined && sameSegment(parsed, seg);
      });
      if (i < 0) {
        throw new Error('That session changed on disk since it was listed. Refresh and try again.');
      }
      lines.splice(i, 1);
    }
    for (const seg of added) {
      load(this.fileFor(seg.start)).push(serializeSegment(seg));
    }
    const written: string[] = [];
    try {
      for (const [file, lines] of files) {
        const tmp = `${file}.tmp-${String(process.pid)}`;
        fs.writeFileSync(tmp, lines.length > 0 ? lines.join('\n') + '\n' : '', 'utf8');
        fs.renameSync(tmp, file);
        written.push(file);
      }
    } catch (err) {
      for (const file of written) {
        const original = originals.get(file);
        if (original === undefined) {
          fs.rmSync(file, { force: true });
        } else {
          fs.writeFileSync(file, original, 'utf8');
        }
      }
      throw err;
    }
  }

  /** Applies an edit and records it in the undo journal (the last 50 edits are kept). */
  applyEdit(removed: readonly Segment[], added: readonly Segment[]): void {
    this.replaceSync(removed, added);
    const entry = JSON.stringify({
      at: new Date().toISOString(),
      removed: removed.map((s) => serializeSegment(s)),
      added: added.map((s) => serializeSegment(s)),
    });
    const lines = this.readJournal();
    lines.push(entry);
    try {
      fs.writeFileSync(this.journalFile, lines.slice(-50).join('\n') + '\n', 'utf8');
    } catch (err) {
      // The edit itself succeeded and stays. Only undo is lost, so say so.
      console.error('[local-time-ledger] could not write the undo journal', err);
    }
  }

  private readJournal(): string[] {
    try {
      return fs
        .readFileSync(this.journalFile, 'utf8')
        .split(/\r?\n/)
        .filter((l) => l.trim() !== '');
    } catch {
      return [];
    }
  }

  /** Undoes the most recent edit. Returns false when there is nothing to undo. */
  undoLastEdit(): boolean {
    const lines = this.readJournal();
    const last = lines.at(-1);
    if (last === undefined) {
      return false;
    }
    const parse = (v: unknown): Segment[] =>
      Array.isArray(v) ? v.flatMap((l) => (typeof l === 'string' ? (parseSegmentLine(l) ?? []) : [])) : [];
    let entry: { removed?: unknown; added?: unknown };
    try {
      entry = JSON.parse(last) as { removed?: unknown; added?: unknown };
    } catch {
      throw new Error('The undo journal is damaged, so the last edit cannot be undone.');
    }
    this.replaceSync(parse(entry.added), parse(entry.removed));
    lines.pop();
    fs.writeFileSync(this.journalFile, lines.length > 0 ? lines.join('\n') + '\n' : '', 'utf8');
    return true;
  }
}
