import { describe, expect, it } from 'vitest';
import type { QualitySnapshot } from '@/features/shared/physics';
import { describeSkinFallback, isOverdue, neonEdge, resolveBoardAppearance, SkinPerformance, type BoardDeviceSignals } from './skin-model';

const desktop: BoardDeviceSignals = { narrowScreen: false, coarsePointer: false, lowEnd: false, reducedMotion: false };
const base = { user: null, workspaceDefault: null, device: desktop, perfLevel: 0, theme: 'dark' } as const;

function snap(p: Partial<QualitySnapshot>): QualitySnapshot {
  return { tier: 'high', autoTier: 'high', forced: null, fps: null, frameMs: null, worstMs: null, sampling: true, ...p };
}

describe('resolveBoardAppearance', () => {
  it('defaults to Depth and follows the user, then the workspace default', () => {
    expect(resolveBoardAppearance(base).skin).toBe('depth');
    expect(resolveBoardAppearance({ ...base, workspaceDefault: 'flat' }).skin).toBe('flat');
    expect(resolveBoardAppearance({ ...base, user: 'neon', workspaceDefault: 'flat' }).skin).toBe('neon');
  });

  it('paints Neon as the Neon variant in dark and Aurora in light, with glow only at full performance', () => {
    expect(resolveBoardAppearance({ ...base, user: 'neon' })).toMatchObject({ skin: 'neon', variant: 'neon', glow: true, reason: null });
    expect(resolveBoardAppearance({ ...base, user: 'neon', theme: 'light' })).toMatchObject({ skin: 'neon', variant: 'aurora' });
    expect(resolveBoardAppearance({ ...base, user: 'depth' }).variant).toBeNull();
    expect(resolveBoardAppearance({ ...base, user: 'neon', perfLevel: 1 })).toMatchObject({ skin: 'neon', glow: false, reason: null });
  });

  it('falls back to Flat on phones, touch screens, low-end devices and with reduced motion', () => {
    const cases: Array<[Partial<BoardDeviceSignals>, string]> = [
      [{ narrowScreen: true, coarsePointer: true }, 'small-screen'],
      [{ coarsePointer: true }, 'touch'],
      [{ lowEnd: true }, 'low-end'],
      [{ reducedMotion: true, narrowScreen: true }, 'reduced-motion'],
    ];
    for (const [d, reason] of cases) {
      const r = resolveBoardAppearance({ ...base, user: 'neon', device: { ...desktop, ...d } });
      expect(r).toMatchObject({ requested: 'neon', skin: 'flat', variant: null, glow: false, reason });
      expect(describeSkinFallback(r)).toMatch(/^Neon Space is off on this device because .+\. Showing Flat\.$/);
    }
    // Depth and Flat are never replaced by the device.
    expect(resolveBoardAppearance({ ...base, user: 'depth', device: { ...desktop, coarsePointer: true } }).skin).toBe('depth');
  });

  it('falls back Neon -> Depth -> Flat on performance', () => {
    expect(resolveBoardAppearance({ ...base, user: 'neon', perfLevel: 2 })).toMatchObject({ skin: 'depth', reason: 'performance' });
    expect(resolveBoardAppearance({ ...base, user: 'neon', perfLevel: 3 })).toMatchObject({ skin: 'flat', reason: 'performance' });
    expect(describeSkinFallback(resolveBoardAppearance({ ...base, user: 'neon', perfLevel: 2 }))).toBe(
      'Neon Space is off for now because the board was running slowly. Showing Depth.',
    );
    // A Depth board keeps Depth (its own tiers trim effects).
    expect(resolveBoardAppearance({ ...base, user: 'depth', perfLevel: 3 }).skin).toBe('depth');
  });
});

