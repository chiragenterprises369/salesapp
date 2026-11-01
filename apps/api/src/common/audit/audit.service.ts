import { Injectable, Logger } from '@nestjs/common';
import { maskPhone, type AuditActorType } from '@vistar/shared';
import type { Request } from 'express';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import type { AuthContext, PlatformAuthContext } from '../auth/auth-context.js';

/**
 * AUDIT (contract). Every sensitive action writes an entry: role/permission change, member change,
 * impersonation, plan change, export, delete, merge, API key, integration secret, support access,
 * settings that affect everyone. Diffs are PII-masked. Never throws into the caller (logs instead).
 *
 *   await this.audit.record(auth, req, { action: 'lead.delete', entityType: 'lead', entityId: id });
 *   await this.audit.platform(admin, req, { action: 'company.suspend', workspaceId, reason, ... });
 */
export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  diff?: Record<string, unknown> | null;
}

const PII_KEYS = /phone|mobile|email|password|token|secret|otp|code/i;

/** Mask phones/emails and drop secrets inside a diff. */
export function maskDiff(value: unknown, key = ''): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => maskDiff(v, key));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, maskDiff(v, k)]));
  }
  if (typeof value === 'string' && PII_KEYS.test(key)) {
    if (/password|token|secret|otp|code/i.test(key)) return '[redacted]';
    if (value.includes('@')) return value.replace(/^(.).*(@.*)$/, '$1***$2');
    return maskPhone(value);
  }
  return value;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(auth: AuthContext, req: Request | null, entry: AuditEntry, actorName?: string | null): Promise<void> {
    const actorType: AuditActorType = auth.impersonation ? 'super_admin' : auth.via === 'api_key' ? 'api_key' : 'user';
    try {
      await this.prisma.forTenant(auth.workspaceId).auditLog.create({
        data: {
          workspaceId: auth.workspaceId,
          actorType,
          actorId: auth.impersonation?.adminId ?? auth.apiKeyId ?? auth.userId,
          actorName: actorName ?? null,
          action: entry.action,
          entityType: entry.entityType,
          entityId: entry.entityId ?? null,
          diff: entry.diff ? (maskDiff(entry.diff) as object) : undefined,
          ip: req?.ip ?? null,
          userAgent: (req?.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null,
        },
      });
    } catch (err) {
      this.logger.error(`Audit write failed for ${entry.action}: ${(err as Error).name}`);
    }
  }

  /** System/workflow actions inside a workspace (no human actor). */
  async system(workspaceId: string, entry: AuditEntry, actorType: Extract<AuditActorType, 'system' | 'workflow'> = 'system'): Promise<void> {
    try {
      await this.prisma.forTenant(workspaceId).auditLog.create({
        data: { workspaceId, actorType, action: entry.action, entityType: entry.entityType, entityId: entry.entityId ?? null, diff: entry.diff ? (maskDiff(entry.diff) as object) : undefined },
      });
    } catch (err) {
      this.logger.error(`Audit write failed for ${entry.action}: ${(err as Error).name}`);
    }
  }

  /** Super Admin action. Pass workspaceId to ALSO write the company's AuditLog (visible to the company). */
  async platform(
    admin: PlatformAuthContext | { adminId: string | null },
    req: Request | null,
    entry: AuditEntry & { workspaceId?: string | null; reason?: string | null },
    adminName?: string | null,
  ): Promise<void> {
    const ip = req?.ip ?? null;
    const userAgent = (req?.headers['user-agent'] as string | undefined)?.slice(0, 300) ?? null;
    const diff = entry.diff ? (maskDiff(entry.diff) as object) : undefined;
    try {
      await this.prisma.platformAuditLog.create({
        data: { adminId: admin.adminId, adminName: adminName ?? null, action: entry.action, workspaceId: entry.workspaceId ?? null, entityType: entry.entityType, entityId: entry.entityId ?? null, reason: entry.reason ?? null, diff, ip, userAgent },
      });
      if (entry.workspaceId) {
        await this.prisma.forTenant(entry.workspaceId).auditLog.create({
          data: { workspaceId: entry.workspaceId, actorType: 'super_admin', actorId: admin.adminId, actorName: adminName ?? 'Vistar support', action: entry.action, entityType: entry.entityType, entityId: entry.entityId ?? null, diff, ip, userAgent },
        });
      }
    } catch (err) {
      this.logger.error(`Platform audit write failed for ${entry.action}: ${(err as Error).name}`);
    }
  }
}
