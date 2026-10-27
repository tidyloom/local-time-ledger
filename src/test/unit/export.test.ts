import * as assert from 'node:assert/strict';
import {
  buildTimesheet,
  csvCell,
  customRange,
  decimalHours,
  defaultFileName,
  escapeHtml,
  parseDay,
  presetRanges,
  renderCsv,
  renderTimesheet,
  renderTimesheetHtml,
  renderTimesheetMarkdown,
  type DateRange,
} from '../../core/export';
import { HOUR, MINUTE } from '../../core/time';

const at = (d: number, h: number, m = 0) => new Date(2026, 0, d, h, m).getTime();
const seg = (start: number, end: number, project = 'demo-project', language = 'typescript') => ({ start, end, project, language });
const range = (first: string, last: string): DateRange => {
  const r = customRange(first, last);
  assert.ok(r);
  return r;
};

describe('timesheet export', () => {
  const segments = [
    seg(at(5, 9), at(5, 10, 30)),
    seg(at(5, 10), at(5, 11), 'demo-project', 'json'),
    seg(at(5, 10), at(5, 10, 45), 'sample-app'),
    seg(at(6, 23), at(7, 0, 30), 'sample-app'),
    seg(at(9, 9), at(9, 10)),
    seg(at(20, 9), at(20, 10)),
  ];

  it('builds rows per day and project, oldest first, within the range', () => {
    const t = buildTimesheet(segments, range('2026-01-05', '2026-01-09'));
    assert.equal(t.firstDay, '2026-01-05');
    assert.equal(t.lastDay, '2026-01-09');
    assert.deepEqual(
      t.rows.map((r) => [r.day, r.project, r.total]),
      [
        ['2026-01-05', 'demo-project', 2 * HOUR],
        ['2026-01-05', 'sample-app', 45 * MINUTE],
        ['2026-01-06', 'sample-app', HOUR],
        ['2026-01-07', 'sample-app', 30 * MINUTE],
        ['2026-01-09', 'demo-project', HOUR],
      ],
    );
    assert.deepEqual(t.byProject, [
      ['demo-project', 3 * HOUR],
      ['sample-app', 2 * HOUR + 15 * MINUTE],
    ]);
    // The 45 minutes in sample-app overlap demo-project, so wall clock time counts them once.
    assert.equal(t.total, 3 * HOUR + 15 * MINUTE + 15 * MINUTE + HOUR);
  });

  it('filters to one project', () => {
    const t = buildTimesheet(segments, range('2026-01-01', '2026-01-31'), 'sample-app');
    assert.deepEqual(new Set(t.rows.map((r) => r.project)), new Set(['sample-app']));
    assert.equal(t.total, 2 * HOUR + 15 * MINUTE);
  });

  it('renders CSV with a header, decimal hours and CRLF lines', () => {
    const csv = renderCsv(buildTimesheet(segments, range('2026-01-09', '2026-01-09')));
    assert.equal(csv, 'Date,Project,Hours,Minutes\r\n2026-01-09,demo-project,1.00,60\r\n');
  });

  it('escapes CSV cells and blocks formula injection', () => {
    assert.equal(csvCell('plain'), 'plain');
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
    assert.equal(csvCell('+1'), "'+1");
    assert.equal(csvCell('@sum'), "'@sum");
    assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  });

  it('rounds decimal hours to the minute', () => {
    assert.equal(decimalHours(0), '0.00');
    assert.equal(decimalHours(90 * MINUTE), '1.50');
    assert.equal(decimalHours(20 * MINUTE), '0.33');
    assert.equal(decimalHours(29_999), '0.00');
    assert.equal(decimalHours(30_000), '0.02');
  });

  it('renders Markdown with escaped project names and totals', () => {
    const md = renderTimesheetMarkdown(buildTimesheet([seg(at(9, 9), at(9, 10), 'a|b')], range('2026-01-09', '2026-01-09')), at(9, 12));
    assert.match(md, /^# Timesheet: 2026-01-09 to 2026-01-09/);
    assert.match(md, /\| 2026-01-09 \| a\\\|b \| 1\.00 \| 1h 00m \|/);
    assert.match(md, /\*\*Total: 1\.00 hours \(1h 00m\)\*\*/);
  });

  it('renders a self contained printable HTML page with everything escaped', () => {
    const evil = '<script>alert("x")</script>&';
    const html = renderTimesheetHtml(buildTimesheet([seg(at(9, 9), at(9, 10), evil)], range('2026-01-09', '2026-01-09')), at(9, 12));
    assert.match(html, /^<!DOCTYPE html>/);
    assert.match(html, /@media print/);
    assert.match(html, /default-src 'none'/);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;&amp;/);
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /\bsrc=|\bhref=/);
    assert.equal(escapeHtml(`'`), '&#39;');
  });

  it('says so when the range is empty, in every format', () => {
    const t = buildTimesheet([], range('2026-01-01', '2026-01-02'));
    assert.equal(renderTimesheet(t, 'csv', 0), 'Date,Project,Hours,Minutes\r\n');
    assert.match(renderTimesheet(t, 'markdown', 0), /Nothing tracked in this range/);
    assert.match(renderTimesheet(t, 'html', 0), /Nothing tracked in this range/);
  });

  it('parses days strictly and builds inclusive custom ranges', () => {
    assert.equal(parseDay('2026-02-30'), undefined);
    assert.equal(parseDay('2026-1-5'), undefined);
    assert.equal(parseDay('yesterday'), undefined);
    assert.equal(parseDay(' 2026-01-05 '), at(5, 0));
    assert.equal(customRange('2026-01-09', '2026-01-05'), undefined);
    const r = range('2026-01-05', '2026-01-05');
    assert.equal(r.from, at(5, 0));
    assert.equal(r.to, at(6, 0));
  });

  it('offers whole day presets that end where they should', () => {
    // Wednesday 7 January 2026.
    const presets = presetRanges(at(7, 15));
    const byLabel = new Map(presets.map((p) => [p.label, p]));
    assert.deepEqual(
      [byLabel.get('This week')?.from, byLabel.get('This week')?.to],
      [at(5, 0), at(8, 0)],
    );
    assert.deepEqual([byLabel.get('Last week')?.from, byLabel.get('Last week')?.to], [new Date(2025, 11, 29).getTime(), at(5, 0)]);
    assert.deepEqual([byLabel.get('This month')?.from, byLabel.get('This month')?.to], [at(1, 0), at(8, 0)]);
    assert.deepEqual([byLabel.get('Last month')?.from, byLabel.get('Last month')?.to], [new Date(2025, 11, 1).getTime(), at(1, 0)]);
    assert.equal(byLabel.get('Last 30 days')?.from, new Date(2025, 11, 9).getTime());
  });

  it('suggests a file name per format', () => {
    const t = buildTimesheet([], range('2026-01-05', '2026-01-11'));
    assert.equal(defaultFileName(t, 'csv'), 'timesheet-2026-01-05-to-2026-01-11.csv');
    assert.equal(defaultFileName(t, 'markdown'), 'timesheet-2026-01-05-to-2026-01-11.md');
    assert.equal(defaultFileName(t, 'html'), 'timesheet-2026-01-05-to-2026-01-11.html');
  });
});
