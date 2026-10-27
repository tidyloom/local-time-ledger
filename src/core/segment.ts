/**
 * The ledger format. One JSON object per line (JSON Lines), for example:
 *
 * {"v":1,"start":"2026-01-05T09:00:00.000Z","end":"2026-01-05T09:25:00.000Z","project":"demo","language":"typescript"}
 *
 * start and end are ISO 8601 timestamps in UTC. project is the workspace name.
 * language is the VS Code language id of the active editor, or "other".
 * Lines that cannot be read are skipped, so a hand edit never breaks the extension.
 */

export const FORMAT_VERSION = 1;

export interface Segment {
  /** Epoch milliseconds, inclusive. */
  readonly start: number;
  /** Epoch milliseconds, exclusive. Always greater than start. */
  readonly end: number;
  readonly project: string;
  readonly language: string;
}

interface SegmentLine {
  v: number;
  start: string;
  end: string;
  project: string;
  language: string;
}

export function serializeSegment(seg: Segment): string {
  const line: SegmentLine = {
    v: FORMAT_VERSION,
    start: new Date(seg.start).toISOString(),
    end: new Date(seg.end).toISOString(),
    project: seg.project,
    language: seg.language,
  };
  return JSON.stringify(line);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Parses one ledger line. Returns undefined for blank, malformed or impossible lines. */
export function parseSegmentLine(line: string): Segment | undefined {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('//')) {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!isRecord(raw) || typeof raw.start !== 'string' || typeof raw.end !== 'string') {
    return undefined;
  }
  const start = Date.parse(raw.start);
  const end = Date.parse(raw.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return undefined;
  }
  const project = typeof raw.project === 'string' && raw.project !== '' ? raw.project : 'unknown';
  const language = typeof raw.language === 'string' && raw.language !== '' ? raw.language : 'other';
  return { start, end, project, language };
}

export interface ParseResult {
  readonly segments: Segment[];
  readonly skipped: number;
}

export function parseLedger(text: string): ParseResult {
  const segments: Segment[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '') {
      continue;
    }
    const seg = parseSegmentLine(line);
    if (seg) {
      segments.push(seg);
    } else {
      skipped++;
    }
  }
  return { segments, skipped };
}
