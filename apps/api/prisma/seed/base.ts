import { type FeatureFlags, type Plan, type PlanLimits } from '@vistar/shared';
import type { PrismaClient } from '../../src/generated/prisma/client.js';

/**
 * Platform rows shared by the clean seed (prisma/seed.ts) and the demo seed (prisma/seed-demo.ts), D-064.
 * Feature flags: custom_domain is off on every plan (Super Admin switch per company); field_tracking is on for
 * growth and enterprise.
 */
export const PLAN_CATALOGUE: Array<{ key: Plan; name: string; monthly: number; limits: PlanLimits; features: FeatureFlags; trialDays: number }> = [
  { key: 'free', name: 'Free', monthly: 0, trialDays: 14, limits: { seats: 3, leads: 500, whatsappMessagesPerMonth: 250, workflowRunsPerMonth: 500, storageMb: 500, apiKeys: 0, apiCallsPerMonth: 0 }, features: { team_floor_3d: false, ai_node: false, telephony: false, api_access: false, whatsapp: true, employee_rank: true, custom_domain: false, field_tracking: false } },
  { key: 'starter', name: 'Starter', monthly: 1999, trialDays: 14, limits: { seats: 10, leads: 10_000, whatsappMessagesPerMonth: 5_000, workflowRunsPerMonth: 10_000, storageMb: 5_000, apiKeys: 2, apiCallsPerMonth: 10_000 }, features: { team_floor_3d: false, ai_node: false, telephony: true, api_access: true, whatsapp: true, employee_rank: true, custom_domain: false, field_tracking: false } },
  { key: 'growth', name: 'Growth', monthly: 5999, trialDays: 14, limits: { seats: 50, leads: 100_000, whatsappMessagesPerMonth: 50_000, workflowRunsPerMonth: 100_000, storageMb: 50_000, apiKeys: 10, apiCallsPerMonth: 100_000 }, features: { team_floor_3d: true, ai_node: false, telephony: true, api_access: true, whatsapp: true, employee_rank: true, custom_domain: false, field_tracking: true } },
  { key: 'enterprise', name: 'Enterprise', monthly: 19999, trialDays: 30, limits: { seats: null, leads: null, whatsappMessagesPerMonth: null, workflowRunsPerMonth: null, storageMb: null, apiKeys: null, apiCallsPerMonth: null }, features: { team_floor_3d: true, ai_node: false, telephony: true, api_access: true, whatsapp: true, employee_rank: true, custom_domain: false, field_tracking: true } },
];

/** Upsert the plan catalogue (prices, limits, features, trial days). */
export async function upsertPlans(prisma: PrismaClient): Promise<void> {
  for (const p of PLAN_CATALOGUE) {
    const data = { name: p.name, priceInrMonthly: p.monthly, priceInrYearly: p.monthly * 10, limits: p.limits, features: p.features, trialDays: p.trialDays };
    await prisma.planDefinition.upsert({ where: { key: p.key }, create: { key: p.key, ...data }, update: data });
  }
}

/**
 * Require DATABASE_URL and refuse to seed production. Change #20 (P6): the CLEAN seed passes
 * `{ allowProduction: true }` (plans, the first Super Admin from SEED_SUPER_ADMIN_*, the pack registry; no demo data).
 */
export function seedDatabaseUrl(opts: { allowProduction?: boolean } = {}): string {
  if (process.env.NODE_ENV === 'production' && !opts.allowProduction) throw new Error('Refusing to seed in production');
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (run pnpm setup:env)');
  return url;
}
