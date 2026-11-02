import { z } from 'zod';
import { LeadSourceSchema, RoutingStrategySchema } from '../enums.js';
import { IdSchema, InrSchema, IsoDateTimeSchema } from './common.js';
import { UserSummarySchema } from './workspace.js';

/**
 * LEAD ROUTING (change #19 wave B, SPEC 29.9).
 * Applied when a lead is created WITHOUT an owner: company admins or API keys creating leads without
 * ownerId, imports (rows without an owner and no default owner), lead capture forms without a fixed owner,
 * inbound webhooks and IndiaMART. Employees creating their own leads keep themselves as the owner.
 *
 * Rules are checked in `priority` order (lowest first); the first ACTIVE rule whose conditions all match
 * picks the owner. Conditions: an empty list or null bound = any. Text matches are case-insensitive
 * (cities and states equal, product keywords "contains" in productInterest or requirement).
 * Pool = active members of `teamId` plus `userIds`, sorted by name then id. Eligible = active user and,
 * when `respectWorkingHours`, inside their working hours (User.workingHours ?? workspace hours, holidays);
 * when `respectAvailability`, not on time off and not in a meeting now; when `requireOnline`, presence not
 * offline. round_robin = the next eligible user after `lastAssignedUserId` in pool order (fair: each
 * eligible user gets one lead before anyone gets a second); least_busy = the eligible user with the fewest
 * open leads (ties by pool order). No eligible user = `fallbackOwnerId` (if active), else unassigned.
 * The decision is recorded as the lead's `assigned` activity (rule `round_robin` | `least_busy` |
 * `fallback`) and the `lead.assigned` event.
 */

export const RoutingConditionsSchema = z.object({
  sources: z.array(LeadSourceSchema).max(10).default([]),
  cities: z.array(z.string().trim().min(1).max(80)).max(100).default([]),
  states: z.array(z.string().trim().min(1).max(80)).max(40).default([]),
  productKeywords: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  minValueInr: InrSchema.nullable().default(null),
  maxValueInr: InrSchema.nullable().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]).describe('Any of these tags'),
  captureFormIds: z.array(IdSchema).max(50).default([]).describe('Leads from these capture forms'),
});
export type RoutingConditions = z.infer<typeof RoutingConditionsSchema>;

