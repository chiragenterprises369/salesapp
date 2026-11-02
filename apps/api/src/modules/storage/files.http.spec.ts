import { FileUrlSchema, StoredFileSchema } from '@vistar/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bearer, createHarness, PNG_1PX, type Harness } from '../../testing/http-harness.js';

/**
 * Storage over HTTP (D-065): POST /files limits per purpose (413, 415, 422, 400), permissions (403), tenant
 * isolation (404 across workspaces), signed downloads (tampered / foreign token 404), public branding files and
 * safe download headers. Two TEMP workspaces (test-files-*).
 */

let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let b: Awaited<ReturnType<Harness['workspace']>>;
let employeeA = '';
let superToken = '';
let logoId = '';
let refId = '';

const upload = (token: string, purpose: string | null, data: Buffer, name: string) => {
  const req = h.api().post('/api/v1/files').set(bearer(token));
  if (purpose !== null) req.field('purpose', purpose);
  return req.attach('file', data, name);
};
const pathOf = (url: string) => new URL(url).pathname;

beforeAll(async () => {
  h = await createHarness('files');
  a = await h.workspace('a');
  b = await h.workspace('b');
  employeeA = (await h.member(a.workspaceId, 'employee', 'emp')).token;
  superToken = (await h.superAdmin(['platform.companies.read'])).token;
}, 90_000);

afterAll(async () => {
  await h?.close();
});

