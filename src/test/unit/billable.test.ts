import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  billableByDefault,
  billTimesheet,
  parseBillableDefault,
  parseRates,
  summarizeClients,
  type BillableDefault,
  type Rates,
} from '../../core/billing';
import { editSession, isBillable, mergeSessions, sameSegment, splitSession, type BillableDefaultOf, type EditResult } from '../../core/edit';
import { buildTimesheet, customRange, renderCsv, renderTimesheet, type DateRange } from '../../core/export';
import { parseLedger, parseSegmentLine, serializeSegment, type Segment } from '../../core/segment';
import { LedgerStore } from '../../core/store';
import { HOUR, MINUTE } from '../../core/time';

const at = (d: number, h: number, m = 0): number => new Date(2026, 2, d, h, m).getTime();
const seg = (start: number, end: number, project: string, extra: Partial<Segment> = {}): Segment => ({
  start,
  end,
  project,
  language: 'typescript',
  ...extra,
});
const now = new Date(2026, 2, 20, 12, 0).getTime();
const range = (first: string, last: string): DateRange => {
  const r = customRange(first, last);
  assert.ok(r);
  return r;
};
function ok(r: EditResult): { removed: Segment[]; added: Segment[] } {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return r;
}
function err(r: EditResult): string {
  assert.ok(!r.ok);
  return r.error;
}
const noRates: Rates = new Map();
const defaultOf =
  (rates: Rates, mode: BillableDefault = 'withClient'): BillableDefaultOf =>
  (s) =>
    billableByDefault(s.project, s.client, rates, mode);

describe('billable tags in the ledger', () => {
  it('writes the tag only when it is set and reads it back', () => {
    const base = seg(at(2, 9), at(2, 10), 'demo');
    assert.doesNotMatch(serializeSegment(base), /billable/);
    for (const billable of [true, false]) {
      const line = serializeSegment({ ...base, billable });
      assert.match(line, new RegExp(`"billable":${String(billable)}`));
      assert.deepEqual(parseSegmentLine(line), { ...base, billable });
    }
  });

  it('loads old ledger lines as untagged and never guesses from odd values', () => {
    const old = '{"v":1,"start":"2026-03-02T08:00:00.000Z","end":"2026-03-02T09:00:00.000Z","project":"demo","language":"go"}';
    const parsedOld = parseSegmentLine(old);
    assert.ok(parsedOld);
    assert.equal('billable' in parsedOld, false);
    for (const odd of ['"yes"', 'null', '1', '{}']) {
      const p = parseSegmentLine(old.replace('}', `,"billable":${odd}}`));
      assert.ok(p);
      assert.equal(p.billable, undefined);
    }
    const { segments, skipped } = parseLedger(`${old}\nnot json\n${old.replace('}', ',"billable":false}')}\n`);
    assert.equal(skipped, 1);
    assert.deepEqual(
      segments.map((s) => s.billable),
      [undefined, false],
    );
  });

  it('treats a tagged and an untagged copy of a session as different lines', () => {
    const a = seg(at(2, 9), at(2, 10), 'demo');
    assert.equal(sameSegment(a, { ...a, billable: true }), false);
    assert.equal(sameSegment({ ...a, billable: false }, { ...a, billable: false }), true);
  });
});

describe('billable default', () => {
  const { rates } = parseRates({ priced: { client: 'Acme', hourlyRate: 50, currency: 'EUR' } });
  it('parses the setting and falls back to withClient', () => {
    assert.equal(parseBillableDefault('always'), 'always');
    assert.equal(parseBillableDefault('never'), 'never');
    assert.equal(parseBillableDefault('withClient'), 'withClient');
    assert.equal(parseBillableDefault(undefined), 'withClient');
    assert.equal(parseBillableDefault('sometimes'), 'withClient');
  });
  it('is billable with a client label or a priced project, unless set otherwise', () => {
    assert.equal(billableByDefault('free-time', undefined, rates, 'withClient'), false);
    assert.equal(billableByDefault('free-time', 'Acme', rates, 'withClient'), true);
    assert.equal(billableByDefault('priced', undefined, rates, 'withClient'), true);
    assert.equal(billableByDefault('priced', undefined, rates, 'never'), false);
    assert.equal(billableByDefault('free-time', undefined, rates, 'always'), true);
  });
  it('lets a tag win over the default', () => {
    const s = seg(at(2, 9), at(2, 10), 'priced', { billable: false });
    assert.equal(isBillable(s, defaultOf(rates)), false);
    assert.equal(isBillable({ ...s, billable: true }, defaultOf(rates, 'never')), true);
    assert.equal(isBillable(seg(at(2, 9), at(2, 10), 'priced'), defaultOf(rates)), true);
  });
});

