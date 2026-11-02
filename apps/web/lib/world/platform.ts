import { FEATURE_FLAGS, formatInr, formatNumber, type ChipTone, type Company, type FeatureFlag, type Plan, type WorkspaceStatus } from '@vistar/shared';
import type { PlatformCompanyFixture } from '@vistar/shared/fixtures';
import { isRouteLive } from '../api/availability';
import { superApi } from '../api/client';
import { world } from './world';

/**
 * Super Admin rows from the platform world (Wave 1; Phase 9 swaps in /api/super/*). Each section
 * returns rows keyed by the column keys its page declares, as plain text or a chip, plus a search
 * string. Super Admin pages are not tied to a workspace, so there is no data scope here; the
 * platform guard already limits who can open them.
 */
export type PlatformCell = string | { text: string; sub?: string; tone?: ChipTone; mono?: boolean };
export interface PlatformRow {
  id: string;
  cells: Record<string, PlatformCell>;
  search: string;
}

const TZ = 'Asia/Kolkata';
const dateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
const date = (iso: string) => dateFmt.format(new Date(iso));
const dateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

const PLAN_LABEL: Record<Plan, string> = { free: 'Free', starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };
const STATUS: Record<WorkspaceStatus, { text: string; tone: ChipTone }> = {
  active: { text: 'Active', tone: 'green' },
  trial: { text: 'Trial', tone: 'blue' },
  suspended: { text: 'Suspended', tone: 'amber' },
  deleted: { text: 'Deleted', tone: 'grey' },
};
export const FLAG_LABEL: Record<FeatureFlag, string> = {
  team_floor_3d: 'Live Team Floor 3D',
  ai_node: 'AI node',
  telephony: 'Telephony',
  api_access: 'API access',
  whatsapp: 'WhatsApp',
  employee_rank: 'Employee rank',
  custom_domain: 'Custom domain',
  field_tracking: 'Field tracking',
};
const ACTION_LABEL: Record<string, string> = {
  'impersonation.start': 'Started View as company',
  'impersonation.end': 'Ended View as company',
  'plan.change': 'Changed plan',
  'plan.update': 'Edited plan price',
  'company.create': 'Company signed up',
  'company.suspend': 'Suspended company',
  'company.delete': 'Deleted company data',
  'flag.override': 'Set feature flag',
  'packs.publish': 'Published pack',
  'system.settings.update': 'Changed system settings',
};

function usage(used: number, limit: number | null, fmt: (n: number) => string = formatNumber): PlatformCell {
  if (limit === null) return { text: fmt(used), sub: 'Unlimited' };
  const pct = limit > 0 ? used / limit : 0;
  const text = `${fmt(used)} / ${fmt(limit)}`;
  return pct >= 1 ? { text, tone: 'red' } : pct >= 0.8 ? { text, tone: 'amber' } : text;
}
const storage = (mb: number) => (mb >= 1024 ? `${Math.round((mb / 1024) * 10) / 10} GB` : `${mb} MB`);
const planDef = (plan: Plan) => world.platform().plans.find((p) => p.key === plan)!;

function companyRow(c: PlatformCompanyFixture): PlatformRow {
  const { company } = c;
  return {
    id: company.id,
    cells: {
      company: { text: company.name, sub: `${c.city} · ${c.industry}` },
      plan: PLAN_LABEL[company.plan],
      status: STATUS[company.status],
      seats: usage(c.users, planDef(company.plan).limits.seats),
      leads: formatNumber(company.usage.leads),
      created: date(company.createdAt),
    },
    search: `${company.name} ${company.slug} ${c.city} ${company.plan} ${company.status} ${company.ownerEmail ?? ''}`.toLowerCase(),
  };
}