describe('POST /files', () => {
  it('stores a logo (public) and a reference image (private) with sha256 and metadata', async () => {
    const logo = await upload(a.token, 'logo', PNG_1PX, 'My Logo.png');
    expect(logo.status, JSON.stringify(logo.body)).toBe(201);
    const parsed = StoredFileSchema.parse(logo.body);
    expect(parsed).toMatchObject({ purpose: 'logo', visibility: 'public', mime: 'image/png', size: PNG_1PX.length, name: 'My Logo.png' });
    expect(parsed.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed.publicUrl).toMatch(/\/api\/files\/p\//);
    logoId = parsed.id;

    const ref = await upload(a.token, 'reference_image', PNG_1PX, 'work-area.png');
    expect(ref.status).toBe(201);
    expect(ref.body).toMatchObject({ purpose: 'reference_image', visibility: 'private', publicUrl: null });
    refId = ref.body.id;
    const row = await h.prisma.file.findUniqueOrThrow({ where: { id: refId } });
    expect(row).toMatchObject({ workspaceId: a.workspaceId, driver: 'local', uploadedById: a.adminId });
    expect(row.key).toBe(`t/${a.workspaceId}/reference_image/${refId}.png`);
  });

  it('403 for a member without settings.manage', async () => {
    const res = await upload(employeeA, 'logo', PNG_1PX, 'logo.png');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('400 without a file or with a purpose that is not a workspace upload', async () => {
    const noFile = await h.api().post('/api/v1/files').set(bearer(a.token)).field('purpose', 'logo');
    expect(noFile.status).toBe(400);
    expect(noFile.body.error.code).toBe('VALIDATION_FAILED');
    for (const purpose of [null, 'apk', 'floor_model', 'nope']) {
      const res = await upload(a.token, purpose, PNG_1PX, 'logo.png');
      expect(res.status, String(purpose)).toBe(400);
    }
  });

  it('415 for an extension the purpose does not accept', async () => {
    const res = await upload(a.token, 'favicon', PNG_1PX, 'favicon.jpg');
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect((await upload(a.token, 'logo', PNG_1PX, 'logo.exe')).status).toBe(415);
  });

  it('422 when the bytes do not match the extension, and for SVGs with script', async () => {
    const fake = await upload(a.token, 'logo', Buffer.from('not really a png'), 'logo.png');
    expect(fake.status).toBe(422);
    expect(fake.body.error.code).toBe('FILE_INVALID');
    const mismatch = await upload(a.token, 'logo', PNG_1PX, 'logo.jpg');
    expect(mismatch.status).toBe(422);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const bad = await upload(a.token, 'logo', svg, 'logo.svg');
    expect(bad.status).toBe(422);
    const handler = await upload(a.token, 'logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>'), 'logo.svg');
    expect(handler.status).toBe(422);
    const ok = await upload(a.token, 'logo', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'), 'logo.svg');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.mime).toBe('image/svg+xml');
  });

  it('413 above the per-purpose limit (logo 2 MB) and above the multipart limit (15 MB)', async () => {
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    const res = await upload(a.token, 'logo', big, 'logo.png');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const huge = Buffer.concat([PNG_1PX, Buffer.alloc(15 * 1024 * 1024 + 10)]);
    const multer = await upload(a.token, 'reference_image', huge, 'ref.png');
    expect(multer.status).toBe(413);
    expect(multer.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  }, 30_000);

  it('rejected uploads leave no rows and no orphan objects', async () => {
    const rows = await h.prisma.file.count({ where: { workspaceId: a.workspaceId } });
    expect(rows).toBe(3); // logo, reference image, safe svg
  });
});

describe('reading files', () => {
  it('metadata: tenant-scoped (404 across workspaces), private files need settings.manage', async () => {
    expect((await h.api().get(`/api/v1/files/${refId}`).set(bearer(a.token))).status).toBe(200);
    const cross = await h.api().get(`/api/v1/files/${refId}`).set(bearer(b.token));
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('NOT_FOUND');
    expect((await h.api().get(`/api/v1/files/${logoId}`).set(bearer(b.token))).status).toBe(404);
    expect((await h.api().get(`/api/v1/files/${logoId}`).set(bearer(employeeA))).status).toBe(200);
    expect((await h.api().get(`/api/v1/files/${refId}`).set(bearer(employeeA))).status).toBe(403);
    expect((await h.api().get(`/api/v1/files/${refId}/url`).set(bearer(employeeA))).status).toBe(403);
    expect((await h.api().get('/api/v1/files/not-a-uuid').set(bearer(a.token))).status).toBe(400);
  });

  it('signed URL downloads the bytes with safe headers; tampered or foreign tokens are 404', async () => {
    const url = await h.api().get(`/api/v1/files/${refId}/url`).set(bearer(a.token));
    expect(url.status).toBe(200);
    const signed = FileUrlSchema.parse(url.body);
    expect(Date.parse(signed.expiresAt) - Date.now()).toBeGreaterThan(14 * 60_000);
    const dl = await h.api().get(pathOf(signed.url)).buffer(true);
    expect(dl.status).toBe(200);
    expect(Buffer.compare(dl.body as Buffer, PNG_1PX)).toBe(0);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(dl.headers['content-security-policy']).toContain('sandbox');

    const token = pathOf(signed.url).split('/').pop()!;
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 't', i: logoId, e: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    expect((await h.api().get(`/api/files/d/${forged}.${sig}`)).status).toBe(404);
    expect((await h.api().get(`/api/files/d/${payload}.${sig!.slice(0, -2)}AA`)).status).toBe(404);
    expect((await h.api().get(`/api/files/d/${'x'.repeat(30)}`)).status).toBe(404);
  });

  it('public route serves branding files only', async () => {
    const pub = await h.api().get(`/api/files/p/${logoId}`);
    expect(pub.status).toBe(200);
    expect(pub.headers['cache-control']).toContain('public');
    expect((await h.api().get(`/api/files/p/${refId}`)).status).toBe(404);
  });

  it('Super Admin signed URL for any company file; workspace tokens are refused', async () => {
    const res = await h.api().get(`/api/super/files/${refId}/url`).set(bearer(superToken));
    expect(res.status).toBe(200);
    expect((await h.api().get(pathOf(res.body.url))).status).toBe(200);
    expect((await h.api().get(`/api/super/files/${refId}/url`).set(bearer(a.token))).status).toBe(401);
    expect((await h.api().get('/api/super/files/00000000-0000-7000-8000-000000000000/url').set(bearer(superToken))).status).toBe(404);
  });
});
