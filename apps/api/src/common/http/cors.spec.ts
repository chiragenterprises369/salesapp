import { describe, expect, it } from 'vitest';
import { cached, corsOriginCheck, customDomainHost, isDevOrigin } from './cors.js';

const dev = { NODE_ENV: 'development' as const, DEV_CORS_PORTS: '3000-3010', WEB_ORIGIN: 'http://localhost:3000, https://app.vistar.in/' };
const prod = { ...dev, NODE_ENV: 'production' as const };

const check = (env: typeof dev | typeof prod, origin: string | undefined, hosts: string[] = []) =>
  new Promise<boolean | undefined>((resolve, reject) => corsOriginCheck(env, async () => new Set(hosts))(origin, (err, allow) => (err ? reject(err) : resolve(allow))));

describe('dev CORS origins', () => {
  it('allows localhost, 127.0.0.1 and *.localhost on 3000-3010 over http', () => {
    for (const o of ['http://localhost:3000', 'http://127.0.0.1:3010', 'http://localhost:3005', 'http://acme.localhost:3002', 'http://a.b.localhost:3001']) expect(isDevOrigin(o, dev), o).toBe(true);
  });

  it('refuses other ports, https, other hosts, credentials in the URL and production', () => {
    for (const o of ['http://localhost:3011', 'http://localhost:2999', 'http://localhost', 'https://localhost:3000', 'http://evil.com:3000', 'http://localhost.evil.com:3000', 'http://u:p@localhost:3000', 'null', 'garbage']) {
      expect(isDevOrigin(o, dev), o).toBe(false);
    }
    expect(isDevOrigin('http://localhost:3000', prod)).toBe(false);
  });
});

describe('corsOriginCheck', () => {
  it('allows requests without Origin and the configured WEB_ORIGIN list (trailing slash ignored)', async () => {
    expect(await check(prod, undefined)).toBe(true);
    expect(await check(prod, 'https://app.vistar.in')).toBe(true);
    expect(await check(prod, 'http://localhost:3000')).toBe(true);
    expect(await check(prod, 'http://localhost:3001')).toBe(false);
    expect(await check(dev, 'http://localhost:3001')).toBe(true);
  });

  it('allows verified custom domains only (https in production)', async () => {
    expect(await check(prod, 'https://crm.acme.com', ['crm.acme.com'])).toBe(true);
    expect(await check(prod, 'https://crm.other.com', ['crm.acme.com'])).toBe(false);
    expect(await check(prod, 'http://crm.acme.com', ['crm.acme.com'])).toBe(false);
    expect(await check(dev, 'http://crm.acme.com', ['crm.acme.com'])).toBe(true);
  });

  it('a failing host lookup refuses instead of throwing', async () => {
    const allow = await new Promise<boolean | undefined>((resolve) =>
      corsOriginCheck(prod, async () => {
        throw new Error('db down');
      })('https://crm.acme.com', (_err, a) => resolve(a)),
    );
    expect(allow).toBe(false);
  });

  it('customDomainHost lower-cases and ignores non-http(s) origins', () => {
    expect(customDomainHost('https://CRM.Acme.com', prod)).toBe('crm.acme.com');
    expect(customDomainHost('ftp://crm.acme.com', dev)).toBeNull();
    expect(customDomainHost('nope', dev)).toBeNull();
  });
});

describe('cached', () => {
  it('reuses the value within the TTL and retries after a failure', async () => {
    let calls = 0;
    const get = cached(async () => ++calls, 60_000);
    expect(await get()).toBe(1);
    expect(await get()).toBe(1);
    let fail = true;
    const flaky = cached(async () => {
      if (fail) throw new Error('x');
      return 'ok';
    }, 60_000);
    await expect(flaky()).rejects.toThrow('x');
    fail = false;
    await Promise.resolve();
    expect(await flaky()).toBe('ok');
  });
});
