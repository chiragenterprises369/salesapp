import {
  ConfigGroupSchema,
  ConfigRegistrySchema,
  EmailPreviewSchema,
  EmailTemplateSchema,
  GoLiveChecklistSchema,
  pageOf,
  PlatformAuditLogSchema,
  PublicPlatformInfoSchema,
  SetupChecklistSchema,
  SuperCompanyUserSchema,
  WhatsAppTemplateSchema,
} from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { hashToken } from '../../infra/crypto/secrets.js';
import { bearer, createHarness, type Harness } from '../../testing/http-harness.js';

/**
 * Change #20 over HTTP (SPEC 30, D-073, D-074; written, run by Kiro Crew / CI, not in the agent session):
 * platform config registry (secrets write-only, statuses, validation, reset, audit), go-live checklist, platform and
 * company e-mail templates (TEMPLATE_INVALID, sanitising, preview), WhatsApp templates in mock mode, setup
 * checklist, password reset links, public platform info and the Super Admin company detail routes.
 * Development environment: no platform email configured -> DevLogMailer; storage local (dev default).
 */

let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let sys = '';
let reader = '';
let auditor = '';
const Items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) });

beforeAll(async () => {
  h = await createHarness('c20');
  a = await h.workspace('a');
  sys = (await h.superAdmin(['platform.system.manage', 'platform.companies.read', 'platform.audit.read'], 'sys')).token;
  reader = (await h.superAdmin(['platform.companies.read'], 'reader')).token;
  auditor = (await h.superAdmin(['platform.audit.read'], 'auditor')).token;
}, 90_000);

afterAll(async () => {
  // Registry rows are platform-wide: leave the dev database as it was.
  await h?.prisma.platformSetting.deleteMany({ where: { key: { in: ['config.branding', 'config.monitoring'] } } });
  await h?.prisma.platformEmailTemplate.deleteMany({ where: { key: 'trial_ending' } });
  await h?.close();
});

describe('platform config registry', () => {
  it('lists every group with a status; 403 without platform.system.manage; 401 for workspace tokens', async () => {
    const res = await h.api().get('/api/super/config/registry').set(bearer(sys));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const reg = ConfigRegistrySchema.parse(res.body);
    expect(reg.groups.map((g) => g.key)).toEqual(expect.arrayContaining(['email', 'storage', 'google_oauth', 'whatsapp_app', 'telephony', 'monitoring', 'security', 'branding', 'billing_profile', 'razorpay', 'firebase', 'android_releases']));
    expect(reg.groups.find((g) => g.key === 'storage')?.status).toMatch(/configured|env_fallback|dev_default/);
    expect((await h.api().get('/api/super/config/registry').set(bearer(reader))).status).toBe(403);
    expect((await h.api().get('/api/super/config/registry').set(bearer(a.token))).status).toBe(401);
  });

  it('secrets are write-only: saved, masked hint, never returned; null clears', async () => {
    const dsn = 'https://abcdef0123456789@o1.ingest.sentry.io/4242';
    const put = await h.api().put('/api/super/config/groups/monitoring').set(bearer(sys)).send({ values: { sentryDsnApi: dsn, environment: 'staging' } });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    const g = ConfigGroupSchema.parse(put.body);
    const f = g.fields.find((x) => x.key === 'sentryDsnApi')!;
    expect(f).toMatchObject({ secret: true, secretSet: true, value: null, source: 'panel' });
    expect(f.secretHint).toBe('••••4242');
    expect(JSON.stringify(put.body)).not.toContain('abcdef0123456789');
    const row = await h.prisma.platformSetting.findUnique({ where: { key: 'config.monitoring' } });
    expect(JSON.stringify(row?.value)).not.toContain('abcdef0123456789');
    expect(row?.secretEncrypted).toBeTruthy();

    const cleared = ConfigGroupSchema.parse((await h.api().put('/api/super/config/groups/monitoring').set(bearer(sys)).send({ values: { sentryDsnApi: null } })).body);
    expect(cleared.fields.find((x) => x.key === 'sentryDsnApi')?.secretSet).toBe(process.env.SENTRY_DSN ? true : false);
  });

  it('validates fields and cross-field rules (422 VALIDATION_FAILED with details)', async () => {
    const bad = await h.api().put('/api/super/config/groups/google_oauth').set(bearer(sys)).send({ values: { clientId: 'not-a-google-id' } });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    const unknown = await h.api().put('/api/super/config/groups/branding').set(bearer(sys)).send({ values: { nope: 'x' } });
    expect(unknown.status).toBe(422);
    const lockout = await h.api().put('/api/super/config/groups/security').set(bearer(sys)).send({ values: { superIpAllowlist: ['203.0.113.7'] } });
    expect(lockout.status).toBe(422);
    expect(JSON.stringify(lockout.body)).toContain('superIpAllowlist');
    expect((await h.api().put('/api/super/config/groups/razorpay').set(bearer(sys)).send({ values: {} })).status).toBe(400);
  });

  it('branding: save, public info shows it, reset clears it; audit lists the changed keys only', async () => {
    const put = await h.api().put('/api/super/config/groups/branding').set(bearer(sys)).send({ values: { productName: `Vistar ${h.sfx}`, supportEmail: 'help@example.test' } });
    expect(put.status).toBe(200);
    const pub = PublicPlatformInfoSchema.parse((await h.api().get('/api/v1/public/platform')).body);
    expect(pub.productName).toBe(`Vistar ${h.sfx}`);
    expect(pub.supportEmail).toBe('help@example.test');
    const audit = Items(z.object({ action: z.string(), changed: z.array(z.string()) })).parse((await h.api().get('/api/super/config/groups/branding/audit').set(bearer(sys))).body);
    expect(audit.items[0]).toMatchObject({ action: 'config.branding.update' });
    expect(audit.items[0]!.changed).toEqual(expect.arrayContaining(['productName', 'supportEmail']));
    const reset = ConfigGroupSchema.parse((await h.api().delete('/api/super/config/groups/branding').set(bearer(sys))).body);
    expect(reset.fields.find((x) => x.key === 'productName')).toMatchObject({ value: 'Vistar', source: 'default' });
  });

  it('storage test writes, reads and deletes a file with the dev default (local)', async () => {
    const res = await h.api().post('/api/super/config/groups/storage/test').set(bearer(sys)).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
  });

  it('go-live checklist fails node_env outside production and is not ready', async () => {
    const res = await h.api().get('/api/super/config/go-live').set(bearer(sys));
    expect(res.status).toBe(200);
    const c = GoLiveChecklistSchema.parse(res.body);
    expect(c.items.find((i) => i.key === 'node_env')?.status).toBe('fail');
    expect(c.ready).toBe(false);
  });
});

