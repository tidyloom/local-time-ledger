import * as assert from 'node:assert/strict';
import { parseLedger, parseSegmentLine, serializeSegment } from '../../core/segment';

describe('ledger format', () => {
  const seg = {
    start: Date.parse('2026-01-05T09:00:00.000Z'),
    end: Date.parse('2026-01-05T09:25:00.000Z'),
    project: 'demo-project',
    language: 'typescript',
  };

  it('round trips a segment', () => {
    const line = serializeSegment(seg);
    assert.equal(
      line,
      '{"v":1,"start":"2026-01-05T09:00:00.000Z","end":"2026-01-05T09:25:00.000Z","project":"demo-project","language":"typescript"}',
    );
    assert.deepEqual(parseSegmentLine(line), seg);
  });

  it('skips broken or impossible lines and keeps the rest', () => {
    const text = [
      serializeSegment(seg),
      'not json',
      '{"start":"2026-01-05T10:00:00Z","end":"2026-01-05T09:00:00Z"}',
      '{"start":"yesterday","end":"today"}',
      '[1,2]',
      '',
      '// a hand written comment',
      '{"start":"2026-01-05T11:00:00Z","end":"2026-01-05T11:10:00Z"}',
    ].join('\n');
    const result = parseLedger(text);
    assert.equal(result.segments.length, 2);
    assert.equal(result.skipped, 5);
    assert.equal(result.segments[1]?.project, 'unknown');
    assert.equal(result.segments[1].language, 'other');
  });
});