export function platformRows(section: string, now = Date.now()): PlatformRow[] {
  const p = world.platform();
  const nameOf = new Map(p.companies.map((c) => [c.company.id, c.company.name]));
  switch (section) {
    case 'companies':
      return p.companies.map(companyRow);
    case 'overview-signups':
      return p.companies.slice(0, 8).map((c) => ({
        id: c.company.id,
        cells: { company: { text: c.company.name, sub: c.company.ownerEmail ?? undefined }, plan: PLAN_LABEL[c.company.plan], users: String(c.users), city: c.city, created: date(c.company.createdAt) },
        search: c.company.name.toLowerCase(),
      }));
    case 'plans':
      return p.plans.map((plan) => {
        const n = p.companies.filter((c) => c.company.plan === plan.key && (c.company.status === 'active' || c.company.status === 'trial')).length;
        return {
          id: plan.key,
          cells: {
            plan: { text: plan.name, sub: `${plan.trialDays}-day trial` },
            price: plan.priceInrMonthly ? formatInr(plan.priceInrMonthly) : 'Free',
            companies: String(n),
            seats: plan.limits.seats === null ? 'Unlimited' : String(plan.limits.seats),
            status: plan.isActive ? { text: 'On sale', tone: 'green' } : { text: 'Retired', tone: 'grey' },
          },
          search: plan.name.toLowerCase(),
        };
      });
    case 'usage':
      return p.companies
        .filter((c) => c.company.status !== 'deleted')
        .map((c) => {
          const limits = planDef(c.company.plan).limits;
          const u = c.company.usage;
          return {
            id: c.company.id,
            cells: {
              company: { text: c.company.name, sub: PLAN_LABEL[c.company.plan] },
              seats: usage(u.seats, limits.seats),
              leads: usage(u.leads, limits.leads),
              whatsapp: usage(u.whatsappMessages, limits.whatsappMessagesPerMonth),
              runs: usage(u.workflowRuns, limits.workflowRunsPerMonth),
              storage: usage(u.storageMb, limits.storageMb, storage),
            },
            search: c.company.name.toLowerCase(),
          };
        });
    case 'flags':
      return [
        ...p.flagOverrides.map((f, i) => ({
          id: `${f.companyId}:${f.flag}:${i}`,
          cells: { company: f.companyName, flag: FLAG_LABEL[f.flag], value: f.value ? { text: 'On', tone: 'green' as const } : { text: 'Off', tone: 'grey' as const }, reason: f.reason, updated: date(f.updatedAt) },
          search: `${f.companyName} ${FLAG_LABEL[f.flag]} ${f.reason}`.toLowerCase(),
        })),
        // Plan defaults, so the page also explains what each plan includes.
        ...p.plans.flatMap((plan) =>
          FEATURE_FLAGS.map((flag) => ({
            id: `plan:${plan.key}:${flag}`,
            cells: { company: { text: `All ${plan.name} companies`, sub: 'Plan default' }, flag: FLAG_LABEL[flag], value: plan.features[flag] ? { text: 'On', tone: 'green' as const } : { text: 'Off', tone: 'grey' as const }, reason: 'Included in the plan', updated: '–' },
            search: `${plan.name} ${FLAG_LABEL[flag]} plan default`.toLowerCase(),
          })),
        ),
      ];
    case 'health':
      return p.health.map((h) => ({
        id: h.service,
        cells: {
          service: h.note ? { text: h.service, sub: h.note } : h.service,
          status: h.status === 'ok' ? { text: 'Healthy', tone: 'green' } : h.status === 'degraded' ? { text: 'Degraded', tone: 'amber' } : { text: 'Down', tone: 'red' },
          p95: `${formatNumber(h.p95Ms)} ms`,
          errors: `${h.errorRatePct.toFixed(2)}%`,
          checked: `${Math.max(1, Math.round((now - Date.parse(h.checkedAt)) / 1000))} s ago`,
        },
        search: h.service.toLowerCase(),
      }));
    case 'analytics':
      return p.analytics.map((m) => {
        const fmt = (n: number) => (m.format === 'inr' ? formatInr(n, { compact: true }) : m.format === 'pct' ? `${n}%` : formatNumber(n));
        const change = m.previous ? ((m.current - m.previous) / m.previous) * 100 : 0;
        const goodWhenDown = m.metric === 'Churned companies';
        const up = change > 0.05;
        const down = change < -0.05;
        return {
          id: m.metric,
          cells: {
            metric: m.metric,
            current: fmt(m.current),
            previous: fmt(m.previous),
            change: { text: `${change > 0 ? '+' : ''}${change.toFixed(1)}%`, tone: !up && !down ? 'grey' : up !== goodWhenDown ? 'green' : 'red' },
          },
          search: m.metric.toLowerCase(),
        };
      });
    case 'support':
      return p.support.map((s) => {
        const active = s.endedAt === null && Date.parse(s.expiresAt) > now;
        return {
          id: s.id,
          cells: {
            company: s.workspaceName,
            reason: s.reason,
            admin: 'Vistar Platform Owner',
            mode: `${s.readOnly ? 'Read-only' : 'Read and write'}${s.contentAccess ? ', with messages' : ''}`,
            ends: active ? { text: `Active, ends ${dateTime(s.expiresAt)}`, tone: 'blue' } : `Ended ${dateTime(s.endedAt ?? s.expiresAt)}`,
          },
          search: `${s.workspaceName} ${s.reason}`.toLowerCase(),
        };
      });
    case 'audit':
      return p.audit.map((a) => ({
        id: a.id,
        cells: {
          time: dateTime(a.createdAt),
          admin: a.adminName ?? 'System',
          action: ACTION_LABEL[a.action] ?? a.action,
          company: a.workspaceId ? (nameOf.get(a.workspaceId) ?? 'Company') : 'Platform',
          reason: a.reason ?? '–',
        },
        search: `${a.action} ${ACTION_LABEL[a.action] ?? ''} ${a.reason ?? ''} ${a.workspaceId ? (nameOf.get(a.workspaceId) ?? '') : ''}`.toLowerCase(),
      }));
    default:
      return [];
  }
}

