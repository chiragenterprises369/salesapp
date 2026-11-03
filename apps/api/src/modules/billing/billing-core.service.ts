import { Injectable, Logger } from '@nestjs/common';
import {
  addBillingCycle,
  FEATURE_FLAGS,
  PlanDefinitionSchema,
  PLANS,
  type BillingCycle,
  type EventName,
  type EventPayload,
  type Plan,
  type PlanDefinition,
  type SubscriptionStatus,
} from '@vistar/shared';
import type { Prisma, Subscription as SubscriptionRow } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { publishSafe, SYSTEM_ACTOR } from '../leads/lib/context.js';
import { NotificationsService, type NotifyInput } from '../notifications/notifications.service.js';

const PLAN_CACHE_MS = 60_000;

/** Prisma transaction client (root) for billing writes that touch the subscription and the workspace mirror. */
export type BillingTx = Prisma.TransactionClient;

/**
 * Shared billing plumbing (D-072): plan catalogue (cached), the company's subscription (created lazily for
 * workspaces made before change #19 wave C or by seeds), the Workspace mirror (plan, trial status, trialEndsAt),
 * company admin notifications and billing events. Billing tables are tenant tables written with explicit
 * `workspaceId`; the plan catalogue, invoice series and webhook log are platform tables (root client).
 */
@Injectable()
export class BillingCoreService {
  private readonly logger = new Logger(BillingCoreService.name);
  private planCache: { at: number; plans: PlanDefinition[] } | null = null;

  constructor(
    readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
  ) {}

  /** Every plan definition (active or not), parsed; plans missing in the database get an unlimited free placeholder. */
  async plans(): Promise<PlanDefinition[]> {
    if (this.planCache && Date.now() - this.planCache.at < PLAN_CACHE_MS) return this.planCache.plans;
    const rows = await this.prisma.planDefinition.findMany();
    const parsed = PLANS.map((key) => {
      const row = rows.find((r) => r.key === key);
      const result = row ? PlanDefinitionSchema.safeParse({ ...row, overage: row.overage ?? null }) : null;
      if (result?.success) return result.data;
      if (row) this.logger.warn(`PlanDefinition ${key} does not match the contract; treated as unlimited`);
      return placeholderPlan(key);
    });
    this.planCache = { at: Date.now(), plans: parsed };
    return parsed;
  }

  async plan(key: Plan): Promise<PlanDefinition> {
    return (await this.plans()).find((p) => p.key === key) ?? placeholderPlan(key);
  }

  clearPlanCache(): void {
    this.planCache = null;
  }

