import { parseSignatureHeader, WEBHOOK_AUTO_DISABLE_AFTER_DEAD, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETRY_DELAYS_SEC, WebhookDeliverySchema } from '@vistar/shared';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';
import { OutboundDispatcher } from './outbound.service.js';

/**
 * Outbound webhooks over HTTP (change #19 wave C): signed deliveries to a local receiver (127.0.0.1 is on the dev
 * allowlist), the retry schedule with a faked clock (Date only; the dispatcher is paused so nothing runs in the
 * background and processDue() drives every attempt), dead-letter after the last attempt, auto-disable after
 * WEBHOOK_AUTO_DISABLE_AFTER_DEAD dead deliveries with an admin notification, replay, test send and the SSRF guard.
 * Written by HUB-API, run by Kiro Crew: `pnpm --filter @vistar/api test outbound-webhooks.http`.
 */
let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let dispatcher: OutboundDispatcher;
let server: http.Server;
let url = '';
const received: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
let replyStatus = 500;

const until = async <T>(fn: () => Promise<T | null | undefined>, ms = 10_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
};

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.writeHead(replyStatus, { 'content-type': 'application/json' }).end(replyStatus < 300 ? '{"ok":true}' : '{"error":"down"}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  h = await createHarness('hookout');
  a = await h.workspace('a');
  dispatcher = h.app.get(OutboundDispatcher);
  dispatcher.setPaused(true);
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await h?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

async function subscribe(name: string) {
  const res = await h.api().post('/api/v1/webhooks/endpoints/outbound').set(bearer(a.token)).send({ name, url, events: ['lead.created'] });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id as string, secret: res.body.secret as string };
}

async function leadDelivery(endpointId: string, name: string) {
  const lead = await h.api().post('/api/v1/leads').set(bearer(a.token)).send({ name });
  expect(lead.status).toBe(201);
  return until(() => h.prisma.webhookDelivery.findFirst({ where: { endpointId, event: 'lead.created', requestBody: { path: ['payload', 'lead', 'id'], equals: lead.body.id as string } } }));
}

describe('SSRF guard', () => {
  it('refuses private and link-local targets', async () => {
    for (const target of ['https://10.0.0.5/hook', 'https://169.254.169.254/latest/meta-data', 'https://[fd00::1]/x', 'https://192.168.1.10/hook']) {
      const res = await h.api().post('/api/v1/webhooks/endpoints/outbound').set(bearer(a.token)).send({ name: 'bad', url: target, events: ['lead.created'] });
      expect(res.status, target).toBe(422);
      expect(res.body.error.code).toBe('WEBHOOK_URL_BLOCKED');
    }
    expect((await h.api().post('/api/v1/webhooks/endpoints/outbound').set(bearer(a.token)).send({ name: 'bad', url: 'http://erp.example.in/hook', events: ['lead.created'] })).status).toBe(400);
  });
});

