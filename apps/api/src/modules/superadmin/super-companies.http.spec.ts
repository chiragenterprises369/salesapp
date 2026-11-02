import { CompanyCreatedSchema, CompanySchema, GENERIC_SALES_PACK_KEY, pageOf } from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Super Admin companies over HTTP (SPEC 29.4, 29.6): list (search, filters, cursor), detail with effective flags,
 * create with an admin invite link (dev) that really works, switches custom_domain / field_tracking with audit,
 * permissions (403 per platform permission, 401 for workspace tokens), 404 and 409.
 */

let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let manager = '';
let reader = '';
let flagger = '';
let createdId = '';
let inviteUrl = '';
const CompanyPage = pageOf(CompanySchema);

beforeAll(async () => {
  h = await createHarness('sco');
  a = await h.workspace('a');
  manager = (await h.superAdmin(['platform.companies.read', 'platform.companies.manage'], 'manager')).token;
  reader = (await h.superAdmin(['platform.companies.read'], 'reader')).token;
  flagger = (await h.superAdmin(['platform.companies.read', 'platform.flags.manage'], 'flagger')).token;
}, 90_000);

afterAll(async () => {
  await h?.close();
});

describe('list and detail', () => {
  it('search finds the company with usage, flags and owner; workspace tokens are 401', async () => {
    const res = await h.api().get('/api/super/companies').query({ q: `test-sco-a-${h.sfx}` }).set(bearer(reader));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const page = CompanyPage.parse(res.body);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      id: a.workspaceId,
      plan: 'free',
      status: 'trial',
      ownerEmail: `test-sco-a-${h.sfx}@example.test`,
      userCount: 1,
      customDomain: null,
      flagOverrides: {},
      floor: { requestStatus: null, publishedVersion: null },
      features: { custom_domain: false, field_tracking: false },
    });
    expect((await h.api().get('/api/super/companies').set(bearer(a.token))).status).toBe(401);
    expect((await h.api().get('/api/super/companies').query({ status: 'nope' }).set(bearer(reader))).status).toBe(400);
  });

  it('cursor pagination walks the list without repeats', async () => {
    const first = CompanyPage.parse((await h.api().get('/api/super/companies').query({ limit: 1 }).set(bearer(reader))).body);
    expect(first.items).toHaveLength(1);
    if (first.nextCursor) {
      const second = CompanyPage.parse((await h.api().get('/api/super/companies').query({ limit: 1, cursor: first.nextCursor }).set(bearer(reader))).body);
      expect(second.items[0]?.id).not.toBe(first.items[0]!.id);
    }
    expect((await h.api().get('/api/super/companies').query({ cursor: 'garbage' }).set(bearer(reader))).status).toBe(400);
  });

  it('detail: 200, 404 for an unknown id, 400 for a bad id', async () => {
    const res = await h.api().get(`/api/super/companies/${a.workspaceId}`).set(bearer(reader));
    expect(res.status).toBe(200);
    expect(CompanySchema.parse(res.body).slug).toBe(a.slug);
    expect((await h.api().get('/api/super/companies/00000000-0000-7000-8000-000000000000').set(bearer(reader))).status).toBe(404);
    expect((await h.api().get('/api/super/companies/123').set(bearer(reader))).status).toBe(400);
  });
});

