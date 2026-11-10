import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  deleteSession,
  editSession,
  formatLocalDateTime,
  mergeSessions,
  parseLocalDateTime,
  splitSession,
  type EditResult,
} from '../../core/edit';
import { parseSegmentLine, serializeSegment, type Segment } from '../../core/segment';
import { LedgerStore } from '../../core/store';
import { MINUTE } from '../../core/time';

const base = new Date(2026, 5, 10, 9, 0).getTime();
const at = (min: number): number => base + min * MINUTE;
const seg = (a: number, b: number, extra: Partial<Segment> = {}): Segment => ({
  start: at(a),
  end: at(b),
  project: 'demo',
  language: 'go',
  ...extra,
});
const now = new Date(2026, 5, 11, 12, 0).getTime();

function ok(r: EditResult): { removed: Segment[]; added: Segment[] } {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r;
}
function err(r: EditResult): string {
  assert.ok(!r.ok);
  return r.error;
}

describe('session editing rules', () => {
  it('edits start, end, note and client', () => {
    const s = seg(0, 60);
    const r = ok(editSession(s, { start: at(10), end: at(50), note: '  Fix\nbug ', client: 'Acme' }, [s], now));
    assert.deepEqual(r.removed, [s]);
    assert.deepEqual(r.added, [seg(10, 50, { note: 'Fix bug', client: 'Acme' })]);
  });

  it('clears a note with an empty string', () => {
    const s = seg(0, 60, { note: 'x' });
    const r = ok(editSession(s, { note: '' }, [s], now));
    assert.equal(r.added[0]?.note, undefined);
  });

  it('rejects an end before or equal to the start', () => {
    const s = seg(0, 60);
    assert.match(err(editSession(s, { end: at(-5) }, [s], now)), /after the start/);
    assert.match(err(editSession(s, { start: at(60) }, [s], now)), /after the start/);
  });

  it('rejects sessions under a minute, in the future and not a number', () => {
    const s = seg(0, 60);
    assert.match(err(editSession(s, { end: at(0) + 30_000 }, [s], now)), /one minute/);
    assert.match(err(editSession(s, { end: now + MINUTE }, [s], now)), /future/);
    assert.match(err(editSession(s, { end: Number.NaN }, [s], now)), /valid times/);
  });

  it('rejects an overlap with another session of the same project only', () => {
    const s = seg(0, 30);
    const next = seg(40, 70);
    const other = seg(40, 70, { project: 'other' });
    assert.match(err(editSession(s, { end: at(45) }, [s, next], now)), /overlap/);
    ok(editSession(s, { end: at(45) }, [s, other], now));
    ok(editSession(s, { end: at(40) }, [s, next], now));
  });

  it('allows a note edit even when the stored data already overlaps', () => {
    const a = seg(0, 60);
    const b = seg(30, 90);
    ok(editSession(a, { note: 'ok' }, [a, b], now));
  });

  it('rejects an empty edit and over long text', () => {
    const s = seg(0, 60);
    assert.match(err(editSession(s, {}, [s], now)), /Nothing changed/);
    assert.match(err(editSession(s, { note: 'x'.repeat(201) }, [s], now)), /note/);
    assert.match(err(editSession(s, { client: 'x'.repeat(101) }, [s], now)), /client/);
  });

  it('splits a session into two that add up and keep the fields', () => {
    const s = seg(0, 60, { note: 'n', client: 'c' });
    const r = ok(splitSession(s, at(25)));
    assert.deepEqual(r.added, [seg(0, 25, { note: 'n', client: 'c' }), seg(25, 60, { note: 'n', client: 'c' })]);
    const total = r.added.reduce((n, p) => n + p.end - p.start, 0);
    assert.equal(total, s.end - s.start);
  });

  it('refuses to split too close to the ends or outside', () => {
    const s = seg(0, 60);
    for (const t of [at(0), at(0) + 30_000, at(60), at(-5), at(90), Number.NaN]) {
      assert.match(err(splitSession(s, t)), /Split inside/);
    }
  });

  it('merges two sessions and covers the gap', () => {
    const a = seg(0, 20, { note: 'one', language: 'go' });
    const b = seg(30, 90, { note: 'two', language: 'rust' });
    const r = ok(mergeSessions(b, a, [a, b], now));
    assert.deepEqual(r.removed, [a, b]);
    assert.deepEqual(r.added, [seg(0, 90, { note: 'one / two', language: 'rust' })]);
  });

  it('refuses to merge across projects, clients, itself, or over a session between them', () => {
    const a = seg(0, 20);
    const b = seg(30, 50);
    assert.match(err(mergeSessions(a, seg(30, 50, { project: 'x' }), [a], now)), /same project/);
    assert.match(err(mergeSessions(seg(0, 20, { client: 'A' }), seg(30, 50, { client: 'B' }), [], now)), /clients/);
    assert.match(err(mergeSessions(a, a, [a], now)), /two different/);
    const mid = seg(22, 28);
    assert.match(err(mergeSessions(a, b, [a, mid, b], now)), /between them/);
    ok(mergeSessions(a, b, [a, b, seg(22, 28, { project: 'x' })], now));
  });

  it('refuses a merged note that is too long', () => {
    const a = seg(0, 20, { note: 'a'.repeat(150) });
    const b = seg(30, 50, { note: 'b'.repeat(150) });
    assert.match(err(mergeSessions(a, b, [a, b], now)), /note/);
  });

  it('deletes a session', () => {
    const s = seg(0, 20);
    assert.deepEqual(ok(deleteSession(s)), { ok: true, removed: [s], added: [] });
  });
});

