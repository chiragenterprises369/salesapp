import type { LeadListItem } from '../schemas/lead.js';
import type { Stage } from '../schemas/pipeline.js';
import type { Team, UserSummary } from '../schemas/workspace.js';
import {
  CITIES,
  COMPANY_FIXTURES,
  EMPLOYEE_FIXTURES,
  PRODUCTS,
  REQUIREMENT_SNIPPETS,
} from './india.js';
import { createRng, int, mockLeads, mockPipeline, mockUsers, pick, type Rng } from './mock.js';

/**
 * Shared core of the "world" fixtures: the anchor time, IST calendar helpers, deterministic hashing,
 * the context every generator reads (users, teams, leads) and the per-lead story (stage history,
 * first touch, WhatsApp reply) that keeps calls, chats, workflow runs and timelines consistent.
 *
 * Determinism: the same `now` and leads give the same output. Ids come from seeds that never use
 * `now`, so they stay stable when a screen is opened later; only times move with `now`.
 */

/** Leads in the main mock workspace (SPEC 20.4). Every web mock reads this one constant. */
export const MOCK_LEAD_COUNT = 2500;
export const MOCK_LEAD_SEED = 7;

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;
/** Asia/Kolkata has no DST, so the workspace calendar is a fixed +05:30 offset. */
const IST_MS = 330 * MINUTE_MS;

/** Start (UTC ms) of the IST calendar day containing `t`. */
export const istDayStart = (t: number) => Math.floor((t + IST_MS) / DAY_MS) * DAY_MS - IST_MS;
/** Minutes since IST midnight. */
export const istMinutes = (t: number) =>
  Math.floor(((((t + IST_MS) % DAY_MS) + DAY_MS) % DAY_MS) / MINUTE_MS);
export const istHour = (t: number) => Math.floor(istMinutes(t) / 60);
/** 0 = Monday ... 6 = Sunday (IST). */
export const istWeekday = (t: number) => (new Date(t + IST_MS).getUTCDay() + 6) % 7;
/** Start of the IST month containing `t`, shifted by `monthOffset` months. */
export function istMonthStart(t: number, monthOffset = 0): number {
  const d = new Date(t + IST_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + monthOffset, 1) - IST_MS;
}
/** "YYYY-MM" of the IST month containing `t`. */
export function istPeriod(t: number): string {
  const d = new Date(t + IST_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
/** "YYYY-MM-DD" of the IST day containing `t`. */
export function istDate(t: number): string {
  return iso(t + IST_MS).slice(0, 10);
}

const P2 = Array.from({ length: 100 }, (_, i) => String(i).padStart(2, '0'));
const P3 = Array.from({ length: 1000 }, (_, i) => String(i).padStart(3, '0'));
const dayPrefix = new Map<number, string>();
/**
 * Same output as `new Date(t).toISOString()` for positive times, several times faster (the world
 * formats tens of thousands of timestamps).
 */
export function iso(t: number): string {
  const ms = Math.floor(t);
  const day = Math.floor(ms / DAY_MS);
  let prefix = dayPrefix.get(day);
  if (prefix === undefined) {
    prefix = new Date(day * DAY_MS).toISOString().slice(0, 11);
    if (dayPrefix.size > 5000) dayPrefix.clear();
    dayPrefix.set(day, prefix);
  }
  let r = ms - day * DAY_MS;
  const h = Math.floor(r / HOUR_MS);
  r -= h * HOUR_MS;
  const m = Math.floor(r / MINUTE_MS);
  r -= m * MINUTE_MS;
  const s = Math.floor(r / 1000);
  return `${prefix}${P2[h]}:${P2[m]}:${P2[s]}.${P3[r - s * 1000]}Z`;
}

/** FNV-1a 32-bit hash: stable seeds from strings. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
export const rngFor = (key: string): Rng => createRng(hashSeed(key));

/** Pick by weight: weighted(rng, [['a', 3], ['b', 1]]). */
export function weighted<T>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [v, w] of entries) {
    r -= w;
    if (r < 0) return v;
  }
  return entries[entries.length - 1]![0];
}

