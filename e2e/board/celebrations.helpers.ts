import type { Page } from '@playwright/test';
import { column, expect, signIn, waitSettled } from './helpers';

/**
 * Helpers for the Board event celebrations specs (SPEC 28.1, frontend-physics).
 *
 * The layer (`[data-celebrations]`, a portal on <body>) exposes:
 * - data-celebrations: full | subtle | off (off = simple fades, no canvas), data-celebrations-setting
 * - data-last-event: new-lead | stage-move | quote-sent | won | lost; data-event-count
 * - data-last-effect: "<event>:<effect>" (stream, ring, envelope, burst, shards, fade, hidden, queued, skipped, ...)
 * - data-won-bursts, data-won-queued, data-won-skipped
 * - data-active-particles, data-peak-particles, data-effects, data-running (requestAnimationFrame loop alive)
 */

export const LAB_PATH = '/dev/board-physics';

/** Wide enough for the lab panel and all six columns, so every effect has its card on screen. */
export const WIDE = { width: 2240, height: 1000 };

export const layer = (page: Page) => page.locator('[data-celebrations]');

/** Open the board physics lab (mock data, celebration triggers) and wait until the board is idle. */
export async function openLab(page: Page, query = '') {
  await signIn(page);
  await page.goto(`${LAB_PATH}${query}`, { waitUntil: 'domcontentloaded' });
  await expect(column(page, 'new').locator('li[data-lead-id]').first()).toBeVisible({ timeout: 60_000 });
  await expect(layer(page)).toBeAttached();
  await waitSettled(page);
}

/** Open the Leads page without waiting for the board to settle (the live feed keeps it busy). */
export async function openLeads(page: Page) {
  await signIn(page);
  await page.goto('/app/leads', { waitUntil: 'domcontentloaded' });
  await expect(column(page, 'new').locator('li[data-lead-id]').first()).toBeVisible({ timeout: 60_000 });
  await expect(layer(page)).toBeAttached();
}

export async function trigger(page: Page, label: string) {
  await page.locator('[data-celebration-triggers] button', { hasText: new RegExp(`^${label}$`) }).click();
}

/** Click a lab trigger and wait until the layer has seen an event of that kind. */
export async function fire(page: Page, label: string, kind: string) {
  const before = Number((await layer(page).getAttribute('data-event-count')) ?? 0);
  await trigger(page, label);
  await page.waitForFunction(
    ({ k, n }) => {
      const el = document.querySelector<HTMLElement>('[data-celebrations]');
      return !!el && el.dataset.lastEvent === k && Number(el.dataset.eventCount) > n;
    },
    { k: kind, n: before },
    { timeout: 15_000 },
  );
}

export interface LayerChange {
  t: number;
  attr: string;
  value: string | null;
}

/**
 * Record every value the given layer attributes take. Effects last well under a second, so specs
 * check the recording instead of polling the DOM.
 */
export async function recordLayer(page: Page, attrs: string[]): Promise<() => Promise<LayerChange[]>> {
  await page.evaluate((names) => {
    const w = window as unknown as { __celebrations?: LayerChange[] };
    w.__celebrations = [];
    const el = document.querySelector('[data-celebrations]');
    if (!el) throw new Error('celebrations layer not mounted');
    new MutationObserver((muts) => {
      for (const m of muts) w.__celebrations!.push({ t: performance.now(), attr: m.attributeName ?? '', value: el.getAttribute(m.attributeName ?? '') });
    }).observe(el, { attributes: true, attributeFilter: names });
  }, attrs);
  return () => page.evaluate(() => (window as unknown as { __celebrations?: LayerChange[] }).__celebrations ?? []);
}

export const valuesOf = (changes: LayerChange[], attr: string) => changes.filter((c) => c.attr === attr).map((c) => c.value ?? '');

/** Animations created inside the layer (fades, the Won total chip) and the properties they animate. */
export async function recordLayerAnimations(page: Page): Promise<() => Promise<string[][]>> {
  await page.evaluate(() => {
    const w = window as unknown as { __celebrationAnims?: string[][] };
    w.__celebrationAnims = [];
    const el = document.querySelector('[data-celebrations]')!;
    const seen = new WeakSet<Animation>();
    const scan = () => {
      for (const a of el.getAnimations({ subtree: true })) {
        if (seen.has(a)) continue;
        seen.add(a);
        const frames = (a.effect as KeyframeEffect | null)?.getKeyframes() ?? [];
        const props = new Set<string>();
        for (const f of frames) for (const k of Object.keys(f)) if (!['offset', 'easing', 'composite', 'computedOffset'].includes(k)) props.add(k);
        w.__celebrationAnims!.push([...props]);
      }
      requestAnimationFrame(scan);
    };
    scan();
  });
  return () => page.evaluate(() => (window as unknown as { __celebrationAnims?: string[][] }).__celebrationAnims ?? []);
}

/** Pretend the tab is hidden (or visible again): document.hidden, visibilityState and the event. */
export async function setTabHidden(page: Page, hidden: boolean) {
  await page.evaluate((h) => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
}

export async function chooseIntensity(page: Page, label: 'Auto' | 'Full' | 'Subtle' | 'Off') {
  await page.getByRole('radiogroup', { name: /Intensity/ }).getByRole('radio', { name: label, exact: true }).click();
}

export interface LiveState {
  active: boolean;
  reason: string;
  events: number;
}

/** The mock live feed's test hook (`window.__vistarMockLive`). */
export function liveState(page: Page): Promise<LiveState | null> {
  return page.evaluate(() => {
    const h = (window as unknown as { __vistarMockLive?: LiveState | null }).__vistarMockLive;
    return h ? { active: h.active, reason: h.reason, events: h.events } : null;
  });
}
