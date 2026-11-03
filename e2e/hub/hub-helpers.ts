import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '../crm/crm-helpers';

export { API, apiGet, apiSend, apiToken, expect, noMockUse, signIn, stamp, watch } from '../crm/crm-helpers';

/**
 * Helpers of the hub suites (change #19 wave C, HUB-WEB): signed inbound requests, a local receiver
 * for outbound deliveries, and reading the shown-once secret from its dialog.
 */

/** X-Vistar-Signature for a body: HMAC-SHA256 of `${t}.${body}` with the source secret. */
export function sign(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;
}

/** POST a signed JSON body to an inbound source URL. */
export async function sendSigned(request: APIRequestContext, url: string, secret: string, payload: unknown, opts: { idempotencyKey?: string; t?: number } = {}) {
  const body = JSON.stringify(payload);
  return request.post(url, {
    data: body,
    headers: { 'content-type': 'application/json', 'x-vistar-signature': sign(secret, body, opts.t), 'idempotency-key': opts.idempotencyKey ?? randomUUID() },
  });
}

/** The value in the shown-once dialog, then tick "stored" and close it. */
export async function takeShownOnce(page: Page): Promise<string> {
  const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('secret-once-value') });
  await expect(dialog).toBeVisible();
  const value = await dialog.getByTestId('secret-once-value').inputValue();
  expect(value.length).toBeGreaterThan(10);
  await dialog.getByRole('checkbox', { name: 'I have copied and stored it' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toBeHidden();
  return value;
}

export interface Receiver {
  url: string;
  hits: Array<{ headers: IncomingMessage['headers']; body: string; at: number }>;
  /** Status answered from now on. */
  respondWith: (status: number) => void;
  close: () => Promise<void>;
}

/** Local HTTP receiver on 127.0.0.1 (the API's dev allowlist lets outbound webhooks reach localhost). */
export async function startReceiver(initialStatus = 500): Promise<Receiver> {
  let status = initialStatus;
  const hits: Receiver['hits'] = [];
  const server: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      hits.push({ headers: req.headers, body, at: Date.now() });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: status < 300 }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://localhost:${port}/hooks/vistar`,
    hits,
    respondWith: (s) => {
      status = s;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