describe('delivery, retries and dead-letter', () => {
  it('signs the envelope; failures retry on the WEBHOOK_RETRY_DELAYS_SEC schedule, then dead', async () => {
    const ep = await subscribe('ERP down');
    const d0 = await leadDelivery(ep.id, 'Retry Lead');
    expect(d0.status).toBe('pending');
    replyStatus = 500;
    received.length = 0;
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);
    let offset = 0;
    for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
      expect(await dispatcher.processDue({ workspaceId: a.workspaceId })).toBeGreaterThanOrEqual(1);
      const row = await h.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d0.id } });
      expect(row.attempt).toBe(attempt);
      if (attempt < WEBHOOK_MAX_ATTEMPTS) {
        expect(row.status).toBe('failed');
        expect(row.nextAttemptAt!.getTime() - (start + offset * 1000)).toBe(WEBHOOK_RETRY_DELAYS_SEC[attempt - 1]! * 1000);
        // not due one second early
        vi.setSystemTime(start + (offset + WEBHOOK_RETRY_DELAYS_SEC[attempt - 1]! - 2) * 1000);
        expect(await dispatcher.processDue({ workspaceId: a.workspaceId })).toBe(0);
        offset += WEBHOOK_RETRY_DELAYS_SEC[attempt - 1]!;
        vi.setSystemTime(start + offset * 1000);
      } else {
        expect(row.status).toBe('dead');
        expect(row.nextAttemptAt).toBeNull();
      }
    }
    vi.useRealTimers();
    expect(received).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    const first = received[0]!;
    const sig = parseSignatureHeader(first.headers['x-vistar-signature'] as string)!;
    expect(sig.signatures[0]).toBe(createHmac('sha256', ep.secret).update(`${sig.timestamp}.${first.body}`).digest('hex'));
    const envelope = JSON.parse(first.body) as { type: string; workspaceId: string; payload: { lead: { name: string } } };
    expect(envelope).toMatchObject({ type: 'lead.created', workspaceId: a.workspaceId, payload: { lead: { name: 'Retry Lead' } } });
    expect(first.headers['x-vistar-event']).toBe('lead.created');
    expect(first.headers['x-vistar-delivery']).toBe(d0.id);
    const dto = WebhookDeliverySchema.parse((await h.api().get(`/api/v1/webhooks/deliveries/${d0.id}`).set(bearer(a.token))).body);
    expect(dto.attempts).toHaveLength(WEBHOOK_MAX_ATTEMPTS);
    expect(dto.attempts.every((x) => !x.ok && x.responseStatus === 500)).toBe(true);
    expect(dto.requestHeaders['x-vistar-signature']).toBe('[redacted]');

    // replay after the receiver is fixed: new delivery, success, replayOfId set
    replyStatus = 200;
    const replay = await h.api().post(`/api/v1/webhooks/deliveries/${d0.id}/replay`).set(bearer(a.token));
    expect(replay.status, JSON.stringify(replay.body)).toBe(201);
    expect(replay.body).toMatchObject({ status: 'success', replayOfId: d0.id, attempt: 1 });
    expect(received.at(-1)!.headers['x-vistar-delivery']).toBe(replay.body.id);
  });

  it(`switches the endpoint off after ${WEBHOOK_AUTO_DISABLE_AFTER_DEAD} dead deliveries in a row and notifies the admin`, async () => {
    const ep = await subscribe('Flaky receiver');
    replyStatus = 503;
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    let clock = start;
    vi.setSystemTime(clock);
    for (let n = 0; n < WEBHOOK_AUTO_DISABLE_AFTER_DEAD; n++) {
      vi.useRealTimers();
      const d = await leadDelivery(ep.id, `Dead ${n}`);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(clock);
      for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt++) {
        await dispatcher.processDue({ workspaceId: a.workspaceId });
        const row = await h.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
        if (row.nextAttemptAt) {
          clock = row.nextAttemptAt.getTime();
          vi.setSystemTime(clock);
        }
      }
      expect((await h.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } })).status).toBe('dead');
    }
    vi.useRealTimers();
    const endpoint = await h.api().get(`/api/v1/webhooks/endpoints/${ep.id}`).set(bearer(a.token));
    expect(endpoint.body).toMatchObject({ isActive: false, deadStreak: WEBHOOK_AUTO_DISABLE_AFTER_DEAD });
    expect(endpoint.body.disabledAt).toBeTruthy();
    const note = await h.prisma.notification.findFirst({ where: { workspaceId: a.workspaceId, userId: a.adminId, type: 'system', data: { path: ['kind'], equals: 'webhook_disabled' } } });
    expect(note?.title).toContain('Flaky receiver');
    // switching it on again resets the counters
    const on = await h.api().patch(`/api/v1/webhooks/endpoints/${ep.id}`).set(bearer(a.token)).send({ isActive: true });
    expect(on.body).toMatchObject({ isActive: true, deadStreak: 0, consecutiveFailures: 0, disabledAt: null });
  });

  it('test send: one attempt, no retries, delivery in the log', async () => {
    const ep = await subscribe('Test target');
    replyStatus = 200;
    const res = await h.api().post(`/api/v1/webhooks/endpoints/${ep.id}/test`).set(bearer(a.token)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({ status: 'success', event: 'webhook.test', maxAttempts: 1 });
    replyStatus = 500;
    const failed = await h.api().post(`/api/v1/webhooks/endpoints/${ep.id}/test`).set(bearer(a.token)).send({ event: 'lead.created' });
    expect(failed.body).toMatchObject({ status: 'failed', nextAttemptAt: null, attempt: 1 });
  });

  it('a deleted endpoint stops its pending deliveries', async () => {
    const ep = await subscribe('Deleted soon');
    const d = await leadDelivery(ep.id, 'Orphan Lead');
    expect((await h.api().delete(`/api/v1/webhooks/endpoints/${ep.id}`).set(bearer(a.token))).status).toBe(200);
    const row = await h.prisma.webhookDelivery.findUniqueOrThrow({ where: { id: d.id } });
    expect(row).toMatchObject({ status: 'failed', nextAttemptAt: null, error: 'Endpoint deleted' });
  });
});
