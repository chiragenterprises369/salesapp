/**
 * Base rows of one demo company: workspace, system roles, users, teams, pipeline + stages, WhatsApp
 * templates, workflows + versions, and the in-memory lead drafts (contacts, leads, deals). Lead content
 * keeps using the shared createRng(2026) stream so names, phones and values match earlier seeds.
 */
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_PIPELINE_KEY,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  DEFAULT_STAGES,
  GENERIC_SALES_PACK_KEY,
  normalizeIndianPhone,
  ROLE_KIND_LABELS,
  ROLE_KINDS,
  SYSTEM_ROLE_KEYS,
  WORKFLOW_TEMPLATES,
  type EmployeeStatus,
  type LeadSource,
  type RoleKind,
  type StageType,
  type WorkflowGraph,
} from '@vistar/shared';
import {
  CITIES,
  COMPANY_PREFIXES,
  COMPANY_SUFFIXES,
  FIRST_NAMES,
  int,
  LAST_NAMES,
  pick,
  PRODUCTS,
  REQUIREMENT_SNIPPETS,
  SEED_WORKSPACE,
  TAGS,
  WHATSAPP_TEMPLATE_FIXTURES,
  type CompanyFixture,
  type Rng,
} from '@vistar/shared/fixtures';
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import { DAY, MIN, rngFor } from './util.js';

/** Same draw as earlier seeds (weights sum to 1), so the shared lead stream stays identical. */
function weighted<T>(rng: Rng, items: Array<[T, number]>): T {
  let r = rng();
  for (const [item, w] of items) if ((r -= w) <= 0) return item;
  return items[items.length - 1]![0];
}

const SOURCE_WEIGHTS: Array<[LeadSource, number]> = [
  ['indiamart', 0.5],
  ['whatsapp', 0.22],
  ['website', 0.18],
  ['manual', 0.06],
  ['webhook', 0.04],
];
const STAGE_WEIGHTS = [0.3, 0.22, 0.16, 0.12, 0.1, 0.1];
/** Workspaces signed up before their oldest lead (leads span 120 days). */
const WORKSPACE_AGE_DAYS: Record<string, number> = { shakti: 128, navkar: 124, sunrise: 122 };
/** Exotel-style virtual numbers and Meta phone-number ids (fake). */
const BUSINESS_NUMBERS: Record<string, { number: string; phoneNumberId: string; wabaId: string }> = {
  shakti: { number: '+918069450100', phoneNumberId: '110482736455021', wabaId: '102938475610293' },
  navkar: { number: '+917969330200', phoneNumberId: '110482736455388', wabaId: '102938475610377' },
  sunrise: { number: '+914224560300', phoneNumberId: '110482736455742', wabaId: '102938475610712' },
};

export interface SeedUser {
  id: string;
  key: string;
  name: string;
  email: string;
  kind: RoleKind;
  status: EmployeeStatus;
  teamId: string | null;
  phone: string;
  title: string;
  joinedAt: number;
}
export interface SeedTeam {
  id: string;
  name: string;
  managerId: string;
  memberIds: string[];
}
export interface SeedStage {
  id: string;
  key: string;
  name: string;
  type: StageType;
  order: number;
}
export interface SeedTemplate {
  id: string;
  name: string;
  body: string;
  variables: string[];
}
export interface SeedWorkflow {
  id: string;
  name: string;
  templateKey: string;
  versionId: string;
  active: boolean;
  graph: WorkflowGraph;
}
export interface LeadDraft {
  lead: Prisma.LeadCreateManyInput & { id: string; createdAt: Date; tags: string[] };
  contact: Prisma.ContactCreateManyInput & { id: string };
  deal: (Prisma.DealCreateManyInput & { createdAt: Date }) | null;
  stageIdx: number;
  source: LeadSource;
  product: string;
}

export interface CompanyCtx {
  fx: CompanyFixture;
  workspaceId: string;
  workspaceName: string;
  createdAt: number;
  now: number;
  /** Extras RNG (never the shared lead stream). */
  rng: Rng;
  users: SeedUser[];
  userById: Map<string, SeedUser>;
  sales: SeedUser[];
  admin: SeedUser;
  managers: SeedUser[];
  roleIds: Map<RoleKind, string>;
  teams: SeedTeam[];
  pipelineId: string;
  stages: SeedStage[];
  templates: Map<string, SeedTemplate>;
  workflows: SeedWorkflow[];
  business: { number: string; phoneNumberId: string; wabaId: string };
  drafts: LeadDraft[];
}