export const RoutingRuleSchema = z.object({
  id: IdSchema,
  name: z.string(),
  active: z.boolean(),
  priority: z.number().int(),
  conditions: RoutingConditionsSchema,
  strategy: RoutingStrategySchema,
  team: z.object({ id: IdSchema, name: z.string() }).nullable(),
  users: z.array(UserSummarySchema).describe('Explicit pool members (besides the team)'),
  respectWorkingHours: z.boolean(),
  respectAvailability: z.boolean(),
  requireOnline: z.boolean(),
  fallbackOwner: UserSummarySchema.nullable(),
  lastAssignedUserId: IdSchema.nullable(),
  assignedCount: z.number().int(),
  lastAssignedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type RoutingRule = z.infer<typeof RoutingRuleSchema>;

const RoutingRuleInputFields = z.object({
  name: z.string().trim().min(1).max(80),
  active: z.boolean(),
  conditions: RoutingConditionsSchema,
  strategy: RoutingStrategySchema,
  teamId: IdSchema.nullable(),
  userIds: z.array(IdSchema).max(200),
  respectWorkingHours: z.boolean(),
  respectAvailability: z.boolean(),
  requireOnline: z.boolean(),
  fallbackOwnerId: IdSchema.nullable(),
});

const hasPool = (r: { teamId?: string | null; userIds?: readonly string[]; fallbackOwnerId?: string | null }) => !!r.teamId || (r.userIds?.length ?? 0) > 0 || !!r.fallbackOwnerId;

/** New rules go to the end of the order. A rule needs a team, users or a fallback owner. */
export const RoutingRuleCreateSchema = RoutingRuleInputFields.extend({
  active: z.boolean().default(true),
  conditions: RoutingConditionsSchema.default(RoutingConditionsSchema.parse({})),
  strategy: RoutingStrategySchema.default('round_robin'),
  teamId: IdSchema.nullable().default(null),
  userIds: z.array(IdSchema).max(200).default([]),
  respectWorkingHours: z.boolean().default(true),
  respectAvailability: z.boolean().default(true),
  requireOnline: z.boolean().default(false),
  fallbackOwnerId: IdSchema.nullable().default(null),
}).refine(hasPool, { error: 'Pick a team, some users or a fallback owner', path: ['teamId'] });
export type RoutingRuleCreate = z.infer<typeof RoutingRuleCreateSchema>;
export const RoutingRuleUpdateSchema = RoutingRuleInputFields.partial();
export type RoutingRuleUpdate = z.infer<typeof RoutingRuleUpdateSchema>;
export const RoutingRuleOrderSchema = z.object({ ids: z.array(IdSchema).min(1).max(200) });

/** The lead facts routing looks at (also the body of the test panel). */
export const RoutingLeadFactsSchema = z.object({
  source: LeadSourceSchema.default('manual'),
  city: z.string().trim().max(80).nullable().default(null),
  state: z.string().trim().max(80).nullable().default(null),
  productInterest: z.string().trim().max(200).nullable().default(null),
  requirement: z.string().trim().max(4000).nullable().default(null),
  valueInr: InrSchema.default(0),
  tags: z.array(z.string()).max(30).default([]),
  captureFormId: IdSchema.nullable().default(null),
});
export type RoutingLeadFacts = z.infer<typeof RoutingLeadFactsSchema>;

/** POST /routing-rules/test: "who would get this lead?" (nothing is written; the round-robin cursor does not move). */
export const RoutingTestSchema = z.object({ lead: RoutingLeadFactsSchema, at: IsoDateTimeSchema.optional().describe('Default: now') });
export type RoutingTest = z.infer<typeof RoutingTestSchema>;

export const ROUTING_OUTCOMES = ['rule', 'fallback', 'no_rule', 'no_eligible_user'] as const;
export const RoutingDecisionSchema = z.object({
  outcome: z.enum(ROUTING_OUTCOMES),
  rule: z.object({ id: IdSchema, name: z.string(), strategy: RoutingStrategySchema }).nullable(),
  owner: UserSummarySchema.nullable(),
  /** Rules checked in order with why each did or did not match. */
  rules: z.array(z.object({ id: IdSchema, name: z.string(), matched: z.boolean(), reasons: z.array(z.string()) })),
  /** Pool of the matched rule with eligibility. */
  candidates: z.array(z.object({ user: UserSummarySchema, eligible: z.boolean(), reasons: z.array(z.string()), openLeads: z.number().int() })),
});
export type RoutingDecision = z.infer<typeof RoutingDecisionSchema>;

/** Pure condition check (API routing engine and the web test panel preview). Returns the failed conditions. */
export function routingConditionMisses(c: RoutingConditions, lead: RoutingLeadFacts): string[] {
  const misses: string[] = [];
  const eq = (list: readonly string[], v: string | null) => !list.length || (!!v && list.some((x) => x.toLowerCase() === v.trim().toLowerCase()));
  if (c.sources.length && !c.sources.includes(lead.source)) misses.push('source');
  if (!eq(c.cities, lead.city)) misses.push('city');
  if (!eq(c.states, lead.state)) misses.push('state');
  if (c.productKeywords.length) {
    const text = `${lead.productInterest ?? ''} ${lead.requirement ?? ''}`.toLowerCase();
    if (!c.productKeywords.some((k) => text.includes(k.toLowerCase()))) misses.push('product');
  }
  if (c.minValueInr !== null && lead.valueInr < c.minValueInr) misses.push('value');
  else if (c.maxValueInr !== null && lead.valueInr > c.maxValueInr) misses.push('value');
  if (c.tags.length && !c.tags.some((t) => lead.tags.includes(t))) misses.push('tags');
  if (c.captureFormIds.length && (!lead.captureFormId || !c.captureFormIds.includes(lead.captureFormId))) misses.push('form');
  return misses;
}

/**
 * Round-robin pick (pure): the first eligible pool member after `lastAssignedUserId` (cyclic, pool order).
 * When the last assignee is no longer in the pool, the pick starts at the top of the pool.
 */
export function nextRoundRobin(pool: readonly string[], eligible: ReadonlySet<string>, lastAssignedUserId: string | null): string | null {
  if (!pool.length) return null;
  let start = 0;
  if (lastAssignedUserId) {
    const at = pool.indexOf(lastAssignedUserId);
    start = at >= 0 ? at + 1 : 0;
  }
  for (let i = 0; i < pool.length; i++) {
    const id = pool[(start + i) % pool.length]!;
    if (eligible.has(id)) return id;
  }
  return null;
}
