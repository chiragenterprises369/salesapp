import { RoutingDecisionSchema, RoutingRuleSchema } from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Lead routing over HTTP (change #19 wave B): round-robin fairness (sequential and concurrent), least busy,
 * conditions, fallback owner, the dry-run test panel, permissions. Rules here ignore working hours and
 * availability so the result does not depend on the time of day. Run: `pnpm --filter @vistar/api test routing.http`.
 */
let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
const reps: Array<{ userId: string; token: string }> = [];
let senior: { userId: string; token: string };

beforeAll(async () => {
  h = await createHarness('route');
  a = await h.workspace('a');
  for (const n of [1, 2, 3]) reps.push(await h.member(a.workspaceId, 'employee', `rep${n}`));
  senior = await h.member(a.workspaceId, 'manager', 'senior');
}, 90_000);

afterAll(async () => {
  await h?.close();
});

const rule = (o: Record<string, unknown>) => ({ respectWorkingHours: false, respectAvailability: false, ...o });
const newLead = (o: Record<string, unknown> = {}) => h.api().post('/api/v1/leads').set(bearer(a.token)).send({ name: `Lead ${Math.random().toString(36).slice(2, 8)}`, source: 'indiamart', ...o });

describe('lead routing', () => {
  let rrId = '';

  it('only routing.manage can manage rules', async () => {
    expect((await h.api().get('/api/v1/routing-rules').set(bearer(reps[0]!.token))).status).toBe(403);
  });

  it('creates rules in priority order', async () => {
    const big = await h.api().post('/api/v1/routing-rules').set(bearer(a.token)).send(rule({ name: 'Big deals', strategy: 'least_busy', conditions: { minValueInr: 1_000_000 }, userIds: [senior.userId] }));
    const rr = await h.api().post('/api/v1/routing-rules').set(bearer(a.token)).send(rule({ name: 'IndiaMART round robin', conditions: { sources: ['indiamart'] }, userIds: reps.map((r) => r.userId), fallbackOwnerId: a.adminId }));
    expect(big.status, JSON.stringify(big.body)).toBe(201);
    expect(rr.status, JSON.stringify(rr.body)).toBe(201);
    expect(RoutingRuleSchema.parse(big.body).priority).toBe(0);
    expect(RoutingRuleSchema.parse(rr.body).priority).toBe(1);
    rrId = rr.body.id;
  });

  it('round robin is fair: 9 leads -> 3 each, in pool order', async () => {
    const owners: string[] = [];
    for (let i = 0; i < 9; i++) {
      const res = await newLead();
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      owners.push(res.body.owner.id);
    }
    for (const r of reps) expect(owners.filter((o) => o === r.userId)).toHaveLength(3);
    // a full cycle before anyone repeats
    expect(new Set(owners.slice(0, 3)).size).toBe(3);
    expect(owners.slice(3, 6)).toEqual(owners.slice(0, 3));
    const timeline = await h.api().get(`/api/v1/leads/${(await newLead()).body.id}/timeline`).set(bearer(a.token));
    expect(timeline.body.items.find((x: { type: string }) => x.type === 'assigned').payload.rule).toBe('round_robin');
  });

  it('stays fair under concurrent creates (row lock on the cursor)', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => newLead()));
    const owners = results.map((r) => r.body.owner.id as string);
    for (const r of reps) expect(owners.filter((o) => o === r.userId)).toHaveLength(2);
  });

  it('the first matching rule wins (value condition before source)', async () => {
    const res = await newLead({ valueInr: 2_000_000 });
    expect(res.body.owner.id).toBe(senior.userId);
  });

  it('no eligible user -> fallback owner', async () => {
    await h.api().patch(`/api/v1/routing-rules/${rrId}`).set(bearer(a.token)).send({ requireOnline: true });
    const res = await newLead();
    expect(res.body.owner.id).toBe(a.adminId);
    await h.api().patch(`/api/v1/routing-rules/${rrId}`).set(bearer(a.token)).send({ requireOnline: false });
  });

  it('employees creating their own leads are not routed; an explicit owner is kept', async () => {
    const own = await h.api().post('/api/v1/leads').set(bearer(reps[0]!.token)).send({ name: 'Self', source: 'indiamart' });
    expect(own.body.owner.id).toBe(reps[0]!.userId);
    const explicit = await newLead({ ownerId: reps[2]!.userId });
    expect(explicit.body.owner.id).toBe(reps[2]!.userId);
  });

  it('the test panel is a dry run (the cursor does not move)', async () => {
    const before = (await h.prisma.routingRule.findUniqueOrThrow({ where: { id: rrId } })).lastAssignedUserId;
    const res = await h.api().post('/api/v1/routing-rules/test').set(bearer(a.token)).send({ lead: { source: 'indiamart', city: 'Pune' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const d = RoutingDecisionSchema.parse(res.body);
    expect(d.outcome).toBe('rule');
    expect(d.rule?.id).toBe(rrId);
    expect(d.rules.find((r) => r.name === 'Big deals')).toMatchObject({ matched: false });
    expect(d.candidates).toHaveLength(3);
    expect((await h.prisma.routingRule.findUniqueOrThrow({ where: { id: rrId } })).lastAssignedUserId).toBe(before);
    const none = RoutingDecisionSchema.parse((await h.api().post('/api/v1/routing-rules/test').set(bearer(a.token)).send({ lead: { source: 'manual' } })).body);
    expect(none.outcome).toBe('no_rule');
  });

  it('reorders rules', async () => {
    const list = (await h.api().get('/api/v1/routing-rules').set(bearer(a.token))).body.items as Array<{ id: string }>;
    const res = await h.api().put('/api/v1/routing-rules/order').set(bearer(a.token)).send({ ids: list.map((r) => r.id).reverse() });
    expect(res.body.items[0].id).toBe(list.at(-1)!.id);
  });
});
