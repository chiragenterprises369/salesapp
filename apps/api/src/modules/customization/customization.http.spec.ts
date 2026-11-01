import 'reflect-metadata';
import { type INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CustomObjectSchema, CustomRecordSchema, MeResponseSchema, PackManifestSchema, PackRuntimeSchema, SuperPackSchema, type CustomRecord } from '@vistar/shared';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { AppExceptionFilter } from '../../common/errors/exception.filter.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { encryptSecret } from '../../infra/crypto/secrets.js';
import { generateTotpSecret, totpCode } from '../../infra/crypto/totp.js';
import { hashPassword } from '../auth/password.js';
import { WorkspaceProvisioner } from '../auth/workspace-provisioner.js';
import { registerManifest } from '../packs/pack-registry.js';
import { deleteTestWorkspace, newTestPrisma, testSuffix } from '../packs/testing.js';

/**
 * HTTP-level checks against the full app (dev DB + Redis), using two TEMP workspaces (test-http-*):
 * RBAC on field definitions, 422 value validation, unique values, data scope and tenant isolation of records.
 */

const sfx = testSuffix();
const PASSWORD = `pw-${sfx}-Vistar!`;
const emails = { adminA: `test-http-a-${sfx}@example.test`, employeeA: `test-http-e-${sfx}@example.test`, adminB: `test-http-b-${sfx}@example.test` };
const SUPER_EMAIL = `test-super-${sfx}@example.test`;
/** Non-core fixture pack registered for this run (removed afterwards). */
const HFX = `test-hfx-${sfx}`;

let app: INestApplication;
let prisma: PrismaClient;
const workspaceIds: string[] = [];
const tokens: Record<keyof typeof emails, string> = { adminA: '', employeeA: '', adminB: '' };
let superToken = '';
let superAdminId = '';

const api = () => request(app.getHttpServer());
const auth = (who: keyof typeof emails) => ({ Authorization: `Bearer ${tokens[who]}` });

const SUPPLIER = {
  key: 'supplier',
  labelSingular: 'Supplier',
  labelPlural: 'Suppliers',
  primaryFieldKey: 'name',
  fields: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'gstin', label: 'GSTIN', type: 'text', unique: true },
    { key: 'rating', label: 'Rating', type: 'number', config: { min: 1, max: 5 } },
  ],
};

async function login(email: string): Promise<string> {
  const res = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

beforeAll(async () => {
  prisma = newTestPrisma();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: ['error'] });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AppExceptionFilter());
  await app.init();

  const provisioner = app.get(WorkspaceProvisioner);
  const passwordHash = await hashPassword(PASSWORD);
  const a = await provisioner.provision({ ownerName: 'Admin A', email: emails.adminA, passwordHash, googleSub: null, workspaceName: `test-http-a-${sfx}`, timezone: 'Asia/Kolkata' });
  const b = await provisioner.provision({ ownerName: 'Admin B', email: emails.adminB, passwordHash, googleSub: null, workspaceName: `test-http-b-${sfx}`, timezone: 'Asia/Kolkata' });
  workspaceIds.push(a.workspaceId, b.workspaceId);
  const employeeRole = await prisma.role.findFirstOrThrow({ where: { workspaceId: a.workspaceId, key: 'employee' } });
  await prisma.user.create({ data: { workspaceId: a.workspaceId, email: emails.employeeA, passwordHash, name: 'Employee A', roleId: employeeRole.id } });

  tokens.adminA = await login(emails.adminA);
  tokens.employeeA = await login(emails.employeeA);
  tokens.adminB = await login(emails.adminB);

  await registerManifest(
    prisma,
    PackManifestSchema.parse({
      schemaVersion: 1,
      key: HFX,
      name: 'HTTP fixture',
      version: '1.0.0',
      description: 'HTTP test fixture (not a real pack)',
      industry: 'Test',
      objects: [{ key: 'unit', labelSingular: 'Unit', labelPlural: 'Units', primaryFieldKey: 'code', showInNav: true, fields: [{ key: 'code', label: 'Code', type: 'text', required: true }] }],
      navigation: [{ id: 'units', label: 'Units', icon: 'Building2', page: 'units', group: 'work', component: `${HFX}.UnitsPage`, anyOf: ['settings.manage'] }],
    }),
  );
  // Temp Super Admin with an enrolled TOTP secret (the seeded Super Admin is never touched).
  const secret = generateTotpSecret();
  superAdminId = (
    await prisma.platformAdmin.create({
      data: { email: SUPER_EMAIL, name: 'Test super admin', passwordHash, permissions: ['platform.packs.manage'], totpSecretEncrypted: encryptSecret(secret), mfaEnabledAt: new Date() },
    })
  ).id;
  const challenge = await api().post('/api/super/auth/login').send({ email: SUPER_EMAIL, password: PASSWORD });
  const verified = await api().post('/api/super/auth/verify').send({ challengeToken: challenge.body.challengeToken, code: totpCode(secret) });
  expect(verified.status, JSON.stringify(verified.body)).toBe(200);
  superToken = verified.body.accessToken as string;
}, 60_000);

