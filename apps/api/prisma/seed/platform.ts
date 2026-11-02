/**
 * Super Admin history: plan changes, trial extension, feature flag overrides and ended "View as company"
 * sessions. Every action writes PlatformAuditLog and, when it affects a company, the company AuditLog too
 * (same as AuditService.platform()). Support access is enabled by the company admin before each session.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma } from '../../src/generated/prisma/client.js';
import type { CompanyCtx } from './company.js';
import * as C from './content.js';
import { between, d, DAY, HOUR, iso, MIN, pick } from './util.js';

type Json = Prisma.InputJsonValue;

export interface PlatformAdminRef {
  id: string;
  name: string;
}

export interface PlatformRows {
  platformAudit: Prisma.PlatformAuditLogCreateManyInput[];
  tenantAudit: Prisma.AuditLogCreateManyInput[];
  impersonations: Prisma.ImpersonationSessionCreateManyInput[];
  flags: Prisma.FeatureFlagOverrideCreateManyInput[];
}

export function buildPlatform(ctx: CompanyCtx, admin: PlatformAdminRef): PlatformRows {
  const { rng, now, workspaceId } = ctx;
  const out: PlatformRows = { platformAudit: [], tenantAudit: [], impersonations: [], flags: [] };
  const ip = () => pick(rng, C.AUDIT_IPS);
  const ua = () => pick(rng, C.USER_AGENTS);

  const superAction = (at: number, action: string, entityType: string, entityId: string | null, reason: string | null, diff: Record<string, unknown> | null) => {
    const shared = { ip: ip(), userAgent: ua(), createdAt: d(at), diff: diff ? (diff as Json) : undefined };
    out.platformAudit.push({ id: randomUUID(), adminId: admin.id, adminName: admin.name, action, workspaceId, entityType, entityId, reason, ...shared });
    out.tenantAudit.push({ id: randomUUID(), workspaceId, actorType: 'super_admin', actorId: admin.id, actorName: admin.name, action, entityType, entityId, ...shared });
  };
  const adminAction = (at: number, action: string, diff: Record<string, unknown>) =>
    out.tenantAudit.push({ id: randomUUID(), workspaceId, actorType: 'user', actorId: ctx.admin.id, actorName: ctx.admin.name, action, entityType: 'workspace', entityId: workspaceId, diff: diff as Json, ip: ip(), userAgent: ua(), createdAt: d(at) });

  const impersonate = (startedAt: number, reason: string, endedAfterMin: number | null) => {
    const accessUntil = startedAt + 24 * HOUR;
    adminAction(startedAt - between(rng, 20 * MIN, 3 * HOUR), 'support_access.enable', { until: iso(accessUntil), includeContent: false });
    const id = randomUUID();
    const expiresAt = startedAt + 30 * MIN;
    const endedAt = endedAfterMin !== null ? startedAt + endedAfterMin * MIN : expiresAt;
    const endedReason = endedAfterMin !== null ? 'ended_by_admin' : 'expired';
    out.impersonations.push({ id, workspaceId, adminId: admin.id, reason, readOnly: true, contentAccess: false, startedAt: d(startedAt), expiresAt: d(expiresAt), endedAt: d(endedAt), endedReason });
    superAction(startedAt, 'impersonation.start', 'impersonation_session', id, reason, { readOnly: true, contentAccess: false, expiresAt: iso(expiresAt) });
    superAction(endedAt, 'impersonation.end', 'impersonation_session', id, null, { endedReason });
    adminAction(Math.min(now - MIN, endedAt + between(rng, 30 * MIN, 5 * HOUR)), 'support_access.disable', { until: null });
  };
  const flag = (at: number, name: string, enabled: boolean, reason: string) => {
    out.flags.push({ id: randomUUID(), workspaceId, flag: name, enabled, setById: admin.id, createdAt: d(at), updatedAt: d(at) });
    superAction(at, 'company.flags_update', 'workspace', workspaceId, reason, { [name]: { from: !enabled, to: enabled } });
  };

  if (ctx.fx.slug === 'shakti') {
    superAction(ctx.createdAt + 35 * DAY, 'company.plan_change', 'workspace', workspaceId, 'Upgrade requested by the customer (invoice INV-2026-0412)', { plan: { from: 'starter', to: 'growth' } });
    impersonate(now - 18 * DAY + between(rng, 0, 4 * HOUR), C.IMPERSONATION_REASONS[0], 22);
    impersonate(now - 4 * DAY + between(rng, 0, 4 * HOUR), C.IMPERSONATION_REASONS[1], null);
  } else if (ctx.fx.slug === 'navkar') {
    superAction(ctx.createdAt + 14 * DAY, 'company.plan_change', 'workspace', workspaceId, 'Paid by bank transfer (manual invoice INV-2026-0388)', { plan: { from: 'free', to: 'starter' } });
    flag(now - 6 * DAY, 'team_floor_3d', true, 'Pilot of the Live Team Floor 3D before a Growth upgrade');
    impersonate(now - 9 * DAY + between(rng, 0, 4 * HOUR), C.IMPERSONATION_REASONS[2], 17);
  } else if (ctx.fx.slug === 'sunrise') {
    const at = now - 2 * DAY + between(rng, 0, 3 * HOUR);
    superAction(at, 'company.trial_extend', 'workspace', workspaceId, 'Customer is evaluating telephony before choosing a plan', { trialEndsAt: { from: iso(now - 2 * DAY), to: iso(now + 10 * DAY) } });
    flag(at + 2 * MIN, 'telephony', true, 'Telephony enabled for the extended trial');
  }
  return out;
}

/** Platform-wide actions (no company). */
export function buildPlatformGlobal(admin: PlatformAdminRef, now: number): Prisma.PlatformAuditLogCreateManyInput[] {
  const row = (at: number, action: string, entityType: string, entityId: string | null, reason: string | null, diff: Record<string, unknown>) => ({
    id: randomUUID(), adminId: admin.id, adminName: admin.name, action, workspaceId: null, entityType, entityId, reason, diff: diff as Json, ip: C.AUDIT_IPS[0], userAgent: C.USER_AGENTS[0], createdAt: d(at),
  });
  return [
    row(now - 60 * DAY, 'plan.update', 'plan', 'growth', 'Festive season WhatsApp allowance', { limits: { whatsappMessagesPerMonth: { from: 40_000, to: 50_000 } } }),
    row(now - 12 * DAY, 'content.announcement', 'announcement', null, null, { title: 'Diwali maintenance window', startsAt: iso(now + 5 * DAY), durationMin: 30 }),
    row(now - 7 * DAY, 'content.template_suggestion', 'whatsapp_template', 'revival_offer', null, { name: 'revival_offer', category: 'marketing' }),
  ];
}
