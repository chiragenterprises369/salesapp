import { expect as baseExpect, test, type Page } from '@playwright/test';

/**
 * Full-screen layout check (SPEC 29.7, D-066; WEB-PREMIUM, frontend-app). Every main route of the
 * Company, Employee and Super Admin panels must use the whole width of the content area at 1280,
 * 1440, 1920 and 2560 px: no empty band on the left or right of the page.
 *
 * Measured inside the shell's content box (`main#main > div`, inside its padding):
 * - right gap = content right edge - the right-most edge of a painted block (background, border or
 *   shadow, at least 48 px high: cards, tables, panels, board columns),
 * - left gap = the left-most painted element, text or control - content left edge.
 * A centred or max-width page container shows up as a gap on both sides; columns that do not grow
 * (the Board) show up as a right gap. Allowed: 16 px.
 * Runs on the mock data layer (persona in localStorage), desktop project only.
 */
const expect = baseExpect.configure({ timeout: 20_000 });
const WIDTHS = [1280, 1440, 1920, 2560] as const;
const HEIGHT = 1000;
const TOLERANCE = 16;

type Persona = 'company_admin' | 'employee' | 'super_admin';

const ROUTES: { persona: Persona; path: string }[] = [
  ...[
    '/app',
    '/app/leads?view=board',
    '/app/leads?view=table',
    '/app/leads/:lead',
    '/app/inbox',
    '/app/calls',
    '/app/tasks',
    '/app/workflows',
    '/app/webhooks',
    '/app/team-floor',
    '/app/team',
    '/app/targets',
    '/app/reports',
    '/app/integrations',
    '/app/billing',
    '/app/profile',
    '/app/settings',
    '/app/settings/design',
    '/app/settings/branding',
    '/app/settings/domain',
    '/app/settings/stages',
    '/app/settings/fields',
    '/app/settings/roles',
    '/app/settings/theme',
  ].map((path) => ({ persona: 'company_admin' as const, path })),
  ...['/me', '/me/leads?view=board', '/me/leads/:lead', '/me/calls', '/me/inbox', '/me/more', '/me/tasks', '/me/performance', '/me/team-floor', '/me/status', '/me/profile', '/me/preferences'].map(
    (path) => ({ persona: 'employee' as const, path }),
  ),
  ...[
    '/super-admin',
    '/super-admin/companies',
    '/super-admin/plans',
    '/super-admin/usage',
    '/super-admin/flags',
    '/super-admin/packs',
    '/super-admin/health',
    '/super-admin/analytics',
    '/super-admin/support',
    '/super-admin/content',
    '/super-admin/audit',
    '/super-admin/system',
    '/super-admin/config',
  ].map((path) => ({ persona: 'super_admin' as const, path })),
];

interface Gaps {
  left: number;
  right: number;
  content: number;
  blocks: number;
}

/** Runs in the page. Returns the gaps in CSS px (see the header comment). */
function measureGaps(): Gaps | null {
  const main = document.querySelector<HTMLElement>('main#main');
  const wrap = main?.firstElementChild as HTMLElement | null;
  if (!main || !wrap) return null;
  const cs = getComputedStyle(wrap);
  const box = wrap.getBoundingClientRect();
  const L = box.left + parseFloat(cs.paddingLeft);
  const R = box.right - parseFloat(cs.paddingRight);
  const REPLACED = new Set(['IMG', 'SVG', 'CANVAS', 'INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'VIDEO']);
  const transparent = (c: string) => c === 'transparent' || /rgba?\([^)]*,\s*0(\.0+)?\)$/.test(c) || /\/\s*0\)$/.test(c);
  const painted = (s: CSSStyleDeclaration) =>
    !transparent(s.backgroundColor) ||
    s.backgroundImage !== 'none' ||
    s.boxShadow !== 'none' ||
    (['Top', 'Right', 'Bottom', 'Left'] as const).some((side) => parseFloat(s[`border${side}Width`]) > 0 && !transparent(s[`border${side}Color`]));
  const ownText = (el: Element) => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim().length > 0);

  let minLeft = Infinity;
  let maxBlockRight = -Infinity;
  let maxAnyRight = -Infinity;
  let blocks = 0;
  for (const el of Array.from(wrap.querySelectorAll('*'))) {
    const r = el.getBoundingClientRect();
    if (r.width <= 2 || r.height <= 2) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.position === 'fixed' || parseFloat(s.opacity) === 0) continue;
    // Decorative layers (backdrops, glows) and screen-reader-only text do not count as content.
    if ((s.position === 'absolute' && s.pointerEvents === 'none') || el.closest('.sr-only')) continue;
    const isPainted = painted(s);
    const visible = isPainted || ownText(el) || REPLACED.has(el.tagName.toUpperCase());
    if (!visible) continue;
    // Clamp to the content box: content that overflows a scroller reaches the edge.
    const left = Math.max(L, r.left);
    const right = Math.min(R, r.right);
    if (right <= left) continue;
    minLeft = Math.min(minLeft, left);
    maxAnyRight = Math.max(maxAnyRight, right);
    if (isPainted && r.height >= 48) {
      blocks += 1;
      maxBlockRight = Math.max(maxBlockRight, right);
    }
  }
  if (!Number.isFinite(minLeft)) return { left: R - L, right: R - L, content: Math.round(R - L), blocks: 0 };
  const rightEdge = blocks > 0 ? maxBlockRight : maxAnyRight;
  return { left: Math.round(minLeft - L), right: Math.round(R - rightEdge), content: Math.round(R - L), blocks };
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.waitForTimeout(350);
}

async function firstLeadId(page: Page, base: '/app' | '/me'): Promise<string> {
  await page.goto(`${base}/leads?view=board`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('li[data-lead-id]').first();
  await expect(card).toBeAttached();
  return (await card.getAttribute('data-lead-id'))!;
}

test.describe.configure({ timeout: 90_000 });

for (const route of ROUTES) {
  test(`full width: ${route.path} (${route.persona})`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Wide-screen check (desktop project)');
    await page.setViewportSize({ width: WIDTHS[0], height: HEIGHT });
    await page.addInitScript((p) => window.localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: p })), route.persona);
    let path = route.path;
    if (path.includes(':lead')) {
      const base = path.startsWith('/me') ? '/me' : '/app';
      path = path.replace(':lead', await firstLeadId(page, base));
    }
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('main#main h1').first()).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => undefined);

    const results: string[] = [];
    const failures: string[] = [];
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: HEIGHT });
      await settle(page);
      const gaps = await page.evaluate(measureGaps);
      expect(gaps, 'main#main > div exists').not.toBeNull();
      const g = gaps!;
      results.push(`${width}: left ${g.left}px, right ${g.right}px of ${g.content}px (${g.blocks} blocks)`);
      if (g.left > TOLERANCE || g.right > TOLERANCE) failures.push(`${width}px: left gap ${g.left}px, right gap ${g.right}px (content ${g.content}px)`);
    }
    await testInfo.attach('gaps', { body: results.join('\n'), contentType: 'text/plain' });
    console.info(`[full-width] ${route.path} ${route.persona} | ${results.join(' | ')}`);
    expect(failures, `${route.path} leaves an empty band`).toEqual([]);
  });
}
