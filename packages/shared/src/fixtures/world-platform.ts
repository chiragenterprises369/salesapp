import type { Plan, WorkspaceStatus } from '../enums.js';
import { FEATURE_FLAGS, type FeatureFlag } from '../rbac.js';
import type {
  Company,
  ImpersonationSession,
  PlanDefinition,
  PlatformAuditLog,
  PlatformOverview,
} from '../schemas/platform.js';
import {
  CITIES,
  COMPANY_FIXTURES,
  COMPANY_PREFIXES,
  COMPANY_SUFFIXES,
  FIRST_NAMES,
  SUPER_ADMIN_FIXTURE,
} from './india.js';
import { int, MOCK_WORKSPACE_ID, mockUuid, pick } from './mock.js';
import {
  between,
  DAY_MS,
  HOUR_MS,
  iso,
  istDayStart,
  istMonthStart,
  istPeriod,
  MINUTE_MS,
  MOCK_LEAD_COUNT,
  rngFor,
} from './world-core.js';

/**
 * Platform world for the Super Admin panel: plan catalogue, the company directory (the three seed
 * companies plus 20 generated ones across plans and statuses), usage, flag overrides, platform audit,
 * health checks, support sessions and analytics. Depends only on `now`.
 */

const isoT = iso;
const flags = (on: FeatureFlag[]) =>
  Object.fromEntries(FEATURE_FLAGS.map((f) => [f, on.includes(f)])) as Record<FeatureFlag, boolean>;

export const MOCK_PLAN_DEFINITIONS: readonly PlanDefinition[] = [
  {
    key: 'free',
    name: 'Free',
    priceInrMonthly: 0,
    priceInrYearly: 0,
    limits: {
      seats: 3,
      leads: 500,
      whatsappMessagesPerMonth: 250,
      workflowRunsPerMonth: 200,
      storageMb: 500,
    },
    features: flags(['whatsapp']),
    overage: null,
    trialDays: 14,
    isActive: true,
  },
  {
    key: 'starter',
    name: 'Starter',
    priceInrMonthly: 2999,
    priceInrYearly: 29_990,
    limits: {
      seats: 5,
      leads: 5000,
      whatsappMessagesPerMonth: 2000,
      workflowRunsPerMonth: 2000,
      storageMb: 5000,
    },
    features: flags(['whatsapp', 'telephony', 'employee_rank']),
    overage: {
      perSeatInr: 499,
      per1000LeadsInr: 199,
      per1000WhatsappInr: 399,
      per1000RunsInr: 149,
    },
    trialDays: 14,
    isActive: true,
  },
  {
    key: 'growth',
    name: 'Growth',
    priceInrMonthly: 7999,
    priceInrYearly: 79_990,
    limits: {
      seats: 25,
      leads: 50_000,
      whatsappMessagesPerMonth: 15_000,
      workflowRunsPerMonth: 25_000,
      storageMb: 50_000,
    },
    features: flags(['whatsapp', 'telephony', 'employee_rank', 'team_floor_3d', 'api_access']),
    overage: { perSeatInr: 399, per1000LeadsInr: 99, per1000WhatsappInr: 349, per1000RunsInr: 99 },
    trialDays: 14,
    isActive: true,
  },
  {
    key: 'enterprise',
    name: 'Enterprise',
    priceInrMonthly: 24_999,
    priceInrYearly: 2_49_990,
    limits: {
      seats: null,
      leads: null,
      whatsappMessagesPerMonth: 1_00_000,
      workflowRunsPerMonth: null,
      storageMb: 2_00_000,
    },
    features: flags(['whatsapp', 'telephony', 'employee_rank', 'team_floor_3d', 'api_access']),
    overage: {
      perSeatInr: 299,
      per1000LeadsInr: null,
      per1000WhatsappInr: 299,
      per1000RunsInr: null,
    },
    trialDays: 30,
    isActive: true,
  },
];
const planOf = (key: Plan) => MOCK_PLAN_DEFINITIONS.find((p) => p.key === key)!;

const INDUSTRIES = [
  'Manufacturing',
  'Distribution',
  'Exports',
  'Textiles',
  'Agro and food',
  'Pharma distribution',
  'Packaging',
  'Electricals',
  'Real estate',
  'Education',
];

