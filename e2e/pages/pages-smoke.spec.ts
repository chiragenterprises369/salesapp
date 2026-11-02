import { expect as baseExpect, test, type Page } from '@playwright/test';

/**
 * Smoke test of the data pages built on the mock world (frontend-app pages): Tasks, Calls, Inbox,
 * Team, Targets, Reports and the employee Inbox. Each page opens as every persona that may use it
 * and must render data with no console errors; personas without the permission get the No access
 * state, and employees are sent to their own panel. Runs on the production build (mock data layer).
 */
const expect = baseExpect.configure({ timeout: 15_000 });
const IGNORED = [/Download the React DevTools/i, /favicon/i];

type Persona = 'company_admin' | 'manager' | 'employee' | 'viewer';

async function open(page: Page, persona: Persona, path: string) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  await page.addInitScript((p) => window.localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: p })), persona);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return errors;
}

const noAccess = (page: Page) => page.getByRole('heading', { name: 'You do not have access to this page' });

const PAGES: Record<string, { path: string; title: string; ready: (page: Page) => Promise<void> }> = {
  tasks: {
    path: '/app/tasks',
    title: 'Tasks',
    ready: async (page) => {
      await expect(page.locator('[data-task-row]').first()).toBeVisible();
      expect(await page.locator('[data-task-row]').count()).toBeGreaterThan(5);
    },
  },
  calls: {
    path: '/app/calls',
    title: 'Calls',
    ready: async (page) => {
      await expect(page.locator('[data-call-row]').first()).toBeVisible();
      await expect(page.getByText('Connected rate')).toBeVisible();
      expect(await page.locator('[data-call-row]').count()).toBeGreaterThan(5);
    },
  },
  inbox: {
    path: '/app/inbox',
    title: 'Inbox',
    ready: async (page) => {
      await expect(page.locator('[data-conversation]').first()).toBeVisible();
      expect(await page.locator('[data-conversation]').count()).toBeGreaterThan(5);
    },
  },
  team: {
    path: '/app/team',
    title: 'Team and roles',
    ready: async (page) => {
      await expect(page.locator('[data-member-card]').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: /Inside Sales/ })).toBeVisible();
    },
  },
  targets: {
    path: '/app/targets',
    title: 'Targets',
    ready: async (page) => {
      await expect(page.locator('[data-target-subject="user"]').first()).toBeVisible();
      await expect(page.locator('[data-target-subject="team"]').first()).toBeVisible();
    },
  },
  reports: {
    path: '/app/reports',
    title: 'Reports',
    ready: async (page) => {
      await expect(page.locator('[data-rep-row]').first()).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Conversion funnel' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Revenue forecast' })).toBeVisible();
    },
  },
};

const ALLOWED: Record<Persona, readonly string[]> = {
  company_admin: ['tasks', 'calls', 'inbox', 'team', 'targets', 'reports'],
  manager: ['tasks', 'calls', 'inbox', 'team', 'targets', 'reports'],
  viewer: ['reports'],
  employee: [],
};

test.describe.configure({ timeout: 60_000 });

for (const persona of ['company_admin', 'manager', 'viewer'] as const) {
  for (const [key, p] of Object.entries(PAGES)) {
    const allowed = ALLOWED[persona].includes(key);
    test(`${key} as ${persona}: ${allowed ? 'renders data' : 'no access'}`, async ({ page }) => {
      const errors = await open(page, persona, p.path);
      if (allowed) {
        await expect(page.getByRole('heading', { level: 1, name: p.title })).toBeVisible();
        await p.ready(page);
      } else {
        await expect(noAccess(page)).toBeVisible();
        await expect(page.locator('[data-task-row], [data-call-row], [data-conversation], [data-member-card], [data-target-subject]')).toHaveCount(0);
      }
      expect(errors).toEqual([]);
    });
  }
}

test('manager sees only their own team', async ({ page }) => {
  const errors = await open(page, 'manager', '/app/team');
  await PAGES.team!.ready(page);
  await expect(page.getByRole('heading', { name: /Key Accounts/ })).toHaveCount(0);
  const cards = await page.locator('[data-member-card]').count();
  expect(cards).toBeGreaterThan(1);
  expect(cards).toBeLessThan(12);
  expect(errors).toEqual([]);
});

test('employee inbox shows own chats and opens a conversation', async ({ page }) => {
  const errors = await open(page, 'employee', '/me/inbox');
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await expect(page.locator('[data-conversation]').first()).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Whose chats' })).toHaveCount(0);
  await page.locator('[data-conversation] button').first().click();
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('employee is sent to the employee panel from company pages', async ({ page }) => {
  const errors = await open(page, 'employee', '/app/tasks');
  await page.waitForURL(/\/me(\/|$|\?)/);
  expect(errors).toEqual([]);
});

test('tasks: complete with undo is optimistic', async ({ page }) => {
  const errors = await open(page, 'manager', '/app/tasks');
  await PAGES.tasks!.ready(page);
  const row = page.locator('[data-task-row]').first();
  const title = (await row.locator('p').first().innerText()).trim();
  const same = page.locator('[data-task-row]').filter({ hasText: title });
  const before = await same.count();
  await row.getByRole('checkbox').check();
  await expect(page.getByText('Task completed')).toBeVisible();
  await expect(same).toHaveCount(before - 1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(same).toHaveCount(before);
  expect(errors).toEqual([]);
});

test('inbox: send an internal note and a reply', async ({ page }) => {
  const errors = await open(page, 'company_admin', '/app/inbox');
  await PAGES.inbox!.ready(page);
  await page.getByRole('radio', { name: /Needs reply/ }).click();
  await page.locator('[data-conversation] button').first().click();
  await expect(page.getByRole('log', { name: 'Messages' })).toBeVisible();
  await page.getByRole('radio', { name: 'Internal note' }).click();
  await page.getByRole('textbox', { name: /Internal note/ }).fill('Checked stock: 2 tonnes ready');
  await page.getByRole('button', { name: 'Add note' }).click();
  await expect(page.getByRole('log', { name: 'Messages' }).getByText('Checked stock: 2 tonnes ready')).toBeVisible();
  expect(errors).toEqual([]);
});

test('calls: recording player opens with the mock label', async ({ page }) => {
  const errors = await open(page, 'company_admin', '/app/calls');
  await PAGES.calls!.ready(page);
  await page.getByRole('button', { name: /^Play recording:/ }).first().click();
  await expect(page.getByText('Recording (mock)')).toBeVisible();
  await expect(page.getByRole('slider', { name: 'Seek' })).toBeVisible();
  expect(errors).toEqual([]);
});
