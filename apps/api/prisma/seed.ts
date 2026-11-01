/**
 * Dev seed. OWNER: orchestrator. Run: pnpm db:seed (refuses to run in production).
 *
 * Creates: plan catalogue, 1 Super Admin (2FA enrolment on first login), 3 companies on different plans
 * (Shakti/growth with 2,500 leads, Navkar/starter, Sunrise/free trial), each with system roles
 * (company_admin, manager, employee, viewer), an admin, managers with teams, employees, a pipeline,
 * approved WhatsApp templates, 4 workflows and leads with contacts and deals.
 * TODO (later phases): calls + recordings (P7), conversations/messages (P5), tasks (P2), targets (P9).
 */
import { PrismaPg } from '@prisma/adapter-pg';
import {
  DEFAULT_BUSINESS_HOURS,
  DEFAULT_PIPELINE_KEY,
  DEFAULT_ROLE_PERMISSIONS,
  DEFAULT_ROLE_SCOPE,
  DEFAULT_STAGES,
  GENERIC_SALES_PACK_KEY,
  normalizeIndianPhone,
  PLATFORM_PERMISSIONS,
  ROLE_KIND_LABELS,
  ROLE_KINDS,
  SYSTEM_ROLE_KEYS,
  WORKFLOW_TEMPLATES,
  type FeatureFlags,
  type LeadSource,
  type Plan,
  type PlanLimits,
} from '@vistar/shared';
import {
  CITIES,
  COMPANY_FIXTURES,
  COMPANY_PREFIXES,
  COMPANY_SUFFIXES,
  createRng,
  FIRST_NAMES,
  int,
  LAST_NAMES,
  pick,
  PRODUCTS,
  REQUIREMENT_SNIPPETS,
  SEED_WORKSPACE,
  SUPER_ADMIN_FIXTURE,
  TAGS,
  WHATSAPP_TEMPLATE_FIXTURES,
  type CompanyFixture,
  type Rng,
} from '@vistar/shared/fixtures';
import argon2 from 'argon2';
import { config } from 'dotenv';
import { generateNKeysBetween } from 'fractional-indexing';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { installPack, SYSTEM_PACK_ACTOR } from '../src/modules/packs/pack-installer.js';
import { syncRegistry } from '../src/modules/packs/pack-registry.js';

config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

const SOURCE_WEIGHTS: Array<[LeadSource, number]> = [
  ['indiamart', 0.5],
  ['whatsapp', 0.22],
  ['website', 0.18],
  ['manual', 0.06],
  ['webhook', 0.04],
];
const STAGE_WEIGHTS = [0.3, 0.22, 0.16, 0.12, 0.1, 0.1];

const PLAN_CATALOGUE: Array<{ key: Plan; name: string; monthly: number; limits: PlanLimits; features: FeatureFlags; trialDays: number }> = [
  { key: 'free', name: 'Free', monthly: 0, trialDays: 14, limits: { seats: 3, leads: 500, whatsappMessagesPerMonth: 250, workflowRunsPerMonth: 500, storageMb: 500 }, features: { team_floor_3d: false, ai_node: false, telephony: false, api_access: false, whatsapp: true, employee_rank: true } },
  { key: 'starter', name: 'Starter', monthly: 1999, trialDays: 14, limits: { seats: 10, leads: 10_000, whatsappMessagesPerMonth: 5_000, workflowRunsPerMonth: 10_000, storageMb: 5_000 }, features: { team_floor_3d: false, ai_node: false, telephony: true, api_access: true, whatsapp: true, employee_rank: true } },
  { key: 'growth', name: 'Growth', monthly: 5999, trialDays: 14, limits: { seats: 50, leads: 100_000, whatsappMessagesPerMonth: 50_000, workflowRunsPerMonth: 100_000, storageMb: 50_000 }, features: { team_floor_3d: true, ai_node: false, telephony: true, api_access: true, whatsapp: true, employee_rank: true } },
  { key: 'enterprise', name: 'Enterprise', monthly: 19999, trialDays: 30, limits: { seats: null, leads: null, whatsappMessagesPerMonth: null, workflowRunsPerMonth: null, storageMb: null }, features: { team_floor_3d: true, ai_node: false, telephony: true, api_access: true, whatsapp: true, employee_rank: true } },
];

function weighted<T>(rng: Rng, items: Array<[T, number]>): T {
  let r = rng();
  for (const [item, w] of items) if ((r -= w) <= 0) return item;
  return items[items.length - 1]![0];
}

