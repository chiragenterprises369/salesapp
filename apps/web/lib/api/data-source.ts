/**
 * Data source switch (SPEC 29.8, D-064). The web reads the real API. The in-browser mock layer
 * (lib/mock-db, lib/world, the mock sources and mock personas) is kept ONLY for automated tests:
 *
 * - It can be turned on only in builds made with `NEXT_PUBLIC_ALLOW_MOCK_DATA=1` (dev and test
 *   builds; production builds leave it unset) or `NEXT_PUBLIC_DATA_SOURCE=mock` (a mock-only build).
 * - At runtime a test picks it with `localStorage["vistar.dataSource"] = "mock"` before the first
 *   page script runs (Playwright `addInitScript`), so e2e suites need no separate build. A mock
 *   persona in storage (`vistar.mock.persona`, what the existing mock e2e suites write) without an
 *   explicit choice also selects mock; `"api"` always wins.
 *
 * The choice is read once per page load and never changes while the page is open.
 */
export type DataSource = 'api' | 'mock';

export const DATA_SOURCE_KEY = 'vistar.dataSource';
const MOCK_PERSONA_KEY = 'vistar.mock.persona';

export const MOCK_DATA_ALLOWED =
  (process.env.NEXT_PUBLIC_ALLOW_MOCK_DATA === '1' || process.env.NEXT_PUBLIC_DATA_SOURCE === 'mock') &&
  process.env.NODE_ENV !== 'production';

const BUILD_DEFAULT: DataSource = process.env.NEXT_PUBLIC_DATA_SOURCE === 'mock' ? 'mock' : 'api';

let cached: DataSource | null = null;

function isProductionHost(): boolean {
  if (typeof window === 'undefined' || !window.location?.hostname) return process.env.NODE_ENV === 'production';
  const h = window.location.hostname.toLowerCase();
  return (
    h === 'tootodo.com' ||
    h.endsWith('.tootodo.com') ||
    h.includes('vercel.app') ||
    process.env.NODE_ENV === 'production'
  );
}

export function getDataSource(): DataSource {
  if (cached) return cached;
  if (isProductionHost() || !MOCK_DATA_ALLOWED) {
    if (typeof window !== 'undefined') {
      try {
        if (window.localStorage.getItem(DATA_SOURCE_KEY) === 'mock') {
          window.localStorage.removeItem(DATA_SOURCE_KEY);
        }
        window.localStorage.removeItem(MOCK_PERSONA_KEY);
      } catch {
        /* ignore */
      }
    }
    return (cached = 'api');
  }
  // Server render: no storage. Session-dependent UI renders on the client only.
  if (typeof window === 'undefined') return BUILD_DEFAULT;
  let stored: string | null = null;
  let persona: string | null = null;
  try {
    stored = window.localStorage.getItem(DATA_SOURCE_KEY);
    persona = window.localStorage.getItem(MOCK_PERSONA_KEY);
  } catch {
    stored = null;
  }
  // A mock persona without an explicit choice means a mock e2e suite (they predate the switch).
  cached = stored === 'mock' || stored === 'api' ? stored : persona ? 'mock' : BUILD_DEFAULT;
  return cached;
}

export const isMockData = (): boolean => getDataSource() === 'mock';
export const isApiData = (): boolean => getDataSource() === 'api';

/** Tests only: forget the cached choice (the next read looks at storage again). */
export function resetDataSourceForTests(): void {
  cached = null;
}

declare global {
  interface Window {
    /** Mock-layer areas used on this page (read by the API-mode e2e check; must stay empty there). */
    __vistarMockUse?: string[];
  }
}

/**
 * Every entry point of the mock layer calls this. In API mode it records the area so the API-mode
 * e2e check can assert that nothing generated reached the page.
 */
export function noteMockUse(area: string): void {
  if (typeof window === 'undefined') return;
  const list = (window.__vistarMockUse ??= []);
  if (!list.includes(area)) list.push(area);
  if (getDataSource() === 'api' && list.length === 1 && process.env.NODE_ENV !== 'test') {
    console.warn(`[vistar] mock data layer used in API mode: ${area}`);
  }
}
