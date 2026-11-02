import { describe, expect, it } from 'vitest';
import { dragStart, placeInLanes, snap } from './layout';

describe('calendar layout', () => {
  it('puts non-overlapping events in one lane', () => {
    const p = placeInLanes([
      { id: 'a', start: 540, end: 600 },
      { id: 'b', start: 600, end: 660 },
    ]);
    expect(p.map((x) => [x.id, x.lane, x.lanes])).toEqual([
      ['a', 0, 1],
      ['b', 0, 1],
    ]);
  });

  it('splits overlapping events into lanes of the same cluster', () => {
    const p = placeInLanes([
      { id: 'a', start: 540, end: 660 },
      { id: 'b', start: 570, end: 600 },
      { id: 'c', start: 600, end: 630 },
      { id: 'd', start: 700, end: 720 },
    ]);
    const by = Object.fromEntries(p.map((x) => [x.id, x]));
    expect(by.a).toMatchObject({ lane: 0, lanes: 2 });
    expect(by.b).toMatchObject({ lane: 1, lanes: 2 });
    expect(by.c).toMatchObject({ lane: 1, lanes: 2 });
    expect(by.d).toMatchObject({ lane: 0, lanes: 1 });
  });

  it('snaps and clamps drags inside the day', () => {
    expect(snap(547)).toBe(540);
    expect(snap(553)).toBe(555);
    expect(dragStart(540, 37, 60)).toBe(570);
    expect(dragStart(60, -200, 30)).toBe(0);
    expect(dragStart(1380, 120, 60)).toBe(1380);
  });
});
