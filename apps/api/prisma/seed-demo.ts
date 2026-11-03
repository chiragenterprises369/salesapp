/**
 * DEMO seed (D-064). Run: pnpm db:seed:demo (refuses to run in production). For worktree databases, smoke and
 * e2e; the clean seed is prisma/seed.ts (pnpm db:seed). Idempotent: wipes the 3 fixture companies
 * (and every platform row that points at them or at the seeded Super Admin) and creates them again.
 *
 * Creates: plan catalogue, 1 Super Admin (2FA enrolment on first login), 3 companies on different plans
 * (Shakti/growth with 2,500 leads, Navkar/starter 320, Sunrise/free trial 120) with system roles, users,
 * teams, invites, pipeline, WhatsApp templates and quick replies, 4 workflows (2 active) and leads with
 * contacts and deals. Each lead has a consistent history (seed/history.ts): timeline activities, 30 days
 * of calls, WhatsApp conversations with consent records, tasks, and runs of the active workflows. Then
 * notifications, targets, saved views, tags, integrations, webhooks + deliveries, API keys (hashed),
 * usage counters, audit logs, settings, feature flag overrides and Super Admin history (seed/extras.ts,
 * seed/platform.ts). Static texts live in seed/content.ts.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { GENERIC_SALES_PACK_KEY, PLATFORM_PERMISSIONS } from '@vistar/shared';
import { COMPANY_FIXTURES, createRng, SEED_WORKSPACE, SUPER_ADMIN_FIXTURE } from '@vistar/shared/fixtures';
import argon2 from 'argon2';
import { config } from 'dotenv';
import { generateNKeysBetween } from 'fractional-indexing';
import path from 'node:path';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { installPack, SYSTEM_PACK_ACTOR } from '../src/modules/packs/pack-installer.js';
import { syncRegistry } from '../src/modules/packs/pack-registry.js';
import { seedDatabaseUrl, upsertPlans } from './seed/base.js';
import { createCompanyBase, type CompanyCtx } from './seed/company.js';
import { seedCrm } from './seed/crm.js';
import { seedBilling, seedVistarProfile } from './seed/billing.js';
import { buildExtras, type Extras } from './seed/extras.js';
import { buildHistory, type History } from './seed/history.js';
import { buildPlatform, buildPlatformGlobal, type PlatformRows } from './seed/platform.js';
import { countRows, formatTable } from './seed/report.js';
import { insertMany, shiftDates } from './seed/util.js';

config({ path: path.resolve(process.cwd(), '../../.env'), quiet: true });

/** Removes the fixture companies and every row the workspace cascade does not reach. */
async function wipe(prisma: PrismaClient) {
  const slugs = COMPANY_FIXTURES.map((c) => c.slug);
  const workspaceIds = (await prisma.workspace.findMany({ where: { slug: { in: slugs } }, select: { id: true } })).map((w) => w.id);
  const adminIds = (await prisma.platformAdmin.findMany({ where: { email: SUPER_ADMIN_FIXTURE.email }, select: { id: true } })).map((a) => a.id);
  // PlatformAuditLog has no foreign keys: delete what points at the seeded companies or Super Admin.
  await prisma.platformAuditLog.deleteMany({ where: { OR: [{ workspaceId: { in: workspaceIds } }, { adminId: { in: adminIds } }] } });
  // WorkflowRun -> WorkflowVersion is RESTRICT; remove runs first so the cascade never depends on ordering.
  await prisma.workflowRun.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  // Dev impersonation sessions in other (test) workspaces still reference the seeded admin.
  await prisma.impersonationSession.deleteMany({ where: { adminId: { in: adminIds } } });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: adminIds } } });
}

async function insertCompany(prisma: PrismaClient, ctx: CompanyCtx, h: History, x: Extras, p: PlatformRows, delta: number) {
  const stageIds = ctx.stages.map((s) => s.id);
  for (const stageId of stageIds) {
    const inStage = ctx.drafts.filter((r) => r.lead.stageId === stageId).sort((a, b) => +b.lead.createdAt - +a.lead.createdAt);
    const keys = generateNKeysBetween(null, null, inStage.length);
    inStage.forEach((r, i) => (r.lead.position = keys[i]!));
  }
  const groups: Array<ReadonlyArray<object | null>> = [
    ctx.drafts.map((r) => r.lead), ctx.drafts.map((r) => r.contact), ctx.drafts.map((r) => r.deal),
    h.activities, h.calls, h.conversations, h.messages, h.consents, h.tasks, h.runs, h.steps,
    x.notifications, x.targets, x.savedViews, x.tags, x.quickReplies, x.integrations, x.endpoints, x.deliveries, x.apiKeys, x.usage, x.audit, x.settings, x.invites,
    p.platformAudit, p.tenantAudit, p.impersonations, p.flags,
  ];
  for (const g of groups) shiftDates(g, delta);
  await insertMany(ctx.drafts.map((r) => r.contact), (b) => prisma.contact.createMany({ data: b }));
  await insertMany(ctx.drafts.map((r) => r.lead), (b) => prisma.lead.createMany({ data: b }));
  await insertMany(ctx.drafts.flatMap((r) => (r.deal ? [r.deal] : [])), (b) => prisma.deal.createMany({ data: b }));
  await insertMany(h.calls, (b) => prisma.call.createMany({ data: b }));
  await insertMany(h.runs, (b) => prisma.workflowRun.createMany({ data: b }));
  await insertMany(h.steps, (b) => prisma.workflowRunStep.createMany({ data: b }), 2000);
  await insertMany(h.conversations, (b) => prisma.conversation.createMany({ data: b }));
  await insertMany(h.messages, (b) => prisma.message.createMany({ data: b }));
  await insertMany(h.consents, (b) => prisma.consentRecord.createMany({ data: b }), 2000);
  await insertMany(h.tasks, (b) => prisma.task.createMany({ data: b }));
  await insertMany(h.activities, (b) => prisma.activity.createMany({ data: b }), 2000);
  await insertMany(x.notifications, (b) => prisma.notification.createMany({ data: b }));
  await prisma.target.createMany({ data: x.targets });
  await prisma.savedView.createMany({ data: x.savedViews });
  await prisma.tag.createMany({ data: x.tags });
  await prisma.quickReply.createMany({ data: x.quickReplies });
  await prisma.integration.createMany({ data: x.integrations });
  await prisma.webhookEndpoint.createMany({ data: x.endpoints });
  await insertMany(x.deliveries, (b) => prisma.webhookDelivery.createMany({ data: b }));
  if (x.apiKeys.length) await prisma.apiKey.createMany({ data: x.apiKeys });
  await prisma.usageCounter.createMany({ data: x.usage });
  await insertMany([...x.audit, ...p.tenantAudit], (b) => prisma.auditLog.createMany({ data: b }));
  await prisma.setting.createMany({ data: x.settings });
  await prisma.invite.createMany({ data: x.invites });
  if (p.impersonations.length) await prisma.impersonationSession.createMany({ data: p.impersonations });
  if (p.flags.length) await prisma.featureFlagOverride.createMany({ data: p.flags });
  if (p.platformAudit.length) await prisma.platformAuditLog.createMany({ data: p.platformAudit });
}