  /** The subscription of a workspace; created from the workspace (plan, trial) when missing. */
  async ensure(workspaceId: string): Promise<SubscriptionRow> {
    const found = await this.prisma.subscription.findUnique({ where: { workspaceId } });
    if (found) return found;
    const ws = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { plan: true, status: true, trialEndsAt: true, createdAt: true } });
    if (!ws) throw new Error(`Workspace ${workspaceId} not found`);
    const trialing = ws.status === 'trial' && !!ws.trialEndsAt;
    const start = trialing ? ws.createdAt : startOfUtcDay(new Date());
    return this.prisma.subscription.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        plan: ws.plan,
        status: trialing ? 'trialing' : 'active',
        cycle: 'monthly',
        currentPeriodStart: start,
        currentPeriodEnd: trialing ? ws.trialEndsAt! : addBillingCycle(start, 'monthly'),
        trialEndsAt: trialing ? ws.trialEndsAt : null,
      },
      update: {},
    });
  }

  async companyName(workspaceId: string): Promise<string> {
    return (await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { name: true } }))?.name ?? 'Company';
  }

  /** Subscriptions for every live workspace that has none yet (seeded or older workspaces); same rules as the migration. */
  async ensureAll(): Promise<number> {
    return this.prisma.$executeRaw`
      INSERT INTO "Subscription" ("id", "workspaceId", "plan", "status", "cycle", "currentPeriodStart", "currentPeriodEnd", "trialEndsAt", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), w."id", w."plan",
        CASE WHEN w."status" = 'trial' AND w."trialEndsAt" IS NOT NULL THEN 'trialing'::"SubscriptionStatus" ELSE 'active'::"SubscriptionStatus" END,
        'monthly'::"BillingCycle",
        CASE WHEN w."status" = 'trial' AND w."trialEndsAt" IS NOT NULL THEN w."createdAt" ELSE date_trunc('day', now()) END,
        CASE WHEN w."status" = 'trial' AND w."trialEndsAt" IS NOT NULL THEN w."trialEndsAt" ELSE date_trunc('day', now()) + interval '1 month' END,
        CASE WHEN w."status" = 'trial' THEN w."trialEndsAt" ELSE NULL END,
        now(), now()
      FROM "Workspace" w
      WHERE w."deletedAt" IS NULL AND NOT EXISTS (SELECT 1 FROM "Subscription" s WHERE s."workspaceId" = w."id")
      ON CONFLICT ("workspaceId") DO NOTHING`;
  }

  /**
   * Change the plan, cycle, seats, period and status in one go and mirror plan, trial status and trialEndsAt on the
   * Workspace (feature flags and pack entitlements read Workspace.plan). Suspended or deleted workspaces keep their
   * status. Bumps the subscription version.
   */
  async apply(
    tx: BillingTx,
    sub: SubscriptionRow,
    change: Partial<{ plan: Plan; cycle: BillingCycle; extraSeats: number; status: SubscriptionStatus; periodStart: Date; periodEnd: Date; trialEndsAt: Date | null; pendingPlan: Plan | null; pendingCycle: BillingCycle | null; pastDueSince: Date | null; cancelledAt: Date | null; dunningStep: number; trialReminderAt: Date | null }>,
  ): Promise<SubscriptionRow> {
    const data: Prisma.SubscriptionUncheckedUpdateInput = { version: { increment: 1 } };
    if (change.plan !== undefined) data.plan = change.plan;
    if (change.cycle !== undefined) data.cycle = change.cycle;
    if (change.extraSeats !== undefined) data.extraSeats = change.extraSeats;
    if (change.status !== undefined) data.status = change.status;
    if (change.periodStart !== undefined) data.currentPeriodStart = change.periodStart;
    if (change.periodEnd !== undefined) data.currentPeriodEnd = change.periodEnd;
    if (change.trialEndsAt !== undefined) data.trialEndsAt = change.trialEndsAt;
    if (change.pendingPlan !== undefined) data.pendingPlan = change.pendingPlan;
    if (change.pendingCycle !== undefined) data.pendingCycle = change.pendingCycle;
    if (change.pastDueSince !== undefined) data.pastDueSince = change.pastDueSince;
    if (change.cancelledAt !== undefined) data.cancelledAt = change.cancelledAt;
    if (change.dunningStep !== undefined) data.dunningStep = change.dunningStep;
    if (change.trialReminderAt !== undefined) data.trialReminderAt = change.trialReminderAt;
    const updated = await tx.subscription.update({ where: { id: sub.id }, data });
    const ws: Prisma.WorkspaceUpdateInput = {};
    if (change.plan !== undefined) ws.plan = change.plan;
    if (change.trialEndsAt !== undefined) ws.trialEndsAt = change.trialEndsAt;
    if (Object.keys(ws).length) await tx.workspace.update({ where: { id: sub.workspaceId }, data: ws });
    if (change.status !== undefined) {
      await tx.workspace.updateMany({ where: { id: sub.workspaceId, status: { in: ['trial', 'active'] } }, data: { status: updated.status === 'trialing' ? 'trial' : 'active' } });
    }
    return updated;
  }

  /** Users who manage billing (billing.manage in their role; company admins by default). */
  async billingAdmins(workspaceId: string): Promise<string[]> {
    const rows = await this.prisma.forTenant(workspaceId).user.findMany({
      where: { isActive: true, deletedAt: null, role: { permissions: { has: 'billing.manage' } } },
      select: { id: true },
      take: 50,
    });
    return rows.map((r) => r.id);
  }

  async notifyAdmins(workspaceId: string, input: NotifyInput): Promise<void> {
    for (const userId of await this.billingAdmins(workspaceId)) {
      try {
        await this.notifications.notify(workspaceId, userId, input, SYSTEM_ACTOR);
      } catch (err) {
        this.logger.error(`Billing notification ${input.type} failed: ${(err as Error).name}`);
      }
    }
  }

  async publish<E extends EventName>(type: E, workspaceId: string, payload: EventPayload<E>): Promise<void> {
    await publishSafe(this.events, this.logger, type, workspaceId, payload, { actor: SYSTEM_ACTOR });
  }
}

export function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Plan row missing or invalid: unlimited, free, inactive (so it is never offered). */
function placeholderPlan(key: Plan): PlanDefinition {
  return {
    key,
    name: key.charAt(0).toUpperCase() + key.slice(1),
    priceInrMonthly: 0,
    priceInrYearly: 0,
    limits: { seats: null, leads: null, whatsappMessagesPerMonth: null, workflowRunsPerMonth: null, storageMb: null, apiKeys: null, apiCallsPerMonth: null },
    features: Object.fromEntries(FEATURE_FLAGS.map((f) => [f, false])) as PlanDefinition['features'],
    overage: null,
    trialDays: 0,
    isActive: false,
  };
}
