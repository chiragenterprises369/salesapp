import { contrastRatio, CustomDomainStateSchema, HostResolutionSchema, PublicWorkspaceSchema, SETTING_KEYS, WorkspaceBrandingSchema, WorkspaceSchema } from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, PNG_1PX, type Harness } from '../../testing/http-harness.js';

/**
 * Branding, component style and custom domains over HTTP (D-059, D-060): contrast-guarded colours, file ids
 * checked per tenant and purpose, audit entries, public branding by slug and host, the custom_domain switch
 * (FEATURE_DISABLED until the Super Admin turns it on), *.localhost verification in development, DOMAIN_TAKEN.
 */

let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let b: Awaited<ReturnType<Harness['workspace']>>;
let viewerA = '';
let superToken = '';
let logoA = '';
let logoB = '';
let refA = '';

const up = async (token: string, purpose: string, name = 'f.png') => {
  const res = await h.api().post('/api/v1/files').set(bearer(token)).field('purpose', purpose).attach('file', PNG_1PX, name);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};

beforeAll(async () => {
  h = await createHarness('brand');
  a = await h.workspace('a');
  b = await h.workspace('b');
  viewerA = (await h.member(a.workspaceId, 'viewer', 'viewer')).token;
  superToken = (await h.superAdmin(['platform.companies.read', 'platform.companies.manage', 'platform.flags.manage'])).token;
  logoA = await up(a.token, 'logo');
  logoB = await up(b.token, 'logo');
  refA = await up(a.token, 'reference_image');
}, 90_000);

afterAll(async () => {
  await h?.close();
});