export async function createCompanyBase(prisma: PrismaClient, fx: CompanyFixture, passwordHash: string, leadRng: Rng, now: number): Promise<CompanyCtx> {
  const rng = rngFor(fx.slug);
  const createdAt = now - (WORKSPACE_AGE_DAYS[fx.slug] ?? 125) * DAY;
  const ws = await prisma.workspace.create({
    data: {
      name: fx.name,
      slug: fx.slug,
      timezone: SEED_WORKSPACE.timezone,
      businessHours: DEFAULT_BUSINESS_HOURS,
      holidays: [{ date: '2026-11-08', name: 'Diwali' }],
      plan: fx.plan,
      status: fx.status,
      trialEndsAt: fx.status === 'trial' ? new Date(now + 10 * DAY) : null,
      createdAt: new Date(createdAt),
    },
  });
  const workspaceId = ws.id;

  const roleIds = new Map<RoleKind, string>();
  for (const kind of ROLE_KINDS) {
    const role = await prisma.role.create({
      data: { workspaceId, key: SYSTEM_ROLE_KEYS[kind], name: ROLE_KIND_LABELS[kind], kind, dataScope: DEFAULT_ROLE_SCOPE[kind], permissions: DEFAULT_ROLE_PERMISSIONS[kind], isSystem: true, createdAt: new Date(createdAt) },
    });
    roleIds.set(kind, role.id);
  }

  const users: SeedUser[] = [];
  for (const [i, e] of fx.employees.entries()) {
    // The admin signs up first; everyone else accepts an invite over the first days.
    const joinedAt = e.role === 'company_admin' ? createdAt : createdAt + (i * 7 + int(rng, 20, 300)) * MIN;
    const u = await prisma.user.create({
      data: {
        workspaceId, email: e.email, passwordHash, name: e.name, phone: e.phone, title: e.title, roleId: roleIds.get(e.role)!, status: e.status,
        statusChangedAt: new Date(now - int(rng, 2, 90) * MIN), lastSeenAt: e.status === 'offline' ? new Date(now - int(rng, 3, 20) * 60 * MIN) : new Date(now - int(rng, 0, 4) * MIN),
        avatar: e.avatar, deskIndex: e.deskIndex, createdAt: new Date(joinedAt),
      },
    });
    users.push({ id: u.id, key: e.key, name: e.name, email: e.email, kind: e.role, status: e.status, teamId: null, phone: e.phone, title: e.title, joinedAt });
  }
  const byKey = new Map(users.map((u) => [u.key, u]));
  const teams: SeedTeam[] = [];
  for (const t of fx.teams) {
    const manager = byKey.get(t.managerKey)!;
    const team = await prisma.team.create({ data: { workspaceId, name: t.name, managerId: manager.id, createdAt: new Date(createdAt + 30 * MIN) } });
    const members = [t.managerKey, ...t.memberKeys].map((k) => byKey.get(k)).filter((x): x is SeedUser => !!x);
    await prisma.user.updateMany({ where: { id: { in: members.map((m) => m.id) } }, data: { teamId: team.id } });
    for (const m of members) m.teamId = team.id;
    teams.push({ id: team.id, name: t.name, managerId: manager.id, memberIds: members.map((m) => m.id) });
  }
  const sales = users.filter((u) => u.kind === 'employee' || u.kind === 'manager');
  const managers = users.filter((u) => u.kind === 'manager');
  const admin = users.find((u) => u.kind === 'company_admin')!;

  const pipeline = await prisma.pipeline.create({ data: { workspaceId, key: DEFAULT_PIPELINE_KEY, packKey: GENERIC_SALES_PACK_KEY, name: 'Sales', isDefault: true, createdAt: new Date(createdAt) } });
  const stages: SeedStage[] = [];
  for (const [order, s] of DEFAULT_STAGES.entries()) {
    const st = await prisma.stage.create({ data: { workspaceId, pipelineId: pipeline.id, key: s.key, name: s.name, type: s.type, order, probability: s.probability, createdAt: new Date(createdAt) } });
    stages.push({ id: st.id, key: s.key, name: s.name, type: s.type, order });
  }

  await prisma.template.createMany({
    data: WHATSAPP_TEMPLATE_FIXTURES.map((t) => ({ workspaceId, channel: 'whatsapp' as const, name: t.name, language: 'en', category: t.category, status: 'approved' as const, body: t.body, variables: t.variables, packKey: GENERIC_SALES_PACK_KEY, providerTemplateId: `${int(rng, 100000000000000, 999999999999999)}`, createdAt: new Date(createdAt + DAY) })),
  });
  const templateRows = await prisma.template.findMany({ where: { workspaceId }, select: { id: true, name: true, body: true, variables: true } });
  const templates = new Map(templateRows.map((t) => [t.name, t]));

  const managerId = managers[0]?.id ?? admin.id;
  const workflows: SeedWorkflow[] = [];
  for (const [i, tpl] of WORKFLOW_TEMPLATES.entries()) {
    const active = i < 2;
    const trigger = tpl.graph.nodes.find((n) => n.type.startsWith('trigger.'))?.type ?? null;
    const graph = { ...tpl.graph, version: 1 };
    const at = new Date(createdAt + (2 + i) * DAY);
    const wf = await prisma.workflow.create({
      data: { workspaceId, name: tpl.name, description: tpl.description, status: active ? 'active' : 'draft', triggerType: trigger, latestVersion: 1, draft: graph, templateKey: tpl.key, createdById: managerId, createdAt: at },
    });
    const version = await prisma.workflowVersion.create({ data: { workspaceId, workflowId: wf.id, version: 1, graph, note: 'Initial version', createdById: managerId, createdAt: at } });
    if (active) await prisma.workflow.update({ where: { id: wf.id }, data: { activeVersionId: version.id } });
    workflows.push({ id: wf.id, name: tpl.name, templateKey: tpl.key, versionId: version.id, active, graph: tpl.graph });
  }

  const owners = sales.map((u) => u.id);
  const drafts: LeadDraft[] = [];
  const usedPhones = new Set<string>();
  for (let i = 0; i < fx.leadCount; i++) {
    const first = pick(leadRng, FIRST_NAMES);
    const last = pick(leadRng, LAST_NAMES);
    const { city, state } = pick(leadRng, CITIES);
    const product = pick(leadRng, PRODUCTS);
    const source = weighted(leadRng, SOURCE_WEIGHTS);
    const stageIdx = weighted(leadRng, STAGE_WEIGHTS.map((w, idx) => [idx, w] as [number, number]));
    const stage = stages[stageIdx]!;
    const created = new Date(now - int(leadRng, 0, 120 * 24 * 60) * MIN);
    let phone = normalizeIndianPhone(`${pick(leadRng, ['9', '8', '7', '6'])}${String(int(leadRng, 0, 999_999_999)).padStart(9, '0')}`);
    if (phone && usedPhones.has(phone)) phone = null;
    if (phone) usedPhones.add(phone);
    const score = int(leadRng, 5, 98);
    const valueInr = Math.round(int(leadRng, product.min, product.max) / 500) * 500;
    const ownerId = leadRng() < 0.08 ? null : pick(leadRng, owners);
    const companyName = `${pick(leadRng, COMPANY_PREFIXES)} ${pick(leadRng, COMPANY_SUFFIXES)}`;
    const email = leadRng() < 0.55 ? `${first}.${last}${i}@example.in`.toLowerCase() : null;
    const contactId = randomUUID();
    const leadId = randomUUID();
    const optIn = source === 'whatsapp' || leadRng() < 0.6;
    const requirement = pick(leadRng, REQUIREMENT_SNIPPETS);
    const tags = leadRng() < 0.45 ? [pick(leadRng, TAGS)] : [];
    const hasFollowUp = stage.type === 'open' && leadRng() < 0.6;
    const followUpAt = hasFollowUp ? new Date(now + int(leadRng, -3 * 1440, 7 * 1440) * MIN) : null;
    // Consume the stream exactly like earlier seeds (lastActivityAt, firstResponseAt, wonAt/lostAt) so the
    // following companies keep their data; the history module recomputes these fields consistently.
    int(leadRng, 5, 3 * 1440);
    int(leadRng, 2, 240);
    if (stage.type !== 'open') int(leadRng, 1, 30);
    drafts.push({
      stageIdx,
      source,
      product: product.name,
      contact: { id: contactId, workspaceId, name: `${first} ${last}`, phone, email, city, whatsappOptIn: optIn ? 'opted_in' : null, createdAt: created },
      lead: {
        id: leadId, workspaceId, name: `${first} ${last}`, companyName, phone, email, city, state, source,
        sourceRef: source === 'indiamart' ? `IM-${fx.slug}-${100000 + i}` : null,
        productInterest: product.name, requirement, ownerId,
        pipelineId: pipeline.id, stageId: stage.id, position: '', valueInr, score,
        temperature: score > 70 ? 'hot' : score > 40 ? 'warm' : 'cold',
        tags, contactId, nextFollowUpAt: followUpAt, createdAt: created,
      },
      deal: stage.key === 'new' ? null : { workspaceId, leadId, title: `${product.name} for ${companyName}`, valueInr, status: stage.type, createdAt: created },
    });
  }

  return {
    fx, workspaceId, workspaceName: fx.name, createdAt, now, rng, users, userById: new Map(users.map((u) => [u.id, u])), sales, admin, managers, roleIds, teams,
    pipelineId: pipeline.id, stages, templates, workflows, business: BUSINESS_NUMBERS[fx.slug] ?? BUSINESS_NUMBERS.shakti!, drafts,
  };
}