export const between = (rng: Rng, min: number, max: number) => min + rng() * (max - min);

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const hex8 = (n: number) => {
  const x = Math.floor(n * 4294967296) >>> 0;
  return HEX[x >>> 24]! + HEX[(x >>> 16) & 255]! + HEX[(x >>> 8) & 255]! + HEX[x & 255]!;
};
/**
 * Fast deterministic RFC 4122 v4-shaped UUID (same shape as mockUuid, about 10x cheaper; the world
 * creates tens of thousands of ids).
 */
export function worldUuid(rng: Rng): string {
  const a = hex8(rng());
  const b = hex8(rng());
  const c = hex8(rng());
  const d = hex8(rng());
  const variant = ((parseInt(c[0]!, 16) & 0x3) | 0x8).toString(16);
  return `${a}-${b.slice(0, 4)}-4${b.slice(5, 8)}-${variant}${c.slice(1, 4)}-${c.slice(4, 8)}${d}`;
}

/** Deterministic UUID-shaped id from a fixed prefix and a counter (readable in fixtures). */
export const fixtureId = (prefix: string, n: number) => {
  const tail = `${prefix}${String(n).padStart(12 - prefix.length, '0')}`.slice(-12);
  return `0190f5a0-0000-7000-8000-${tail}`;
};

export const firstName = (name: string) => name.split(' ')[0] ?? name;

/** Teams of the main workspace (ids match the dashboard team filter and the mock session). */
export function mockTeams(): Team[] {
  const users = mockUsers();
  const idByKey = new Map(EMPLOYEE_FIXTURES.map((e, i) => [e.key, users[i]!.id]));
  return COMPANY_FIXTURES[0]!.teams.map((t, i) => ({
    id: `0190f5a0-0000-7000-8000-4000000000${i}0`,
    name: t.name,
    managerId: idByKey.get(t.managerKey) ?? null,
    memberIds: [t.managerKey, ...t.memberKeys]
      .map((k) => idByKey.get(k))
      .filter((x): x is string => !!x),
  }));
}

/** The 2,500 leads of the main workspace, anchored at `now` (ids do not depend on `now`). */
export function worldLeads(now: number, count = MOCK_LEAD_COUNT): LeadListItem[] {
  return mockLeads(count, MOCK_LEAD_SEED, new Date(now)).map((l) =>
    // The generator may put the last activity a few hours after "now" for brand-new leads.
    l.lastActivityAt && Date.parse(l.lastActivityAt) > now
      ? { ...l, lastActivityAt: l.createdAt }
      : l,
  );
}

export interface WorldContext {
  now: number;
  users: UserSummary[];
  /** Employees and managers: lead owners and callers. */
  sellers: UserSummary[];
  teams: Team[];
  leads: LeadListItem[];
  leadById: Map<string, LeadListItem>;
  /** Leads per owner id, oldest first. */
  leadsByOwner: Map<string, LeadListItem[]>;
  stages: Stage[];
  stageById: Map<string, Stage>;
  phoneOf: Map<string, string>;
  /** Memo for derived sections (stories, tasks, ...). */
  cache: Map<string, unknown>;
}

export function createWorldContext(
  opts: { now?: Date | number; leads?: LeadListItem[] } = {},
): WorldContext {
  const now =
    opts.now === undefined
      ? Date.now()
      : typeof opts.now === 'number'
        ? opts.now
        : opts.now.getTime();
  const users = mockUsers();
  const leads = opts.leads ?? worldLeads(now);
  const stages = mockPipeline().stages;
  const leadsByOwner = new Map<string, LeadListItem[]>();
  for (const l of leads) {
    if (!l.owner) continue;
    const list = leadsByOwner.get(l.owner.id) ?? [];
    list.push(l);
    leadsByOwner.set(l.owner.id, list);
  }
  for (const list of leadsByOwner.values())
    list.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
  return {
    now,
    users,
    sellers: users.filter((u) => u.role === 'employee' || u.role === 'manager'),
    teams: mockTeams(),
    leads,
    leadById: new Map(leads.map((l) => [l.id, l])),
    leadsByOwner,
    stages,
    stageById: new Map(stages.map((s) => [s.id, s])),
    phoneOf: new Map(EMPLOYEE_FIXTURES.map((e, i) => [users[i]!.id, e.phone])),
    cache: new Map(),
  };
}

