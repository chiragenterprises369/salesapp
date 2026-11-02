import 'reflect-metadata';
import { type INestApplication, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { PlatformPermission } from '@vistar/shared';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { AppExceptionFilter } from '../common/errors/exception.filter.js';
import type { PrismaClient } from '../generated/prisma/client.js';
import { hashToken, randomToken } from '../infra/crypto/secrets.js';
import { hashPassword } from '../modules/auth/password.js';
import { TokenService } from '../modules/auth/token.service.js';
import { WorkspaceProvisioner } from '../modules/auth/workspace-provisioner.js';
import { deleteTestWorkspace, newTestPrisma, testSuffix } from '../modules/packs/testing.js';
import { StorageService } from '../modules/storage/storage.service.js';

/**
 * HTTP test harness for the change #19 specs (full AppModule against the worktree dev DB + Redis). Everything a
 * spec creates is temporary: `test-*` workspaces, `test-*@example.test` users, Super Admins with a minted platform
 * session, local storage objects under `t/<workspaceId>/`. Not used by application code.
 */
export interface Harness {
  app: INestApplication;
  prisma: PrismaClient;
  sfx: string;
  password: string;
  api: () => ReturnType<typeof request>;
  /** Workspace (sign-up path) with its company admin; returns ids and a fresh access token. */
  workspace: (label: string) => Promise<{ workspaceId: string; adminId: string; slug: string; token: string }>;
  /** Extra member with a system role (employee, manager, viewer) in a workspace. */
  member: (workspaceId: string, roleKey: 'employee' | 'manager' | 'viewer' | 'company_admin', label: string) => Promise<{ userId: string; token: string }>;
  /** Super Admin with the given platform permissions and a live platform session. */
  superAdmin: (permissions: readonly PlatformPermission[], label?: string) => Promise<{ adminId: string; token: string }>;
  /** Track a workspace created another way (e.g. POST /api/super/companies) for cleanup. */
  track: (workspaceId: string) => void;
  close: () => Promise<void>;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function createHarness(prefix: string): Promise<Harness> {
  const prisma = newTestPrisma();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AppExceptionFilter());
  await app.init();

  const sfx = testSuffix();
  const password = `pw-${sfx}-Vistar!`;
  const passwordHash = await hashPassword(password);
  const workspaceIds: string[] = [];
  const adminIds: string[] = [];
  const api = () => request(app.getHttpServer());

  const login = async (email: string): Promise<string> => {
    const res = await api().post('/api/v1/auth/login').send({ email, password });
    if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body.accessToken as string;
  };

  const harness: Harness = {
    app,
    prisma,
    sfx,
    password,
    api,
    async workspace(label) {
      const email = `test-${prefix}-${label}-${sfx}@example.test`;
      const ws = await app.get(WorkspaceProvisioner).provision({ ownerName: `Admin ${label}`, email, passwordHash, googleSub: null, workspaceName: `test-${prefix}-${label}-${sfx}`, timezone: 'Asia/Kolkata' });
      workspaceIds.push(ws.workspaceId);
      const { slug } = await prisma.workspace.findUniqueOrThrow({ where: { id: ws.workspaceId }, select: { slug: true } });
      return { workspaceId: ws.workspaceId, adminId: ws.userId, slug, token: await login(email) };
    },
    async member(workspaceId, roleKey, label) {
      const email = `test-${prefix}-${label}-${sfx}@example.test`;
      const role = await prisma.role.findFirstOrThrow({ where: { workspaceId, key: roleKey } });
      const user = await prisma.user.create({ data: { workspaceId, email, passwordHash, name: `Member ${label}`, roleId: role.id } });
      return { userId: user.id, token: await login(email) };
    },
    async superAdmin(permissions, label = 'super') {
      const admin = await prisma.platformAdmin.create({
        data: { email: `test-${prefix}-${label}-${sfx}@example.test`, name: `Test ${label}`, passwordHash, permissions: [...permissions], mfaEnabledAt: new Date() },
      });
      adminIds.push(admin.id);
      const familyId = randomUUID();
      await prisma.platformSession.create({
        data: { adminId: admin.id, familyId, tokenHash: hashToken(randomToken(32)), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) },
      });
      const { token } = app.get(TokenService).signPlatformAccess({ sub: admin.id, role: 'super_admin', perms: [...permissions], sid: familyId, mfa: true });
      return { adminId: admin.id, token };
    },
    track(workspaceId) {
      workspaceIds.push(workspaceId);
    },
    async close() {
      const root = app.get(StorageService).localRoot;
      try {
        for (const id of workspaceIds) {
          await deleteTestWorkspace(prisma, id);
          if (root) await rm(path.join(root, 't', id), { recursive: true, force: true });
        }
        if (adminIds.length) {
          await prisma.platformAuditLog.deleteMany({ where: { adminId: { in: adminIds } } });
          await prisma.platformAdmin.deleteMany({ where: { id: { in: adminIds } } });
        }
        if (workspaceIds.length) await prisma.platformAuditLog.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      } finally {
        await app.close();
        await prisma.$disconnect();
      }
    },
  };
  return harness;
}

export * from './fixtures.js';
