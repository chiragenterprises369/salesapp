import { Injectable, Logger } from '@nestjs/common';
import {
  nextRoundRobin,
  routingConditionMisses,
  RoutingConditionsSchema,
  type RoutingDecision,
  type RoutingLeadFacts,
  type RoutingRule,
  type RoutingRuleCreate,
  type RoutingRuleUpdate,
  type RoutingStrategy,
  type RoutingTest,
  type UserSummary,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { iso, toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma, RoutingRule as RuleRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AvailabilityService, type NowAvailability } from '../calendar/availability.service.js';
import { requestActor, type TenantDb } from '../leads/lib/context.js';

/** Outcome of routing one lead. `rule` is the activity / lead.assigned rule label. */
export interface RoutedOwner {
  ownerId: string | null;
  rule: 'round_robin' | 'least_busy' | 'fallback' | null;
  ruleId: string | null;
}

type PoolUser = { id: string; summary: UserSummary; openLeads: number; eligible: boolean; reasons: string[] };

const parseConditions = (j: unknown) => {
  const r = RoutingConditionsSchema.safeParse(j ?? {});
  return r.success ? r.data : RoutingConditionsSchema.parse({});
};
const strategyOf = (s: string): RoutingStrategy => (s === 'least_busy' ? 'least_busy' : 'round_robin');

/**
 * Lead routing rules (schemas/routing.ts). `decide` is pure reading (test panel); `assign` advances the
 * round-robin cursor under a row lock (SELECT ... FOR UPDATE) so concurrent leads never get the same
 * "next" user and every eligible user gets one lead before anyone gets a second.
 */
@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- CRUD

  private async toDto(db: TenantDb, rows: RuleRow[]): Promise<RoutingRule[]> {
    const userIds = [...new Set(rows.flatMap((r) => [...r.userIds, ...(r.fallbackOwnerId ? [r.fallbackOwnerId] : [])]))];
    const teamIds = [...new Set(rows.map((r) => r.teamId).filter((t): t is string => !!t))];
    const [users, teams] = await Promise.all([
      userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: USER_SUMMARY_SELECT }) : [],
      teamIds.length ? db.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } }) : [],
    ]);
    const u = new Map(users.map((x) => [x.id, toUserSummary(x)]));
    const t = new Map(teams.map((x) => [x.id, x]));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      active: r.active,
      priority: r.priority,
      conditions: parseConditions(r.conditions),
      strategy: strategyOf(r.strategy),
      team: r.teamId ? (t.get(r.teamId) ?? null) : null,
      users: r.userIds.map((id) => u.get(id)).filter((x): x is UserSummary => !!x),
      respectWorkingHours: r.respectWorkingHours,
      respectAvailability: r.respectAvailability,
      requireOnline: r.requireOnline,
      fallbackOwner: r.fallbackOwnerId ? (u.get(r.fallbackOwnerId) ?? null) : null,
      lastAssignedUserId: r.lastAssignedUserId,
      assignedCount: r.assignedCount,
      lastAssignedAt: iso(r.lastAssignedAt),
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  private async checkRefs(db: TenantDb, body: { teamId?: string | null; userIds?: string[]; fallbackOwnerId?: string | null }): Promise<void> {
    if (body.teamId && (await db.team.count({ where: { id: body.teamId } })) !== 1) throw notFound('Team');
    const ids = [...new Set([...(body.userIds ?? []), ...(body.fallbackOwnerId ? [body.fallbackOwnerId] : [])])];
    if (ids.length && (await db.user.count({ where: { id: { in: ids }, deletedAt: null } })) !== ids.length) throw notFound('User');
  }

  async list(auth: AuthContext): Promise<{ items: RoutingRule[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const rows = await db.routingRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    return { items: await this.toDto(db, rows) };
  }

  async create(auth: AuthContext, req: Request, body: RoutingRuleCreate): Promise<RoutingRule> {
    const db = this.prisma.forTenant(auth.workspaceId);
    await this.checkRefs(db, body);
    const last = await db.routingRule.findFirst({ orderBy: { priority: 'desc' }, select: { priority: true } });
    const row = await db.routingRule.create({
      data: {
        workspaceId: auth.workspaceId,
        name: body.name,
        active: body.active,
        priority: (last?.priority ?? -1) + 1,
        conditions: body.conditions as unknown as Prisma.InputJsonObject,
        strategy: body.strategy,
        teamId: body.teamId,
        userIds: [...new Set(body.userIds)],
        respectWorkingHours: body.respectWorkingHours,
        respectAvailability: body.respectAvailability,
        requireOnline: body.requireOnline,
        fallbackOwnerId: body.fallbackOwnerId,
      },
    });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'routing.rule_create', entityType: 'routing_rule', entityId: row.id, diff: { name: row.name, strategy: row.strategy } }, actor.summary?.name);
    return (await this.toDto(db, [row]))[0]!;
  }

  async update(auth: AuthContext, req: Request, id: string, body: RoutingRuleUpdate): Promise<RoutingRule> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const current = await db.routingRule.findFirst({ where: { id } });
    if (!current) throw notFound('Routing rule');
    await this.checkRefs(db, body);
    const next = { teamId: body.teamId !== undefined ? body.teamId : current.teamId, userIds: body.userIds ?? current.userIds, fallbackOwnerId: body.fallbackOwnerId !== undefined ? body.fallbackOwnerId : current.fallbackOwnerId };
    if (!next.teamId && !next.userIds.length && !next.fallbackOwnerId) throw new AppException('VALIDATION_FAILED', 'Pick a team, some users or a fallback owner', { details: [{ path: 'teamId', message: 'Empty pool' }] });
    const row = await db.routingRule.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.conditions !== undefined ? { conditions: body.conditions as unknown as Prisma.InputJsonObject } : {}),
        ...(body.strategy !== undefined ? { strategy: body.strategy } : {}),
        ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
        ...(body.userIds !== undefined ? { userIds: [...new Set(body.userIds)] } : {}),
        ...(body.respectWorkingHours !== undefined ? { respectWorkingHours: body.respectWorkingHours } : {}),
        ...(body.respectAvailability !== undefined ? { respectAvailability: body.respectAvailability } : {}),
        ...(body.requireOnline !== undefined ? { requireOnline: body.requireOnline } : {}),
        ...(body.fallbackOwnerId !== undefined ? { fallbackOwnerId: body.fallbackOwnerId } : {}),
      },
    });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'routing.rule_update', entityType: 'routing_rule', entityId: id, diff: { changed: Object.keys(body) } }, actor.summary?.name);
    return (await this.toDto(db, [row]))[0]!;
  }

  async remove(auth: AuthContext, req: Request, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await db.routingRule.findFirst({ where: { id } });
    if (!row) throw notFound('Routing rule');
    await db.routingRule.deleteMany({ where: { id } });
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'routing.rule_delete', entityType: 'routing_rule', entityId: id, diff: { name: row.name } }, actor.summary?.name);
    return { ok: true };
  }

  async reorder(auth: AuthContext, ids: string[]): Promise<{ items: RoutingRule[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const rows = await db.routingRule.findMany({ select: { id: true } });
    const all = new Set(rows.map((r) => r.id));
    if (new Set(ids).size !== ids.length || ids.length !== all.size || ids.some((i) => !all.has(i))) throw new AppException('VALIDATION_FAILED', 'Send every rule exactly once');
    await db.$transaction(async (tx) => {
      for (const [priority, id] of ids.entries()) await tx.routingRule.update({ where: { id }, data: { priority } });
    });
    return this.list(auth);
  }

  // ---------------------------------------------------------------- engine

  /** Active pool members of a rule (team members + explicit users), sorted by name then id. */
  private async pool(db: TenantDb, rule: RuleRow): Promise<Array<{ id: string; summary: UserSummary }>> {
    const users = await db.user.findMany({
      where: { isActive: true, deletedAt: null, OR: [...(rule.teamId ? [{ teamId: rule.teamId }] : []), { id: { in: rule.userIds } }] },
      select: USER_SUMMARY_SELECT,
    });
    return users.map((u) => ({ id: u.id, summary: toUserSummary(u) })).sort((a, b) => a.summary.name.localeCompare(b.summary.name) || a.id.localeCompare(b.id));
  }

  private eligibility(rule: RuleRow, now: NowAvailability | undefined): string[] {
    const reasons: string[] = [];
    if (!now) return ['unknown user'];
    if (rule.respectWorkingHours && !now.inWorkingHours) reasons.push('outside working hours');
    if (rule.respectAvailability && now.onTimeOff) reasons.push('on time off');
    if (rule.respectAvailability && now.inMeeting) reasons.push('in a meeting');
    if (rule.requireOnline && (now.presence === null || now.presence === 'offline')) reasons.push('offline');
    return reasons;
  }

  private async evaluate(workspaceId: string, facts: RoutingLeadFacts, at: number) {
    const db = this.prisma.forTenant(workspaceId);
    const rules = await db.routingRule.findMany({ where: { active: true }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
    const checked: RoutingDecision['rules'] = [];
    for (const rule of rules) {
      const misses = routingConditionMisses(parseConditions(rule.conditions), facts);
      checked.push({ id: rule.id, name: rule.name, matched: !misses.length, reasons: misses.map((m) => `${m} does not match`) });
      if (misses.length) continue;
      const members = await this.pool(db, rule);
      const now = await this.availability.now(workspaceId, members.map((m) => m.id), at);
      const counts = members.length
        ? await db.lead.groupBy({ by: ['ownerId'], where: { ownerId: { in: members.map((m) => m.id) }, deletedAt: null, stage: { type: 'open' } }, _count: { _all: true } })
        : [];
      const open = new Map(counts.map((c) => [c.ownerId, c._count._all]));
      const pool: PoolUser[] = members.map((m) => {
        const reasons = this.eligibility(rule, now.get(m.id));
        return { id: m.id, summary: m.summary, openLeads: open.get(m.id) ?? 0, eligible: !reasons.length, reasons };
      });
      return { rule, pool, checked };
    }
    return { rule: null, pool: [] as PoolUser[], checked };
  }

  private pick(rule: RuleRow, pool: PoolUser[], lastAssignedUserId: string | null): string | null {
    const eligible = pool.filter((p) => p.eligible);
    if (!eligible.length) return null;
    if (strategyOf(rule.strategy) === 'least_busy') {
      return [...eligible].sort((a, b) => a.openLeads - b.openLeads || pool.indexOf(a) - pool.indexOf(b))[0]!.id;
    }
    return nextRoundRobin(pool.map((p) => p.id), new Set(eligible.map((p) => p.id)), lastAssignedUserId);
  }

  private async fallback(db: TenantDb, rule: RuleRow): Promise<string | null> {
    if (!rule.fallbackOwnerId) return null;
    return (await db.user.count({ where: { id: rule.fallbackOwnerId, isActive: true, deletedAt: null } })) === 1 ? rule.fallbackOwnerId : null;
  }

  /** Dry run for the test panel ("who would get this lead?"). Nothing is written. */
  async test(auth: AuthContext, body: RoutingTest): Promise<RoutingDecision> {
    const at = body.at ? Date.parse(body.at) : Date.now();
    const db = this.prisma.forTenant(auth.workspaceId);
    const { rule, pool, checked } = await this.evaluate(auth.workspaceId, body.lead, at);
    const candidates = pool.map((p) => ({ user: p.summary, eligible: p.eligible, reasons: p.reasons, openLeads: p.openLeads }));
    if (!rule) return { outcome: 'no_rule', rule: null, owner: null, rules: checked, candidates };
    const picked = this.pick(rule, pool, rule.lastAssignedUserId);
    const ruleRef = { id: rule.id, name: rule.name, strategy: strategyOf(rule.strategy) };
    if (picked) return { outcome: 'rule', rule: ruleRef, owner: pool.find((p) => p.id === picked)!.summary, rules: checked, candidates };
    const fb = await this.fallback(db, rule);
    if (!fb) return { outcome: 'no_eligible_user', rule: ruleRef, owner: null, rules: checked, candidates };
    const fbUser = await db.user.findFirst({ where: { id: fb }, select: USER_SUMMARY_SELECT });
    return { outcome: 'fallback', rule: ruleRef, owner: toUserSummary(fbUser), rules: checked, candidates };
  }

  /**
   * Route one new lead: the owner, and which rule decided. The round-robin cursor moves under a row lock;
   * routing errors never block lead creation (the lead stays unassigned and the error is logged).
   */
  async assign(workspaceId: string, facts: RoutingLeadFacts, at = Date.now()): Promise<RoutedOwner> {
    try {
      const { rule, pool } = await this.evaluate(workspaceId, facts, at);
      if (!rule) return { ownerId: null, rule: null, ruleId: null };
      const db = this.prisma.forTenant(workspaceId);
      const ownerId = await db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ lastAssignedUserId: string | null }>>`
          SELECT "lastAssignedUserId" FROM "RoutingRule" WHERE "id" = ${rule.id}::uuid AND "workspaceId" = ${workspaceId}::uuid FOR UPDATE`;
        if (!locked.length) return null;
        const picked = this.pick(rule, pool, locked[0]!.lastAssignedUserId);
        if (picked) await tx.routingRule.update({ where: { id: rule.id }, data: { lastAssignedUserId: picked, assignedCount: { increment: 1 }, lastAssignedAt: new Date(at) } });
        return picked;
      });
      if (ownerId) return { ownerId, rule: strategyOf(rule.strategy), ruleId: rule.id };
      const fb = await this.fallback(db, rule);
      return { ownerId: fb, rule: fb ? 'fallback' : null, ruleId: rule.id };
    } catch (err) {
      this.logger.error(`Lead routing failed: ${(err as Error).name}`);
      return { ownerId: null, rule: null, ruleId: null };
    }
  }
}
