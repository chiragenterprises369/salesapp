import { Injectable } from '@nestjs/common';
import {
  addBillingCycle,
  isUpgrade,
  PLANS,
  planChangeAmountPaise,
  planPricePaise,
  SUBSCRIPTION_STATUSES,
  type BillingContact,
  type BillingOverview,
  type BillingUsage,
  type CompanyBilling,
  type ManualInvoiceCreate,
  type PlanChangeCreate,
  type PlanChangeRequest,
  type PlanChangeResult,
  type PlanDefinition,
  type PlanRequestDecide,
  type PlatformInvoice,
  type PlatformInvoiceMarkPaid,
  type SubscriptionList,
  type SubscriptionStatus,
  type SuperPlanChange,
  type TrialExtend,
} from '@vistar/shared';
import type { Request } from 'express';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext, PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma, Subscription as SubscriptionRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { afterTimeCursor, nextTimeCursor } from '../leads/lib/cursor.js';
import { BillingCoreService } from './billing-core.service.js';
import { BillingProfileService } from './billing-profile.service.js';
import { istToday, n, toDbDate, toInvoiceListItem, toPayment, toRequest, toSubscription } from './billing.mapper.js';
import { CheckoutService } from './checkout.service.js';
import { PlatformInvoicesService } from './platform-invoices.service.js';
import { UsageService } from './usage.service.js';

const fmt = (d: Date) => d.toISOString().slice(0, 10).split('-').reverse().join('-');