describe('tagging in the session editor rules', () => {
  const s = seg(at(3, 9), at(3, 11), 'demo', { client: 'Acme' });
  it('sets, changes and clears the tag without touching times', () => {
    const on = ok(editSession(s, { billable: true }, [s], now));
    assert.deepEqual(on.added, [{ ...s, billable: true }]);
    const tagged = on.added[0] as Segment;
    const off = ok(editSession(tagged, { billable: false }, [tagged], now));
    assert.equal(off.added[0]?.billable, false);
    const cleared = ok(editSession(tagged, { billable: null }, [tagged], now));
    assert.equal(cleared.added[0]?.billable, undefined);
    assert.equal('billable' in (cleared.added[0] as Segment), false);
  });
  it('says nothing changed when the tag is already set', () => {
    const tagged = { ...s, billable: true };
    assert.match(err(editSession(tagged, { billable: true }, [tagged], now)), /Nothing changed/);
    assert.match(err(editSession(s, { billable: null }, [s], now)), /Nothing changed/);
  });
  it('keeps the tag when other fields change', () => {
    const tagged = { ...s, billable: false };
    const r = ok(editSession(tagged, { note: 'review', end: at(3, 10) }, [tagged], now));
    assert.deepEqual(r.added, [{ ...tagged, note: 'review', end: at(3, 10) }]);
  });
});

describe('split and merge with billable tags', () => {
  const s = seg(at(4, 9), at(4, 11), 'demo', { client: 'Acme', billable: true });
  it('keeps the tag on both parts by default', () => {
    const r = ok(splitSession(s, at(4, 10)));
    assert.deepEqual(
      r.added.map((p) => p.billable),
      [true, true],
    );
  });
  it('tags each part on its own and can clear one', () => {
    const r = ok(splitSession(s, at(4, 10), { first: true, second: false }));
    assert.deepEqual(
      r.added.map((p) => [p.end - p.start, p.billable]),
      [
        [HOUR, true],
        [HOUR, false],
      ],
    );
    const c = ok(splitSession(s, at(4, 10), { second: null }));
    assert.deepEqual(
      c.added.map((p) => p.billable),
      [true, undefined],
    );
  });
  it('still refuses a split outside the session', () => {
    assert.match(err(splitSession(s, at(4, 9), { first: false })), /Split inside/);
  });
  it('merges sessions that count the same and keeps an explicit tag', () => {
    const a = seg(at(5, 9), at(5, 10), 'demo', { billable: false });
    const b = seg(at(5, 10, 30), at(5, 11), 'demo', { billable: false });
    const m = ok(mergeSessions(a, b, [a, b], now, defaultOf(noRates)));
    assert.deepEqual(m.added, [seg(at(5, 9), at(5, 11), 'demo', { billable: false })]);
  });
  it('refuses to merge billable with non-billable time', () => {
    const a = seg(at(5, 9), at(5, 10), 'demo', { billable: true });
    const b = seg(at(5, 10, 30), at(5, 11), 'demo', { billable: false });
    assert.match(err(mergeSessions(a, b, [a, b], now, defaultOf(noRates))), /billable/);
    // Untagged time is judged by the default: here not billable, so it cannot join billable time.
    const u = seg(at(5, 10, 30), at(5, 11), 'demo');
    assert.match(err(mergeSessions(a, u, [a, u], now, defaultOf(noRates))), /billable/);
  });
  it('keeps two untagged sessions untagged, and tags the result when the default would change', () => {
    const a = seg(at(6, 9), at(6, 10), 'demo');
    const b = seg(at(6, 10, 30), at(6, 11), 'demo');
    const m = ok(mergeSessions(a, b, [a, b], now, defaultOf(noRates)));
    assert.equal(m.added[0]?.billable, undefined);
    // a has a client label, b does not: under withClient a is billable and b is not.
    const labelled = seg(at(6, 9), at(6, 10), 'demo', { client: 'Acme' });
    assert.match(err(mergeSessions(labelled, b, [labelled, b], now, defaultOf(noRates))), /billable/);
    // Under "always" both count as billable, and the merged one keeps no tag.
    const always = ok(mergeSessions(labelled, b, [labelled, b], now, defaultOf(noRates, 'always')));
    assert.equal(always.added[0]?.billable, undefined);
    // One tagged, one untagged but counting the same: the result carries the tag.
    const t = seg(at(6, 9), at(6, 10), 'demo', { billable: true });
    const mixed = ok(mergeSessions(t, b, [t, b], now, defaultOf(noRates, 'always')));
    assert.equal(mixed.added[0]?.billable, true);
  });
});