export interface PlatformCompanyFixture {
  /**
   * Company row. flagOverrides holds every flag (the contract record is exhaustive): plan default
   * merged with the Super Admin overrides in overrides.
   */
  company: Company;
  /** Super Admin overrides only (flag -> value). */
  overrides: Partial<Record<FeatureFlag, boolean>>;
  city: string;
  industry: string;
  /** Active users (seats in use). */
  users: number;
  /** Users seen today. */
  activeToday: number;
}

/** Company ids: Shakti = MOCK_WORKSPACE_ID; Navkar and Sunrise match the packs registry mock. */
export const platformCompanyId = (i: number) =>
  i === 0
    ? MOCK_WORKSPACE_ID
    : i < 3
      ? `0190f5a0-0000-7000-8000-90000000000${i}`
      : `0190f5a0-0000-7000-8000-9000000001${String(i).padStart(2, '0')}`;

const overridesOf: Array<Partial<Record<FeatureFlag, boolean>>> = [
  { ai_node: true },
  { team_floor_3d: true },
  {},
];
const fullFlags = (plan: Plan, overrides: Partial<Record<FeatureFlag, boolean>>) =>
  ({ ...planOf(plan).features, ...overrides }) as Record<FeatureFlag, boolean>;

export function worldPlatformCompanies(now: number): PlatformCompanyFixture[] {
  const rng = rngFor('platform:companies');
  const out: PlatformCompanyFixture[] = [];
  const usageFor = (plan: Plan, users: number, leads: number) => ({
    period: istPeriod(now),
    seats: users,
    leads,
    whatsappMessages:
      plan === 'free' ? int(rng, 20, 240) : Math.round(leads * between(rng, 0.8, 2.4)),
    workflowRuns: plan === 'free' ? int(rng, 10, 180) : Math.round(leads * between(rng, 0.3, 1.1)),
    storageMb: Math.round(leads * between(rng, 0.3, 0.9)),
  });
  COMPANY_FIXTURES.forEach((c, i) => {
    const users = c.employees.length;
    const leads = i === 0 ? MOCK_LEAD_COUNT : c.leadCount;
    const created = now - [290, 160, 9][i]! * DAY_MS;
    out.push({
      company: {
        id: platformCompanyId(i),
        name: c.name,
        slug: c.slug,
        status: c.status,
        plan: c.plan,
        trialEndsAt:
          c.status === 'trial' ? isoT(created + planOf(c.plan).trialDays * DAY_MS) : null,
        mrrInr: c.status === 'trial' ? 0 : planOf(c.plan).priceInrMonthly,
        usage: usageFor(c.plan, users, leads),
        flagOverrides: fullFlags(c.plan, overridesOf[i] ?? {}),
        ownerEmail: c.employees.find((e) => e.role === 'company_admin')?.email ?? null,
        lastActiveAt: isoT(now - int(rng, 1, i === 2 ? 600 : 40) * MINUTE_MS),
        createdAt: isoT(created),
      },
      overrides: overridesOf[i] ?? {},
      city: c.city,
      industry: i === 1 ? 'Packaging' : i === 2 ? 'Agro and food' : 'Manufacturing',
      users,
      activeToday: i === 0 ? 10 : Math.max(1, users - int(rng, 0, 2)),
    });
  });
  const used = new Set(COMPANY_FIXTURES.map((c) => c.name));
  const statuses: Array<[WorkspaceStatus, Plan]> = [
    ['active', 'growth'],
    ['active', 'starter'],
    ['active', 'starter'],
    ['active', 'enterprise'],
    ['active', 'growth'],
    ['active', 'starter'],
    ['active', 'free'],
    ['active', 'growth'],
    ['active', 'starter'],
    ['active', 'free'],
    ['active', 'starter'],
    ['active', 'growth'],
    ['active', 'enterprise'],
    ['trial', 'growth'],
    ['trial', 'starter'],
    ['trial', 'growth'],
    ['trial', 'starter'],
    ['suspended', 'starter'],
    ['suspended', 'free'],
    ['deleted', 'free'],
  ];
  statuses.forEach(([status, plan], j) => {
    const i = j + 3;
    let name = '';
    do name = `${pick(rng, COMPANY_PREFIXES)} ${pick(rng, COMPANY_SUFFIXES)}`;
    while (used.has(name));
    used.add(name);
    const city = pick(rng, CITIES).city;
    const users =
      plan === 'enterprise'
        ? int(rng, 30, 80)
        : plan === 'growth'
          ? int(rng, 8, 24)
          : plan === 'starter'
            ? int(rng, 2, 5)
            : int(rng, 1, 3);
    const leads =
      plan === 'enterprise'
        ? int(rng, 9000, 42000)
        : plan === 'growth'
          ? int(rng, 1500, 9000)
          : plan === 'starter'
            ? int(rng, 200, 2400)
            : int(rng, 20, 400);
    // Trials signed up in the last two weeks; a few active companies joined this month.
    const ageDays =
      status === 'trial' ? int(rng, 1, 13) : j < 4 ? int(rng, 2, 28) : int(rng, 35, 420);
    const created = now - ageDays * DAY_MS - int(rng, 0, 600) * MINUTE_MS;
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    const yearly = plan !== 'free' && rng() < 0.25;
    const overrides: Partial<Record<FeatureFlag, boolean>> =
      rng() < 0.2
        ? { [pick(rng, ['team_floor_3d', 'ai_node', 'api_access'] as const)]: rng() < 0.7 }
        : {};
    out.push({
      company: {
        id: platformCompanyId(i),
        name,
        slug,
        status,
        plan,
        trialEndsAt: status === 'trial' ? isoT(created + planOf(plan).trialDays * DAY_MS) : null,
        mrrInr:
          status === 'active'
            ? yearly
              ? Math.round(planOf(plan).priceInrYearly / 12)
              : planOf(plan).priceInrMonthly
            : 0,
        usage: usageFor(plan, users, leads),
        flagOverrides: fullFlags(plan, overrides),
        ownerEmail: `${pick(rng, FIRST_NAMES).toLowerCase()}@${slug.split('-')[0]}.example`,
        lastActiveAt:
          status === 'deleted'
            ? null
            : isoT(
                now -
                  (status === 'suspended'
                    ? int(rng, 8, 40) * DAY_MS
                    : int(rng, 2, 3000) * MINUTE_MS),
              ),
        createdAt: isoT(created),
      },
      overrides,
      city,
      industry: pick(rng, INDUSTRIES),
      users,
      activeToday:
        status === 'active' || status === 'trial'
          ? Math.max(1, Math.round(users * between(rng, 0.4, 0.9)))
          : 0,
    });
  });
  return out.sort((a, b) => (a.company.createdAt < b.company.createdAt ? 1 : -1));
}