describe('branding (/workspace/branding)', () => {
  it('starts empty', async () => {
    const res = await h.api().get('/api/v1/workspace/branding').set(bearer(viewerA));
    expect(res.status).toBe(200);
    expect(WorkspaceBrandingSchema.parse(res.body)).toMatchObject({ logoLight: null, brandColor: null, colors: null });
  });

  it('a viewer cannot change it (403)', async () => {
    const res = await h.api().patch('/api/v1/workspace/branding').set(bearer(viewerA)).send({ brandColor: '#123456' });
    expect(res.status).toBe(403);
  });

  it('admin sets logo, colours and name; pale colours are adjusted to 3:1; audited; mirrored on /auth/me', async () => {
    const palette = ['#FFFF00', '#00FF00', '#0000FF', '#FF0000', '#FFFFFF', '#000000'];
    const res = await h.api().patch('/api/v1/workspace/branding').set(bearer(a.token)).send({ logoLightFileId: logoA, brandColor: '#ffff00', chartPalette: palette, displayName: 'Acme Sales' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ws = WorkspaceSchema.parse(res.body);
    expect(ws.branding.brandColor).toBe('#FFFF00');
    expect(ws.branding.colors?.adjusted).toBe(true);
    expect(contrastRatio(ws.branding.colors!.light, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ws.branding.colors!.dark, '#171A21')).toBeGreaterThanOrEqual(3);
    expect(ws.branding.chartColors?.adjusted.length).toBeGreaterThan(0);
    expect(ws.branding.logoLight).toMatchObject({ fileId: logoA, mime: 'image/png' });
    expect(ws.branding.logoLight?.url).toMatch(new RegExp(`/api/files/p/${logoA}$`));
    expect(ws.branding.displayName).toBe('Acme Sales');
    expect(ws.accentColor).toBe('#FFFF00');

    const me = await h.api().get('/api/v1/auth/me').set(bearer(viewerA));
    expect(me.body.workspace.branding.brandColor).toBe('#FFFF00');
    const log = await h.prisma.auditLog.findFirst({ where: { workspaceId: a.workspaceId, action: 'workspace.branding_update' }, orderBy: { createdAt: 'desc' } });
    expect(Object.keys((log?.diff ?? {}) as object)).toEqual(expect.arrayContaining(['brandColor', 'logoLight', 'displayName', 'chartPalette']));
    const rows = await h.prisma.setting.count({ where: { workspaceId: a.workspaceId, scope: 'workspace', key: { startsWith: 'branding.' } } });
    expect(rows).toBe(4);
  });

  it('the same PATCH again is idempotent: no new audit entry', async () => {
    const before = await h.prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: 'workspace.branding_update' } });
    const res = await h.api().patch('/api/v1/workspace/branding').set(bearer(a.token)).send({ logoLightFileId: logoA, brandColor: '#FFFF00' });
    expect(res.status).toBe(200);
    expect(await h.prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: 'workspace.branding_update' } })).toBe(before);
  });

  it("another company's file is 404; a private or wrong-purpose file is 422; bad colours are 400", async () => {
    const cross = await h.api().patch('/api/v1/workspace/branding').set(bearer(a.token)).send({ logoLightFileId: logoB });
    expect(cross.status).toBe(404);
    const priv = await h.api().patch('/api/v1/workspace/branding').set(bearer(a.token)).send({ logoDarkFileId: refA });
    expect(priv.status).toBe(422);
    expect(priv.body.error.code).toBe('FILE_INVALID');
    const purpose = await h.api().patch('/api/v1/workspace/branding').set(bearer(a.token)).send({ faviconFileId: logoA });
    expect(purpose.status).toBe(422);
    for (const body of [{ brandColor: 'red' }, { chartPalette: ['#FFFFFF'] }, { displayName: '' }]) {
      expect((await h.api().patch('/api/v1/workspace/branding').set(bearer(a.token)).send(body)).status, JSON.stringify(body)).toBe(400);
    }
    const ws = await h.api().get('/api/v1/workspace').set(bearer(a.token));
    expect(ws.body.branding.logoLight.fileId).toBe(logoA);
  });

  it('null clears a key (row removed)', async () => {
    const res = await h.api().patch('/api/v1/workspace/branding').set(bearer(a.token)).send({ chartPalette: null });
    expect(res.status).toBe(200);
    expect(res.body.branding.chartPalette).toBeNull();
    expect(await h.prisma.setting.count({ where: { workspaceId: a.workspaceId, key: SETTING_KEYS.workspace.brandingChartPalette } })).toBe(0);
  });

  it('component style is admin-only and shows on the public branding', async () => {
    expect((await h.api().patch('/api/v1/workspace').set(bearer(viewerA)).send({ componentStyle: 'premium' })).status).toBe(403);
    const res = await h.api().patch('/api/v1/workspace').set(bearer(a.token)).send({ componentStyle: 'premium' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.componentStyle).toBe('premium');
    const pub = await h.api().get(`/api/v1/public/workspaces/${a.slug}/branding`);
    expect(pub.status).toBe(200);
    expect(PublicWorkspaceSchema.parse(pub.body)).toMatchObject({ slug: a.slug, name: 'Acme Sales', componentStyle: 'premium' });
    expect((await h.api().get('/api/v1/public/workspaces/no-such-company-xyz/branding')).status).toBe(404);
    expect((await h.api().get('/api/v1/public/workspaces/Bad_Slug/branding')).status).toBe(400);
  });
});

