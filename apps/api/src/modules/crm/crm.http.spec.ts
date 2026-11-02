import { AccountSchema, ContactSchema, DealBoardSchema, DealSchema, gstinCheckChar, LeadConvertResultSchema } from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Contacts, accounts and deals over HTTP (change #19 wave B): validation (phone uniqueness, GSTIN check digit
 * and state), data scope (owner or a visible lead), merge, timeline and notes, the Deals board and moves, lead
 * conversion, permissions and tenant isolation. Run: `pnpm --filter @vistar/api test crm.http`.
 */
const gstin = (state: string, pan: string) => `${state}${pan}1Z${gstinCheckChar(`${state}${pan}1Z`)}`;
let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let b: Awaited<ReturnType<Harness['workspace']>>;
let emp: { userId: string; token: string };
let viewer: { userId: string; token: string };

beforeAll(async () => {
  h = await createHarness('crm');
  a = await h.workspace('a');
  b = await h.workspace('b');
  emp = await h.member(a.workspaceId, 'employee', 'crm-emp');
  viewer = await h.member(a.workspaceId, 'viewer', 'crm-viewer');
}, 90_000);

afterAll(async () => {
  await h?.close();
});

describe('contacts', () => {
  it('creates a contact; a second contact with the same primary phone is a 409', async () => {
    const res = await h.api().post('/api/v1/contacts').set(bearer(a.token)).send({ name: 'Ravi Kumar', phone: '+919812345601', email: 'ravi@example.test', additionalPhones: [{ label: 'work', value: '+912012345678' }] });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(ContactSchema.parse(res.body)).toMatchObject({ name: 'Ravi Kumar', owner: null, additionalPhones: [{ label: 'work', value: '+912012345678' }] });
    const dup = await h.api().post('/api/v1/contacts').set(bearer(a.token)).send({ name: 'Other', phone: '+919812345601' });
    expect(dup.status).toBe(409);
  });

  it('employees see their own contacts and contacts of their leads, not others', async () => {
    const mine = (await h.api().post('/api/v1/contacts').set(bearer(emp.token)).send({ name: 'Mine' })).body;
    expect(mine.owner.id).toBe(emp.userId);
    const adminOwned = (await h.api().post('/api/v1/contacts').set(bearer(a.token)).send({ name: 'Admin only', phone: '+919812345602' })).body;
    expect((await h.api().get(`/api/v1/contacts/${adminOwned.id}`).set(bearer(emp.token))).status).toBe(404);
    // a lead owned by the employee with the same phone links that contact: now visible
    const lead = await h.api().post('/api/v1/leads').set(bearer(emp.token)).send({ name: 'Admin only', phone: '+919812345602' });
    expect(lead.status, JSON.stringify(lead.body)).toBe(201);
    expect(lead.body.contactId).toBe(adminOwned.id);
    expect((await h.api().get(`/api/v1/contacts/${adminOwned.id}`).set(bearer(emp.token))).status).toBe(200);
    const list = await h.api().get('/api/v1/contacts?limit=100').set(bearer(emp.token));
    expect(list.body.items.map((c: { id: string }) => c.id)).toEqual(expect.arrayContaining([mine.id, adminOwned.id]));
  });

  it('viewers can read but not create', async () => {
    expect((await h.api().get('/api/v1/contacts').set(bearer(viewer.token))).status).toBe(200);
    expect((await h.api().post('/api/v1/contacts').set(bearer(viewer.token)).send({ name: 'x' })).status).toBe(403);
  });

  it('merges duplicates: links move, the duplicate is soft-deleted, audit written', async () => {
    const p = (await h.api().post('/api/v1/contacts').set(bearer(a.token)).send({ name: 'Priya Shah', email: 'priya@example.test' })).body;
    const d = (await h.api().post('/api/v1/contacts').set(bearer(a.token)).send({ name: 'Priya S', phone: '+919812345603', email: 'PRIYA@example.test', tags: ['vip'] })).body;
    const dups = await h.api().get(`/api/v1/contacts/${p.id}/duplicates`).set(bearer(a.token));
    expect(dups.body.items.map((c: { id: string }) => c.id)).toContain(d.id);
    const merged = await h.api().post('/api/v1/contacts/merge').set(bearer(a.token)).send({ primaryId: p.id, duplicateIds: [d.id] });
    expect(merged.status, JSON.stringify(merged.body)).toBe(200);
    expect(merged.body).toMatchObject({ name: 'Priya Shah', phone: '+919812345603', tags: ['vip'] });
    expect((await h.api().get(`/api/v1/contacts/${d.id}`).set(bearer(a.token))).status).toBe(404);
    expect(await h.prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: 'contact.merge' } })).toBe(1);
    expect((await h.api().post('/api/v1/contacts/merge').set(bearer(a.token)).send({ primaryId: p.id, duplicateIds: [p.id] })).body.error.code).toBe('RECORD_MERGE_INVALID');
  });

  it('notes appear on the timeline', async () => {
    const c = (await h.api().post('/api/v1/contacts').set(bearer(a.token)).send({ name: 'Timeline person' })).body;
    expect((await h.api().post(`/api/v1/contacts/${c.id}/notes`).set(bearer(a.token)).send({ body: 'Called, wants a demo' })).status).toBe(201);
    const tl = await h.api().get(`/api/v1/contacts/${c.id}/timeline`).set(bearer(a.token));
    expect(tl.body.items[0]).toMatchObject({ kind: 'note', body: 'Called, wants a demo' });
  });

  it('tenant isolation: workspace B cannot read A contacts', async () => {
    const c = (await h.api().post('/api/v1/contacts').set(bearer(a.token)).send({ name: 'Secret' })).body;
    expect((await h.api().get(`/api/v1/contacts/${c.id}`).set(bearer(b.token))).status).toBe(404);
  });
});

