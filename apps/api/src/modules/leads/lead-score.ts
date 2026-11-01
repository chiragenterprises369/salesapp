import type { LeadSource, LeadTemperature } from '@vistar/shared';

/**
 * Rules-based lead score (0-100). Pure: same input + `now` = same output.
 * Rules: source quality, deal value, profile completeness, recency of the last touch, and tags.
 */
export interface ScoreInput {
  source: LeadSource;
  valueInr: number;
  phone: string | null;
  email: string | null;
  companyName: string | null;
  city: string | null;
  requirement: string | null;
  productInterest: string | null;
  tags: readonly string[];
  createdAt: Date;
  lastActivityAt: Date | null;
}

export interface ScoreResult {
  score: number;
  temperature: LeadTemperature;
  breakdown: Array<{ rule: string; points: number }>;
}

const SOURCE_POINTS: Record<LeadSource, number> = {
  indiamart: 20,
  website: 15,
  whatsapp: 15,
  webhook: 10,
  api: 10,
  manual: 5,
  import: 5,
};

const TAG_POINTS: Record<string, number> = {
  hot: 10,
  'repeat-buyer': 8,
  bulk: 5,
  distributor: 5,
  tender: 5,
  export: 3,
  'gst-registered': 2,
  'price-sensitive': -5,
};
const TAG_CAP = 15;

const DAY_MS = 86_400_000;

export function temperatureFor(score: number): LeadTemperature {
  return score > 70 ? 'hot' : score > 40 ? 'warm' : 'cold';
}

export function scoreLead(input: ScoreInput, now: Date = new Date()): ScoreResult {
  const breakdown: ScoreResult['breakdown'] = [];
  const add = (rule: string, points: number) => {
    if (points !== 0) breakdown.push({ rule, points });
  };

  add(`source:${input.source}`, SOURCE_POINTS[input.source] ?? 0);

  const v = input.valueInr;
  add('value', v >= 500_000 ? 25 : v >= 100_000 ? 20 : v >= 25_000 ? 12 : v > 0 ? 5 : 0);

  if (input.phone) add('has_phone', 10);
  if (input.email) add('has_email', 5);
  if (input.companyName?.trim()) add('has_company', 5);
  if (input.city?.trim()) add('has_city', 3);
  if ((input.requirement?.trim().length ?? 0) >= 20) add('detailed_requirement', 7);
  else if (input.productInterest?.trim()) add('product_interest', 3);

  const lastTouch = Math.max(input.createdAt.getTime(), input.lastActivityAt?.getTime() ?? 0);
  const ageDays = (now.getTime() - lastTouch) / DAY_MS;
  add('recency', ageDays <= 1 ? 15 : ageDays <= 7 ? 10 : ageDays <= 30 ? 5 : 0);

  const tagPoints = [...new Set(input.tags.map((t) => t.toLowerCase()))].reduce((sum, t) => sum + (TAG_POINTS[t] ?? 0), 0);
  add('tags', Math.max(-TAG_CAP, Math.min(TAG_CAP, tagPoints)));

  const score = Math.max(0, Math.min(100, breakdown.reduce((s, b) => s + b.points, 0)));
  return { score, temperature: temperatureFor(score), breakdown };
}