describe('custom domains (/workspace/domain)', () => {
  const host = () => `crm-${h.sfx}.localhost`;

  it('off by default: state says enabled=false and writes are FEATURE_DISABLED (403)', async () => {
    const state = await h.api().get('/api/v1/workspace/domain').set(bearer(a.token));
    expect(state.status).toBe(200);
    expect(CustomDomainStateSchema.parse(state.body)).toEqual({ enabled: false, domain: null });
    const set = await h.api().put('/api/v1/workspace/domain').set(bearer(a.token)).send({ hostname: host() });
    expect(set.status).toBe(403);
    expect(set.body.error.code).toBe('FEATURE_DISABLED');
    expect((await h.api().get('/api/v1/workspace/domain').set(bearer(viewerA))).status).toBe(403);
  });

  it('Super Admin switch on -> set (pending, DNS instructions) -> verify (*.localhost) -> resolve-host', async () => {
    const flags = await h.api().put(`/api/super/companies/${a.workspaceId}/flags`).set(bearer(superToken)).send({ overrides: { custom_domain: true } });
    expect(flags.status, JSON.stringify(flags.body)).toBe(200);
    expect(flags.body.features.custom_domain).toBe(true);

    const set = await h.api().put('/api/v1/workspace/domain').set(bearer(a.token)).send({ hostname: host().toUpperCase() });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const state = CustomDomainStateSchema.parse(set.body);
    expect(state.domain).toMatchObject({ hostname: host(), status: 'pending' });
    expect(state.domain?.dns.txt.name).toBe(`_vistar-verify.${host()}`);
    expect(state.domain?.dns.txt.value).toMatch(/^vistar-verify=/);

    const again = await h.api().put('/api/v1/workspace/domain').set(bearer(a.token)).send({ hostname: host() });
    expect(again.body.domain.dns.txt.value).toBe(state.domain?.dns.txt.value); // idempotent: same token

    const unresolved = await h.api().get('/api/v1/public/resolve-host').query({ host: host() });
    expect(unresolved.status).toBe(404); // pending domains never resolve

    const verify = await h.api().post('/api/v1/workspace/domain/verify').set(bearer(a.token));
    expect(verify.status).toBe(200);
    expect(verify.body.domain).toMatchObject({ status: 'verified', lastError: null });

    const resolved = await h.api().get('/api/v1/public/resolve-host').query({ host: `${host()}:3000` });
    expect(resolved.status).toBe(200);
    expect(HostResolutionSchema.parse(resolved.body)).toMatchObject({ host: host(), source: 'custom_domain', workspace: { slug: a.slug, name: 'Acme Sales' } });
    expect(await h.prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: { in: ['domain.set', 'domain.verified'] } } })).toBe(2);
  });

  it('another company cannot take the hostname (409 DOMAIN_TAKEN); invalid names are 400', async () => {
    await h.api().put(`/api/super/companies/${b.workspaceId}/flags`).set(bearer(superToken)).send({ overrides: { custom_domain: true } });
    const taken = await h.api().put('/api/v1/workspace/domain').set(bearer(b.token)).send({ hostname: host() });
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('DOMAIN_TAKEN');
    for (const hostname of ['not a domain', '-bad.example.com', 'localhost']) {
      expect((await h.api().put('/api/v1/workspace/domain').set(bearer(b.token)).send({ hostname })).status, hostname).toBe(400);
    }
  });

  it('a public domain without the TXT record fails verification with a reason', async () => {
    const hostname = `crm.test-${h.sfx}.example`;
    expect((await h.api().put('/api/v1/workspace/domain').set(bearer(b.token)).send({ hostname })).status).toBe(200);
    const res = await h.api().post('/api/v1/workspace/domain/verify').set(bearer(b.token));
    expect(res.status).toBe(200);
    expect(res.body.domain).toMatchObject({ hostname, status: 'failed' });
    expect(res.body.domain.lastError).toMatch(/TXT|DNS/);
  }, 20_000);

  it('switching the flag off stops resolution; the dev <slug>.localhost fallback still works', async () => {
    await h.api().put(`/api/super/companies/${a.workspaceId}/flags`).set(bearer(superToken)).send({ overrides: { custom_domain: false } });
    const off = await h.api().get('/api/v1/public/resolve-host').query({ host: host() });
    // crm-<sfx>.localhost falls back to the slug "crm-<sfx>", which does not exist.
    expect(off.status).toBe(404);
    const dev = await h.api().get('/api/v1/public/resolve-host').query({ host: `${a.slug}.localhost` });
    expect(dev.status).toBe(200);
    expect(dev.body).toMatchObject({ source: 'dev_localhost', workspace: { slug: a.slug } });
    expect((await h.api().get('/api/v1/public/resolve-host').query({ host: 'unknown.example.com' })).status).toBe(404);
    expect((await h.api().get('/api/v1/public/resolve-host')).status).toBe(400);
  });

  it('delete removes the domain (audited); verify without a domain is 404', async () => {
    await h.api().put(`/api/super/companies/${a.workspaceId}/flags`).set(bearer(superToken)).send({ overrides: { custom_domain: true } });
    const del = await h.api().delete('/api/v1/workspace/domain').set(bearer(a.token));
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ enabled: true, domain: null });
    expect((await h.api().post('/api/v1/workspace/domain/verify').set(bearer(a.token))).status).toBe(404);
    expect(await h.prisma.auditLog.count({ where: { workspaceId: a.workspaceId, action: 'domain.delete' } })).toBe(1);
  });
});