describe('accounts', () => {
  it('validates the GSTIN check digit and fills PAN and state code from it', async () => {
    const bad = await h.api().post('/api/v1/accounts').set(bearer(a.token)).send({ name: 'Bad', gstin: '27AABCU9603R1ZX' });
    expect(bad.status).toBe(400);
    const good = await h.api().post('/api/v1/accounts').set(bearer(a.token)).send({ name: 'Good Traders', gstin: gstin('27', 'AABCG1234Q') });
    expect(good.status, JSON.stringify(good.body)).toBe(201);
    expect(AccountSchema.parse(good.body)).toMatchObject({ pan: 'AABCG1234Q', stateCode: '27' });
  });

  it('a billing state other than the GSTIN state is a 422', async () => {
    const res = await h.api().post('/api/v1/accounts').set(bearer(a.token)).send({ name: 'Mismatch', gstin: gstin('27', 'AABCM1234Q'), billingAddress: { line1: '1 Road', city: 'Bengaluru', stateCode: '29' } });
    expect(res.status).toBe(422);
  });
});

describe('deals', () => {
  it('the default deal pipeline exists on first use and deals move along it', async () => {
    const pipes = await h.api().get('/api/v1/pipelines?entity=deal').set(bearer(a.token));
    expect(pipes.status).toBe(200);
    expect(pipes.body.items[0]).toMatchObject({ key: 'deals', entity: 'deal' });
    const leadPipes = await h.api().get('/api/v1/pipelines').set(bearer(a.token));
    expect(leadPipes.body.items.every((p: { entity?: string }) => p.entity !== 'deal')).toBe(true);

    const deal = await h.api().post('/api/v1/deals').set(bearer(a.token)).send({ title: 'Solar for Good Traders', lines: [{ name: 'Panel', hsnSac: '8541', quantity: 10, unitPricePaise: 1_450_000, gstRate: 12 }] });
    expect(deal.status, JSON.stringify(deal.body)).toBe(201);
    const d = DealSchema.parse(deal.body);
    expect(d.valueInr).toBe(145_000);
    expect(d.status).toBe('open');

    const board = DealBoardSchema.parse((await h.api().get('/api/v1/deals/board').set(bearer(a.token))).body);
    const won = board.columns.find((c) => c.stage.type === 'won')!;
    expect(board.columns[0]!.deals.map((x) => x.id)).toContain(d.id);
    const moved = await h.api().post(`/api/v1/deals/${d.id}/move`).set(bearer(a.token)).send({ stageId: won.stage.id });
    expect(moved.body).toMatchObject({ status: 'won', stageId: won.stage.id, probability: 100 });
    expect(moved.body.closedAt).not.toBeNull();
    // a lead stage is not a deal stage
    const leadStage = leadPipes.body.items[0].stages[0].id;
    expect((await h.api().post(`/api/v1/deals/${d.id}/move`).set(bearer(a.token)).send({ stageId: leadStage })).body.error.code).toBe('STAGE_NOT_IN_PIPELINE');
  });

  it('employees only see their own deals', async () => {
    const own = (await h.api().post('/api/v1/deals').set(bearer(emp.token)).send({ title: 'Emp deal', valueInr: 1000 })).body;
    const other = (await h.api().post('/api/v1/deals').set(bearer(a.token)).send({ title: 'Admin deal', valueInr: 1000 })).body;
    const list = await h.api().get('/api/v1/deals?limit=200').set(bearer(emp.token));
    const ids = list.body.items.map((x: { id: string }) => x.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(other.id);
  });
});

describe('lead conversion', () => {
  it('links the contact, creates the account from the company name and a deal', async () => {
    const lead = (await h.api().post('/api/v1/leads').set(bearer(a.token)).send({ name: 'Anil Mehta', companyName: 'Mehta Steels', phone: '+919812345604', valueInr: 250_000, ownerId: a.adminId })).body;
    const res = await h.api().post(`/api/v1/leads/${lead.id}/convert`).set(bearer(a.token)).send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const r = LeadConvertResultSchema.parse(res.body);
    expect(r.contact.id).toBe(lead.contactId);
    expect(r.account?.name).toBe('Mehta Steels');
    expect(r.deal).toMatchObject({ valueInr: 250_000, lead: { id: lead.id } });
    const after = (await h.api().get(`/api/v1/leads/${lead.id}`).set(bearer(a.token))).body;
    expect(after.companyId).toBe(r.account?.id);
    const related = await h.api().get(`/api/v1/accounts/${r.account!.id}/related`).set(bearer(a.token));
    expect(related.body.deals.map((x: { id: string }) => x.id)).toContain(r.deal!.id);
    expect(related.body.contacts.map((x: { id: string }) => x.id)).toContain(r.contact.id);
  });
});
