import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { LedgerStore } from '../../core/store';

describe('LedgerStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltl-unit-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('appends to month files and reads across months', async () => {
    const store = new LedgerStore(path.join(dir, 'ledger'));
    const jan31 = new Date(2026, 0, 31, 23, 50).getTime();
    const feb1 = new Date(2026, 1, 1, 9).getTime();
    await store.append([{ start: jan31, end: jan31 + 20 * 60_000, project: 'demo-project', language: 'go' }]);
    store.appendSync([{ start: feb1, end: feb1 + 60_000, project: 'demo-project', language: 'go' }]);
    const files = fs.readdirSync(store.dir).sort();
    assert.deepEqual(files, ['FORMAT.txt', 'ledger-2026-01.jsonl', 'ledger-2026-02.jsonl']);
    const result = await store.read(new Date(2026, 1, 1).getTime(), new Date(2026, 1, 2).getTime());
    assert.equal(result.segments.length, 2);
    assert.equal(result.skipped, 0);
  });

  it('tolerates hand edits and missing files', async () => {
    const store = new LedgerStore(path.join(dir, 'ledger'));
    const empty = await store.read(0, Date.now());
    assert.equal(empty.segments.length, 0);
    const t = new Date(2026, 2, 3, 10).getTime();
    await store.append([{ start: t, end: t + 60_000, project: 'demo-project', language: 'go' }]);
    fs.appendFileSync(store.fileFor(t), 'garbage line\n');
    const result = await store.read(new Date(2026, 2, 1).getTime(), new Date(2026, 3, 1).getTime());
    assert.equal(result.segments.length, 1);
    assert.equal(result.skipped, 1);
  });
  it('finds the earliest month with a ledger file, ignoring other files', async () => {
    const store = new LedgerStore(path.join(dir, 'ledger'));
    assert.equal(await store.earliestMonth(), undefined);
    fs.mkdirSync(store.dir, { recursive: true });
    for (const name of ['ledger-2026-03.jsonl', 'ledger-2024-11.jsonl', 'ledger-2023-13.jsonl', 'ledger-2020-01.jsonl.bak', 'notes.txt']) {
      fs.writeFileSync(path.join(store.dir, name), '');
    }
    assert.equal(await store.earliestMonth(), new Date(2024, 10, 1).getTime());
  });
});
