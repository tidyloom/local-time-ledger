import type { Segment } from './segment';

export interface ActivityContext {
  readonly project: string;
  readonly language: string;
}

export interface TrackerOptions {
  /** Gap without activity after which the current stretch ends. */
  idleMs: number;
  now: () => number;
}

interface OpenSegment {
  start: number;
  last: number;
  project: string;
  language: string;
}

/**
 * Turns editor activity into time segments. Pure logic with an injected clock.
 *
 * Time between two activity events is counted only when the gap is at most idleMs.
 * A longer gap ends the stretch at the last activity, so idle time is never counted.
 */
export class Tracker {
  private open: OpenSegment | undefined;
  private pending: Segment[] = [];
  private pausedFlag = false;

  constructor(private readonly options: TrackerOptions) {}

  get paused(): boolean {
    return this.pausedFlag;
  }

  setIdleMs(idleMs: number): void {
    this.options.idleMs = idleMs;
  }

  /** Records one activity event (an edit, a cursor move, focus, a save). */
  activity(ctx: ActivityContext): void {
    if (this.pausedFlag) {
      return;
    }
    const t = this.options.now();
    const open = this.open;
    if (open) {
      if (t < open.last) {
        // Clock went backwards. Close what we have and start again.
        this.close();
      } else if (t - open.last > this.options.idleMs) {
        this.close();
      } else if (open.project !== ctx.project || open.language !== ctx.language) {
        open.last = t;
        this.close();
      } else {
        open.last = t;
        return;
      }
    }
    this.open = { start: t, last: t, project: ctx.project, language: ctx.language };
  }

  /** Ends the current stretch if the idle limit has passed. Call this from a timer. */
  tick(): void {
    const open = this.open;
    if (open && this.options.now() - open.last > this.options.idleMs) {
      this.close();
    }
  }

  /** Ends the current stretch at the last activity, for example when the window loses focus. */
  stop(): void {
    this.close();
  }

  pause(): void {
    this.close();
    this.pausedFlag = true;
  }

  resume(): void {
    this.pausedFlag = false;
  }

  /**
   * Returns every finished segment plus the counted part of the open one, and forgets them.
   * The open stretch keeps running from its last activity, so nothing is counted twice.
   */
  drain(): Segment[] {
    this.tick();
    const out = this.pending;
    this.pending = [];
    const open = this.open;
    if (open && open.last > open.start) {
      out.push({ start: open.start, end: open.last, project: open.project, language: open.language });
      open.start = open.last;
    }
    return out;
  }

  /** Segments counted so far that have not been drained yet. Does not change state. */
  peek(): Segment[] {
    const out = [...this.pending];
    const open = this.open;
    if (open && open.last > open.start) {
      out.push({ start: open.start, end: open.last, project: open.project, language: open.language });
    }
    return out;
  }

  private close(): void {
    const open = this.open;
    this.open = undefined;
    if (open && open.last > open.start) {
      this.pending.push({ start: open.start, end: open.last, project: open.project, language: open.language });
    }
  }
}