export interface PlatformFlagOverride {
  companyId: string;
  companyName: string;
  flag: FeatureFlag;
  value: boolean;
  reason: string;
  updatedAt: string;
}

export function worldFlagOverrides(
  now: number,
  companies = worldPlatformCompanies(now),
): PlatformFlagOverride[] {
  const rng = rngFor('platform:flags');
  const reasons: Record<string, string> = {
    team_floor_3d: 'Pilot of the 3D floor for a large team',
    ai_node: 'Beta tester for the AI node',
    api_access: 'Needs the API for an ERP integration',
    telephony: 'Telephony disabled after repeated failed calls',
    whatsapp: 'WhatsApp paused until opt-in proof is shared',
    employee_rank: 'Company asked to hide ranks',
  };
  return companies
    .flatMap((c) =>
      Object.entries(c.overrides).map(([flag, value]) => ({
        c,
        flag: flag as FeatureFlag,
        value: !!value,
      })),
    )
    .map(({ c, flag, value }) => ({
      companyId: c.company.id,
      companyName: c.company.name,
      flag,
      value,
      reason: reasons[flag] ?? 'Support request',
      updatedAt: isoT(now - int(rng, 1, 60) * DAY_MS),
    }))
    .concat([
      {
        companyId: platformCompanyId(4),
        companyName:
          companies.find((c) => c.company.id === platformCompanyId(4))?.company.name ?? 'Company',
        flag: 'telephony',
        value: false,
        reason: reasons.telephony!,
        updatedAt: isoT(now - 5 * DAY_MS),
      },
      {
        companyId: platformCompanyId(7),
        companyName:
          companies.find((c) => c.company.id === platformCompanyId(7))?.company.name ?? 'Company',
        flag: 'employee_rank',
        value: false,
        reason: reasons.employee_rank!,
        updatedAt: isoT(now - 12 * DAY_MS),
      },
    ])
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Super Admin actions (newest first, 60 days): company lifecycle, plans, flags, impersonation, packs. */
export function worldPlatformAudit(
  now: number,
  companies = worldPlatformCompanies(now),
): PlatformAuditLog[] {
  const rng = rngFor('platform:audit');
  const adminId = '0190f5a0-0000-7000-8000-600000000001';
  const out: PlatformAuditLog[] = [];
  const add = (
    t: number,
    e: Pick<
      PlatformAuditLog,
      'action' | 'workspaceId' | 'entityType' | 'entityId' | 'reason' | 'diff'
    >,
  ) => {
    if (t > now) return;
    out.push({
      id: mockUuid(rng),
      adminId,
      adminName: SUPER_ADMIN_FIXTURE.name,
      ip: '13.232.10.4',
      createdAt: isoT(t),
      ...e,
    });
  };
  const shakti = companies.find((c) => c.company.id === MOCK_WORKSPACE_ID)!.company;
  add(istDayStart(now) - DAY_MS + 15 * HOUR_MS, {
    action: 'impersonation.start',
    workspaceId: shakti.id,
    entityType: 'workspace',
    entityId: shakti.id,
    reason: 'Customer asked for help configuring lead routing',
    diff: { readOnly: true, durationMin: 30 },
  });
  add(istDayStart(now) - DAY_MS + 15.4 * HOUR_MS, {
    action: 'impersonation.end',
    workspaceId: shakti.id,
    entityType: 'workspace',
    entityId: shakti.id,
    reason: null,
    diff: null,
  });
  add(now - 9 * DAY_MS, {
    action: 'plan.change',
    workspaceId: shakti.id,
    entityType: 'workspace',
    entityId: shakti.id,
    reason: 'Upgrade requested by the customer',
    diff: { plan: { from: 'starter', to: 'growth' } },
  });
  for (const c of companies) {
    const created = Date.parse(c.company.createdAt);
    if (now - created < 60 * DAY_MS)
      add(created + 2 * MINUTE_MS, {
        action: 'company.create',
        workspaceId: c.company.id,
        entityType: 'workspace',
        entityId: c.company.id,
        reason: null,
        diff: { plan: c.company.plan, source: rng() < 0.7 ? 'self_signup' : 'sales_assisted' },
      });
    if (c.company.status === 'suspended')
      add(now - int(rng, 3, 30) * DAY_MS, {
        action: 'company.suspend',
        workspaceId: c.company.id,
        entityType: 'workspace',
        entityId: c.company.id,
        reason: pick(rng, ['Invoice unpaid for 45 days', 'Spam complaints on WhatsApp']),
        diff: { status: { from: 'active', to: 'suspended' } },
      });
    if (c.company.status === 'deleted')
      add(now - int(rng, 2, 20) * DAY_MS, {
        action: 'company.delete',
        workspaceId: c.company.id,
        entityType: 'workspace',
        entityId: c.company.id,
        reason: 'Delete-my-data request from the owner',
        diff: null,
      });
    for (const [flag, value] of Object.entries(c.overrides))
      add(now - int(rng, 1, 60) * DAY_MS, {
        action: 'flag.override',
        workspaceId: c.company.id,
        entityType: 'feature_flag',
        entityId: flag,
        reason: 'Support request',
        diff: { [flag]: value },
      });
  }
  for (let i = 0; i < 8; i++) {
    const c = pick(
      rng,
      companies.filter((x) => x.company.status === 'active'),
    );
    const t = now - int(rng, 1, 55) * DAY_MS - int(rng, 0, 480) * MINUTE_MS;
    add(t, {
      action: 'impersonation.start',
      workspaceId: c.company.id,
      entityType: 'workspace',
      entityId: c.company.id,
      reason: pick(rng, [
        'WhatsApp templates not sending',
        'Help importing an IndiaMART export',
        'Checking a failed workflow run',
        'Owner cannot see team leads',
      ]),
      diff: { readOnly: true, durationMin: 30 },
    });
  }
  add(now - 18 * DAY_MS, {
    action: 'packs.publish',
    workspaceId: null,
    entityType: 'pack',
    entityId: 'generic-sales',
    reason: null,
    diff: { version: '1.0.0' },
  });
  add(now - 21 * DAY_MS, {
    action: 'system.settings.update',
    workspaceId: null,
    entityType: 'system',
    entityId: 'rate_limits',
    reason: 'Raise API limit for enterprise plans',
    diff: { apiPerMinute: { from: 300, to: 600 } },
  });
  add(now - 33 * DAY_MS, {
    action: 'plan.update',
    workspaceId: null,
    entityType: 'plan',
    entityId: 'starter',
    reason: null,
    diff: { priceInrMonthly: { from: 2499, to: 2999 } },
  });
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export interface PlatformHealthCheck {
  service: string;
  status: 'ok' | 'degraded' | 'down';
  p95Ms: number;
  errorRatePct: number;
  checkedAt: string;
  note: string | null;
}

export function worldHealthChecks(now: number): PlatformHealthCheck[] {
  const rng = rngFor(`platform:health:${istDayStart(now)}`);
  const row = (
    service: string,
    p95: [number, number],
    err: [number, number],
    status: PlatformHealthCheck['status'] = 'ok',
    note: string | null = null,
  ): PlatformHealthCheck => ({
    service,
    status,
    p95Ms: int(rng, p95[0], p95[1]),
    errorRatePct: Math.round(between(rng, err[0], err[1]) * 100) / 100,
    checkedAt: isoT(now - int(rng, 5, 55) * 1000),
    note,
  });
  return [
    row('API (REST)', [120, 260], [0.05, 0.3]),
    row('Realtime gateway (Socket.IO)', [40, 90], [0, 0.1]),
    row('Workflow workers (BullMQ)', [300, 900], [0.2, 0.8]),
    row('PostgreSQL', [8, 25], [0, 0.02]),
    row('Redis', [1, 4], [0, 0.01]),
    row('Object storage (recordings)', [90, 220], [0, 0.1]),
    row(
      'WhatsApp Cloud API',
      [600, 1400],
      [1.2, 2.4],
      'degraded',
      'Meta reports slower template delivery in India',
    ),
    row('IndiaMART pull', [800, 2200], [0.3, 1.1]),
    row('Telephony (mock adapter)', [50, 150], [0, 0.2]),
    row('Email (SMTP relay)', [300, 700], [0.1, 0.6]),
  ];
}

/** "View as company" sessions (newest first): one active now, the rest ended. */
export function worldSupportSessions(
  now: number,
  companies = worldPlatformCompanies(now),
): ImpersonationSession[] {
  const rng = rngFor('platform:support');
  const active = companies.filter((c) => c.company.status === 'active');
  return Array.from({ length: 9 }, (_, i) => {
    const c =
      i === 0 ? companies.find((x) => x.company.id === platformCompanyId(1))! : pick(rng, active);
    const started =
      i === 0 ? now - 12 * MINUTE_MS : now - (i * int(rng, 20, 60) + int(rng, 0, 30)) * HOUR_MS;
    const duration = pick(rng, [15, 30, 30, 60]);
    return {
      id: mockUuid(rng),
      workspaceId: c.company.id,
      workspaceName: c.company.name,
      reason: pick(rng, [
        'WhatsApp templates not sending',
        'Help importing an IndiaMART export',
        'Checking a failed workflow run',
        'Owner cannot see team leads',
        'Customer asked for help configuring lead routing',
      ]),
      readOnly: rng() < 0.85,
      contentAccess: rng() < 0.2,
      startedAt: isoT(started),
      expiresAt: isoT(started + duration * MINUTE_MS),
      endedAt: i === 0 ? null : isoT(started + int(rng, 5, duration) * MINUTE_MS),
    };
  });
}

export interface PlatformMetric {
  metric: string;
  current: number;
  previous: number;
  format: 'number' | 'inr' | 'pct';
}

export interface PlatformWorld {
  companies: PlatformCompanyFixture[];
  overview: PlatformOverview;
  usersActiveToday: number;
  leadsThisMonth: number;
  analytics: PlatformMetric[];
  audit: PlatformAuditLog[];
  flagOverrides: PlatformFlagOverride[];
  health: PlatformHealthCheck[];
  support: ImpersonationSession[];
  plans: readonly PlanDefinition[];
}

export function worldPlatform(now: number): PlatformWorld {
  const companies = worldPlatformCompanies(now);
  const live = companies.filter(
    (c) => c.company.status === 'active' || c.company.status === 'trial',
  );
  const monthStart = istMonthStart(now);
  const prevStart = istMonthStart(now, -1);
  const signups = (from: number, to: number) =>
    companies.filter(
      (c) => Date.parse(c.company.createdAt) >= from && Date.parse(c.company.createdAt) < to,
    ).length;
  const mrr = companies.reduce((s, c) => s + c.company.mrrInr, 0);
  const health = worldHealthChecks(now);
  const elapsed = Math.max(0.05, (now - monthStart) / (monthStart - prevStart));
  const leadsThisMonth = Math.round(
    live.reduce((s, c) => s + c.company.usage.leads, 0) * 0.12 * elapsed,
  );
  const overview: PlatformOverview = {
    activeCompanies: companies.filter((c) => c.company.status === 'active').length,
    trialCompanies: companies.filter((c) => c.company.status === 'trial').length,
    mrrInr: mrr,
    signups30d: signups(now - 30 * DAY_MS, now + 1),
    churnPct30d: Math.round((2 / Math.max(1, companies.length)) * 1000) / 10,
    health: {
      status: health.some((h) => h.status === 'down')
        ? 'down'
        : health.some((h) => h.status === 'degraded')
          ? 'degraded'
          : 'ok',
      failedJobs24h: 7,
      webhookFailures24h: 13,
      errorRatePct: 0.21,
    },
    generatedAt: isoT(now),
  };
  const analytics: PlatformMetric[] = [
    {
      metric: 'New sign-ups',
      current: signups(monthStart, now + 1),
      previous: signups(prevStart, monthStart),
      format: 'number',
    },
    {
      metric: 'Active companies',
      current: overview.activeCompanies,
      previous: overview.activeCompanies - 2,
      format: 'number',
    },
    { metric: 'Trials converted', current: 1, previous: 3, format: 'number' },
    {
      metric: 'Monthly recurring revenue',
      current: mrr,
      previous: Math.round(mrr * 0.91),
      format: 'inr',
    },
    { metric: 'Churned companies', current: 1, previous: 1, format: 'number' },
    {
      metric: 'Leads created',
      current: leadsThisMonth,
      previous: Math.round(live.reduce((s, c) => s + c.company.usage.leads, 0) * 0.12),
      format: 'number',
    },
    {
      metric: 'WhatsApp messages sent',
      current: Math.round(live.reduce((s, c) => s + c.company.usage.whatsappMessages, 0) * elapsed),
      previous: live.reduce((s, c) => s + c.company.usage.whatsappMessages, 0),
      format: 'number',
    },
    {
      metric: 'Workflow runs',
      current: Math.round(live.reduce((s, c) => s + c.company.usage.workflowRuns, 0) * elapsed),
      previous: live.reduce((s, c) => s + c.company.usage.workflowRuns, 0),
      format: 'number',
    },
    { metric: '3D floor adoption', current: 38, previous: 31, format: 'pct' },
  ];
  return {
    companies,
    overview,
    usersActiveToday: live.reduce((s, c) => s + c.activeToday, 0),
    leadsThisMonth,
    analytics,
    audit: worldPlatformAudit(now, companies),
    flagOverrides: worldFlagOverrides(now, companies),
    health,
    support: worldSupportSessions(now, companies),
    plans: MOCK_PLAN_DEFINITIONS,
  };
}