export interface PlatformKpi {
  label: string;
  value: string;
  hint: string;
}

/** Overview cards. */
export function platformKpis(): PlatformKpi[] {
  const p = world.platform();
  const o = p.overview;
  return [
    { label: 'Active companies', value: formatNumber(o.activeCompanies), hint: `${o.trialCompanies} on trial · ${o.signups30d} signed up in 30 days` },
    { label: 'Users active today', value: formatNumber(p.usersActiveToday), hint: `Across ${o.activeCompanies + o.trialCompanies} companies` },
    { label: 'Monthly recurring revenue', value: formatInr(o.mrrInr, { compact: true }), hint: `Churn ${o.churnPct30d}% in 30 days` },
    { label: 'Leads this month', value: formatNumber(p.leadsThisMonth), hint: `Platform health: ${o.health.status === 'ok' ? 'all systems normal' : o.health.status}` },
  ];
}

// ---------------------------------------------------------------- API mode (real /api/super routes)

/** Company row from GET /api/super/companies, with the same column keys as the mock rows. */
function apiCompanyRow(c: Company): PlatformRow {
  return {
    id: c.id,
    cells: {
      company: { text: c.name, sub: c.ownerEmail ?? c.slug },
      plan: PLAN_LABEL[c.plan],
      status: STATUS[c.status],
      seats: c.userCount === undefined ? formatNumber(c.usage.seats) : formatNumber(c.userCount),
      leads: formatNumber(c.usage.leads),
      created: date(c.createdAt),
    },
    search: `    `.toLowerCase(),
  };
}

/**
 * Super Admin lists in API mode. Sections whose /api/super route has not shipped return no rows
 * (the table shows its empty state); nothing generated.
 */
export async function apiPlatformRows(section: string): Promise<PlatformRow[]> {
  if (section === 'companies' && isRouteLive('superCompanyList')) {
    const rows: PlatformRow[] = [];
    let cursor: string | undefined;
    do {
      const page = await superApi.call('superCompanyList', { query: { cursor, limit: 100 } });
      rows.push(...page.items.map(apiCompanyRow));
      cursor = page.nextCursor ?? undefined;
    } while (cursor && rows.length < 1000);
    return rows;
  }
  return [];
}

/** Overview KPIs in API mode (GET /api/super/overview once it ships; none until then). */
export async function apiPlatformKpis(): Promise<PlatformKpi[]> {
  return [];
}