describe('billable tags on disk, with undo', () => {
  let dir: string;
  let store: LedgerStore;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltl-billable-'));
    store = new LedgerStore(path.join(dir, 'ledger'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('tags a session in an old ledger, leaves other lines alone and undoes byte for byte', async () => {
    fs.mkdirSync(store.dir, { recursive: true });
    const file = store.fileFor(at(7, 9));
    const oldLines = [
      '{"v":1,"start":"2026-03-07T08:00:00.000Z","end":"2026-03-07T09:00:00.000Z","project":"demo","language":"go"}',
      '// a hand written comment',
      '{"v":1,"start":"2026-03-07T10:00:00.000Z","end":"2026-03-07T11:00:00.000Z","project":"demo","language":"go","client":"Acme"}',
    ];
    const original = oldLines.join('\n') + '\n';
    fs.writeFileSync(file, original);
    const { segments, skipped } = await store.read(at(1, 0), at(31, 0));
    assert.equal(skipped, 1);
    assert.equal(segments.length, 2);
    const target = segments.find((s) => s.client === 'Acme') as Segment;
    const r = ok(editSession(target, { billable: false }, segments, now));
    store.applyEdit(r.removed, r.added);
    const text = fs.readFileSync(file, 'utf8');
    assert.ok(text.includes(oldLines[0] as string));
    assert.ok(text.includes(oldLines[1] as string));
    assert.match(text, /"client":"Acme","billable":false/);
    const split = ok(splitSession(r.added[0] as Segment, target.start + 30 * MINUTE, { first: true }));
    store.applyEdit(split.removed, split.added);
    const after = (await store.read(at(1, 0), at(31, 0))).segments.filter((s) => s.client === 'Acme').map((s) => s.billable);
    assert.deepEqual(after.sort(), [false, true]);
    assert.equal(store.undoLastEdit(), true);
    assert.equal(store.undoLastEdit(), true);
    assert.equal(fs.readFileSync(file, 'utf8').split('\n').sort().join('\n'), original.split('\n').sort().join('\n'));
  });

  it('undoes a journal entry written before billable tags existed', async () => {
    const a = seg(at(8, 9), at(8, 10), 'demo');
    await store.append([seg(at(8, 9), at(8, 9, 30), 'demo'), seg(at(8, 9, 30), at(8, 10), 'demo')]);
    fs.writeFileSync(
      store.journalFile,
      JSON.stringify({
        at: '2026-03-08T12:00:00.000Z',
        removed: [serializeSegment(a)],
        added: [serializeSegment(seg(at(8, 9), at(8, 9, 30), 'demo')), serializeSegment(seg(at(8, 9, 30), at(8, 10), 'demo'))],
      }) + '\n',
    );
    assert.equal(store.undoLastEdit(), true);
    assert.deepEqual((await store.read(at(1, 0), at(31, 0))).segments, [a]);
  });
});

describe('billable hours and amounts per client in exports', () => {
  const { rates } = parseRates({
    'site-eu': { client: 'Acme', hourlyRate: 60, currency: 'EUR' },
    'site-us': { client: 'Acme', hourlyRate: 50, currency: 'USD' },
    tooling: { client: 'Globex', hourlyRate: 40, currency: 'EUR' },
  });
  const segments: Segment[] = [
    // Acme, EUR: 2h, of which 30m tagged not billable.
    seg(at(9, 9), at(9, 10, 30), 'site-eu'),
    seg(at(9, 11), at(9, 11, 30), 'site-eu', { billable: false }),
    // Acme, USD: 1h untagged, billable by default (priced project).
    seg(at(9, 13), at(9, 14), 'site-us'),
    // Globex, EUR: 1h, but this session is labelled for another client and tagged billable.
    seg(at(10, 9), at(10, 10), 'tooling'),
    seg(at(10, 10), at(10, 10, 45), 'tooling', { client: 'Initech', billable: true }),
    // Unpriced project with a client label: billable hours without an amount.
    seg(at(10, 14), at(10, 15), 'notes', { client: 'Initech' }),
    // Unpriced, no label, untagged: not billable under withClient.
    seg(at(10, 16), at(10, 16, 20), 'scratch'),
  ];
  const sheet = buildTimesheet(segments, range('2026-03-09', '2026-03-10'));

  it('gives a labelled client its own row and keeps per project totals', () => {
    const tooling = sheet.rows.filter((r) => r.project === 'tooling');
    assert.deepEqual(
      tooling.map((r) => [r.client, r.total]),
      [
        [undefined, HOUR],
        ['Initech', 45 * MINUTE],
      ],
    );
    assert.deepEqual(new Map(sheet.byProject).get('tooling'), HOUR + 45 * MINUTE);
    assert.equal(sheet.hasSessionBilling, true);
  });

  it('sums billable time and amounts per client and currency, never across currencies', () => {
    const c = summarizeClients(sheet, rates);
    const view = c.lines.map((l) => [l.client, l.currency, l.total / MINUTE, l.billable / MINUTE, l.amountCents]);
    assert.deepEqual(view, [
      ['Acme', 'EUR', 120, 90, 9000],
      ['Acme', 'USD', 60, 60, 5000],
      ['Globex', 'EUR', 60, 60, 4000],
      ['Initech', 'EUR', 45, 45, 3000],
      ['Initech', undefined, 60, 60, undefined],
      ['', undefined, 20, 0, undefined],
    ]);
    assert.deepEqual(c.totals, [
      { currency: 'EUR', amountCents: 16000 },
      { currency: 'USD', amountCents: 5000 },
    ]);
    const bill = billTimesheet(sheet, rates);
    assert.ok(bill);
    assert.deepEqual(bill.totals, c.totals);
    assert.deepEqual(
      bill.lines.map((l) => [l.client, l.project, l.total / MINUTE, l.billable / MINUTE, l.amountCents]),
      [
        ['Acme', 'site-eu', 120, 90, 9000],
        ['Acme', 'site-us', 60, 60, 5000],
        ['Globex', 'tooling', 60, 60, 4000],
        ['Initech', 'tooling', 45, 45, 3000],
      ],
    );
  });

  it('follows the billableDefault setting for untagged time only', () => {
    const never = summarizeClients(sheet, rates, 'never');
    assert.deepEqual(
      never.lines.map((l) => [l.client, l.currency, l.billable / MINUTE]),
      [
        ['Acme', 'EUR', 0],
        ['Acme', 'USD', 0],
        ['Globex', 'EUR', 0],
        ['Initech', 'EUR', 45],
        ['Initech', undefined, 0],
        ['', undefined, 0],
      ],
    );
    const always = summarizeClients(sheet, rates, 'always');
    assert.equal(always.lines.at(-1)?.billable, 20 * MINUTE);
    assert.equal(always.lines[0]?.billable, 90 * MINUTE);
  });

  it('adds billable columns to CSV rows and keeps the earlier columns', () => {
    const csv = renderTimesheet(sheet, 'csv', 0, rates).split('\r\n');
    assert.equal(csv[0], 'Date,Project,Hours,Minutes,Client,Hourly rate,Currency,Amount,Billable hours,Billable minutes');
    assert.ok(csv.includes('2026-03-09,site-eu,2.00,120,Acme,60,EUR,90.00,1.50,90'));
    assert.ok(csv.includes('2026-03-10,tooling,0.75,45,Initech,40,EUR,30.00,0.75,45'));
    assert.ok(csv.includes('2026-03-10,notes,1.00,60,Initech,,,,1.00,60'));
    assert.ok(csv.includes('2026-03-10,scratch,0.33,20,,,,,0.00,0'));
  });

  it('adds a per client section to Markdown and HTML next to total time', () => {
    const md = renderTimesheet(sheet, 'markdown', 0, rates);
    assert.match(md, /## Billable time per client/);
    assert.match(md, /\| Acme \| 2\.00 \| 1\.50 \| 0\.50 \| 90\.00 EUR \|/);
    assert.match(md, /\| Acme \| 1\.00 \| 1\.00 \| 0\.00 \| 50\.00 USD \|/);
    assert.match(md, /\| Initech \| 1\.00 \| 1\.00 \| 0\.00 \| no rate \|/);
    assert.match(md, /\| \(no client\) \| 0\.33 \| 0\.00 \| 0\.33 \| no rate \|/);
    assert.match(md, /\*\*Amount due: 160\.00 EUR\*\*/);
    assert.match(md, /\*\*Amount due: 50\.00 USD\*\*/);
    assert.match(md, /Untagged sessions are billable when they have a client\./);
    assert.ok(md.indexOf('**Total:') < md.indexOf('## Billable time per client'));
    const html = renderTimesheet(sheet, 'html', 0, rates, 'never');
    assert.match(html, /<h2>Billable time per client<\/h2>/);
    assert.match(html, /<td>Initech<\/td><td class="num">0\.75<\/td><td class="num">0\.75<\/td><td class="num">0\.00<\/td><td class="num">30\.00 EUR<\/td>/);
    assert.match(html, /Untagged sessions are not billable\./);
    assert.match(html, /Amount due<\/td><td class="num">30\.00 EUR/);
  });

  it('shows billable hours without rates when sessions carry tags, and escapes labels', () => {
    const t = buildTimesheet([seg(at(11, 9), at(11, 10), 'demo', { client: '<b>&', billable: true })], range('2026-03-11', '2026-03-11'));
    const md = renderTimesheet(t, 'markdown', 0);
    assert.match(md, /\| <b>& \| 1\.00 \| 1\.00 \| 0\.00 \| no rate \|/);
    assert.doesNotMatch(md, /## Billing/);
    const html = renderTimesheet(t, 'html', 0);
    assert.match(html, /<td>&lt;b&gt;&amp;<\/td>/);
    assert.equal(renderTimesheet(t, 'csv', 0).split('\r\n')[1], '2026-03-11,demo,1.00,60,<b>&,,,,1.00,60');
  });

  it('leaves an untagged ledger without rates exactly as before', () => {
    const plain = buildTimesheet([seg(at(12, 9), at(12, 10), 'demo')], range('2026-03-12', '2026-03-12'));
    assert.equal(plain.hasSessionBilling, false);
    assert.equal(renderTimesheet(plain, 'csv', 0), renderCsv(plain));
    assert.equal(renderTimesheet(plain, 'csv', 0, noRates, 'always'), 'Date,Project,Hours,Minutes\r\n2026-03-12,demo,1.00,60\r\n');
    assert.doesNotMatch(renderTimesheet(plain, 'markdown', 0), /Billable/);
    assert.doesNotMatch(renderTimesheet(plain, 'html', 0), /Billable/);
  });

  it('prices an untagged ledger with rates the same as before billable tags', () => {
    const { rates: one } = parseRates({ demo: { client: 'Example Client', hourlyRate: 60, currency: 'EUR' } });
    const t = buildTimesheet([seg(at(12, 9), at(12, 10, 30), 'demo'), seg(at(13, 9), at(13, 9, 20), 'demo')], range('2026-03-12', '2026-03-13'));
    const bill = billTimesheet(t, one);
    assert.ok(bill);
    assert.deepEqual(bill.totals, [{ currency: 'EUR', amountCents: 11000 }]);
    assert.equal(bill.lines[0]?.billable, bill.lines[0]?.total);
  });
});