describe('SkinPerformance', () => {
  it('drops the glow at medium and recovers it with the tier', () => {
    const p = new SkinPerformance({ fpsFloor: 45 });
    expect(p.update(snap({}))).toBe(0);
    expect(p.update(snap({ tier: 'medium', autoTier: 'medium', fps: 40, frameMs: 25 }))).toBe(1);
    expect(p.update(snap({ tier: 'high', autoTier: 'high', fps: 60, frameMs: 16.6 }))).toBe(0);
  });

  it('keeps the Depth fallback once the tier reached low, and gives up to Flat after more slow windows', () => {
    const p = new SkinPerformance({ fpsFloor: 45, giveUpWindows: 2 });
    expect(p.update(snap({ tier: 'low', autoTier: 'low', fps: 38, frameMs: 26.3 }))).toBe(2);
    // Recovery of the tier does not bring Neon back in this session.
    expect(p.update(snap({ tier: 'medium', autoTier: 'medium', fps: 58, frameMs: 17.2 }))).toBe(2);
    expect(p.update(snap({ tier: 'low', autoTier: 'low', fps: 40, frameMs: 25 }))).toBe(2);
    expect(p.update(snap({ tier: 'low', autoTier: 'low', fps: 41, frameMs: 24.4 }))).toBe(2);
    // Sampling on/off alone is not a measured window.
    expect(p.update(snap({ tier: 'low', autoTier: 'low', fps: 41, frameMs: 24.4, sampling: false }))).toBe(2);
    expect(p.update(snap({ tier: 'low', autoTier: 'low', fps: 39, frameMs: 25.6 }))).toBe(3);
    expect(p.stickyLevel).toBe(3);
    p.reset();
    expect(p.update(snap({}))).toBe(0);
  });

  it('a good window at low resets the give-up count', () => {
    const p = new SkinPerformance({ fpsFloor: 45, giveUpWindows: 2 });
    p.update(snap({ tier: 'low', autoTier: 'low', fps: 38, frameMs: 26.3 }));
    p.update(snap({ tier: 'low', autoTier: 'low', fps: 40, frameMs: 25 }));
    p.update(snap({ tier: 'low', autoTier: 'low', fps: 50, frameMs: 20 }));
    expect(p.update(snap({ tier: 'low', autoTier: 'low', fps: 42, frameMs: 23.8 }))).toBe(2);
  });

  it('forced tiers map straight to levels without touching the sticky state', () => {
    const p = new SkinPerformance({ fpsFloor: 45 });
    expect(p.update(snap({ tier: 'low', forced: 'low' }))).toBe(2);
    expect(p.update(snap({ tier: 'medium', forced: 'medium' }))).toBe(1);
    expect(p.update(snap({}))).toBe(0);
  });
});

describe('neonEdge and isOverdue', () => {
  it('uses the spec palette for default stages, the stage colour or a fallback hue for custom ones', () => {
    expect(neonEdge({ key: 'new' }, 0)).toBe('var(--vn-edge-new)');
    expect(neonEdge({ key: 'quote_sent', color: '#123456' }, 3)).toBe('var(--vn-edge-quote-sent)');
    expect(neonEdge({ key: 'site_visit', color: '#0EA5E9' }, 6)).toBe('#0EA5E9');
    expect(neonEdge({ key: 'site_visit', color: 'red; background: url(x)' }, 7)).toBe('var(--vn-edge-x1)');
    expect(neonEdge({ key: 'closed_won', type: 'won' }, 8)).toBe('var(--vn-edge-won)');
    expect(neonEdge({ key: 'dropped', type: 'lost' }, 9)).toBe('var(--vn-edge-lost)');
  });

  it('marks open-stage leads with a past follow-up as overdue', () => {
    const now = Date.parse('2026-11-02T10:00:00Z');
    expect(isOverdue({ nextFollowUpAt: '2026-11-01T10:00:00Z' }, 'open', now)).toBe(true);
    expect(isOverdue({ nextFollowUpAt: '2026-11-03T10:00:00Z' }, 'open', now)).toBe(false);
    expect(isOverdue({ nextFollowUpAt: '2026-11-01T10:00:00Z' }, 'won', now)).toBe(false);
    expect(isOverdue({ nextFollowUpAt: '2026-11-01T10:00:00Z' }, 'lost', now)).toBe(false);
    expect(isOverdue({ nextFollowUpAt: null }, 'open', now)).toBe(false);
  });
});
