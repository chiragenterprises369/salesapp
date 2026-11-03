import { Injectable } from '@nestjs/common';
import {
  API_KEY_DISPLAY_PREFIX_LENGTH,
  API_KEY_PREFIX,
  apiKeyScopeOptions,
  type ApiKey,
  type ApiKeyCreate,
  type ApiKeyCreated,
  type ApiKeyScope,
  type ApiKeyScopeOption,
  type ApiKeyUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { ApiKey as ApiKeyRow } from '../../generated/prisma/client.js';
import { hashToken, randomToken } from '../../infra/crypto/secrets.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { requestActor } from '../leads/lib/context.js';
import { WorkspaceService } from '../workspace/workspace.service.js';

const newKey = () => `${API_KEY_PREFIX}${randomToken(24)}`;

/**
 * API keys (SPEC 15.5, change #19 wave C, D-070): scoped (each scope a permission the creator holds), optional expiry,
 * per-key rate limit, shown once, rotation with a grace period for the old key, revoke, last used at and from. Needs
 * the api_access plan feature. Only the SHA-256 is stored. Every change is audited.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly workspaces: WorkspaceService,
  ) {}

  private db(auth: AuthContext) {
    return this.prisma.forTenant(auth.workspaceId);
  }

  private async requireApiAccess(auth: AuthContext): Promise<void> {
    const db = this.db(auth);
    const ws = await db.workspace.findFirst({ select: { plan: true } });
    const features = await this.workspaces.features(db, ws?.plan ?? 'free');
    if (!features.api_access) throw new AppException('FEATURE_DISABLED', 'API access is not part of your plan');
  }

  private async toDtos(auth: AuthContext, rows: ApiKeyRow[]): Promise<ApiKey[]> {
    const ids = [...new Set(rows.map((r) => r.createdById).filter((x): x is string => !!x))];
    const users = ids.length ? await this.db(auth).user.findMany({ where: { id: { in: ids } }, select: USER_SUMMARY_SELECT }) : [];
    const by = new Map(users.map((u) => [u.id, toUserSummary(u)]));
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      prefix: r.prefix,
      scopes: r.scopes as ApiKeyScope[],
      status: r.revokedAt ? 'revoked' : r.expiresAt && r.expiresAt.getTime() <= now ? 'expired' : 'active',
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      lastUsedIp: r.lastUsedIp,
      rateLimitPerMinute: r.rateLimitPerMinute,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      revokedAt: r.revokedAt?.toISOString() ?? null,
      rotatedAt: r.rotatedAt?.toISOString() ?? null,
      previousKeyExpiresAt: r.previousKeyExpiresAt && r.previousKeyExpiresAt.getTime() > now ? r.previousKeyExpiresAt.toISOString() : null,
      createdBy: r.createdById ? (by.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  private async load(auth: AuthContext, id: string): Promise<ApiKeyRow> {
    const row = await this.db(auth).apiKey.findFirst({ where: { id } });
    if (!row) throw notFound('API key');
    return row;
  }

  async list(auth: AuthContext): Promise<{ items: ApiKey[] }> {
    const rows = await this.db(auth).apiKey.findMany({ orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }] });
    return { items: await this.toDtos(auth, rows) };
  }

  scopes(auth: AuthContext): { items: ApiKeyScopeOption[] } {
    return { items: apiKeyScopeOptions(auth.permissions) };
  }

  /** Create path (BILLING-PDF adds its PLAN_LIMIT_REACHED check at the top of this method). */
  async create(auth: AuthContext, req: Request, body: ApiKeyCreate): Promise<ApiKeyCreated> {
    await this.requireApiAccess(auth);
    const missing = body.scopes.filter((s) => !auth.permissions.includes(s));
    if (missing.length) {
      throw new AppException('API_KEY_SCOPE_NOT_ALLOWED', 'A key cannot have scopes you do not hold', { details: missing.map((s) => ({ path: 'scopes', message: `You do not have ${s}` })) });
    }
    if (body.expiresAt && Date.parse(body.expiresAt) <= Date.now()) throw new AppException('VALIDATION_FAILED', 'Expiry must be in the future', { details: [{ path: 'expiresAt', message: 'Must be in the future' }] });
    const key = newKey();
    const row = await this.db(auth).apiKey.create({
      data: {
        workspaceId: auth.workspaceId,
        name: body.name,
        prefix: key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH),
        keyHash: hashToken(key),
        scopes: [...new Set(body.scopes)],
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
        rateLimitPerMinute: body.rateLimitPerMinute ?? null,
        createdById: auth.userId,
      },
    });
    const actor = await requestActor(this.db(auth), auth);
    await this.audit.record(auth, req, { action: 'apikey.create', entityType: 'api_key', entityId: row.id, diff: { name: row.name, prefix: row.prefix, scopes: row.scopes, expiresAt: row.expiresAt?.toISOString() ?? null } }, actor.summary?.name);
    const [dto] = await this.toDtos(auth, [row]);
    return { ...dto!, key };
  }

  async update(auth: AuthContext, req: Request, id: string, body: ApiKeyUpdate): Promise<ApiKey> {
    await this.load(auth, id);
    const data = { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.rateLimitPerMinute !== undefined ? { rateLimitPerMinute: body.rateLimitPerMinute } : {}) };
    const row = await this.db(auth).apiKey.update({ where: { id }, data });
    const actor = await requestActor(this.db(auth), auth);
    await this.audit.record(auth, req, { action: 'apikey.update', entityType: 'api_key', entityId: id, diff: data }, actor.summary?.name);
    const [dto] = await this.toDtos(auth, [row]);
    return dto!;
  }

  async rotate(auth: AuthContext, req: Request, id: string, body: { graceMinutes: number }): Promise<ApiKeyCreated> {
    await this.requireApiAccess(auth);
    const current = await this.load(auth, id);
    if (current.revokedAt || (current.expiresAt && current.expiresAt.getTime() <= Date.now())) throw new AppException('CONFLICT', 'Revoked or expired keys cannot be rotated; create a new key');
    const key = newKey();
    const now = new Date();
    const graceUntil = body.graceMinutes > 0 ? new Date(now.getTime() + body.graceMinutes * 60_000) : null;
    const row = await this.db(auth).apiKey.update({
      where: { id },
      data: { keyHash: hashToken(key), prefix: key.slice(0, API_KEY_DISPLAY_PREFIX_LENGTH), previousKeyHash: graceUntil ? current.keyHash : null, previousKeyExpiresAt: graceUntil, rotatedAt: now },
    });
    const actor = await requestActor(this.db(auth), auth);
    await this.audit.record(auth, req, { action: 'apikey.rotate', entityType: 'api_key', entityId: id, diff: { prefix: row.prefix, graceMinutes: body.graceMinutes } }, actor.summary?.name);
    const [dto] = await this.toDtos(auth, [row]);
    return { ...dto!, key };
  }

  async revoke(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const row = await this.load(auth, id);
    if (!row.revokedAt) {
      await this.db(auth).apiKey.update({ where: { id }, data: { revokedAt: new Date(), previousKeyHash: null, previousKeyExpiresAt: null } });
      const actor = await requestActor(this.db(auth), auth);
      await this.audit.record(auth, req, { action: 'apikey.revoke', entityType: 'api_key', entityId: id, diff: { name: row.name, prefix: row.prefix } }, actor.summary?.name);
    }
    return { ok: true };
  }
}
