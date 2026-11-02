import { expect, test } from '@playwright/test';

/**
 * SPEC 12.1 item 5: zero label overlaps in the default view (name tags, "Needs you" and call
 * outcome bubbles). Uses the QA hook window.__vistarFloor (enabled by localStorage vistar.floor.qa).
 * Run against a running app: E2E_BASE_URL=http://localhost:3005 pnpm e2e e2e/team-floor --project=desktop
 */

declare global {
  interface Window {
    __vistarFloor?: {
      ready(): boolean;
      labels(): { id: string; kind: string; mode: string; x: number; y: number; w: number; h: number }[];
      overlaps(): [string, string][];
    };
  }
}

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const VIEWS = [
  { name: 'manager team', query: '' },
  { name: 'populated (14 people)', query: '&floorStress=14' },
];

test.use({ launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] } });

for (const vp of VIEWPORTS) {
  for (const view of VIEWS) {
    test(`no label overlaps at ${vp.width}x${vp.height}, ${view.name}`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.setViewportSize(vp);
      await page.goto('/kit');
      await page.evaluate(() => {
        localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: 'manager' }));
        localStorage.setItem('vistar.floor.qa', '1');
      });
      await page.goto(`/app/team-floor?floorMode=3d${view.query}`);
      await page.waitForFunction(() => window.__vistarFloor?.ready() === true, null, { timeout: 60_000 });
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
