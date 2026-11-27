import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '../../api-error';
import { isApiWaking, isColdStartError, wakeApi, withColdStartRetry } from '../wake';

/**
 * Cold-start handling for the sign-in (API on a sleeping free instance): only timeouts and gateway errors
 * wait for /api/health and retry once; other errors are thrown at once.
 */

const timedOut = () => new ApiRequestError('SERVICE_UNAVAILABLE', 'The server took too long to answer. Try again.', [], { status: 0, timeout: true });
const unreachable = () => new ApiRequestError('SERVICE_UNAVAILABLE', 'Tootodo could not reach the server.', [], { status: 0 });
const gateway = (status: number) => new ApiRequestError('SERVICE_UNAVAILABLE', 'Tootodo is not available right now.', [], { status });
const badPassword = () => new ApiRequestError('AUTH_INVALID_CREDENTIALS', 'Wrong email or password', [], { status: 401 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isColdStartError', () => {
  it('is true for timeouts and 502/503/504 only', () => {
    expect(isColdStartError(timedOut())).toBe(true);
    expect(isColdStartError(gateway(502))).toBe(true);
    expect(isColdStartError(gateway(503))).toBe(true);
    expect(isColdStartError(gateway(504))).toBe(true);
    expect(isColdStartError(unreachable())).toBe(false);
    expect(isColdStartError(badPassword())).toBe(false);
    expect(isColdStartError(new Error('boom'))).toBe(false);
  });
});

describe('withColdStartRetry', () => {
  it('waits for the API after a timeout and runs once more', async () => {
    let answer!: () => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(new Response(null, { status: 200 }));
        }),
    );
    const run = vi.fn<() => Promise<string>>().mockRejectedValueOnce(timedOut()).mockResolvedValueOnce('signed in');

    const result = withColdStartRetry(run, 5_000);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(isApiWaking()).toBe(true);
    answer();

    await expect(result).resolves.toBe('signed in');
    expect(run).toHaveBeenCalledTimes(2);
    expect(isApiWaking()).toBe(false);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/health$/);
    expect(init).toMatchObject({ mode: 'no-cors', credentials: 'omit' });
  });

  it('throws other errors at once without waiting', async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(badPassword());
    await expect(withColdStartRetry(run, 5_000)).rejects.toMatchObject({ code: 'AUTH_INVALID_CREDENTIALS' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not wait when the server cannot be reached at all', async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(unreachable());
    await expect(withColdStartRetry(run, 5_000)).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', timeout: false });
    expect(run).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives up with the first error when the API never answers', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const first = timedOut();
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(first);
    await expect(withColdStartRetry(run, 50)).rejects.toBe(first);
    expect(run).toHaveBeenCalledTimes(1);
    expect(isApiWaking()).toBe(false);
  });
});

describe('wakeApi', () => {
  it('sends one health probe for concurrent calls (browser only)', async () => {
    expect(await wakeApi()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubGlobal('window', {});
    const [a, b] = await Promise.all([wakeApi(), wakeApi()]);
    expect([a, b]).toEqual([true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