describe('create company', () => {
  const body = () => ({ name: `test-sco-new-${h.sfx}`, plan: 'growth', adminName: 'New Admin', adminEmail: `TEST-SCO-NEW-${h.sfx}@example.test`, trialDays: 0 });

  it('403 without platform.companies.manage; 400 for bad bodies', async () => {
    expect((await h.api().post('/api/super/companies').set(bearer(reader)).send(body())).status).toBe(403);
    expect((await h.api().post('/api/super/companies').set(bearer(manager)).send({ ...body(), plan: 'gold' })).status).toBe(400);
    expect((await h.api().post('/api/super/companies').set(bearer(manager)).send({ ...body(), adminEmail: 'nope' })).status).toBe(400);
    expect((await h.api().post('/api/super/companies').set(bearer(manager)).send({ ...body(), timezone: 'Mars/Olympus' })).status).toBe(400);
    expect(await h.prisma.workspace.count({ where: { slug: { startsWith: `test-sco-new-${h.sfx}` } } })).toBe(0);
  });

  it('201: active growth company with roles, pipeline, core pack, no users yet, and a dev invite link', async () => {
    const res = await h.api().post('/api/super/companies').set(bearer(manager)).send(body());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const c = CompanyCreatedSchema.parse(res.body);
    createdId = c.id;
    h.track(createdId);
    expect(c).toMatchObject({ plan: 'growth', status: 'active', trialEndsAt: null, userCount: 0, ownerEmail: `test-sco-new-${h.sfx}@example.test`, features: { field_tracking: true, custom_domain: false } });
    expect(c.adminInvite).toMatchObject({ email: `test-sco-new-${h.sfx}@example.test`, emailed: false });
    expect(c.adminInvite.url).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);
    inviteUrl = c.adminInvite.url!;

    const [roles, pipelines, pack] = await Promise.all([
      h.prisma.role.count({ where: { workspaceId: createdId, isSystem: true } }),
      h.prisma.pipeline.count({ where: { workspaceId: createdId, isDefault: true } }),
      h.prisma.workspacePack.findFirst({ where: { workspaceId: createdId, packKey: GENERIC_SALES_PACK_KEY } }),
    ]);
    expect(roles).toBe(4);
    expect(pipelines).toBe(1);
    expect(pack?.status).toBe('active');
    expect(await h.prisma.platformAuditLog.count({ where: { action: 'company.create', workspaceId: createdId } })).toBe(1);
    expect(await h.prisma.auditLog.count({ where: { workspaceId: createdId, action: 'company.create', actorType: 'super_admin' } })).toBe(1);
  });

  it('the invite link signs the company admin in', async () => {
    const token = inviteUrl.split('/').pop()!;
    const lookup = await h.api().get('/api/v1/invites/lookup').query({ token });
    expect(lookup.status, JSON.stringify(lookup.body)).toBe(200);
    expect(lookup.body).toMatchObject({ workspaceName: `test-sco-new-${h.sfx}`, email: `test-sco-new-${h.sfx}@example.test`, roleName: 'Company admin' });
    const accept = await h.api().post('/api/v1/auth/invite/accept').send({ token, name: 'New Admin', password: h.password });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    const me = await h.api().get('/api/v1/auth/me').set(bearer(accept.body.accessToken));
    expect(me.body.role.kind).toBe('company_admin');
    const detail = await h.api().get(`/api/super/companies/${createdId}`).set(bearer(reader));
    expect(detail.body).toMatchObject({ userCount: 1, ownerEmail: `test-sco-new-${h.sfx}@example.test` });
  });

  it('409 when the admin email already has an account', async () => {
    const res = await h.api().post('/api/super/companies').set(bearer(manager)).send({ ...body(), name: `test-sco-dup-${h.sfx}`, adminEmail: `test-sco-a-${h.sfx}@example.test` });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUTH_EMAIL_TAKEN');
    expect(await h.prisma.workspace.count({ where: { slug: { startsWith: `test-sco-dup-${h.sfx}` } } })).toBe(0);
  });
});

describe('switches (PUT /api/super/companies/{id}/flags)', () => {
  it('needs platform.flags.manage (403)', async () => {
    expect((await h.api().put(`/api/super/companies/${a.workspaceId}/flags`).set(bearer(manager)).send({ overrides: { custom_domain: true } })).status).toBe(403);
  });

  it('on, unchanged (no audit), null back to the plan; field_tracking too; unknown flags are 400', async () => {
    const on = await h.api().put(`/api/super/companies/${a.workspaceId}/flags`).set(bearer(flagger)).send({ overrides: { custom_domain: true, field_tracking: true } });
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    expect(on.body).toMatchObject({ flagOverrides: { custom_domain: true, field_tracking: true }, features: { custom_domain: true, field_tracking: true } });
    const me = await h.api().get('/api/v1/auth/me').set(bearer(a.token));
    expect(me.body.workspace.features).toMatchObject({ custom_domain: true, field_tracking: true });

    const audits = () => h.prisma.platformAuditLog.count({ where: { action: 'company.flags', workspaceId: a.workspaceId } });
    expect(await audits()).toBe(1);
    await h.api().put(`/api/super/companies/${a.workspaceId}/flags`).set(bearer(flagger)).send({ overrides: { custom_domain: true } });
    expect(await audits()).toBe(1);

    const off = await h.api().put(`/api/super/companies/${a.workspaceId}/flags`).set(bearer(flagger)).send({ overrides: { custom_domain: null, field_tracking: false } });
    expect(off.body).toMatchObject({ flagOverrides: { field_tracking: false }, features: { custom_domain: false, field_tracking: false } });
    expect(off.body.flagOverrides.custom_domain).toBeUndefined();
    expect(await audits()).toBe(2);
    expect(await h.prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: 'company.flags' } })).toBe(2);

    expect((await h.api().put(`/api/super/companies/${a.workspaceId}/flags`).set(bearer(flagger)).send({ overrides: { warp_drive: true } })).status).toBe(400);
    expect((await h.api().put('/api/super/companies/00000000-0000-7000-8000-000000000000/flags').set(bearer(flagger)).send({ overrides: { custom_domain: true } })).status).toBe(404);
  });
});
