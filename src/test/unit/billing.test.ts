import * as assert from 'node:assert/strict';
import { amountCents, billTimesheet, formatMoney, parseRates } from '../../core/billing';
import { buildTimesheet, customRange, renderCsv, renderTimesheet, type DateRange } from '../../core/export';
import { HOUR, MINUTE } from '../../core/time';

const at = (d: number, h: number, m = 0) => new Date(2026, 0, d, h, m).getTime();
const seg = (start: number, end: number, project: string) => ({ start, end, project, language: 'typescript' });
const range = (first: string, last: string): DateRange => {
  const r = customRange(first, last);
  assert.ok(r);
  return r;
};

describe('clients and hourly rates', () => {
  const segments = [
    seg(at(5, 9), at(5, 10, 30), 'demo-project'),
    seg(at(6, 9), at(6, 9, 20), 'demo-project'),
    seg(at(5, 14), at(5, 15), 'sample-app'),
    seg(at(5, 16), at(5, 16, 45), 'side-thing'),
  ];
  const sheet = buildTimesheet(segments, range('2026-01-05', '2026-01-06'));

  it('parses valid entries and skips bad ones with a plain reason', () => {
    const { rates, problems } = parseRates({
      'demo-project': { client: ' Example Client ', hourlyRate: 60, currency: 'eur' },
      'sample-app': { hourlyRate: 40 },
      bad: { hourlyRate: -1 },
      worse: 'nope',
      ' ': { hourlyRate: 10 },
    });
    assert.deepEqual(rates.get('demo-project'), { client: 'Example Client', hourlyRate: 60, currency: 'EUR' });
    assert.deepEqual(rates.get('sample-app'), { client: '', hourlyRate: 40, currency: '' });
    assert.equal(rates.size, 2);
    assert.equal(problems.length, 2);
    assert.match(problems[0] ?? '', /bad/);
  });

  it('treats a missing or wrong setting safely', () => {
    assert.equal(parseRates(undefined).rates.size, 0);
    assert.equal(parseRates([]).problems.length, 1);
    assert.equal(parseRates({ x: { hourlyRate: Number.NaN } }).rates.size, 0);
  });

  it('prices per whole minute and formats money', () => {
    assert.equal(amountCents(HOUR, 50), 5000);
    assert.equal(amountCents(20 * MINUTE, 60), 2000);
    assert.equal(amountCents(29_000, 60), 0);
    assert.equal(amountCents(31_000, 60), 100);
    assert.equal(formatMoney(12345, 'EUR'), '123.45 EUR');
    assert.equal(formatMoney(5, ''), '0.05');
  });

  it('leaves the output unchanged when nothing has a rate', () => {
    const { rates } = parseRates({ other: { hourlyRate: 10 } });
    assert.equal(billTimesheet(sheet, rates), undefined);
    assert.equal(renderTimesheet(sheet, 'csv', 0, rates), renderCsv(sheet));
    assert.equal(renderTimesheet(sheet, 'markdown', 0, rates), renderTimesheet(sheet, 'markdown', 0));
  });

  it('bills priced projects, keeps currencies apart and lists unpriced ones', () => {
    const { rates } = parseRates({
      'demo-project': { client: 'Example Client', hourlyRate: 60, currency: 'EUR' },
      'sample-app': { client: 'Acme', hourlyRate: 30, currency: 'USD' },
    });
    const bill = billTimesheet(sheet, rates);
    assert.ok(bill);
    assert.deepEqual(
      bill.lines.map((l) => [l.client, l.project, l.amountCents]),
      [
        ['Acme', 'sample-app', 3000],
        ['Example Client', 'demo-project', 11000],
      ],
    );
    assert.deepEqual(bill.totals, [
      { currency: 'EUR', amountCents: 11000 },
      { currency: 'USD', amountCents: 3000 },
    ]);
    assert.deepEqual(bill.unrated, ['side-thing']);
  });

  it('adds billing columns and sections to every format', () => {
    const { rates } = parseRates({ 'demo-project': { client: 'Example Client', hourlyRate: 60, currency: 'EUR' } });
    const csv = renderTimesheet(sheet, 'csv', 0, rates).split('\r\n');
    assert.equal(csv[0], 'Date,Project,Hours,Minutes,Client,Hourly rate,Currency,Amount');
    assert.ok(csv.includes('2026-01-05,demo-project,1.50,90,Example Client,60,EUR,90.00'));
    assert.ok(csv.includes('2026-01-05,sample-app,1.00,60,,,,'));
    const md = renderTimesheet(sheet, 'markdown', 0, rates);
    assert.match(md, /## Billing/);
    assert.match(md, /\*\*Amount due: 110\.00 EUR\*\*/);
    assert.match(md, /Not priced \(no hourly rate set\): sample-app, side-thing\./);
    const html = renderTimesheet(sheet, 'html', 0, rates);
    assert.match(html, /<h2>Billing<\/h2>/);
    assert.match(html, /Amount due<\/td><td class="num">110\.00 EUR/);
  });

  it('escapes client names in html', () => {
    const { rates } = parseRates({ 'demo-project': { client: '<b>x</b>', hourlyRate: 1 } });
    assert.match(renderTimesheet(sheet, 'html', 0, rates), /&lt;b&gt;x&lt;\/b&gt;/);
  });
});
