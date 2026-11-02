/**
 * Throttling for celebrations (SPEC 28.1 "Safety"). Pure and clock-injected, so it is unit tested.
 *
 * - Won: at most one burst per `wonIntervalMs` (2 s). Wins that arrive sooner wait in a queue of at
 *   most `wonQueueMax` (3); a win that finds the queue full is skipped (the column still ticks).
 * - Everything else: at most `pulsesPerSecond` (3) animated arrivals start in any 1 s window, so
 *   nothing flashes faster than 3 times per second; the rest get the quiet version (a fade).
 */

export interface ScheduleConfig {
  wonIntervalMs: number;
  wonQueueMax: number;
  pulsesPerSecond: number;
}

export const DEFAULT_SCHEDULE: ScheduleConfig = { wonIntervalMs: 2000, wonQueueMax: 3, pulsesPerSecond: 3 };

export type WonDecision = 'play' | 'queued' | 'skipped';
export type PulseDecision = 'play' | 'quiet';

export class CelebrationSchedule<T> {
  private queue: T[] = [];
  private lastWon = -Infinity;
  private pulses: number[] = [];
  /** Totals for test hooks. */
  readonly stats = { wonPlayed: 0, wonQueued: 0, wonSkipped: 0, quiet: 0 };

  constructor(private cfg: ScheduleConfig = DEFAULT_SCHEDULE) {}

  /** A win arrived. */
  offerWon(item: T, now: number): WonDecision {
    if (this.queue.length === 0 && now - this.lastWon >= this.cfg.wonIntervalMs) {
      this.lastWon = now;
      this.stats.wonPlayed++;
      return 'play';
    }
    if (this.queue.length >= this.cfg.wonQueueMax) {
      this.stats.wonSkipped++;
      return 'skipped';
    }
    this.queue.push(item);
    this.stats.wonQueued++;
    return 'queued';
  }

  /** The queued win that may play now, if any. */
  takeDueWon(now: number): T | null {
    if (this.queue.length === 0 || now - this.lastWon < this.cfg.wonIntervalMs) return null;
    this.lastWon = now;
    this.stats.wonPlayed++;
    return this.queue.shift() ?? null;
  }

  /** Milliseconds until the next queued win may play (null when the queue is empty). */
  msUntilNextWon(now: number): number | null {
    if (this.queue.length === 0) return null;
    return Math.max(0, this.lastWon + this.cfg.wonIntervalMs - now);
  }

  /** Remove queued wins that match (a move was rolled back before its burst played). */
  dropQueued(match: (item: T) => boolean) {
    this.queue = this.queue.filter((i) => !match(i));
  }

  get queued(): number {
    return this.queue.length;
  }

  /** An animated arrival (ring, envelope, shards, stream-in) wants to start. */
  offerPulse(now: number): PulseDecision {
    this.pulses = this.pulses.filter((t) => now - t < 1000);
    if (this.pulses.length >= this.cfg.pulsesPerSecond) {
      this.stats.quiet++;
      return 'quiet';
    }
    this.pulses.push(now);
    return 'play';
  }

  /** Forget timing and the queue (tab hidden: nobody saw it). */
  clear() {
    this.queue = [];
    this.pulses = [];
  }
}