describe('e-mail templates', () => {
  it('platform: 422 TEMPLATE_INVALID on unknown or missing required variables; markup sanitised; reset', async () => {
    const bad = await h.api().put('/api/super/email-templates/password_reset').set(bearer(sys)).send({ subject: 'Reset', html: '<p>Hi {{nope}}</p>' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('TEMPLATE_INVALID');
    const ok = await h.api().put('/api/super/email-templates/trial_ending').set(bearer(sys)).send({ subject: 'Trial ends {{endsAt}}', html: '<p>Hi {{name}}<script>alert(1)</script></p><p><a class="button" href="{{link}}">Choose a plan</a></p>' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const t = EmailTemplateSchema.parse(ok.body);
    expect(t.isCustom).toBe(true);
    expect(t.html).not.toContain('<script');
    const preview = EmailPreviewSchema.parse((await h.api().post('/api/super/email-templates/trial_ending/preview').set(bearer(sys)).send({ theme: 'dark' })).body);
    expect(preview.html).toContain('<table');
    expect(preview.text.length).toBeGreaterThan(0);
    const reset = EmailTemplateSchema.parse((await h.api().delete('/api/super/email-templates/trial_ending').set(bearer(sys))).body);
    expect(reset.isCustom).toBe(false);
  });

  it('company: list the six keys, preview with company branding, optional {{message}} paragraph dropped when empty', async () => {
    const list = await h.api().get('/api/v1/email-templates').set(bearer(a.token));
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: { key: string }) => i.key)).toEqual(['quotation_sent', 'invoice_sent', 'payment_reminder', 'follow_up', 'meeting_invite', 'welcome_lead']);
    const preview = EmailPreviewSchema.parse((await h.api().post('/api/v1/email-templates/quotation_sent/preview').set(bearer(a.token)).send({ values: { message: '' }, theme: 'light' })).body);
    expect(preview.html).not.toContain('<p></p>');
    const test = await h.api().post('/api/v1/email-templates/quotation_sent/test').set(bearer(a.token)).send({});
    expect(test.status).toBe(200);
    expect(test.body.ok).toBe(true);
  });
});

describe('WhatsApp templates (mock outside production)', () => {
  it('create a draft, 422 for gaps in numbering, submit -> pending, sync -> approved', async () => {
    const gap = await h.api().post('/api/v1/whatsapp-templates').set(bearer(a.token)).send({ name: `gap_${h.sfx}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'), language: 'en', category: 'utility', body: 'Hi {{1}} and {{3}}', bodyExamples: ['A', 'B'], variables: ['name', 'x'] });
    expect([400, 422]).toContain(gap.status);
    const created = await h.api().post('/api/v1/whatsapp-templates').set(bearer(a.token)).send({ name: `order_${h.sfx}`.toLowerCase().replace(/[^a-z0-9_]/g, '_'), language: 'en', category: 'utility', body: 'Hi {{1}}, your order is ready.', bodyExamples: ['Rahul'], variables: ['name'] });
    if (created.status === 403 || created.status === 422) return; // plan without the whatsapp feature
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const t = WhatsAppTemplateSchema.parse(created.body);
    expect(t.status).toBe('draft');
    const submitted = WhatsAppTemplateSchema.parse((await h.api().post(`/api/v1/whatsapp-templates/${t.id}/submit`).set(bearer(a.token))).body);
    expect(submitted.status).toBe('pending');
    expect((await h.api().patch(`/api/v1/whatsapp-templates/${t.id}`).set(bearer(a.token)).send({ body: 'Changed {{1}}' })).status).toBe(409);
    const sync = await h.api().post('/api/v1/whatsapp-templates/sync').set(bearer(a.token));
    expect(sync.status).toBe(200);
    expect(sync.body.mode).toBe('mock');
    expect((await h.api().delete(`/api/v1/whatsapp-templates/${t.id}`).set(bearer(a.token))).status).toBe(200);
  });
});

describe('setup checklist', () => {
  it('computed items and percent; tick an acknowledgeable item; detected items cannot be ticked', async () => {
    const res = await h.api().get('/api/v1/setup').set(bearer(a.token));
    expect(res.status).toBe(200);
    const c = SetupChecklistSchema.parse(res.body);
    expect(c.items.map((i) => i.key)).toContain('branding');
    const ticked = SetupChecklistSchema.parse((await h.api().put('/api/v1/setup/items/roles_reviewed').set(bearer(a.token)).send({ acknowledged: true })).body);
    expect(ticked.items.find((i) => i.key === 'roles_reviewed')?.status).toBe('done');
    expect((await h.api().put('/api/v1/setup/items/branding').set(bearer(a.token)).send({ acknowledged: true })).status).toBe(400);
    const banner = SetupChecklistSchema.parse((await h.api().put('/api/v1/setup/banner').set(bearer(a.token)).send({ dismissed: true })).body);
    expect(banner.bannerDismissed).toBe(true);
  });
});

describe('password reset links', () => {
  it('forgot always answers 200; a valid token resets once and signs out; reused or bad tokens are 400 AUTH_LINK_INVALID', async () => {
    const email = `test-c20-a-${h.sfx}@example.test`;
    expect((await h.api().post('/api/v1/auth/password/forgot').send({ email: 'nobody@example.test' })).status).toBe(200);
    expect((await h.api().post('/api/v1/auth/password/forgot').send({ email })).status).toBe(200);
    // The raw token only goes out by e-mail: plant a known one for the test.
    const token = `c20-reset-${h.sfx}-0123456789abcdef`;
    const user = await h.prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true, workspaceId: true } });
    await h.prisma.userToken.create({ data: { workspaceId: user.workspaceId, userId: user.id, kind: 'password_reset', tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 600_000) } });
    const lookup = await h.api().get('/api/v1/auth/password/reset').query({ token });
    expect(lookup.status).toBe(200);
    expect(lookup.body.valid).toBe(true);
    expect(lookup.body.email).toMatch(/^t\*\*\*@/);
    expect((await h.api().post('/api/v1/auth/password/reset').send({ token, password: `new-${h.password}` })).status).toBe(200);
    const again = await h.api().post('/api/v1/auth/password/reset').send({ token, password: `new-${h.password}` });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('AUTH_LINK_INVALID');
    expect((await h.api().post('/api/v1/auth/login').send({ email, password: `new-${h.password}` })).status).toBe(200);
  });
});

describe('Super Admin company detail', () => {
  it('users without phone numbers; setup checklist; 404 for an unknown company', async () => {
    const users = await h.api().get(`/api/super/companies/${a.workspaceId}/users`).set(bearer(reader));
    expect(users.status, JSON.stringify(users.body)).toBe(200);
    const list = Items(SuperCompanyUserSchema).parse(users.body);
    expect(list.items.length).toBeGreaterThan(0);
    expect(JSON.stringify(users.body)).not.toMatch(/phone/i);
    const setup = await h.api().get(`/api/super/companies/${a.workspaceId}/setup`).set(bearer(reader));
    expect(setup.status).toBe(200);
    expect(SetupChecklistSchema.parse(setup.body).bannerDismissed).toBe(false);
    expect((await h.api().get('/api/super/companies/00000000-0000-7000-8000-000000000000/users').set(bearer(reader))).status).toBe(404);
    expect((await h.api().get(`/api/super/companies/${a.workspaceId}/users`).set(bearer(auditor))).status).toBe(403);
  });

  it('audit log filters by company and action prefix, with a cursor', async () => {
    const res = await h.api().get('/api/super/audit-logs').query({ action: 'config.', limit: 2 }).set(bearer(auditor));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const page = pageOf(PlatformAuditLogSchema).parse(res.body);
    expect(page.items.every((i) => i.action.startsWith('config.'))).toBe(true);
    if (page.nextCursor) expect((await h.api().get('/api/super/audit-logs').query({ action: 'config.', limit: 2, cursor: page.nextCursor }).set(bearer(auditor))).status).toBe(200);
    const byCompany = pageOf(PlatformAuditLogSchema).parse((await h.api().get('/api/super/audit-logs').query({ workspaceId: a.workspaceId }).set(bearer(auditor))).body);
    expect(byCompany.items.every((i) => i.workspaceId === a.workspaceId)).toBe(true);
    expect((await h.api().get('/api/super/audit-logs').set(bearer(reader))).status).toBe(403);
  });
});
