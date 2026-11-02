import 'reflect-metadata';
import { type INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MeResponseSchema, SETTING_KEYS, UserSettingsSchema, WorkspaceSchema } from '@vistar/shared';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module.js';
import { AppExceptionFilter } from '../../common/errors/exception.filter.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import { hashPassword } from '../auth/password.js';
import { WorkspaceProvisioner } from '../auth/workspace-provisioner.js';
import { deleteTestWorkspace, newTestPrisma, testSuffix } from '../packs/testing.js';

/**
 * D-052 appearance settings over HTTP (full app, dev DB + Redis) in one TEMP workspace (test-appearance-*):
 * user keys ui.interfaceStyle, ui.motionIntensity, leads.boardSkin, leads.celebrations (PATCH merges, null drops the row)
 * and workspace defaults ui.defaultInterfaceStyle, leads.defaultBoardSkin (settings.manage, audited; viewers get 403).
 */

const sfx = testSuffix();
const PASSWORD = `pw-${sfx}-Vistar!`;
const emails = { admin: `test-appearance-a-${sfx}@example.test`, viewer: `test-appearance-v-${sfx}@example.test` };

let app: INestApplication;
let prisma: PrismaClient;
let workspaceId = '';
let adminId = '';
const tokens: Record<keyof typeof emails, string> = { admin: '', viewer: '' };

const api = () => request(app.getHttpServer());
const auth = (who: keyof typeof emails) => ({ Authorization: `Bearer ${tokens[who]}` });

async function login(email: string): Promise<string> {
  const res = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.accessToken as string;
}

const userRows = (userId: string) =>
  prisma.setting.findMany({ where: { workspaceId, scope: 'user', scopeId: userId }, select: { key: true, value: true }, orderBy: { key: 'asc' } });

beforeAll(async () => {
  prisma = newTestPrisma();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication({ logger: ['error'] });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AppExceptionFilter());
  await app.init();

  const passwordHash = await hashPassword(PASSWORD);
  const ws = await app
    .get(WorkspaceProvisioner)
    .provision({ ownerName: 'Admin', email: emails.admin, passwordHash, googleSub: null, workspaceName: `test-appearance-${sfx}`, timezone: 'Asia/Kolkata' });
  workspaceId = ws.workspaceId;
  const viewerRole = await prisma.role.findFirstOrThrow({ where: { workspaceId, key: 'viewer' } });
  await prisma.user.create({ data: { workspaceId, email: emails.viewer, passwordHash, name: 'Viewer', roleId: viewerRole.id } });
  adminId = (await prisma.user.findFirstOrThrow({ where: { workspaceId, email: emails.admin }, select: { id: true } })).id;

  tokens.admin = await login(emails.admin);
  tokens.viewer = await login(emails.viewer);
}, 60_000);

afterAll(async () => {
  await app?.close();
  if (prisma) {
    if (workspaceId) await deleteTestWorkspace(prisma, workspaceId);
    await prisma.$disconnect();
  }
});