describe('time input', () => {
  it('parses HH:MM on the base day and full local dates', () => {
    assert.equal(parseLocalDateTime('14:30', base), new Date(2026, 5, 10, 14, 30).getTime());
    assert.equal(parseLocalDateTime('2026-06-09 08:05', base), new Date(2026, 5, 9, 8, 5).getTime());
    assert.equal(formatLocalDateTime(at(0)), '2026-06-10 09:00');
  });
  it('rejects impossible times', () => {
    for (const t of ['', '25:00', '12:60', 'noon', '2026-02-30 10:00', '2026-13-01 10:00']) {
      assert.equal(parseLocalDateTime(t, base), undefined, t);
    }
  });
});

describe('segment fields', () => {
  it('round trips note and client and still reads old lines', () => {
    const s = seg(0, 20, { note: 'a "quoted" note', client: 'Acme' });
    assert.deepEqual(parseSegmentLine(serializeSegment(s)), s);
    assert.ok(!serializeSegment(seg(0, 20)).includes('note'));
    assert.deepEqual(parseSegmentLine('{"v":1,"start":"2026-01-05T09:00:00.000Z","end":"2026-01-05T09:25:00.000Z","project":"d","language":"go"}'), {
      start: Date.parse('2026-01-05T09:00:00.000Z'),
      end: Date.parse('2026-01-05T09:25:00.000Z'),
      project: 'd',
      language: 'go',
    });
  });
});

describe('persistence of edits', () => {
  let dir: string;
  let store: LedgerStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltl-edit-'));
    store = new LedgerStore(path.join(dir, 'ledger'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const stored = async (): Promise<Segment[]> => {
    const result = await store.read(0, now + 365 * 86_400_000);
    return result.segments.sort((a, b) => a.start - b.start);
  };

  it('applies an edit, keeps other lines and undoes it exactly', async () => {
    const a = seg(0, 60);
    const b = seg(120, 180);
    await store.append([a, b]);
    fs.appendFileSync(store.fileFor(a.start), 'garbage line\n');
    const before = fs.readFileSync(store.fileFor(a.start), 'utf8');
    const r = ok(splitSession(a, at(30)));
    store.applyEdit(r.removed, r.added);
    assert.deepEqual(await stored(), [seg(0, 30), seg(30, 60), b]);
    assert.ok(fs.readFileSync(store.fileFor(a.start), 'utf8').includes('garbage line\n'));
    assert.equal(store.undoLastEdit(), true);
    assert.deepEqual((await stored()).map((s) => serializeSegment(s)).sort(), [a, b].map((s) => serializeSegment(s)).sort());
    assert.equal(fs.readFileSync(store.fileFor(a.start), 'utf8').split('\n').sort().join('\n'), before.split('\n').sort().join('\n'));
    assert.equal(store.undoLastEdit(), false);
  });

  it('undoes several edits in reverse order, including delete and merge', async () => {
    const a = seg(0, 20);
    const b = seg(30, 50);
    await store.append([a, b]);
    const m = ok(mergeSessions(a, b, [a, b], now));
    store.applyEdit(m.removed, m.added);
    const d = ok(deleteSession(m.added[0] as Segment));
    store.applyEdit(d.removed, d.added);
    assert.deepEqual(await stored(), []);
    store.undoLastEdit();
    assert.deepEqual(await stored(), [seg(0, 50)]);
    store.undoLastEdit();
    assert.deepEqual(await stored(), [a, b]);
  });

  it('moves a session to another month file when its start moves', async () => {
    const jan = new Date(2026, 0, 31, 23, 0).getTime();
    const s: Segment = { start: jan, end: jan + 30 * MINUTE, project: 'demo', language: 'go' };
    await store.append([s]);
    const moved = ok(editSession(s, { start: new Date(2026, 1, 1, 0, 10).getTime(), end: new Date(2026, 1, 1, 0, 40).getTime() }, [s], now));
    store.applyEdit(moved.removed, moved.added);
    assert.equal(fs.readFileSync(store.fileFor(jan), 'utf8'), '');
    assert.equal((await stored()).length, 1);
    store.undoLastEdit();
    assert.deepEqual(await stored(), [s]);
  });

  it('changes nothing when the session is no longer on disk', async () => {
    const a = seg(0, 60);
    await store.append([a]);
    const before = fs.readFileSync(store.fileFor(a.start), 'utf8');
    const ghost = seg(5, 10);
    assert.throws(() => {
      store.replaceSync([a, ghost], [seg(0, 5)]);
    }, /changed on disk/);
    assert.equal(fs.readFileSync(store.fileFor(a.start), 'utf8'), before);
    assert.equal(store.undoLastEdit(), false);
  });

  it('removes only one of two identical lines', async () => {
    const a = seg(0, 60);
    await store.append([a, a]);
    store.applyEdit([a], []);
    assert.equal((await stored()).length, 1);
  });

  it('leaves no temporary files and keeps the journal out of the ledger views', async () => {
    const a = seg(0, 60);
    await store.append([a]);
    store.applyEdit([a], [seg(0, 50)]);
    const names = fs.readdirSync(store.dir).sort();
    assert.deepEqual(names, ['FORMAT.txt', 'ledger-2026-06.jsonl', 'session-edits.jsonl']);
    assert.equal((await stored()).length, 1);
    assert.equal(await store.earliestMonth(), new Date(2026, 5, 1).getTime());
  });

  it('refuses to undo from a damaged journal and keeps the data', async () => {
    const a = seg(0, 60);
    await store.append([a]);
    store.applyEdit([a], [seg(0, 50)]);
    fs.writeFileSync(store.journalFile, 'not json\n');
    assert.throws(() => store.undoLastEdit(), /damaged/);
    assert.deepEqual(await stored(), [seg(0, 50)]);
  });
});
