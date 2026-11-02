import { AndroidReleaseSchema, AppConfigSchema, DeviceSchema, FirebaseConfigStatusSchema } from '@vistar/shared';
import { createHash, randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PlatformSetting } from '../../generated/prisma/client.js';
import { bearer, createHarness, googleServicesJson, makeApk, serviceAccountJson, type Harness } from '../../testing/http-harness.js';
import { StorageService } from '../storage/storage.service.js';
import { FIREBASE_CLIENT_KEY, FIREBASE_SA_KEY, FirebaseConfigService } from './firebase-config.service.js';
import { PushService } from './push.service.js';

/**
 * Super Admin config section over HTTP (D-058): Firebase files (422 on the wrong package or file kind, encrypted,
 * service account never returned), APK releases (sha256, unique versionCode, 422 for non-APKs), public
 * /app/config and /app/android/latest, devices (idempotent upsert per installation, token moves, 404 across
 * users) and the push sender skipping when Firebase is not configured. Platform rows touched here (Firebase
 * settings, releases) are restored / removed afterwards.
 */

let h: Harness;
let a: Awaited<ReturnType<Harness['workspace']>>;
let employeeA = { userId: '', token: '' };
let superToken = '';
let readOnlySuper = '';
let saved: PlatformSetting[] = [];
const releaseIds: string[] = [];
const versionBase = 2_000_000_000 + randomInt(0, 90_000_000);

const putJson = (path: string, token: string, json: string, name = 'google-services.json') => h.api().put(path).set(bearer(token)).attach('file', Buffer.from(json), name);
const uploadApk = (token: string, versionCode: number, data = makeApk(String(versionCode)), extra: Record<string, string> = {}) => {
  const req = h.api().post('/api/super/android-releases').set(bearer(token)).field('versionName', '9.9.' + (versionCode - versionBase)).field('versionCode', String(versionCode));
  for (const [k, v] of Object.entries(extra)) req.field(k, v);
  return req.attach('file', data, 'vistar.apk');
};

beforeAll(async () => {
  h = await createHarness('pcfg');
  saved = await h.prisma.platformSetting.findMany({ where: { key: { in: [FIREBASE_CLIENT_KEY, FIREBASE_SA_KEY] } } });
  await h.prisma.platformSetting.deleteMany({ where: { key: { in: [FIREBASE_CLIENT_KEY, FIREBASE_SA_KEY] } } });
  a = await h.workspace('a');
  employeeA = await h.member(a.workspaceId, 'employee', 'emp');
  superToken = (await h.superAdmin(['platform.system.manage', 'platform.companies.read'])).token;
  readOnlySuper = (await h.superAdmin(['platform.companies.read'], 'reader')).token;
}, 90_000);

afterAll(async () => {
  if (h) {
    const storage = h.app.get(StorageService);
    const releases = await h.prisma.androidRelease.findMany({ where: { id: { in: releaseIds } }, include: { file: true } });
    for (const r of releases) {
      await h.prisma.androidRelease.delete({ where: { id: r.id } });
      await storage.deleteObject(r.file);
      await h.prisma.platformFile.delete({ where: { id: r.fileId } });
    }
    await h.prisma.platformSetting.deleteMany({ where: { key: { in: [FIREBASE_CLIENT_KEY, FIREBASE_SA_KEY] } } });
    for (const s of saved) await h.prisma.platformSetting.create({ data: { ...s, value: s.value ?? undefined } as never });
    await h.close();
  }
});

