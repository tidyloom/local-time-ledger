import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseLedger, serializeSegment, type Segment } from './segment';
import { monthKey } from './time';

export const FORMAT_NOTE = `Local Time Ledger data folder

Each ledger-YYYY-MM.jsonl file holds one JSON object per line:

{"v":1,"start":"2026-01-05T09:00:00.000Z","end":"2026-01-05T09:25:00.000Z","project":"demo","language":"typescript"}

start and end are UTC timestamps (ISO 8601). project is the workspace name. language is the
editor language id. A line goes into the file of the month its start falls in (local time).

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
}
