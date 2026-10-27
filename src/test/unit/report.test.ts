import * as assert from 'node:assert/strict';
import { allTimeHistory, renderMarkdown, splitByDay, summarize, unionLength } from '../../core/report';
import { HOUR, MINUTE } from '../../core/time';

const at = (d: number, h: number, m = 0) => new Date(2026, 0, d, h, m).getTime();
const seg = (start: number, end: number, project = 'demo-project', language = 'typescript') => ({
  start,
  end,
  project,
  language,
});

describe('reports', () => {
  it('counts overlapping intervals once', () => {
    assert.equal(unionLength([]), 0);
    assert.equal(
      unionLength([
        { start: 0, end: 10 },
        { start: 5, end: 15 },
        { start: 20, end: 30 },
        { start: 20, end: 30 },
      ]),
      25,
    );
  });

  it('builds today, this week and the 30 day history', () => {
    // Wednesday 7 January 2026. The week starts Monday 5 January.
    const now = at(7, 18);
    const segments = [
      seg(at(7, 9), at(7, 10)),
      seg(at(7, 9, 30), at(7, 10, 30), 'sample-app', 'python'),
      seg(at(6, 23, 30), at(7, 0, 30)),
      seg(at(5, 8), at(5, 9)),
      seg(at(4, 8), at(4, 10)),
      seg(at(1, 8), at(1, 9)),
      seg(new Date(2025, 11, 1, 8).getTime(), new Date(2025, 11, 1, 9).getTime()),
    ];
    const s = summarize(segments, now);
    assert.equal(s.today.total, 2 * HOUR);
    assert.deepEqual(s.today.byProject, [
      ['demo-project', 90 * MINUTE],
      ['sample-app', 60 * MINUTE],
    ]);
    assert.equal(s.week.total, 2 * HOUR + 30 * MINUTE + HOUR);
    assert.equal(s.history.total, s.week.total + 2 * HOUR + HOUR);
    assert.deepEqual(
      s.days.map((d) => d.day),
      ['2026-01-07', '2026-01-06', '2026-01-05', '2026-01-04', '2026-01-01'],
    );
    assert.equal(s.days[1]?.total, 30 * MINUTE);
  });

  it('renders a markdown report with no data', () => {
    const md = renderMarkdown(summarize([], at(7, 12)), at(7, 12), '/tmp/example-ledger');
    assert.match(md, /## Today: 0m/);
    assert.match(md, /Nothing tracked yet/);
    assert.match(md, /never leaves this machine/);
  });

  it('escapes table cells', () => {
    const md = renderMarkdown(summarize([seg(at(7, 9), at(7, 10), 'a|b')], at(7, 12)), at(7, 12), '/tmp/x');
    assert.match(md, /\| a\\\|b \| 1h 00m \|/);
  });
  it('free history stops at 30 days and Pro all time history includes everything', () => {
    const now = at(31, 12);
    const old = seg(new Date(2024, 5, 3, 8).getTime(), new Date(2024, 5, 3, 10).getTime());
    const recent = seg(at(30, 8), at(30, 9));
    const free = summarize([old, recent], now);
    assert.equal(free.history.label, 'Last 30 days');
    assert.equal(free.history.total, HOUR);
    assert.deepEqual(free.days.map((d) => d.day), ['2026-01-30']);
    const pro = summarize([old, recent], now, allTimeHistory([old, recent], now));
    assert.equal(pro.history.label, 'All time');
    assert.equal(pro.history.total, 3 * HOUR);
    assert.deepEqual(pro.days.map((d) => d.day), ['2026-01-30', '2024-06-03']);
    assert.equal(pro.today.total, free.today.total);
    assert.equal(pro.week.total, free.week.total);
  });

  it('all time with no data starts today', () => {
    const now = at(7, 12);
    assert.equal(allTimeHistory([], now).from, new Date(2026, 0, 7).getTime());
  });

  it('splits segments that cross midnight into both days', () => {
    const byDay = splitByDay([seg(at(6, 23), at(8, 1))], at(1, 0), at(10, 0));
    assert.deepEqual(
      [...byDay.entries()].map(([d, list]) => [d, unionLength(list)]),
      [
        [at(6, 0), HOUR],
        [at(7, 0), 24 * HOUR],
        [at(8, 0), HOUR],
      ],
    );
  });

  it('summarizes several years of data quickly', () => {
    const segments = [];
    for (let i = 0; i < 20_000; i++) {
      const start = new Date(2022, 0, 1, 9).getTime() + i * 90 * MINUTE;
      segments.push(seg(start, start + 30 * MINUTE, `p${String(i % 7)}`));
    }
    const now = at(7, 12);
    const t0 = Date.now();
    const s = summarize(segments, now, allTimeHistory(segments, now));
    assert.ok(Date.now() - t0 < 2000, 'took too long');
    assert.equal(s.history.total, 20_000 * 30 * MINUTE);
  });
});