afterAll(async () => {
  await app?.close();
  for (const id of workspaceIds) await deleteTestWorkspace(prisma, id);
  if (prisma) {
    await prisma.packDefinition.deleteMany({ where: { key: HFX } });
    if (superAdminId) {
      await prisma.platformAuditLog.deleteMany({ where: { adminId: superAdminId } });
      await prisma.platformAdmin.deleteMany({ where: { id: superAdminId } });
    }
    await prisma.$disconnect();
  }
});

describe('field definitions', () => {
  it('lists the generic-sales lead fields for a new workspace', async () => {
    const res = await api().get('/api/v1/fields?target=lead').set(auth('adminA'));
    expect(res.status).toBe(200);
    expect(res.body.items.map((f: { key: string }) => f.key)).toEqual(['gst_number', 'quantity', 'preferred_language', 'delivery_by']);
  });

  it('employees cannot create fields (403)', async () => {
    const res = await api()
      .post('/api/v1/fields')
      .set(auth('employeeA'))
      .send({ target: 'lead', field: { key: 'source_detail', label: 'Source detail', type: 'text' } });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects a reused key (FIELD_KEY_TAKEN)', async () => {
    const res = await api()
      .post('/api/v1/fields')
      .set(auth('adminA'))
      .send({ target: 'lead', field: { key: 'gst_number', label: 'GST again', type: 'text' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FIELD_KEY_TAKEN');
  });

  it('validates lead custom values with 422 and field paths', async () => {
    const res = await api()
      .post('/api/v1/leads')
      .set(auth('adminA'))
      .send({ name: 'Bad GST lead', customFields: { gst_number: 'not-a-gstin', nope: 1 } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual(['customFields.gst_number', 'customFields.nope']);
  });
});

describe('custom objects and records', () => {
  let record: CustomRecord;

  it('creates an object with its fields in one request', async () => {
    const res = await api().post('/api/v1/objects').set(auth('adminA')).send(SUPPLIER);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(CustomObjectSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.fields.map((f: { key: string }) => f.key)).toEqual(['name', 'gstin', 'rating']);
  });

  it('rejects an invalid value with 422 and details[0].path values.<key>', async () => {
    const res = await api()
      .post('/api/v1/objects/supplier/records')
      .set(auth('adminA'))
      .send({ values: { name: 'Acme Metals', rating: 'excellent' } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].path).toBe('values.rating');
  });

  it('creates a record (title = primary field) and enforces unique values', async () => {
    const res = await api()
      .post('/api/v1/objects/supplier/records')
      .set(auth('adminA'))
      .send({ values: { name: 'Acme Metals', gstin: '24ABCDE1234F1Z5', rating: 4 } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(CustomRecordSchema.safeParse(res.body).success).toBe(true);
    record = res.body;
    expect(record.title).toBe('Acme Metals');

    const dup = await api()
      .post('/api/v1/objects/supplier/records')
      .set(auth('adminA'))
      .send({ values: { name: 'Acme Copy', gstin: '24ABCDE1234F1Z5' } });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('FIELD_VALUE_NOT_UNIQUE');
    expect(dup.body.error.details[0].path).toBe('values.gstin');
  });

  it('applies the optimistic version check', async () => {
    const ok = await api().patch(`/api/v1/objects/supplier/records/${record.id}`).set(auth('adminA')).send({ values: { rating: 5 }, expectedVersion: record.version });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(record.version + 1);
    const stale = await api().patch(`/api/v1/objects/supplier/records/${record.id}`).set(auth('adminA')).send({ values: { rating: 3 }, expectedVersion: record.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('data scope: an employee does not see a record owned by the admin', async () => {
    const res = await api().get(`/api/v1/objects/supplier/records/${record.id}`).set(auth('employeeA'));
    expect(res.status).toBe(404);
    const list = await api().get('/api/v1/objects/supplier/records').set(auth('employeeA'));
    expect(list.status).toBe(200);
    expect(list.body.items).toEqual([]);
  });

  it('tenant isolation: workspace B cannot read workspace A records by id (404)', async () => {
    const created = await api().post('/api/v1/objects').set(auth('adminB')).send(SUPPLIER);
    expect(created.status).toBe(201);
    const res = await api().get(`/api/v1/objects/supplier/records/${record.id}`).set(auth('adminB'));
    expect(res.status).toBe(404);
    const list = await api().get('/api/v1/objects/supplier/records').set(auth('adminB'));
    expect(list.body.items).toEqual([]);
  });
});

describe('labels and pack runtime', () => {
  it('label overrides show up in /auth/me and the runtime parses', async () => {
    const put = await api()
      .put('/api/v1/labels')
      .set(auth('adminA'))
      .send({ overrides: { lead: { singular: 'Enquiry', plural: 'Enquiries' } } });
    expect(put.status).toBe(200);
    const me = await api().get('/api/v1/auth/me').set(auth('adminA'));
    expect(MeResponseSchema.safeParse(me.body).success).toBe(true);
    expect(me.body.labels.lead).toEqual({ singular: 'Enquiry', plural: 'Enquiries' });
    expect(me.body.packs).toEqual([{ key: 'generic-sales', version: '1.0.0', modes: [] }]);
    const rt = await api().get('/api/v1/packs/runtime').set(auth('employeeA'));
    expect(rt.status).toBe(200);
    expect(PackRuntimeSchema.safeParse(rt.body).success).toBe(true);
    expect(rt.body.importMappings.map((m: { key: string }) => m.key)).toEqual(['indiamart_csv']);
  });
});

describe('Industry Packs: entitlement, install and the Super Admin registry', () => {
  const wsA = () => workspaceIds[0]!;
  const superAuth = () => ({ Authorization: `Bearer ${superToken}` });

  it('a non-core pack is locked on the free plan; install is refused (PACK_NOT_ENTITLED)', async () => {
    const list = await api().get('/api/v1/packs').set(auth('adminA'));
    expect(list.status).toBe(200);
    expect(list.body.items.find((p: { key: string }) => p.key === HFX)).toMatchObject({ status: 'locked', entitlement: 'none' });
    const res = await api().post(`/api/v1/packs/${HFX}/install`).set(auth('adminA')).send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PACK_NOT_ENTITLED');
  });

  it('Super Admin registry: lists packs, core plans are locked, workspace tokens are rejected', async () => {
    const list = await api().get('/api/super/packs').set(superAuth());
    expect(list.status).toBe(200);
    const core = list.body.items.find((p: { key: string }) => p.key === 'generic-sales');
    expect(SuperPackSchema.safeParse(core).success).toBe(true);
    expect(core.plans).toEqual(['free', 'starter', 'growth', 'enterprise']);
    const locked = await api().put('/api/super/packs/generic-sales/plans').set(superAuth()).send({ plans: ['growth'] });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('PACK_CORE_LOCKED');
    expect((await api().get('/api/super/packs').set(auth('adminA'))).status).toBe(401);
  });

  it('grant for one company (reason required, audited in both logs), then the company admin installs it', async () => {
    const noReason = await api().put(`/api/super/packs/${HFX}/companies/${wsA()}`).set(superAuth()).send({ override: 'grant' });
    expect(noReason.status).toBe(400);
    const grant = await api().put(`/api/super/packs/${HFX}/companies/${wsA()}`).set(superAuth()).send({ override: 'grant', reason: 'Pilot for the HTTP test' });
    expect(grant.status, JSON.stringify(grant.body)).toBe(200);
    expect(grant.body).toMatchObject({ entitlement: 'grant', status: 'not_installed' });
    expect(await prisma.platformAuditLog.count({ where: { adminId: superAdminId, action: 'pack.entitlement', workspaceId: wsA() } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { workspaceId: wsA(), action: 'pack.entitlement', actorType: 'super_admin' } })).toBe(1);

    const plan = await api().get(`/api/v1/packs/${HFX}/plan?action=install`).set(auth('adminA'));
    expect(plan.body).toMatchObject({ noop: false, summary: { 'object.create': 1, 'field.create': 1 } });
    const install = await api().post(`/api/v1/packs/${HFX}/install`).set(auth('adminA')).send({});
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body).toMatchObject({ noop: false, pack: { status: 'active', entitlement: 'grant', installedVersion: '1.0.0' } });
    const again = await api().post(`/api/v1/packs/${HFX}/install`).set(auth('adminA')).send({});
    expect(again.body.noop).toBe(true);

    const rt = await api().get('/api/v1/packs/runtime').set(auth('adminA'));
    expect(rt.body.navigation.map((n: { id: string }) => n.id)).toEqual(['units']);
    expect(rt.body.objects.map((o: { key: string; packKey: string | null }) => `${o.key}:${o.packKey}`)).toEqual(['supplier:null', `unit:${HFX}`]);
    // Permission-filtered navigation: employees lack settings.manage.
    const rtEmployee = await api().get('/api/v1/packs/runtime').set(auth('employeeA'));
    expect(rtEmployee.body.navigation).toEqual([]);
    const log = await api().get(`/api/v1/packs/${HFX}/log`).set(auth('adminA'));
    expect(log.body.items.map((l: { status: string }) => l.status)).toEqual(['noop', 'success']);
  });

  it('revoke hides the pack from runtime and /auth/me but keeps its data', async () => {
    const revoke = await api().put(`/api/super/packs/${HFX}/companies/${wsA()}`).set(superAuth()).send({ override: 'revoke', reason: 'Pilot ended for the HTTP test' });
    expect(revoke.body).toMatchObject({ entitlement: 'revoked', status: 'active' });
    const me = await api().get('/api/v1/auth/me').set(auth('adminA'));
    expect(me.body.packs.map((p: { key: string }) => p.key)).toEqual(['generic-sales']);
    const rt = await api().get('/api/v1/packs/runtime').set(auth('adminA'));
    expect(rt.body.navigation).toEqual([]);
    expect(await prisma.customObject.count({ where: { workspaceId: wsA(), key: 'unit', archivedAt: null } })).toBe(1);
    const usage = await api().get(`/api/super/packs/${HFX}/usage`).set(superAuth());
    expect(usage.status).toBe(200);
    expect(usage.body.companies.find((c: { workspaceId: string }) => c.workspaceId === wsA())).toMatchObject({ entitlement: 'revoked', status: 'active', installedVersion: '1.0.0' });
    // Uninstall is always allowed, even when revoked.
    const un = await api().post(`/api/v1/packs/${HFX}/uninstall`).set(auth('adminA'));
    expect(un.status).toBe(200);
    expect(un.body.pack.status).toBe('uninstalled');
  });
});
