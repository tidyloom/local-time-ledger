import * as assert from 'node:assert/strict';
import { MINUTE } from '../../core/time';
import { Tracker } from '../../core/tracker';

function setup(idleMinutes = 5) {
  let now = 1_000_000;
  const tracker = new Tracker({ idleMs: idleMinutes * MINUTE, now: () => now });
  const at = (minute: number) => {
    now = 1_000_000 + minute * MINUTE;
  };
  return { tracker, at };
}

const ctx = { project: 'demo-project', language: 'typescript' };
const sum = (segs: Array<{ start: number; end: number }>) => segs.reduce((a, s) => a + s.end - s.start, 0);

describe('Tracker', () => {
  it('counts time between close activity events', () => {
    const { tracker, at } = setup();
    for (const m of [0, 2, 4, 6]) {
      at(m);
      tracker.activity(ctx);
    }
    assert.equal(sum(tracker.drain()), 6 * MINUTE);
  });

  it('does not count idle gaps', () => {
    const { tracker, at } = setup();
    at(0);
    tracker.activity(ctx);
    at(3);
    tracker.activity(ctx);
    at(20);
    tracker.activity(ctx);
    at(21);
    tracker.activity(ctx);
    const segs = tracker.drain();
    assert.equal(segs.length, 2);
    assert.equal(sum(segs), 4 * MINUTE);
  });

  it('closes the stretch on tick after the idle limit', () => {
    const { tracker, at } = setup();
    at(0);
    tracker.activity(ctx);
    at(4);
    tracker.activity(ctx);
    at(30);
    tracker.tick();
    assert.equal(sum(tracker.peek()), 4 * MINUTE);
    at(31);
    tracker.activity(ctx);
    assert.equal(sum(tracker.drain()), 4 * MINUTE);
  });

  it('drains without double counting the open stretch', () => {
    const { tracker, at } = setup();
    at(0);
    tracker.activity(ctx);
    at(2);
    tracker.activity(ctx);
    const first = tracker.drain();
    at(3);
    tracker.activity(ctx);
    const second = tracker.drain();
    assert.equal(sum(first), 2 * MINUTE);
    assert.equal(sum(second), 1 * MINUTE);
    assert.equal(first[0]?.end, second[0]?.start);
  });

  it('splits on project or language change without losing the gap', () => {
    const { tracker, at } = setup();
    at(0);
    tracker.activity(ctx);
    at(2);
    tracker.activity({ project: 'demo-project', language: 'markdown' });
    at(3);
    tracker.activity({ project: 'demo-project', language: 'markdown' });
    const segs = tracker.drain();
    assert.equal(segs.length, 2);
    assert.equal(segs[0]?.language, 'typescript');
    assert.equal(segs[0].end, segs[1]?.start);
    assert.equal(sum(segs), 3 * MINUTE);
  });

  it('records nothing while paused and stops at focus loss', () => {
    const { tracker, at } = setup();
    at(0);
    tracker.activity(ctx);
    at(1);
    tracker.activity(ctx);
    tracker.pause();
    at(2);
    tracker.activity(ctx);
    assert.equal(sum(tracker.drain()), 1 * MINUTE);
    tracker.resume();
    at(3);
    tracker.activity(ctx);
    at(4);
    tracker.stop();
    at(5);
    tracker.activity(ctx);
    assert.equal(sum(tracker.drain()), 0);
  });

  it('survives the clock going backwards', () => {
    const { tracker, at } = setup();
    at(10);
    tracker.activity(ctx);
    at(12);
    tracker.activity(ctx);
    at(1);
    tracker.activity(ctx);
    at(2);
    tracker.activity(ctx);
    assert.equal(sum(tracker.drain()), 3 * MINUTE);
  });
});