export function memo<T>(ctx: WorldContext, key: string, build: () => T): T {
  if (ctx.cache.has(key)) return ctx.cache.get(key) as T;
  const v = build();
  ctx.cache.set(key, v);
  return v;
}

// ---------------------------------------------------------------- lead story

export type ReplyIntent = 'price' | 'catalog' | 'not_interested' | 'other';

export interface LeadStory {
  leadId: string;
  createdAt: number;
  /** Stages the lead went through, oldest first; the last entry is its current stage. */
  stagePath: Array<{ stageId: string; at: number }>;
  /** When the lead was won or lost; null while open. */
  closedAt: number | null;
  /** First outbound touch (WhatsApp welcome or first call). May be after `now` for brand-new leads. */
  firstTouchAt: number;
  /** Has a WhatsApp conversation (about 40% of leads). */
  whatsapp: boolean;
  /** IndiaMART enquiry that duplicates an earlier one. */
  duplicate: boolean;
  replied: boolean;
  intent: ReplyIntent | null;
  replyAt: number | null;
  /** The automated welcome template failed to send. */
  welcomeFailed: boolean;
}

const WHATSAPP_SHARE: Record<LeadListItem['source'], number> = {
  whatsapp: 1,
  indiamart: 0.5,
  website: 0.15,
  manual: 0.05,
  webhook: 0.05,
  import: 0.05,
  api: 0.05,
};
const FIRST_TOUCH_SEC: Record<LeadListItem['source'], [number, number]> = {
  indiamart: [40, 200],
  website: [60, 300],
  whatsapp: [120, 900],
  manual: [300, 3600],
  webhook: [180, 2700],
  import: [600, 7200],
  api: [180, 2700],
};

function buildStory(ctx: WorldContext, lead: LeadListItem): LeadStory {
  const rng = rngFor(`story:${lead.id}`);
  const created = Date.parse(lead.createdAt);
  const age = Math.max(MINUTE_MS, ctx.now - created);
  const order = ctx.stages;
  const idx = order.findIndex((s) => s.id === lead.stageId);
  const stage = order[idx] ?? order[0]!;
  const open = order.filter((s) => s.type === 'open');
  const [fMin, fMax] = FIRST_TOUCH_SEC[lead.source];
  const firstTouchAt =
    created + Math.round(between(rng, fMin, fMax) * (lead.owner ? 1 : 2.5)) * 1000;
  const closedAt = stage.type === 'open' ? null : created + age * between(rng, 0.35, 0.95);

  // Stage history: every open stage up to the current one, or a path to Won/Lost.
  let pathStages: Stage[];
  if (stage.type === 'open')
    pathStages = open.slice(0, open.findIndex((s) => s.id === stage.id) + 1);
  else if (stage.type === 'won')
    pathStages = [...open.filter((s, i) => i === 0 || i === open.length - 1 || rng() < 0.7), stage];
  else pathStages = [...open.slice(0, int(rng, 1, open.length)), stage];
  const end = closedAt ?? created + age * between(rng, 0.4, 0.92);
  const stagePath = pathStages.map((s, i) => ({
    stageId: s.id,
    at:
      i === 0
        ? created
        : i === pathStages.length - 1
          ? end
          : created + ((end - created) * (i + rng() * 0.6)) / pathStages.length,
  }));

  const whatsapp = rng() < WHATSAPP_SHARE[lead.source];
  const duplicate = lead.source === 'indiamart' && rng() < 0.04;
  const advanced = idx >= 2 || stage.type === 'won';
  const replied = whatsapp && !duplicate && rng() < (advanced ? 0.85 : 0.5);
  const intent: ReplyIntent | null = !replied
    ? null
    : stage.type === 'lost' && rng() < 0.6
      ? 'not_interested'
      : weighted<ReplyIntent>(rng, [
          ['price', 45],
          ['catalog', 25],
          ['other', 20],
          ['not_interested', stage.type === 'won' ? 0 : 10],
        ]);
  const replyAt = replied ? firstTouchAt + Math.round(between(rng, 3, 110)) * MINUTE_MS : null;
  const welcomeFailed =
    whatsapp &&
    (lead.source === 'indiamart' || lead.source === 'website') &&
    !replied &&
    rng() < 0.06;
  return {
    leadId: lead.id,
    createdAt: created,
    stagePath,
    closedAt,
    firstTouchAt,
    whatsapp,
    duplicate,
    replied,
    intent,
    replyAt,
    welcomeFailed,
  };
}

