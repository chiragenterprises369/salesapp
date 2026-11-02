import { expect, test } from '@playwright/test';

/**
 * SPEC 12.1 item 5: zero label overlaps in the default view (name tags, "Needs you" and call
 * outcome bubbles) for the Small, Medium and Large templates in Light (Day) and Dark (Evening).
 * Uses the QA hook window.__vistarFloor (enabled by localStorage vistar.floor.qa).
 * Run against a running app: E2E_BASE_URL=http://localhost:3005 pnpm e2e e2e/team-floor --project=desktop
 */

declare global {
  interface Window {
    __vistarFloor?: {
      ready(): boolean;
      info(): { template: string; people: number };
      labels(): { id: string; kind: string; mode: string; x: number; y: number; w: number; h: number }[];
      overlaps(): [string, string][];
    };
  }
}

const VIEWS = [
  { name: 'Medium, manager team', query: '&floorTemplate=medium', template: 'medium', sizes: ['1440x900', '1920x1080'] },
  { name: 'Medium, 14 people', query: '&floorTemplate=medium&floorStress=14', template: 'medium', sizes: ['1440x900', '1920x1080'] },
  { name: 'Small, manager team', query: '', template: 'small', sizes: ['1440x900'] },
  { name: 'Large, 36 people', query: '&floorStress=36', template: 'large', sizes: ['1440x900'] },
  { name: 'Large, 50 people', query: '&floorStress=50', template: 'large', sizes: ['1440x900'] },
];

test.use({ launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] } });

for (const theme of ['light', 'dark'] as const) {
  for (const view of VIEWS) {
    for (const size of view.sizes) {
      const [width, height] = size.split('x').map(Number) as [number, number];
      test(`no label overlaps: ${view.name}, ${size}, ${theme}`, async ({ page, context, baseURL, isMobile }) => {
        test.skip(isMobile, 'desktop 3D view (mobile gets Flat, see flat.spec.ts)');
        test.setTimeout(90_000);
        await context.addCookies([
          {
            name: 'vistar_theme',
            value: encodeURIComponent(JSON.stringify({ mode: theme, darkFrom: '19:00', darkTo: '07:00', tz: 'Asia/Kolkata' })),
            domain: new URL(baseURL ?? 'http://localhost:3000').hostname,
            path: '/',
          },
        ]);
        await page.setViewportSize({ width, height });
        // Signed-in mock users follow the system theme; the cookie covers the boot script.
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/kit');
        await page.evaluate(() => {
          localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'manager' }));
          localStorage.setItem('vistar.floor.qa', '1');
        });
        await page.goto(`/app/team-floor?floorMode=3d${view.query}`);
        await page.waitForFunction(() => window.__vistarFloor?.ready() === true, null, { timeout: 60_000 });
        expect(await page.evaluate(() => window.__vistarFloor!.info().template)).toBe(view.template);
        expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
        // Sample the default view a few times while people walk and events arrive.
        for (let i = 0; i < 4; i++) {
          await page.waitForTimeout(1500);
          const labels = await page.evaluate(() => window.__vistarFloor!.labels());
          const overlaps = await page.evaluate(() => window.__vistarFloor!.overlaps());
          expect(labels.length, 'labels are placed').toBeGreaterThan(0);
          expect(overlaps, `overlapping labels: ${JSON.stringify(overlaps)}`).toEqual([]);
        }
      });
    }
  }
}