async function seedCompany(prisma: PrismaClient, fx: CompanyFixture, passwordHash: string, rng: Rng) {
  const ws = await prisma.workspace.create({
    data: {
      name: fx.name,
      slug: fx.slug,
      timezone: SEED_WORKSPACE.timezone,
      businessHours: DEFAULT_BUSINESS_HOURS,
      holidays: [{ date: '2026-11-08', name: 'Diwali' }],
      plan: fx.plan,
      status: fx.status,
      trialEndsAt: fx.status === 'trial' ? new Date(Date.now() + 10 * 86_400_000) : null,
    },
  });
  const workspaceId = ws.id;

  const roles = new Map<string, string>();
  for (const kind of ROLE_KINDS) {
    const role = await prisma.role.create({
      data: { workspaceId, key: SYSTEM_ROLE_KEYS[kind], name: ROLE_KIND_LABELS[kind], kind, dataScope: DEFAULT_ROLE_SCOPE[kind], permissions: DEFAULT_ROLE_PERMISSIONS[kind], isSystem: true },
    });
    roles.set(kind, role.id);
  }

  const userIdByKey = new Map<string, string>();
  for (const e of fx.employees) {
    const u = await prisma.user.create({
      data: { workspaceId, email: e.email, passwordHash, name: e.name, phone: e.phone, title: e.title, roleId: roles.get(e.role)!, status: e.status, statusChangedAt: new Date(), avatar: e.avatar, deskIndex: e.deskIndex },
    });
    userIdByKey.set(e.key, u.id);
  }
  for (const t of fx.teams) {
    const team = await prisma.team.create({ data: { workspaceId, name: t.name, managerId: userIdByKey.get(t.managerKey)! } });
    const memberIds = [t.managerKey, ...t.memberKeys].map((k) => userIdByKey.get(k)).filter((x): x is string => !!x);
    await prisma.user.updateMany({ where: { id: { in: memberIds } }, data: { teamId: team.id } });
  }
  const owners = fx.employees.filter((e) => e.role === 'employee' || e.role === 'manager').map((e) => userIdByKey.get(e.key)!);
  const managerId = userIdByKey.get(fx.employees.find((e) => e.role === 'manager')!.key)!;

  const pipeline = await prisma.pipeline.create({ data: { workspaceId, key: DEFAULT_PIPELINE_KEY, packKey: GENERIC_SALES_PACK_KEY, name: 'Sales', isDefault: true } });
  const stages = [];
  for (const [order, s] of DEFAULT_STAGES.entries()) {
    stages.push(await prisma.stage.create({ data: { workspaceId, pipelineId: pipeline.id, key: s.key, name: s.name, type: s.type, order, probability: s.probability } }));
  }

  await prisma.template.createMany({
    data: WHATSAPP_TEMPLATE_FIXTURES.map((t) => ({ workspaceId, channel: 'whatsapp' as const, name: t.name, language: 'en', category: t.category, status: 'approved' as const, body: t.body, variables: t.variables, packKey: GENERIC_SALES_PACK_KEY })),
  });
  for (const [i, tpl] of WORKFLOW_TEMPLATES.entries()) {
    const active = i < 2;
    const trigger = tpl.graph.nodes.find((n) => n.type.startsWith('trigger.'))?.type ?? null;
    const graph = { ...tpl.graph, version: 1 };
    const wf = await prisma.workflow.create({
      data: { workspaceId, name: tpl.name, description: tpl.description, status: active ? 'active' : 'draft', triggerType: trigger, latestVersion: 1, draft: graph, templateKey: tpl.key, createdById: managerId },
    });
    const version = await prisma.workflowVersion.create({ data: { workspaceId, workflowId: wf.id, version: 1, graph, note: 'Initial version', createdById: managerId } });
    if (active) await prisma.workflow.update({ where: { id: wf.id }, data: { activeVersionId: version.id } });
  }

  // Leads + contacts + deals
  const now = Date.now();
  type Row = { lead: Record<string, unknown>; contact: Record<string, unknown>; deal: Record<string, unknown> | null };
  const rows: Row[] = [];
  const usedPhones = new Set<string>();
  for (let i = 0; i < fx.leadCount; i++) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const { city, state } = pick(rng, CITIES);
    const product = pick(rng, PRODUCTS);
    const source = weighted(rng, SOURCE_WEIGHTS);
    const stage = stages[weighted(rng, STAGE_WEIGHTS.map((w, idx) => [idx, w] as [number, number]))]!;
    const createdAt = new Date(now - int(rng, 0, 120 * 24 * 60) * 60_000);
    let phone = normalizeIndianPhone(`${pick(rng, ['9', '8', '7', '6'])}${String(int(rng, 0, 999_999_999)).padStart(9, '0')}`);
    if (phone && usedPhones.has(phone)) phone = null;
    if (phone) usedPhones.add(phone);
    const score = int(rng, 5, 98);
    const valueInr = Math.round(int(rng, product.min, product.max) / 500) * 500;
    const ownerId = rng() < 0.08 ? null : pick(rng, owners);
    const companyName = `${pick(rng, COMPANY_PREFIXES)} ${pick(rng, COMPANY_SUFFIXES)}`;
    const email = rng() < 0.55 ? `${first}.${last}${i}@example.in`.toLowerCase() : null;
    const contactId = randomUUID();
    const leadId = randomUUID();
    rows.push({
      contact: { id: contactId, workspaceId, name: `${first} ${last}`, phone, email, city, whatsappOptIn: source === 'whatsapp' || rng() < 0.6 ? 'opted_in' : null, createdAt },
      lead: {
        id: leadId, workspaceId, name: `${first} ${last}`, companyName, phone, email, city, state, source,
        sourceRef: source === 'indiamart' ? `IM-${fx.slug}-${100000 + i}` : null,
        productInterest: product.name, requirement: pick(rng, REQUIREMENT_SNIPPETS), ownerId,
        pipelineId: pipeline.id, stageId: stage.id, position: '', valueInr, score,
        temperature: score > 70 ? 'hot' : score > 40 ? 'warm' : 'cold',
        tags: rng() < 0.45 ? [pick(rng, TAGS)] : [], contactId,
        nextFollowUpAt: stage.type === 'open' && rng() < 0.6 ? new Date(now + int(rng, -3 * 1440, 7 * 1440) * 60_000) : null,
        lastActivityAt: new Date(createdAt.getTime() + int(rng, 5, 3 * 1440) * 60_000),
        firstResponseAt: new Date(createdAt.getTime() + int(rng, 2, 240) * 60_000),
        stageChangedAt: createdAt,
        wonAt: stage.type === 'won' ? new Date(createdAt.getTime() + int(rng, 1, 30) * 86_400_000) : null,
        lostAt: stage.type === 'lost' ? new Date(createdAt.getTime() + int(rng, 1, 30) * 86_400_000) : null,
        createdAt,
      },
      deal: stage.key === 'new' ? null : { workspaceId, leadId, title: `${product.name} for ${companyName}`, valueInr, status: stage.type, closedAt: stage.type === 'open' ? null : new Date(), createdAt },
    });
  }
  for (const stage of stages) {
    const inStage = rows.filter((r) => r.lead.stageId === stage.id).sort((a, b) => +(b.lead.createdAt as Date) - +(a.lead.createdAt as Date));
    const keys = generateNKeysBetween(null, null, inStage.length);
    inStage.forEach((r, i) => (r.lead.position = keys[i]));
  }
  for (let i = 0; i < rows.length; i += 500) {
    const slice = rows.slice(i, i + 500);
    await prisma.contact.createMany({ data: slice.map((r) => r.contact) as never });
    await prisma.lead.createMany({ data: slice.map((r) => r.lead) as never });
    const deals = slice.map((r) => r.deal).filter(Boolean);
    if (deals.length) await prisma.deal.createMany({ data: deals as never });
  }
  return { ws, users: fx.employees.length, leads: rows.length };
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (run pnpm setup:env)');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const rng = createRng(2026);
  const t0 = Date.now();

  try {
    await prisma.workspace.deleteMany({ where: { slug: { in: COMPANY_FIXTURES.map((c) => c.slug) } } });
    // Dev impersonation sessions in other (test) workspaces still reference the seeded admin.
    await prisma.impersonationSession.deleteMany({ where: { admin: { email: SUPER_ADMIN_FIXTURE.email } } });
    await prisma.platformAdmin.deleteMany({ where: { email: SUPER_ADMIN_FIXTURE.email } });

    for (const p of PLAN_CATALOGUE) {
      const data = { name: p.name, priceInrMonthly: p.monthly, priceInrYearly: p.monthly * 10, limits: p.limits, features: p.features, trialDays: p.trialDays };
      await prisma.planDefinition.upsert({ where: { key: p.key }, create: { key: p.key, ...data }, update: data });
    }

    const passwordHash = await argon2.hash(SEED_WORKSPACE.devPassword);
    // Super Admin: 2FA is mandatory and enrolled on first login (no secret is generated or printed here).
    await prisma.platformAdmin.create({
      data: { email: SUPER_ADMIN_FIXTURE.email, name: SUPER_ADMIN_FIXTURE.name, passwordHash, permissions: [...PLATFORM_PERMISSIONS] },
    });

    const summary: string[] = [];
    // Industry Packs: register packs/*/manifest.json, then install generic-sales (adopts the pipeline and templates seeded below).
    await syncRegistry(prisma);
    for (const fx of COMPANY_FIXTURES) {
      const r = await seedCompany(prisma, fx, passwordHash, rng);
      const pack = await installPack(prisma, r.ws.id, GENERIC_SALES_PACK_KEY, { action: 'sync', actor: SYSTEM_PACK_ACTOR });
      summary.push(`  ${r.ws.name} (${fx.plan}): ${r.users} users, ${r.leads} leads, ${GENERIC_SALES_PACK_KEY} ${pack.status}`);
    }

    console.info(`Seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s\n${summary.join('\n')}`);
    console.info(`Dev logins (password "${SEED_WORKSPACE.devPassword}"):`);
    console.info(`  Super Admin   ${SUPER_ADMIN_FIXTURE.email}  -> /super-admin (enrol 2FA on first login)`);
    for (const fx of COMPANY_FIXTURES) {
      const byRole = (r: string) => fx.employees.find((e) => e.role === r)?.email;
      console.info(`  ${fx.name.padEnd(20)} admin ${byRole('company_admin')}, manager ${byRole('manager')}, employee ${byRole('employee')}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
