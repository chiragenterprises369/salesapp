import type { Board, LeadListItem, Stage } from '@vistar/shared';
import { describe, expect, it } from 'vitest';
import { diffBoards, kindForStage, MAX_EVENTS_PER_DIFF, snapshotBoard } from './events';
import { ParticlePool, PARTICLE_CAP, DUST } from './particles';
import { CelebrationSchedule } from './schedule';

const stage = (id: string, key: string, type: Stage['type'], order: number): Stage =>
  ({ id, pipelineId: 'p1', key, name: key, type, order, color: null, probability: 0 }) as Stage;

const STAGES = [stage('s-new', 'new', 'open', 0), stage('s-con', 'contacted', 'open', 1), stage('s-quote', 'quote_sent', 'open', 2), stage('s-won', 'won', 'won', 3), stage('s-lost', 'lost', 'lost', 4)];

const lead = (id: string, stageId: string, valueInr = 1000): LeadListItem => ({ id, stageId, valueInr, name: id, source: 'indiamart', position: id }) as LeadListItem;

function board(cols: Record<string, LeadListItem[]>, extraCount: Record<string, number> = {}): Board {
  return {
    pipeline: { id: 'p1', key: 'default', name: 'Sales', isDefault: true, packKey: null, stages: STAGES },
    columns: STAGES.map((s) => {
      const leads = cols[s.id] ?? [];
      return { stage: s, leads, count: leads.length + (extraCount[s.id] ?? 0), totalValueInr: leads.reduce((n, l) => n + l.valueInr, 0), nextCursor: null };
    }),
  } as unknown as Board;
}

describe('kindForStage', () => {
  it('maps stage type and the quote key', () => {
    expect(kindForStage(STAGES[3]!)).toBe('won');
    expect(kindForStage(STAGES[4]!)).toBe('lost');
    expect(kindForStage(STAGES[2]!)).toBe('quote-sent');
    expect(kindForStage(STAGES[1]!)).toBe('stage-move');
  });
});

describe('diffBoards', () => {
  const a = lead('a', 's-new');
  const b = lead('b', 's-new');
  const before = board({ 's-new': [a, b], 's-con': [lead('c', 's-con')] });

  it('finds a new lead at the top of its column', () => {
    const n = lead('n', 's-new', 5000);
    const d = diffBoards(snapshotBoard(before), board({ 's-new': [n, a, b], 's-con': [lead('c', 's-con')] }));
    expect(d.events.map((e) => [e.kind, e.lead.id, e.fromStageId])).toEqual([['new-lead', 'n', null]]);
    expect(d.events[0]!.totalAfter - d.events[0]!.totalBefore).toBe(5000);
  });

  it('classifies moves by the target stage', () => {
    const won = board({ 's-new': [b], 's-con': [lead('c', 's-con')], 's-won': [{ ...a, stageId: 's-won' }] });
    expect(diffBoards(snapshotBoard(before), won).events.map((e) => [e.kind, e.fromStageId, e.toStageId])).toEqual([['won', 's-new', 's-won']]);
    const quote = board({ 's-new': [b], 's-con': [lead('c', 's-con')], 's-quote': [{ ...a, stageId: 's-quote' }] });
    expect(diffBoards(snapshotBoard(before), quote).events[0]!.kind).toBe('quote-sent');
    const lost = board({ 's-new': [b], 's-con': [lead('c', 's-con')], 's-lost': [{ ...a, stageId: 's-lost' }] });
    expect(diffBoards(snapshotBoard(before), lost).events[0]!.kind).toBe('lost');
  });

  it('ignores reorders, appended pages and removals', () => {
    expect(diffBoards(snapshotBoard(before), board({ 's-new': [b, a], 's-con': [lead('c', 's-con')] })).events).toEqual([]);
    const paged = board({ 's-new': [a, b, lead('x', 's-new'), lead('y', 's-new'), lead('z', 's-new')], 's-con': [lead('c', 's-con')] });
    expect(diffBoards(snapshotBoard(board({ 's-new': [a, b], 's-con': [lead('c', 's-con')] }, { 's-new': 3 })), paged).events).toEqual([]);
    expect(diffBoards(snapshotBoard(before), board({ 's-new': [a], 's-con': [lead('c', 's-con')] })).events).toEqual([]);
  });

  it('treats an unknown card from an unloaded page as a move, not a new lead', () => {
    const prev = board({ 's-new': [a], 's-con': [] }, { 's-new': 5 });
    const next = board({ 's-new': [a], 's-won': [lead('far', 's-won')] }, { 's-new': 4 });
    expect(diffBoards(snapshotBoard(prev), next).events.map((e) => [e.kind, e.fromStageId])).toEqual([['won', 's-new']]);
  });

  it('drops bulk changes', () => {
    const many = Array.from({ length: MAX_EVENTS_PER_DIFF + 1 }, (_, i) => lead(`m${i}`, 's-new'));
    const prev = board({ 's-new': many });
    const next = board({ 's-con': many.map((l) => ({ ...l, stageId: 's-con' })) });
    expect(diffBoards(snapshotBoard(prev), next)).toEqual({ events: [], bulk: true });
  });
});