/**
 * Subscriptions (D-072): the company Billing page (overview, usage, plans, contact, plan change) and the Super Admin
 * billing (list with totals, company billing, trial extension, plan change, plan requests, manual invoices). Every
 * Super Admin change is audited in PlatformAuditLog and the company's AuditLog; company changes in its AuditLog.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly core: BillingCoreService,
    private readonly usage: UsageService,
    private readonly invoices: PlatformInvoicesService,
    private readonly checkout: CheckoutService,
    private readonly profiles: BillingProfileService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- company

  async overview(workspaceId: string): Promise<BillingOverview> {
    const sub = await this.core.ensure(workspaceId);
    const plan = await this.core.plan(sub.plan);
    const today = toDbDate(istToday());
    const [usage, checkout, pending, open] = await Promise.all([
      this.usage.usage(workspaceId, plan, sub.extraSeats),
      this.checkout.availability(),
      this.prisma.planChangeRequest.findFirst({ where: { workspaceId, status: 'pending' }, orderBy: { createdAt: 'desc' } }),
      this.prisma.platformInvoice.findMany({ where: { workspaceId, status: 'issued' }, select: { totalPaise: true, paidPaise: true, dueDate: true } }),
    ]);
    const name = await this.core.companyName(workspaceId);
    const requestedBy = pending?.requestedById ? await this.userSummary(workspaceId, pending.requestedById) : null;
    const paidPlan = planPricePaise(plan, sub.cycle, sub.extraSeats) > 0;
    return {
      subscription: toSubscription(sub, plan),
      plan,
      usage,
      checkout,
      pendingRequest: pending ? toRequest(pending, name, requestedBy) : null,
      openInvoices: {
        count: open.length,
        balancePaise: open.reduce((s, i) => s + Math.max(0, n(i.totalPaise) - n(i.paidPaise)), 0),
        overdue: open.filter((i) => i.dueDate && i.dueDate < today).length,
      },
      nextInvoiceAt: sub.status === 'cancelled' ? null : sub.status === 'trialing' ? (paidPlan ? (sub.trialEndsAt?.toISOString() ?? null) : null) : paidPlan || sub.pendingPlan ? sub.currentPeriodEnd.toISOString() : null,
    };
  }

  async usageOf(workspaceId: string): Promise<BillingUsage> {
    const sub = await this.core.ensure(workspaceId);
    return this.usage.usage(workspaceId, await this.core.plan(sub.plan), sub.extraSeats);
  }

  async activePlans(): Promise<{ items: PlanDefinition[] }> {
    return { items: (await this.core.plans()).filter((p) => p.isActive) };
  }

  async updateContact(auth: AuthContext, req: Request, body: BillingContact): Promise<BillingContact> {
    const sub = await this.core.ensure(auth.workspaceId);
    const updated = await this.prisma.subscription.update({ where: { id: sub.id }, data: { billingContact: body as unknown as Prisma.InputJsonObject, version: { increment: 1 } } });
    await this.audit.record(auth, req, { action: 'billing.contact_update', entityType: 'subscription', entityId: sub.id, diff: { name: body.name, gstin: body.gstin, stateCode: body.address?.stateCode ?? null } });
    await this.core.publish('billing.subscription_updated', auth.workspaceId, { subscription: toSubscription(updated, await this.core.plan(updated.plan)) });
    return body;
  }

  private async userSummary(workspaceId: string, userId: string) {
    const u = await this.prisma.forTenant(workspaceId).user.findFirst({ where: { id: userId }, select: USER_SUMMARY_SELECT });
    return u ? toUserSummary(u) : null;
  }

  /** Over-limit warnings when moving to `plan` (shown before a downgrade takes effect). */
  private async warningsFor(workspaceId: string, sub: SubscriptionRow, plan: PlanDefinition): Promise<string[]> {
    const usage = await this.usage.usage(workspaceId, plan, sub.extraSeats);
    return usage.meters.filter((m) => m.limit !== null && m.used > m.limit).map((m) => `${m.label}: ${m.used} in use, the ${plan.name} plan allows ${m.limit}. New ones are blocked until you are under the limit.`);
  }

  /**
   * Company plan change. Upgrades (higher monthly price, or monthly to yearly) need payment: with checkout a prorated
   * plan_change invoice is issued and the checkout returned (the plan changes when it is paid); without checkout,
   * or while the Vistar billing profile is incomplete, a request goes to the Super Admin. Downgrades wait for the
   * period end, except during a trial or on a free plan where they apply at once.
   */
  async changePlan(auth: AuthContext, req: Request, body: PlanChangeCreate): Promise<PlanChangeResult> {
    const wid = auth.workspaceId;
    const sub = await this.core.ensure(wid);
    const from = await this.core.plan(sub.plan);
    const to = await this.core.plan(body.plan);
    const cycle = body.cycle ?? sub.cycle;
    if (!to.isActive) throw new AppException('PLAN_CHANGE_INVALID', 'This plan is not available');
    if (to.key === sub.plan && cycle === sub.cycle && sub.status !== 'cancelled') throw new AppException('PLAN_CHANGE_INVALID', 'You are already on this plan');
    const now = new Date();
    const fromPrice = planPricePaise(from, sub.cycle, sub.extraSeats);
    const toPrice = planPricePaise(to, cycle, sub.extraSeats);
    const upgrade = isUpgrade(from, to) || (to.key === from.key && cycle === 'yearly' && sub.cycle === 'monthly') || (sub.status === 'cancelled' && toPrice > 0);
    const name = await this.core.companyName(wid);
    const auditChange = (outcome: string, extra: Record<string, unknown> = {}) =>
      this.audit.record(auth, req, { action: 'billing.plan_change', entityType: 'subscription', entityId: sub.id, diff: { from: { plan: sub.plan, cycle: sub.cycle }, to: { plan: to.key, cycle }, outcome, ...extra } });

    if (!upgrade) {
      const warnings = await this.warningsFor(wid, sub, to);
      const immediate = sub.status === 'trialing' || fromPrice === 0;
      const next = await this.prisma.$transaction(async (tx) => {
        await tx.planChangeRequest.updateMany({ where: { workspaceId: wid, status: 'pending' }, data: { status: 'cancelled', decidedAt: now, decisionNote: 'Replaced by a new plan change' } });
        if (immediate) {
          const toFree = toPrice === 0;
          return this.core.apply(tx, sub, {
            plan: to.key,
            cycle,
            pendingPlan: null,
            pendingCycle: null,
            ...(sub.status === 'trialing' && toFree ? { status: 'active' as SubscriptionStatus, trialEndsAt: null, periodStart: now, periodEnd: addBillingCycle(now, cycle) } : {}),
          });
        }
        return this.core.apply(tx, sub, { pendingPlan: to.key, pendingCycle: cycle });
      });
      await auditChange(immediate ? 'applied' : 'scheduled');
      const dto = toSubscription(next, await this.core.plan(next.plan));
      await this.core.publish('billing.subscription_updated', wid, { subscription: dto });
      return { outcome: immediate ? 'applied' : 'scheduled', subscription: dto, checkout: null, invoice: null, request: null, warnings };
    }

    const restart = sub.status === 'trialing' || sub.status === 'cancelled' || fromPrice === 0 || cycle !== sub.cycle;
    const amount = planChangeAmountPaise({ fromPricePaise: fromPrice, toPricePaise: toPrice, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, now, restart, fromPaid: sub.status === 'active' || sub.status === 'past_due' });
    const periodStart = restart ? now : sub.currentPeriodStart;
    const periodEnd = restart ? addBillingCycle(now, cycle) : sub.currentPeriodEnd;

    if (amount === 0) {
      const next = await this.prisma.$transaction((tx) => this.core.apply(tx, sub, { plan: to.key, cycle, status: 'active', trialEndsAt: null, periodStart, periodEnd, pendingPlan: null, pendingCycle: null, cancelledAt: null }));
      await auditChange('applied');
      const dto = toSubscription(next, to);
      await this.core.publish('billing.subscription_updated', wid, { subscription: dto });
      return { outcome: 'applied', subscription: dto, checkout: null, invoice: null, request: null, warnings: [] };
    }

    const availability = await this.checkout.availability();
    const profileReady = (await this.profiles.response()).complete;
    if (!availability.available || !profileReady) {
      const request = await this.prisma.$transaction(async (tx) => {
        await tx.planChangeRequest.updateMany({ where: { workspaceId: wid, status: 'pending' }, data: { status: 'cancelled', decidedAt: now, decisionNote: 'Replaced by a new request' } });
        return tx.planChangeRequest.create({ data: { workspaceId: wid, fromPlan: sub.plan, toPlan: to.key, cycle, note: body.note ?? null, requestedById: auth.userId } });
      });
      await auditChange('requested', { requestId: request.id });
      const requestedBy = auth.userId ? await this.userSummary(wid, auth.userId) : null;
      return { outcome: 'requested', subscription: toSubscription(sub, from), checkout: null, invoice: null, request: toRequest(request, name, requestedBy), warnings: [] };
    }

    const invoice = await this.prisma.$transaction(async (tx) => {
      // one open upgrade at a time: an unpaid earlier upgrade invoice is replaced
      await tx.platformInvoice.updateMany({ where: { workspaceId: wid, kind: 'plan_change', status: 'issued', paidPaise: 0 }, data: { status: 'cancelled', cancelledAt: now, cancelReason: 'Replaced by a new plan change' } });
      const label = restart ? `${to.name} plan, ${cycle}` : `Upgrade to ${to.name}, rest of the period (prorated)`;
      return this.invoices.create(
        wid,
        {
          kind: 'plan_change',
          lines: [{ name: label, description: `From ${from.name}. Service period ${fmt(periodStart)} to ${fmt(periodEnd)}`, unitPricePaise: amount, quantity: 1 }],
          plan: to.key,
          cycle,
          extraSeats: sub.extraSeats,
          periodStart,
          periodEnd,
          dueDate: istToday(now),
        },
        true,
        tx,
      );
    });
    await auditChange('checkout', { invoiceId: invoice.id, amountPaise: n(invoice.totalPaise) });
    await this.invoices.afterIssue(invoice);
    const user = auth.userId ? await this.prisma.forTenant(wid).user.findFirst({ where: { id: auth.userId }, select: { name: true, email: true, phone: true } }) : null;
    const checkout = await this.checkout.start(wid, invoice.id, { name: user?.name ?? null, email: user?.email ?? null, contact: user?.phone ?? null });
    return { outcome: 'checkout', subscription: toSubscription(sub, from), checkout, invoice: toInvoiceListItem(invoice, name), request: null, warnings: [] };
  }

  /** Cancel the scheduled downgrade and any pending request. */
  async cancelChange(auth: AuthContext, req: Request): Promise<BillingOverview> {
    const wid = auth.workspaceId;
    const sub = await this.core.ensure(wid);
    const now = new Date();
    const next = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.planChangeRequest.updateMany({ where: { workspaceId: wid, status: 'pending' }, data: { status: 'cancelled', decidedAt: now, decisionNote: 'Cancelled by the company' } });
      const changed = sub.pendingPlan ? await this.core.apply(tx, sub, { pendingPlan: null, pendingCycle: null }) : sub;
      return { changed, count };
    });
    if (sub.pendingPlan || next.count) {
      await this.audit.record(auth, req, { action: 'billing.plan_change_cancel', entityType: 'subscription', entityId: sub.id, diff: { pendingPlan: sub.pendingPlan, requests: next.count } });
      await this.core.publish('billing.subscription_updated', wid, { subscription: toSubscription(next.changed, await this.core.plan(next.changed.plan)) });
    }
    return this.overview(wid);
  }

  // ---------------------------------------------------------------- Super Admin

  private async adminName(adminId: string): Promise<string | null> {
    return (await this.prisma.platformAdmin.findUnique({ where: { id: adminId }, select: { name: true } }))?.name ?? null;
  }

  private async liveWorkspace(id: string) {
    const ws = await this.prisma.workspace.findUnique({ where: { id }, select: { id: true, name: true, slug: true, status: true, deletedAt: true } });
    if (!ws || ws.deletedAt) throw notFound('Company');
    return ws;
  }

  async list(q: { cursor?: string; limit: number; q?: string; status?: SubscriptionStatus; plan?: SubscriptionRow['plan']; cycle?: SubscriptionRow['cycle']; overdue?: boolean; trialEndingDays?: number }): Promise<SubscriptionList> {
    await this.core.ensureAll();
    const today = toDbDate(istToday());
    const and: Prisma.SubscriptionWhereInput[] = [{ workspace: { deletedAt: null } }];
    const search = q.q?.trim();
    if (search) and.push({ workspace: { OR: [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search.toLowerCase() } }] } });
    if (q.status) and.push({ status: q.status });
    if (q.plan) and.push({ plan: q.plan });
    if (q.cycle) and.push({ cycle: q.cycle });
    if (q.overdue) and.push({ workspace: { platformInvoices: { some: { status: 'issued', dueDate: { lt: today } } } } });
    if (q.trialEndingDays) and.push({ status: 'trialing', trialEndsAt: { lte: new Date(Date.now() + q.trialEndingDays * 86_400_000) } });
    const where: Prisma.SubscriptionWhereInput = { AND: and };
    const after = afterTimeCursor(q.cursor);
    const [rows, all, plans] = await Promise.all([
      this.prisma.subscription.findMany({ where: { AND: [...and, ...(Object.keys(after).length ? [after as Prisma.SubscriptionWhereInput] : [])] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1, include: { workspace: { select: { id: true, name: true, slug: true, status: true } } } }),
      this.prisma.subscription.findMany({ where, select: { workspaceId: true, plan: true, cycle: true, extraSeats: true, status: true } }),
      this.core.plans(),
    ]);
    const planBy = new Map(plans.map((p) => [p.key, p]));
    const mrrOf = (s: { plan: SubscriptionRow['plan']; cycle: SubscriptionRow['cycle']; extraSeats: number; status: SubscriptionStatus }) => {
      if (s.status !== 'active' && s.status !== 'past_due') return 0;
      const price = planPricePaise(planBy.get(s.plan)!, s.cycle, s.extraSeats);
      return s.cycle === 'yearly' ? Math.round(price / 12) : price;
    };
    const allIds = all.map((s) => s.workspaceId);
    const page = rows.slice(0, q.limit);
    const pageIds = page.map((r) => r.workspaceId);
    const [openAll, seats, lastPaid, pendingReqs] = await Promise.all([
      allIds.length ? this.prisma.platformInvoice.findMany({ where: { workspaceId: { in: allIds }, status: 'issued' }, select: { workspaceId: true, totalPaise: true, paidPaise: true, dueDate: true } }) : Promise.resolve([]),
      pageIds.length ? this.prisma.user.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: pageIds }, isActive: true, deletedAt: null }, _count: { _all: true } }) : Promise.resolve([]),
      pageIds.length ? this.prisma.platformPayment.groupBy({ by: ['workspaceId'], where: { workspaceId: { in: pageIds }, status: 'captured' }, _max: { createdAt: true } }) : Promise.resolve([]),
      pageIds.length ? this.prisma.planChangeRequest.findMany({ where: { workspaceId: { in: pageIds }, status: 'pending' }, select: { workspaceId: true } }) : Promise.resolve([]),
    ]);
    const outstanding = new Map<string, number>();
    const overdueBy = new Map<string, number>();
    for (const inv of openAll) {
      outstanding.set(inv.workspaceId, (outstanding.get(inv.workspaceId) ?? 0) + Math.max(0, n(inv.totalPaise) - n(inv.paidPaise)));
      if (inv.dueDate && inv.dueDate < today) overdueBy.set(inv.workspaceId, (overdueBy.get(inv.workspaceId) ?? 0) + 1);
    }
    const seatsBy = new Map(seats.map((s) => [s.workspaceId, s._count._all]));
    const paidBy = new Map(lastPaid.map((p) => [p.workspaceId, p._max.createdAt]));
    const pendingBy = new Set(pendingReqs.map((r) => r.workspaceId));
    const byStatus = Object.fromEntries(SUBSCRIPTION_STATUSES.map((s) => [s, 0])) as Record<SubscriptionStatus, number>;
    const byPlan = Object.fromEntries(PLANS.map((p) => [p, 0])) as Record<SubscriptionRow['plan'], number>;
    for (const s of all) {
      byStatus[s.status] += 1;
      byPlan[s.plan] += 1;
    }
    return {
      items: page.map((r) => ({
        company: { id: r.workspace.id, name: r.workspace.name, slug: r.workspace.slug, status: r.workspace.status },
        subscription: toSubscription(r, planBy.get(r.plan)!),
        mrrPaise: mrrOf(r),
        outstandingPaise: outstanding.get(r.workspaceId) ?? 0,
        overdueInvoices: overdueBy.get(r.workspaceId) ?? 0,
        seatsUsed: seatsBy.get(r.workspaceId) ?? 0,
        lastPaymentAt: paidBy.get(r.workspaceId)?.toISOString() ?? null,
        pendingRequest: pendingBy.has(r.workspaceId),
      })),
      nextCursor: nextTimeCursor(rows, q.limit),
      totals: {
        companies: all.length,
        mrrPaise: all.reduce((s, x) => s + mrrOf(x), 0),
        outstandingPaise: [...outstanding.values()].reduce((s, v) => s + v, 0),
        overdueCompanies: overdueBy.size,
        byStatus,
        byPlan,
      },
    };
  }

  async companyBilling(workspaceId: string): Promise<CompanyBilling> {
    const ws = await this.liveWorkspace(workspaceId);
    const sub = await this.core.ensure(workspaceId);
    const plan = await this.core.plan(sub.plan);
    const [usage, invoices, payments, requests] = await Promise.all([
      this.usage.usage(workspaceId, plan, sub.extraSeats),
      this.prisma.platformInvoice.findMany({ where: { workspaceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50 }),
      this.prisma.platformPayment.findMany({ where: { workspaceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50, include: { invoice: { select: { number: true } } } }),
      this.prisma.planChangeRequest.findMany({ where: { workspaceId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }),
    ]);
    const requesters = await this.prisma.forTenant(workspaceId).user.findMany({ where: { id: { in: requests.map((r) => r.requestedById).filter((x): x is string => !!x) } }, select: USER_SUMMARY_SELECT });
    const userBy = new Map(requesters.map((u) => [u.id, toUserSummary(u)]));
    return {
      company: { id: ws.id, name: ws.name, slug: ws.slug, status: ws.status },
      subscription: toSubscription(sub, plan),
      plan,
      usage,
      invoices: invoices.map((i) => toInvoiceListItem(i, ws.name)),
      payments: payments.map((p) => toPayment(p, p.invoice.number)),
      requests: requests.map((r) => toRequest(r, ws.name, r.requestedById ? (userBy.get(r.requestedById) ?? null) : null)),
    };
  }

  /** Days are added to the current trial end (or today when lapsed); `until` ends the trial at the end of that IST day. */
  async extendTrial(admin: PlatformAuthContext, req: Request, workspaceId: string, body: TrialExtend): Promise<CompanyBilling> {
    await this.liveWorkspace(workspaceId);
    const sub = await this.core.ensure(workspaceId);
    const now = new Date();
    const base = sub.status === 'trialing' && sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
    const end = body.until ? new Date(toDbDate(body.until).getTime() + 86_400_000 - 330 * 60_000 - 1) : new Date(base.getTime() + body.days! * 86_400_000);
    if (end <= now) throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: [{ path: 'until', message: 'Pick a date in the future' }] });
    const next = await this.prisma.$transaction(async (tx) => {
      // a lapsed trial's unpaid first invoice is withdrawn
      if (sub.status !== 'trialing') {
        await tx.platformInvoice.updateMany({ where: { workspaceId, kind: 'subscription', status: 'issued', paidPaise: 0, periodStart: { gte: toDbDate(sub.currentPeriodStart.toISOString().slice(0, 10)) } }, data: { status: 'cancelled', cancelledAt: now, cancelReason: 'Trial extended' } });
      }
      return this.core.apply(tx, sub, { status: 'trialing', trialEndsAt: end, periodStart: sub.status === 'trialing' ? sub.currentPeriodStart : now, periodEnd: end, trialReminderAt: null, pastDueSince: null, dunningStep: 0, cancelledAt: null });
    });
    await this.audit.platform(admin, req, { action: 'billing.trial_extend', entityType: 'subscription', entityId: sub.id, workspaceId, reason: body.reason, diff: { from: sub.trialEndsAt?.toISOString() ?? null, to: end.toISOString() } }, await this.adminName(admin.adminId));
    await this.core.publish('billing.subscription_updated', workspaceId, { subscription: toSubscription(next, await this.core.plan(next.plan)) });
    return this.companyBilling(workspaceId);
  }

  /** Apply a plan change decided by Vistar (no checkout); optional prorated invoice (kind manual, informational plan). */
  private async applyByAdmin(workspaceId: string, sub: SubscriptionRow, body: { plan: SuperPlanChange['plan']; cycle?: SuperPlanChange['cycle']; extraSeats?: number; effective: 'now' | 'period_end'; invoice: boolean }, createdById: string | null): Promise<{ next: SubscriptionRow; invoiceId: string | null }> {
    const from = await this.core.plan(sub.plan);
    const to = await this.core.plan(body.plan);
    const cycle = body.cycle ?? sub.cycle;
    const extraSeats = body.extraSeats ?? sub.extraSeats;
    const now = new Date();
    if (body.effective === 'period_end') {
      const next = await this.prisma.$transaction((tx) => this.core.apply(tx, sub, { pendingPlan: to.key, pendingCycle: cycle, extraSeats }));
      return { next, invoiceId: null };
    }
    const fromPrice = planPricePaise(from, sub.cycle, sub.extraSeats);
    const toPrice = planPricePaise(to, cycle, extraSeats);
    const restart = sub.status === 'cancelled' || cycle !== sub.cycle || (sub.status === 'trialing' && toPrice === 0) || fromPrice === 0;
    const amount = planChangeAmountPaise({ fromPricePaise: fromPrice, toPricePaise: toPrice, periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd, now, restart, fromPaid: sub.status === 'active' || sub.status === 'past_due' });
    const periodStart = restart ? now : sub.currentPeriodStart;
    const periodEnd = restart ? addBillingCycle(now, cycle) : sub.currentPeriodEnd;
    const status: SubscriptionStatus = sub.status === 'cancelled' ? 'active' : sub.status === 'trialing' && toPrice === 0 ? 'active' : sub.status;
    let invoiceId: string | null = null;
    const next = await this.prisma.$transaction(async (tx) => {
      const applied = await this.core.apply(tx, sub, {
        plan: to.key,
        cycle,
        extraSeats,
        status,
        periodStart,
        periodEnd,
        pendingPlan: null,
        pendingCycle: null,
        cancelledAt: null,
        ...(status !== sub.status && status === 'active' ? { trialEndsAt: null } : {}),
      });
      if (body.invoice && amount > 0 && sub.status !== 'trialing') {
        const label = restart ? `${to.name} plan, ${cycle}` : `Upgrade to ${to.name}, rest of the period (prorated)`;
        const inv = await this.invoices.create(workspaceId, { kind: 'manual', lines: [{ name: label, description: `From ${from.name}. Service period ${fmt(periodStart)} to ${fmt(periodEnd)}`, unitPricePaise: amount, quantity: 1 }], plan: to.key, cycle, extraSeats, periodStart, periodEnd, createdById }, true, tx);
        invoiceId = inv.id;
      }
      return applied;
    });
    if (invoiceId) await this.invoices.afterIssue(await this.prisma.platformInvoice.findUniqueOrThrow({ where: { id: invoiceId } }));
    return { next, invoiceId };
  }

  async superChangePlan(admin: PlatformAuthContext, req: Request, workspaceId: string, body: SuperPlanChange): Promise<CompanyBilling> {
    await this.liveWorkspace(workspaceId);
    const sub = await this.core.ensure(workspaceId);
    const to = await this.core.plan(body.plan);
    if (to.key === sub.plan && (body.cycle ?? sub.cycle) === sub.cycle && (body.extraSeats ?? sub.extraSeats) === sub.extraSeats && sub.status !== 'cancelled') {
      throw new AppException('PLAN_CHANGE_INVALID', 'The company is already on this plan, cycle and seats');
    }
    const { next, invoiceId } = await this.applyByAdmin(workspaceId, sub, body, admin.adminId);
    await this.prisma.planChangeRequest.updateMany({ where: { workspaceId, status: 'pending', toPlan: body.plan }, data: { status: 'approved', decidedById: admin.adminId, decidedAt: new Date(), decisionNote: 'Changed by Vistar' } });
    await this.audit.platform(admin, req, { action: 'billing.plan_change', entityType: 'subscription', entityId: sub.id, workspaceId, reason: body.reason, diff: { from: { plan: sub.plan, cycle: sub.cycle, extraSeats: sub.extraSeats }, to: { plan: body.plan, cycle: body.cycle ?? sub.cycle, extraSeats: body.extraSeats ?? sub.extraSeats }, effective: body.effective, invoiceId } }, await this.adminName(admin.adminId));
    await this.core.publish('billing.subscription_updated', workspaceId, { subscription: toSubscription(next, await this.core.plan(next.plan)) });
    return this.companyBilling(workspaceId);
  }

  async requests(status?: PlanChangeRequest['status']): Promise<{ items: PlanChangeRequest[] }> {
    const rows = await this.prisma.planChangeRequest.findMany({ where: status ? { status } : {}, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 200, include: { workspace: { select: { name: true } } } });
    const userIds = rows.map((r) => r.requestedById).filter((x): x is string => !!x);
    const users = userIds.length ? await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: USER_SUMMARY_SELECT }) : [];
    const userBy = new Map(users.map((u) => [u.id, toUserSummary(u)]));
    return { items: rows.map((r) => toRequest(r, r.workspace.name, r.requestedById ? (userBy.get(r.requestedById) ?? null) : null)) };
  }

  async decide(admin: PlatformAuthContext, req: Request, id: string, body: PlanRequestDecide): Promise<PlanChangeRequest> {
    const request = await this.prisma.planChangeRequest.findUnique({ where: { id }, include: { workspace: { select: { name: true } } } });
    if (!request) throw notFound('Request');
    if (request.status !== 'pending') throw new AppException('PLAN_CHANGE_INVALID', 'This request was already decided');
    const now = new Date();
    const { count } = await this.prisma.planChangeRequest.updateMany({ where: { id, status: 'pending' }, data: { status: body.decision === 'approve' ? 'approved' : 'rejected', decidedById: admin.adminId, decidedAt: now, decisionNote: body.note ?? null } });
    if (count !== 1) throw new AppException('PLAN_CHANGE_INVALID', 'This request was already decided');
    let invoiceId: string | null = null;
    if (body.decision === 'approve') {
      const sub = await this.core.ensure(request.workspaceId);
      const res = await this.applyByAdmin(request.workspaceId, sub, { plan: request.toPlan, cycle: request.cycle, effective: body.effective, invoice: body.invoice }, admin.adminId);
      invoiceId = res.invoiceId;
      await this.core.publish('billing.subscription_updated', request.workspaceId, { subscription: toSubscription(res.next, await this.core.plan(res.next.plan)) });
    }
    await this.core.notifyAdmins(request.workspaceId, {
      type: 'system',
      title: body.decision === 'approve' ? 'Your plan change was approved' : 'Your plan change request was declined',
      body: body.note ?? (body.decision === 'approve' ? `You are on the ${(await this.core.plan(request.toPlan)).name} plan${body.effective === 'period_end' ? ' from the next period' : ''}` : null),
      path: '/billing',
      data: { requestId: id },
    });
    await this.audit.platform(admin, req, { action: `billing.request_${body.decision}`, entityType: 'plan_change_request', entityId: id, workspaceId: request.workspaceId, reason: body.note ?? null, diff: { fromPlan: request.fromPlan, toPlan: request.toPlan, cycle: request.cycle, effective: body.effective, invoiceId } }, await this.adminName(admin.adminId));
    const fresh = await this.prisma.planChangeRequest.findUniqueOrThrow({ where: { id } });
    const requestedBy = fresh.requestedById ? await this.userSummary(fresh.workspaceId, fresh.requestedById) : null;
    return toRequest(fresh, request.workspace.name, requestedBy);
  }

  // ---------------------------------------------------------------- Super Admin invoices

  async createManualInvoice(admin: PlatformAuthContext, req: Request, workspaceId: string, body: ManualInvoiceCreate & { issue: boolean }): Promise<PlatformInvoice> {
    await this.liveWorkspace(workspaceId);
    await this.core.ensure(workspaceId);
    const row = await this.invoices.create(
      workspaceId,
      { kind: 'manual', lines: body.lines, issueDate: body.issueDate, dueDate: body.dueDate, placeOfSupplyStateCode: body.placeOfSupplyStateCode ?? null, notes: body.notes ?? null, createdById: admin.adminId },
      body.issue,
    );
    await this.audit.platform(admin, req, { action: 'billing.invoice_create', entityType: 'platform_invoice', entityId: row.id, workspaceId, diff: { number: row.number, totalPaise: n(row.totalPaise), lines: body.lines.length, issued: body.issue } }, await this.adminName(admin.adminId));
    if (row.status === 'issued') await this.invoices.afterIssue(row);
    return this.invoices.present(row);
  }

  async issueInvoice(admin: PlatformAuthContext, req: Request, id: string, dueDate: string | null | undefined): Promise<PlatformInvoice> {
    const row = await this.invoices.issueDraft(id, dueDate);
    await this.audit.platform(admin, req, { action: 'billing.invoice_issue', entityType: 'platform_invoice', entityId: id, workspaceId: row.workspaceId, diff: { number: row.number, totalPaise: n(row.totalPaise) } }, await this.adminName(admin.adminId));
    await this.invoices.afterIssue(row);
    return this.invoices.present(row);
  }

  async markPaid(admin: PlatformAuthContext, req: Request, id: string, body: PlatformInvoiceMarkPaid): Promise<PlatformInvoice> {
    const existing = await this.prisma.platformInvoice.findUnique({ where: { id }, select: { id: true, workspaceId: true } });
    if (!existing) throw notFound('Invoice');
    if (body.clientPaymentId) {
      const dup = await this.prisma.platformPayment.findUnique({ where: { invoiceId_clientPaymentId: { invoiceId: id, clientPaymentId: body.clientPaymentId } } });
      if (dup) return this.invoices.get(id, null, false);
    }
    const res = await this.prisma.$transaction((tx) =>
      this.invoices.markPaid(tx, id, { provider: 'manual', mode: body.mode, reference: body.reference ?? null, paidOn: body.paidOn, note: body.note ?? null, clientPaymentId: body.clientPaymentId, recordedById: admin.adminId }),
    );
    if (res.changed) {
      await this.audit.platform(admin, req, { action: 'billing.invoice_mark_paid', entityType: 'platform_invoice', entityId: id, workspaceId: existing.workspaceId, diff: { mode: body.mode, reference: body.reference ?? null, paidOn: body.paidOn ?? null, amountPaise: n(res.invoice.totalPaise) } }, await this.adminName(admin.adminId));
      await this.invoices.afterPaid(res.invoice, res.subscription);
    }
    return this.invoices.get(id, null, false);
  }

  async cancelInvoice(admin: PlatformAuthContext, req: Request, id: string, reason: string): Promise<PlatformInvoice> {
    const row = await this.invoices.cancel(id, reason);
    await this.audit.platform(admin, req, { action: 'billing.invoice_cancel', entityType: 'platform_invoice', entityId: id, workspaceId: row.workspaceId, reason, diff: { number: row.number } }, await this.adminName(admin.adminId));
    return this.invoices.present(row);
  }
}
