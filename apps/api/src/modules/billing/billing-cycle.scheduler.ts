import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  addBillingCycle,
  BILLING_DUNNING_DAYS,
  BILLING_GRACE_DAYS,
  BILLING_TRIAL_REMINDER_DAYS,
  daysLeft,
  formatPaise,
  planPricePaise,
  USAGE_METRICS,
  type PlanDefinition,
} from '@vistar/shared';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Subscription as SubscriptionRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { BillingCoreService } from './billing-core.service.js';
import { BillingProfileService } from './billing-profile.service.js';
import { istToday, n, toDbDate, toSubscription } from './billing.mapper.js';
import { PlatformInvoicesService } from './platform-invoices.service.js';
import { UsageService } from './usage.service.js';

const LEASE_KEY = 'vistar:billing:cycle';
const LEASE_MS = 10 * 60_000;
const BATCH = 200;
const DAY = 86_400_000;
const fmt = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('-');

/**
 * Billing cycle (D-072), every 15 minutes on one instance (Redis lease; a per-instance flag without Redis):
 * 1. subscriptions for workspaces without one; 2. trial reminders (BILLING_TRIAL_REMINDER_DAYS before the end);
 * 3. trial end (free plan: active; paid plan: active with the first period invoice); 4. period end (scheduled
 * downgrade applied, next period, renewal invoice); 5. overdue invoices -> past_due; 6. reminders on days 0, 3, 7
 * overdue; 7. after BILLING_GRACE_DAYS past due -> cancelled on the free plan. Each step claims its rows with
 * conditional updates, so a crash or a second instance never acts twice. Daily at 02:30 IST: usage snapshot.
 */