describe('CelebrationSchedule', () => {
  it('plays one win per 2 s, queues up to 3 and skips the rest', () => {
    const s = new CelebrationSchedule<number>();
    const decisions = [0, 1, 2, 3, 4].map((i) => s.offerWon(i, 100 + i * 50));
    expect(decisions).toEqual(['play', 'queued', 'queued', 'queued', 'skipped']);
    expect(s.takeDueWon(1500)).toBeNull();
    expect(s.msUntilNextWon(1500)).toBe(600);
    expect(s.takeDueWon(2100)).toBe(1);
    expect(s.takeDueWon(2200)).toBeNull();
    expect(s.takeDueWon(4100)).toBe(2);
    expect(s.takeDueWon(6100)).toBe(3);
    expect(s.queued).toBe(0);
    expect(s.stats).toMatchObject({ wonPlayed: 4, wonSkipped: 1 });
  });

  it('never starts more than 3 animated pulses per second', () => {
    const s = new CelebrationSchedule<number>();
    const d = [0, 100, 200, 300, 400, 1050, 1150].map((t) => s.offerPulse(t));
    expect(d).toEqual(['play', 'play', 'play', 'quiet', 'quiet', 'play', 'play']);
  });

  it('drops a queued win when its move is rolled back', () => {
    const s = new CelebrationSchedule<{ id: string }>();
    s.offerWon({ id: 'a' }, 0);
    s.offerWon({ id: 'b' }, 10);
    s.dropQueued((w) => w.id === 'b');
    expect(s.takeDueWon(3000)).toBeNull();
  });
});

describe('ParticlePool', () => {
  it('never holds more than its cap or budget', () => {
    const pool = new ParticlePool();
    const spec = { kind: DUST, x: 0, y: 0, vx: 1, vy: 1, ttl: 1000, size: 1, color: { r: 1, g: 2, b: 3 } } as const;
    let ok = 0;
    for (let i = 0; i < PARTICLE_CAP + 50; i++) if (pool.spawn(spec)) ok++;
    expect(ok).toBe(PARTICLE_CAP);
    expect(pool.peak).toBe(PARTICLE_CAP);
    pool.clear();
    pool.setBudget(90);
    for (let i = 0; i < 200; i++) pool.spawn(spec);
    expect(pool.count).toBe(90);
  });

  it('recycles dead particles', () => {
    const pool = new ParticlePool(10);
    for (let i = 0; i < 10; i++) pool.spawn({ kind: DUST, x: 0, y: 0, vx: 0, vy: 0, ttl: 100 + i * 100, size: 1, color: { r: 0, g: 0, b: 0 } });
    pool.step(150);
    expect(pool.count).toBe(9);
    pool.step(1000);
    expect(pool.count).toBe(0);
    expect(pool.spawn({ kind: DUST, x: 0, y: 0, vx: 0, vy: 0, ttl: 100, size: 1, color: { r: 0, g: 0, b: 0 } })).toBe(true);
  });
});