describe('user appearance settings (/me/settings)', () => {
  it('defaults: follow the workspace, motion full, celebrations follow motion', async () => {
    const res = await api().get('/api/v1/me/settings').set(auth('admin'));
    expect(res.status).toBe(200);
    expect(UserSettingsSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({ interfaceStyle: null, motionIntensity: 'full', boardSkin: null, celebrations: null });
  });

  it('PATCH round trip stores one row per key and merges with the other settings', async () => {
    const view = await api().patch('/api/v1/me/settings').set(auth('admin')).send({ leadsViewMode: 'table' });
    expect(view.status).toBe(200);

    const res = await api().patch('/api/v1/me/settings').set(auth('admin')).send({ boardSkin: 'neon', motionIntensity: 'reduced' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ boardSkin: 'neon', motionIntensity: 'reduced', interfaceStyle: null, celebrations: null, leadsViewMode: 'table' });

    const more = await api().patch('/api/v1/me/settings').set(auth('admin')).send({ interfaceStyle: 'depth', celebrations: 'subtle' });
    expect(more.body).toMatchObject({ boardSkin: 'neon', motionIntensity: 'reduced', interfaceStyle: 'depth', celebrations: 'subtle', leadsViewMode: 'table' });

    const got = await api().get('/api/v1/me/settings').set(auth('admin'));
    expect(got.body).toEqual(more.body);
    const me = await api().get('/api/v1/auth/me').set(auth('admin'));
    expect(MeResponseSchema.safeParse(me.body).success).toBe(true);
    expect(me.body.settings).toEqual(more.body);

    const rows = new Map((await userRows(adminId)).map((r) => [r.key, r.value]));
    expect(rows.get(SETTING_KEYS.user.interfaceStyle)).toBe('depth');
    expect(rows.get(SETTING_KEYS.user.motionIntensity)).toBe('reduced');
    expect(rows.get(SETTING_KEYS.user.boardSkin)).toBe('neon');
    expect(rows.get(SETTING_KEYS.user.celebrations)).toBe('subtle');
  });

  it('settings are per user: the viewer still has the defaults', async () => {
    const res = await api().get('/api/v1/me/settings').set(auth('viewer'));
    expect(res.body).toMatchObject({ interfaceStyle: null, motionIntensity: 'full', boardSkin: null, celebrations: null });
  });

  it('rejects unknown values and a null motion intensity (400 VALIDATION_FAILED)', async () => {
    for (const body of [{ boardSkin: 'glass' }, { interfaceStyle: 'aurora' }, { motionIntensity: null }, { celebrations: 'reduced' }]) {
      const res = await api().patch('/api/v1/me/settings').set(auth('admin')).send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    const unchanged = await api().get('/api/v1/me/settings').set(auth('admin'));
    expect(unchanged.body).toMatchObject({ boardSkin: 'neon', interfaceStyle: 'depth' });
  });

  it('null goes back to following the default and drops the row', async () => {
    const res = await api().patch('/api/v1/me/settings').set(auth('admin')).send({ boardSkin: null, interfaceStyle: null, celebrations: null, motionIntensity: 'full' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ interfaceStyle: null, motionIntensity: 'full', boardSkin: null, celebrations: null, leadsViewMode: 'table' });
    const keys = (await userRows(adminId)).map((r) => r.key);
    expect(keys).not.toContain(SETTING_KEYS.user.boardSkin);
    expect(keys).not.toContain(SETTING_KEYS.user.interfaceStyle);
    expect(keys).not.toContain(SETTING_KEYS.user.celebrations);
  });
});

describe('workspace appearance defaults (/workspace)', () => {
  it('defaults are classic and depth', async () => {
    const res = await api().get('/api/v1/workspace').set(auth('viewer'));
    expect(res.status).toBe(200);
    expect(WorkspaceSchema.safeParse(res.body).success).toBe(true);
    expect(res.body).toMatchObject({ defaultInterfaceStyle: 'classic', defaultBoardSkin: 'depth' });
  });

  it('a viewer cannot change them (403) and nothing is written', async () => {
    const res = await api().patch('/api/v1/workspace').set(auth('viewer')).send({ defaultBoardSkin: 'neon' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(await prisma.setting.count({ where: { workspaceId, scope: 'workspace', key: SETTING_KEYS.workspace.defaultBoardSkin } })).toBe(0);
  });

  it('an admin changes them: shown in /workspace and /auth/me for everyone, audited', async () => {
    const res = await api().patch('/api/v1/workspace').set(auth('admin')).send({ defaultBoardSkin: 'flat', defaultInterfaceStyle: 'neon' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ defaultBoardSkin: 'flat', defaultInterfaceStyle: 'neon' });

    const me = await api().get('/api/v1/auth/me').set(auth('viewer'));
    expect(MeResponseSchema.safeParse(me.body).success).toBe(true);
    expect(me.body.workspace).toMatchObject({ defaultBoardSkin: 'flat', defaultInterfaceStyle: 'neon' });

    const log = await prisma.auditLog.findFirst({ where: { workspaceId, action: 'workspace.update' }, orderBy: { createdAt: 'desc' } });
    expect(log?.diff).toEqual({ defaultBoardSkin: { from: 'depth', to: 'flat' }, defaultInterfaceStyle: { from: 'classic', to: 'neon' } });
  });

  it('an unrelated PATCH keeps them (no defaults re-applied); invalid values are rejected', async () => {
    const res = await api().patch('/api/v1/workspace').set(auth('admin')).send({ name: `test-appearance-${sfx} renamed` });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ defaultBoardSkin: 'flat', defaultInterfaceStyle: 'neon' });
    for (const body of [{ defaultBoardSkin: null }, { defaultInterfaceStyle: 'aurora' }]) {
      const bad = await api().patch('/api/v1/workspace').set(auth('admin')).send(body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
    }
  });

  it('an unchanged value writes no audit entry', async () => {
    const before = await prisma.auditLog.count({ where: { workspaceId, action: 'workspace.update' } });
    const res = await api().patch('/api/v1/workspace').set(auth('admin')).send({ defaultBoardSkin: 'flat' });
    expect(res.status).toBe(200);
    expect(await prisma.auditLog.count({ where: { workspaceId, action: 'workspace.update' } })).toBe(before);
  });
});