describe('Firebase config', () => {
  it('needs platform.system.manage (403) and a platform token (401)', async () => {
    expect((await h.api().get('/api/super/config/firebase').set(bearer(readOnlySuper))).status).toBe(403);
    expect((await h.api().get('/api/super/config/firebase').set(bearer(a.token))).status).toBe(401);
    expect((await h.api().get('/api/super/config/firebase')).status).toBe(401);
  });

  it('starts unconfigured; push is skipped and the test send explains why', async () => {
    const res = await h.api().get('/api/super/config/firebase').set(bearer(superToken));
    expect(FirebaseConfigStatusSchema.parse(res.body)).toMatchObject({ client: null, pushReady: false, projectMatch: null });
    expect(await h.app.get(PushService).sendToUser(a.workspaceId, a.adminId, { title: 't', data: { kind: 'system', workspaceId: a.workspaceId } })).toBe(0);
    const t = await h.api().post('/api/super/config/firebase/test').set(bearer(superToken)).send({ token: 'x'.repeat(40) });
    expect(t.status).toBe(200);
    expect(t.body).toMatchObject({ ok: false, messageId: null });
  });

  it('google-services.json: 422 for another package, a service account file or broken JSON', async () => {
    const other = await putJson('/api/super/config/firebase/client', superToken, googleServicesJson('vistar-test-123', 'com.example.other'));
    expect(other.status).toBe(422);
    expect(other.body.error.code).toBe('FIREBASE_CONFIG_INVALID');
    expect(other.body.error.message).toContain('app.vistar.employee');
    expect((await putJson('/api/super/config/firebase/client', superToken, serviceAccountJson())).status).toBe(422);
    expect((await putJson('/api/super/config/firebase/client', superToken, '{ nope')).status).toBe(422);
    expect((await h.api().put('/api/super/config/firebase/client').set(bearer(superToken))).status).toBe(400);
  });

  it('valid files are stored encrypted; the service account is never returned; /app/config serves the options', async () => {
    const client = await putJson('/api/super/config/firebase/client', superToken, googleServicesJson());
    expect(client.status, JSON.stringify(client.body)).toBe(200);
    expect(client.body.client).toMatchObject({ projectId: 'vistar-test-123', packageName: 'app.vistar.employee', messagingSenderId: '123456789012' });

    const sa = await putJson('/api/super/config/firebase/service-account', superToken, serviceAccountJson(), 'sa.json');
    expect(sa.status, JSON.stringify(sa.body)).toBe(200);
    const status = FirebaseConfigStatusSchema.parse(sa.body);
    expect(status).toMatchObject({ pushReady: true, projectMatch: true, serviceAccount: { configured: true, projectId: 'vistar-test-123', privateKeyIdLast4: 'abcd' } });
    expect(status.serviceAccount.clientEmail).toMatch(/^fir\*\*\*@/);
    expect(JSON.stringify(sa.body)).not.toContain('PRIVATE KEY');

    const row = await h.prisma.platformSetting.findUniqueOrThrow({ where: { key: FIREBASE_SA_KEY } });
    expect(row.secretEncrypted).toBeTruthy();
    expect(row.secretEncrypted).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(row.value)).not.toContain('PRIVATE KEY');

    const cfg = await h.api().get('/api/v1/app/config');
    expect(cfg.status).toBe(200);
    expect(AppConfigSchema.parse(cfg.body).firebase).toMatchObject({ projectId: 'vistar-test-123', appId: '1:123456789012:android:abcdef0123456789' });
    expect(await h.prisma.platformAuditLog.count({ where: { action: { in: ['config.firebase_client', 'config.firebase_service_account'] }, entityId: { in: [FIREBASE_CLIENT_KEY, FIREBASE_SA_KEY] }, createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBeGreaterThanOrEqual(2);
  });

  it('a fake service account key never throws from the sender (logged, 0 sent)', async () => {
    await h.prisma.device.create({ data: { workspaceId: a.workspaceId, userId: a.adminId, platform: 'android', installationId: `inst-push-${h.sfx}`, fcmToken: `tok-push-${h.sfx}-${'x'.repeat(30)}`, appVersion: '1.0.0' } });
    expect(await h.app.get(PushService).sendToUser(a.workspaceId, a.adminId, { title: 't', data: { kind: 'system', workspaceId: a.workspaceId } })).toBe(0);
  });

  it('delete removes one part; unknown parts are 400', async () => {
    const del = await h.api().delete('/api/super/config/firebase/service_account').set(bearer(superToken));
    expect(del.status).toBe(200);
    expect(del.body).toMatchObject({ pushReady: false, serviceAccount: { configured: false } });
    expect(del.body.client).not.toBeNull();
    expect(await h.app.get(FirebaseConfigService).serviceAccount()).toBeNull();
    expect((await h.api().delete('/api/super/config/firebase/everything').set(bearer(superToken))).status).toBe(400);
  });
});

describe('Android releases', () => {
  it('uploads an APK with sha256; the latest is on /app/config and downloads from /app/android/latest', async () => {
    const apk = makeApk('first');
    const res = await uploadApk(superToken, versionBase + 1, apk, { notes: 'First test build' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const rel = AndroidReleaseSchema.parse(res.body);
    releaseIds.push(rel.id);
    expect(rel.sha256).toBe(createHash('sha256').update(apk).digest('hex'));
    expect(rel).toMatchObject({ versionCode: versionBase + 1, size: apk.length, minSupported: false, notes: 'First test build' });

    const second = await uploadApk(superToken, versionBase + 2, makeApk('second'), { minSupported: 'true' });
    expect(second.status).toBe(201);
    releaseIds.push(second.body.id);

    const cfg = AppConfigSchema.parse((await h.api().get('/api/v1/app/config')).body);
    expect(cfg.android.latest).toMatchObject({ versionCode: versionBase + 2, sha256: second.body.sha256 });
    expect(cfg.android.minSupportedVersionCode).toBe(versionBase + 2);

    const dl = await h.api().get('/api/v1/app/android/latest').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toBe('application/vnd.android.package-archive');
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(createHash('sha256').update(dl.body as Buffer).digest('hex')).toBe(second.body.sha256);

    const list = await h.api().get('/api/super/android-releases').set(bearer(superToken));
    expect(list.status).toBe(200);
    expect(list.body.items.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining(releaseIds));
  });

  it('409 for a versionCode that exists, 422 for a zip that is not an APK, 400 for bad fields, 403 without permission', async () => {
    const dup = await uploadApk(superToken, versionBase + 1);
    expect(dup.status).toBe(409);
    const notApk = await uploadApk(superToken, versionBase + 3, Buffer.from('PK\u0003\u0004 not really'));
    expect(notApk.status).toBe(422);
    expect(notApk.body.error.code).toBe('APP_RELEASE_INVALID');
    const badName = await h.api().post('/api/super/android-releases').set(bearer(superToken)).field('versionName', 'latest').field('versionCode', '5').attach('file', makeApk(), 'v.apk');
    expect(badName.status).toBe(400);
    const wrongExt = await h.api().post('/api/super/android-releases').set(bearer(superToken)).field('versionName', '1.0.0').field('versionCode', String(versionBase + 4)).attach('file', makeApk(), 'v.zip');
    expect(wrongExt.status).toBe(415);
    expect((await uploadApk(readOnlySuper, versionBase + 5)).status).toBe(403);
    expect(await h.prisma.androidRelease.count({ where: { versionCode: { in: [versionBase + 3, versionBase + 4, versionBase + 5] } } })).toBe(0);
  });

  it('PATCH notes and minSupported (audited); 404 for an unknown id', async () => {
    const res = await h.api().patch(`/api/super/android-releases/${releaseIds[1]}`).set(bearer(superToken)).send({ minSupported: false, notes: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ minSupported: false, notes: null });
    expect((await h.api().patch('/api/super/android-releases/00000000-0000-7000-8000-000000000000').set(bearer(superToken)).send({ notes: 'x' })).status).toBe(404);
  });
});

describe('devices (/me/devices)', () => {
  const body = (installationId: string, fcmToken: string | null) => ({ platform: 'android', installationId, fcmToken, appVersion: '1.0.0', appBuild: 1, model: 'Pixel', osVersion: '15' });

  it('register is idempotent per installation; the token moves to the newest owner', async () => {
    const token = `fcm-${h.sfx}-${'y'.repeat(40)}`;
    const first = await h.api().post('/api/v1/me/devices').set(bearer(a.token)).send(body(`inst-a-${h.sfx}`, token));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(DeviceSchema.parse(first.body)).toMatchObject({ hasPushToken: true, installationId: `inst-a-${h.sfx}` });
    const again = await h.api().post('/api/v1/me/devices').set(bearer(a.token)).send({ ...body(`inst-a-${h.sfx}`, token), appVersion: '1.0.1' });
    expect(again.body.id).toBe(first.body.id);
    expect(again.body.appVersion).toBe('1.0.1');

    const moved = await h.api().post('/api/v1/me/devices').set(bearer(employeeA.token)).send(body(`inst-e-${h.sfx}`, token));
    expect(moved.status).toBe(200);
    const old = await h.prisma.device.findUniqueOrThrow({ where: { id: first.body.id } });
    expect(old.fcmToken).toBeNull();
    const mine = await h.api().get('/api/v1/me/devices').set(bearer(a.token));
    expect(mine.body.items.find((d: { id: string }) => d.id === first.body.id).hasPushToken).toBe(false);
  });

  it('400 for bad bodies; a device of another user is 404; delete works', async () => {
    expect((await h.api().post('/api/v1/me/devices').set(bearer(a.token)).send({ platform: 'ios', installationId: 'x', fcmToken: null, appVersion: '1' })).status).toBe(400);
    const theirs = await h.prisma.device.findFirstOrThrow({ where: { userId: employeeA.userId } });
    expect((await h.api().delete(`/api/v1/me/devices/${theirs.id}`).set(bearer(a.token))).status).toBe(404);
    expect((await h.api().delete(`/api/v1/me/devices/${theirs.id}`).set(bearer(employeeA.token))).status).toBe(200);
    expect(await h.prisma.device.count({ where: { id: theirs.id } })).toBe(0);
    expect((await h.api().get('/api/v1/me/devices')).status).toBe(401);
  });
});
