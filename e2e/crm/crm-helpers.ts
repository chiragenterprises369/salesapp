import { expect as baseExpect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Helpers of the CRM suites (change #19 wave B, CRM-WEB). Two modes:
 * - mock (crm-mock.spec.ts): web build with NEXT_PUBLIC_ALLOW_MOCK_DATA=1, no API; a mock persona in
 *   localStorage picks the data layer.
 * - API (crm-*.api.spec.ts, E2E_API_MODE=1): the web built against the CRM API (default
 *   http://localhost:4030) on a `seed:demo` database; personas sign in through /login.
 */
export const expect = baseExpect.configure({ timeout: 20_000 });
export const API = (process.env.E2E_API_URL ?? 'http://localhost:4030').replace(/\/$/, '');
export const PASSWORD = process.env.SMOKE_PASSWORD ?? 'vistar-demo-123';
export const ACCOUNTS = {
  company_admin: 'anil@shakti.example',
  manager: 'priya@shakti.example',
  employee: 'rohit@shakti.example',
  viewer: 'deepa@shakti.example',
} as const;
export type Persona = keyof typeof ACCOUNTS;

const IGNORED = [/Download the React DevTools/i, /favicon/i];

/** Collect page errors and console errors (fail the test on any). */
export function watch(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  return errors;
}

export async function mockAs(page: Page, persona: Persona) {
  await page.addInitScript((p) => {
    window.localStorage.setItem('vistar.dataSource', 'mock');
    window.localStorage.setItem('vistar.mock.persona', JSON.stringify({ persona: p }));
  }, persona);
}

export async function signIn(page: Page, persona: Persona) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill(ACCOUNTS[persona]);
  await page.locator('input[name="password"]').fill(PASSWORD);
  const login = page.waitForResponse((r) => r.url().includes('/api/v1/auth/login'));
  await page.locator('form button[type="submit"]').click();
  expect((await login).status()).toBe(200);
  await page.waitForURL((u) => !u.pathname.startsWith('/login'));
}

export async function noMockUse(page: Page) {
  expect(await page.evaluate(() => (window as unknown as { __vistarMockUse?: string[] }).__vistarMockUse ?? [])).toEqual([]);
}

/** Access token for direct API calls (setup and checks), from the normal workspace login. */
export async function apiToken(request: APIRequestContext, persona: Persona): Promise<string> {
  const res = await request.post(`${API}/api/v1/auth/login`, { data: { email: ACCOUNTS[persona], password: PASSWORD } });
  expect(res.status(), `API login as ${persona}`).toBe(200);
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

export async function apiGet<T>(request: APIRequestContext, token: string, path: string): Promise<T> {
  const res = await request.get(`${API}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
  expect(res.ok(), `GET ${path} -> ${res.status()}`).toBe(true);
  return (await res.json()) as T;
}

export async function apiSend<T>(request: APIRequestContext, token: string, method: 'POST' | 'PUT' | 'PATCH', path: string, data: unknown): Promise<T> {
  const res = await request.fetch(`${API}/api/v1${path}`, { method, data, headers: { authorization: `Bearer ${token}` } });
  expect(res.ok(), `${method} ${path} -> ${res.status()} ${await res.text().catch(() => '')}`).toBe(true);
  return (await res.json()) as T;
}

/** Total of the first list page a CRM page requests (the API applies the data scope). */
export async function listTotal(page: Page, path: string, apiPath: RegExp): Promise<number> {
  const res = page.waitForResponse((r) => r.request().method() === 'GET' && apiPath.test(new URL(r.url()).pathname) && r.status() === 200);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const body = (await (await res).json()) as { items: unknown[]; total?: number };
  return body.total ?? body.items.length;
}

export const stamp = () => Date.now().toString(36).slice(-6);

const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** A valid GSTIN (check digit included) for a state code and PAN, like gstinCheckChar() in packages/shared. */
export function gstin(stateCode: string, pan: string): string {
  const first = `1Z`;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return first + GSTIN_CHARS[(36 - (sum % 36)) % 36]!;
}