export function leadStory(ctx: WorldContext, lead: LeadListItem): LeadStory {
  const stories = memo(ctx, 'stories', () => new Map<string, LeadStory>());
  let s = stories.get(lead.id);
  if (!s) {
    s = buildStory(ctx, lead);
    stories.set(lead.id, s);
  }
  return s;
}

/** When a won lead was won (null if not won). */
export function wonAt(ctx: WorldContext, lead: LeadListItem): number | null {
  return ctx.stageById.get(lead.stageId)?.type === 'won' ? leadStory(ctx, lead).closedAt : null;
}

// ---------------------------------------------------------------- lead details (Lead fields not on LeadListItem)

const GST_STATE_CODE: Record<string, string> = {
  Maharashtra: '27',
  Delhi: '07',
  'Uttar Pradesh': '09',
  Gujarat: '24',
  Karnataka: '29',
  'Tamil Nadu': '33',
  Telangana: '36',
  'West Bengal': '19',
  Rajasthan: '08',
  Punjab: '03',
  'Madhya Pradesh': '23',
  Kerala: '32',
  Haryana: '06',
};
const LANGUAGE_BY_STATE: Record<string, string> = {
  Maharashtra: 'mr',
  Gujarat: 'gu',
  Karnataka: 'kn',
  'Tamil Nadu': 'ta',
  Telangana: 'te',
  'West Bengal': 'bn',
  Kerala: 'en',
};
const QUANTITIES = [
  '500 kg',
  '2 tonnes',
  '20 pieces',
  '2 units',
  '1,000 boxes',
  '50 sets',
  '10 rolls',
  'Monthly 5 tonnes',
  '1 container (20 ft)',
  '300 metres',
];
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Valid 15-character GSTIN for a state (matches the generic-sales gst_number pattern). */
export function mockGstin(rng: Rng, state: string | null): string {
  const L = () => LETTERS[int(rng, 0, 25)]!;
  const D = () => String(int(rng, 0, 9));
  return `${GST_STATE_CODE[state ?? ''] ?? '03'}${L()}${L()}${L()}${L()}${L()}${D()}${D()}${D()}${D()}${L()}${int(rng, 1, 9)}Z${D()}`;
}

export interface LeadDetailFixture {
  state: string | null;
  productInterest: string | null;
  requirement: string | null;
  /** Values for the generic-sales lead fields (gst_number, quantity, preferred_language, delivery_by). */
  customFields: Record<string, string>;
}

export function worldLeadDetails(lead: LeadListItem): LeadDetailFixture {
  const cacheKey = `${lead.id}|${lead.createdAt}|${lead.valueInr}|${lead.city ?? ''}`;
  const hit = detailCache.get(cacheKey);
  if (hit) return hit;
  const rng = rngFor(`detail:${lead.id}`);
  const state = CITIES.find((c) => c.city === lead.city)?.state ?? null;
  const product =
    PRODUCTS.find((p) => lead.valueInr >= p.min && lead.valueInr <= p.max) ?? pick(rng, PRODUCTS);
  const customFields: Record<string, string> = {
    quantity: pick(rng, QUANTITIES),
    preferred_language: rng() < 0.3 ? 'en' : (LANGUAGE_BY_STATE[state ?? ''] ?? 'hi'),
  };
  if (rng() < 0.6) customFields.gst_number = mockGstin(rng, state);
  if (rng() < 0.55)
    customFields.delivery_by = istDate(Date.parse(lead.createdAt) + int(rng, 7, 45) * DAY_MS);
  const details = {
    state,
    productInterest: product.name,
    requirement: pick(rng, REQUIREMENT_SNIPPETS),
    customFields,
  };
  if (detailCache.size > 20_000) detailCache.clear();
  detailCache.set(cacheKey, details);
  return details;
}
/** Details only depend on the lead id, value, city and creation time. */
const detailCache = new Map<string, LeadDetailFixture>();
