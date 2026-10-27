import * as assert from 'node:assert/strict';
import { dayKey, formatDuration, HOUR, MINUTE, startOfDay, startOfNextDay, startOfWeek } from '../../core/time';

describe('time helpers', () => {
  it('formats durations', () => {
    assert.equal(formatDuration(0), '0m');
    assert.equal(formatDuration(59_999), '0m');
    assert.equal(formatDuration(14 * MINUTE), '14m');
    assert.equal(formatDuration(2 * HOUR + 5 * MINUTE), '2h 05m');
    assert.equal(formatDuration(-5), '0m');
  });

  it('finds local day and week boundaries', () => {
    const wed = new Date(2026, 0, 7, 15, 30).getTime();
    assert.equal(dayKey(wed), '2026-01-07');
    assert.equal(startOfDay(wed), new Date(2026, 0, 7).getTime());
    assert.equal(startOfNextDay(wed), new Date(2026, 0, 8).getTime());
    assert.equal(startOfWeek(wed), new Date(2026, 0, 5).getTime());
    const sun = new Date(2026, 0, 11, 23, 0).getTime();
    assert.equal(startOfWeek(sun), new Date(2026, 0, 5).getTime());
    const mon = new Date(2026, 0, 12, 0, 0).getTime();
    assert.equal(startOfWeek(mon), mon);
  });
});