async function main() {
  const url = seedDatabaseUrl();
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const rng = createRng(2026);
  const t0 = Date.now();
  // Data is generated on a clock rounded down to the hour (so runs within the same hour build identical
  // data and counts) and every timestamp is then shifted by `delta` so "now" in the data is the real now.
  const now = Math.floor(t0 / 3_600_000) * 3_600_000;
  const delta = t0 - now;

  try {
    await wipe(prisma);
    await upsertPlans(prisma);

    const passwordHash = await argon2.hash(SEED_WORKSPACE.devPassword);
    // Super Admin: 2FA is mandatory and enrolled on first login (no secret is generated or printed here).
    const superAdmin = await prisma.platformAdmin.create({
      data: { email: SUPER_ADMIN_FIXTURE.email, name: SUPER_ADMIN_FIXTURE.name, passwordHash, permissions: [...PLATFORM_PERMISSIONS], createdAt: new Date(now - 130 * 86_400_000) },
    });
    const adminRef = { id: superAdmin.id, name: superAdmin.name };

    const summary: string[] = [];
    const companies: Array<{ id: string; label: string }> = [];
    // Industry Packs: register packs/*/manifest.json, then install generic-sales (adopts the pipeline and templates seeded below).
    await syncRegistry(prisma);
    await seedVistarProfile(prisma);
    for (const [index, fx] of COMPANY_FIXTURES.entries()) {
      const ctx = await createCompanyBase(prisma, fx, passwordHash, rng, now, delta);
      const history = buildHistory(ctx);
      const extras = buildExtras(ctx, history);
      const platform = buildPlatform(ctx, adminRef);
      await insertCompany(prisma, ctx, history, extras, platform, delta);
      const pack = await installPack(prisma, ctx.workspaceId, GENERIC_SALES_PACK_KEY, { action: 'sync', actor: SYSTEM_PACK_ACTOR });
      const crm = await seedCrm(prisma, ctx, index);
      // change #19 wave C: billing (subscription, Vistar invoices, payments)
      const billing = await seedBilling(prisma, ctx, index);
      companies.push({ id: ctx.workspaceId, label: fx.slug });
      summary.push(`  ${fx.name} (${fx.plan}): ${fx.employees.length} users, ${ctx.drafts.length} leads, ${history.calls.length} calls, ${history.conversations.length} conversations, ${history.runs.length} workflow runs, ${GENERIC_SALES_PACK_KEY} ${pack.status}`);
      summary.push(`    CRM: ${crm.accounts} accounts, ${crm.contactsLinked} contacts linked, ${crm.deals} deals on the board, ${crm.products} products, ${crm.quotations} quotations, ${crm.invoices} invoices, ${crm.meetings} meetings, capture form /f/${crm.captureFormKey}`);
      summary.push(`    Billing: ${billing.plan} ${billing.status}, ${billing.invoices} Vistar invoices (${billing.paid} paid)`);
    }
    const globalRows = buildPlatformGlobal(adminRef, now);
    shiftDates(globalRows, delta);
    await prisma.platformAuditLog.createMany({ data: globalRows });
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);

    const counts = await countRows(prisma, companies);
    const platformCounts: Array<[string, number]> = [
      ['PlatformAdmin', await prisma.platformAdmin.count({ where: { email: SUPER_ADMIN_FIXTURE.email } })],
      ['PlatformAuditLog', await prisma.platformAuditLog.count({ where: { adminId: superAdmin.id } })],
      ['PlanDefinition', await prisma.planDefinition.count()],
    ];
    console.info(`Seeded in ${seconds}s\n${summary.join('\n')}\n`);
    console.info(formatTable(counts, companies, platformCounts));
    console.info(`\nDev logins (password "${SEED_WORKSPACE.devPassword}"):`);
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