@Injectable()
export class BillingCycleScheduler {
  private readonly logger = new Logger(BillingCycleScheduler.name);
  private running = false;
  private profileWarned = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BillingCoreService,
    private readonly invoices: PlatformInvoicesService,
    private readonly profiles: BillingProfileService,
    private readonly usage: UsageService,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  @Cron('*/15 * * * *', { name: 'billing-cycle' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const token = randomUUID();
    try {
      if (!(await this.lease(token))) return;
      await this.run(new Date());
    } catch (err) {
      this.logger.error(`Billing cycle failed: ${(err as Error).name}: ${(err as Error).message.slice(0, 200)}`);
    } finally {
      await this.release(token);
      this.running = false;
    }
  }

  private async lease(token: string): Promise<boolean> {
    if (!this.redis || this.redis.status !== 'ready') return true;
    return (await this.redis.set(LEASE_KEY, token, 'PX', LEASE_MS, 'NX')) === 'OK';
  }

  private async release(token: string): Promise<void> {
    if (!this.redis || this.redis.status !== 'ready') return;
    try {
      if ((await this.redis.get(LEASE_KEY)) === token) await this.redis.del(LEASE_KEY);
    } catch {
      // the lease expires on its own
    }
  }

  /** One full pass (exposed for tests). */
  async run(now: Date): Promise<void> {
    await this.core.ensureAll();
    await this.trialReminders(now);
    await this.trialEnds(now);
    await this.periodEnds(now);
    await this.periodInvoices(now);
    await this.overdue(now);
    await this.dunning(now);
    await this.grace(now);
  }

  private async plan(key: SubscriptionRow['plan']): Promise<PlanDefinition> {
    return this.core.plan(key);
  }

  private async publishSub(sub: SubscriptionRow): Promise<void> {
    await this.core.publish('billing.subscription_updated', sub.workspaceId, { subscription: toSubscription(sub, await this.plan(sub.plan)) });
  }

  async trialReminders(now: Date): Promise<void> {
    const rows = await this.prisma.subscription.findMany({ where: { status: 'trialing', trialReminderAt: null, trialEndsAt: { gt: now, lte: new Date(now.getTime() + BILLING_TRIAL_REMINDER_DAYS * DAY) } }, take: BATCH });
    for (const sub of rows) {
      const { count } = await this.prisma.subscription.updateMany({ where: { id: sub.id, trialReminderAt: null }, data: { trialReminderAt: now } });
      if (!count) continue;
      const days = Math.max(1, daysLeft(sub.trialEndsAt!, now));
      const plan = await this.plan(sub.plan);
      await this.core.notifyAdmins(sub.workspaceId, {
        type: 'billing_trial_ending',
        title: `Your trial ends in ${days} day${days === 1 ? '' : 's'}`,
        body: planPricePaise(plan, sub.cycle, sub.extraSeats) > 0 ? `The ${plan.name} plan then costs ${formatPaise(planPricePaise(plan, sub.cycle, sub.extraSeats))} a ${sub.cycle === 'yearly' ? 'year' : 'month'} plus GST` : `You stay on the ${plan.name} plan`,
        path: '/billing',
        data: { trialEndsAt: sub.trialEndsAt!.toISOString() },
      });
    }
  }

  async trialEnds(now: Date): Promise<void> {
    const rows = await this.prisma.subscription.findMany({ where: { status: 'trialing', trialEndsAt: { lte: now } }, take: BATCH });
    for (const sub of rows) {
      let start = sub.trialEndsAt!;
      let end = addBillingCycle(start, sub.cycle);
      while (end <= now) {
        start = end;
        end = addBillingCycle(start, sub.cycle);
      }
      const periodStart = start;
      const next = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.subscription.updateMany({ where: { id: sub.id, status: 'trialing', trialEndsAt: { lte: now } }, data: { status: 'active', version: { increment: 1 } } });
        if (!count) return null;
        return this.core.apply(tx, { ...sub, status: 'active' }, { status: 'active', trialEndsAt: null, periodStart, periodEnd: end });
      });
      if (next) await this.publishSub(next);
    }
  }

  async periodEnds(now: Date): Promise<void> {
    const rows = await this.prisma.subscription.findMany({ where: { status: { in: ['active', 'past_due'] }, currentPeriodEnd: { lte: now } }, take: BATCH });
    for (const sub of rows) {
      const plan = sub.pendingPlan ?? sub.plan;
      const cycle = sub.pendingCycle ?? sub.cycle;
      let start = sub.currentPeriodEnd;
      let end = addBillingCycle(start, cycle);
      // a long outage skips to the period that contains now (one invoice, not one per missed period)
      while (end <= now) {
        start = end;
        end = addBillingCycle(start, cycle);
      }
      const next = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.subscription.updateMany({ where: { id: sub.id, currentPeriodEnd: sub.currentPeriodEnd, status: { in: ['active', 'past_due'] } }, data: { version: { increment: 1 } } });
        if (!count) return null;
        return this.core.apply(tx, sub, { plan, cycle, periodStart: start, periodEnd: end, pendingPlan: null, pendingCycle: null });
      });
      if (next) await this.publishSub(next);
    }
  }

  /** The invoice of the current period for paid plans (any invoice whose period starts with it counts). */
  async periodInvoices(now: Date): Promise<void> {
    const profile = await this.profiles.load();
    if (!BillingProfileService.complete(profile)) {
      if (!this.profileWarned) this.logger.warn('Vistar billing profile is not saved: renewal invoices wait (Super Admin > Billing > Profile)');
      this.profileWarned = true;
      return;
    }
    this.profileWarned = false;
    const rows = await this.prisma.subscription.findMany({ where: { status: { in: ['active', 'past_due'] }, currentPeriodStart: { lte: now } }, take: 2000 });
    for (const sub of rows) {
      const plan = await this.plan(sub.plan);
      const price = planPricePaise(plan, sub.cycle, sub.extraSeats);
      if (price <= 0) continue;
      const periodStart = toDbDate(sub.currentPeriodStart.toISOString().slice(0, 10));
      const exists = await this.prisma.platformInvoice.count({ where: { workspaceId: sub.workspaceId, periodStart } });
      if (exists) continue;
      const lastDay = new Date(sub.currentPeriodEnd.getTime() - 1);
      const lines = [{ name: `${plan.name} plan, ${sub.cycle}`, description: `Service period ${fmt(sub.currentPeriodStart)} to ${fmt(lastDay)}`, unitPricePaise: planPricePaise(plan, sub.cycle, 0), quantity: 1 }];
      if (sub.extraSeats > 0 && planPricePaise(plan, sub.cycle, sub.extraSeats) > planPricePaise(plan, sub.cycle, 0)) {
        lines.push({ name: 'Extra users', description: `${sub.extraSeats} users beyond the plan`, unitPricePaise: Math.round((planPricePaise(plan, sub.cycle, sub.extraSeats) - planPricePaise(plan, sub.cycle, 0)) / sub.extraSeats), quantity: sub.extraSeats });
      }
      try {
        const row = await this.invoices.create(sub.workspaceId, { kind: 'subscription', lines, plan: sub.plan, cycle: sub.cycle, extraSeats: sub.extraSeats, periodStart: sub.currentPeriodStart, periodEnd: lastDay, issueDate: istToday(now) }, true);
        await this.invoices.afterIssue(row);
      } catch (err) {
        this.logger.error(`Renewal invoice failed for a workspace: ${(err as Error).name}`);
      }
    }
  }

  async overdue(now: Date): Promise<void> {
    const today = toDbDate(istToday(now));
    const late = await this.prisma.platformInvoice.findMany({ where: { status: 'issued', dueDate: { lt: today } }, select: { workspaceId: true }, distinct: ['workspaceId'], take: 2000 });
    for (const { workspaceId } of late) {
      const sub = await this.prisma.subscription.findUnique({ where: { workspaceId } });
      if (!sub || sub.status !== 'active') continue;
      const next = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.subscription.updateMany({ where: { id: sub.id, status: 'active' }, data: { version: { increment: 1 } } });
        if (!count) return null;
        return this.core.apply(tx, sub, { status: 'past_due', pastDueSince: now, dunningStep: 0 });
      });
      if (next) await this.publishSub(next);
    }
  }

  async dunning(now: Date): Promise<void> {
    const today = istToday(now);
    const rows = await this.prisma.subscription.findMany({ where: { status: 'past_due', dunningStep: { lt: BILLING_DUNNING_DAYS.length } }, take: BATCH });
    for (const sub of rows) {
      const oldest = await this.prisma.platformInvoice.findFirst({ where: { workspaceId: sub.workspaceId, status: 'issued', dueDate: { lt: toDbDate(today) } }, orderBy: { dueDate: 'asc' } });
      if (!oldest?.dueDate) continue;
      const overdueDays = Math.floor((toDbDate(today).getTime() - oldest.dueDate.getTime()) / DAY) - 1;
      let step = sub.dunningStep;
      while (step < BILLING_DUNNING_DAYS.length && overdueDays >= BILLING_DUNNING_DAYS[step]!) step++;
      if (step === sub.dunningStep) continue;
      const { count } = await this.prisma.subscription.updateMany({ where: { id: sub.id, dunningStep: sub.dunningStep, status: 'past_due' }, data: { dunningStep: step, lastDunningAt: now } });
      if (!count) continue;
      const left = Math.max(0, BILLING_GRACE_DAYS - Math.floor((now.getTime() - (sub.pastDueSince ?? now).getTime()) / DAY));
      await this.core.notifyAdmins(sub.workspaceId, {
        type: 'billing_payment_failed',
        title: `Payment overdue: invoice ${oldest.number ?? ''}`.trim(),
        body: `${formatPaise(n(oldest.totalPaise) - n(oldest.paidPaise))} was due on ${fmt(oldest.dueDate)}. Pay within ${left} day${left === 1 ? '' : 's'} to keep your plan`,
        path: `/billing?invoice=${oldest.id}`,
        data: { invoiceId: oldest.id, step },
      });
    }
  }

  async grace(now: Date): Promise<void> {
    const rows = await this.prisma.subscription.findMany({ where: { status: 'past_due', pastDueSince: { lte: new Date(now.getTime() - BILLING_GRACE_DAYS * DAY) } }, take: BATCH });
    for (const sub of rows) {
      const next = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.subscription.updateMany({ where: { id: sub.id, status: 'past_due' }, data: { version: { increment: 1 } } });
        if (!count) return null;
        return this.core.apply(tx, sub, { status: 'cancelled', plan: 'free', cycle: 'monthly', extraSeats: 0, cancelledAt: now, pendingPlan: null, pendingCycle: null, periodStart: now, periodEnd: addBillingCycle(now, 'monthly') });
      });
      if (!next) continue;
      await this.publishSub(next);
      await this.core.notifyAdmins(sub.workspaceId, {
        type: 'billing_payment_failed',
        title: 'Your Vistar subscription was cancelled',
        body: `The invoice stayed unpaid for ${BILLING_GRACE_DAYS} days, so the company moved to the Free plan. Your data is kept; pay the invoice or upgrade to restore the limits`,
        path: '/billing',
        data: { subscriptionId: sub.id },
      });
    }
  }

  /** 02:30 IST: UsageCounter snapshot of every metric and usage alerts for meters at 80 % or more. */
  @Cron('30 21 * * *', { name: 'billing-usage-reconcile' })
  async reconcile(): Promise<void> {
    const token = randomUUID();
    try {
      if (this.redis && this.redis.status === 'ready' && (await this.redis.set(`${LEASE_KEY}:usage`, token, 'PX', LEASE_MS, 'NX')) !== 'OK') return;
      const snapshot = await this.usage.reconcile(new Date());
      const subs = await this.prisma.subscription.findMany({ where: { workspaceId: { in: [...snapshot.keys()] } }, select: { workspaceId: true, plan: true, extraSeats: true } });
      for (const sub of subs) {
        const values = snapshot.get(sub.workspaceId);
        if (!values) continue;
        const plan = await this.plan(sub.plan);
        for (const metric of USAGE_METRICS) {
          const meter = this.usage.meter(metric, values[metric], plan, sub.extraSeats);
          if (meter.state !== 'ok') await this.core.publish('billing.usage_alert', sub.workspaceId, { meter, blocked: false });
        }
      }
      this.logger.log(`Usage snapshot for ${snapshot.size} workspace(s)`);
    } catch (err) {
      this.logger.error(`Usage reconcile failed: ${(err as Error).name}`);
    }
  }
}
