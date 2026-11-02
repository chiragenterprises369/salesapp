/** Small helpers shared by the seed modules (deterministic randomness, time maths, batching). */
import { createRng, int, pick, type Rng } from '@vistar/shared/fixtures';
import { createHash } from 'node:crypto';
import { addZonedDays, startOfZonedDay, zonedMonthKey, zonedParts } from '../../src/modules/leads/lib/tz.js';

export { int, pick, type Rng };

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const TZ = 'Asia/Kolkata';

/** Stable per-company RNG so one company's extras never shift another company's data. */
export function rngFor(label: string): Rng {
  const h = createHash('sha256').update(`vistar-seed:${label}`).digest();
  return createRng(h.readUInt32BE(0));
}

export function weighted<T>(rng: Rng, items: ReadonlyArray<readonly [T, number]>): T {
  let r = rng() * items.reduce((a, [, w]) => a + w, 0);
  for (const [item, w] of items) if ((r -= w) <= 0) return item;
  return items[items.length - 1]![0];
}

export const chance = (rng: Rng, p: number) => rng() < p;
/** Uniform instant in [a, b] (ms). */
export const between = (rng: Rng, a: number, b: number) => Math.round(a + rng() * Math.max(0, b - a));

export function shuffle<T>(rng: Rng, list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [list[i], list[j]] = [list[j]!, list[i]!];
  }
  return list;
}

export function hex(rng: Rng, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += Math.floor(rng() * 16).toString(16);
  return s;
}

/** Replace {key} placeholders; unknown keys stay as they are. */
export function fill(template: string, vars: Record<string, string | number | null | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? m : String(v);
  });
}

/** WhatsApp-style {{1}} template rendering from an ordered list of values. */
export function renderTemplate(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (m, n: string) => values[Number(n) - 1] ?? m);
}

export const startOfDay = (at: number) => startOfZonedDay(new Date(at), TZ).getTime();
export const addDays = (at: number, days: number) => addZonedDays(new Date(at), days, TZ).getTime();
export const monthKey = (at: number) => zonedMonthKey(new Date(at), TZ);
export const istHour = (at: number) => zonedParts(new Date(at), TZ).hour;
/** 0 = Sunday. */
export const istWeekday = (at: number) => {
  const p = zonedParts(new Date(at), TZ);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
};

/** Clamp a time into IST business hours (10:00-19:00) of its own day. */
export function intoBusinessHours(rng: Rng, at: number): number {
  const h = istHour(at);
  if (h >= 10 && h < 19) return at;
  return startOfDay(at) + 10 * HOUR + Math.floor(rng() * 9 * HOUR);
}

export const iso = (at: number) => new Date(at).toISOString();
export const d = (at: number) => new Date(at);

/** Insert rows in batches with createMany (pg adapter parameter limits). */
export async function insertMany<T>(rows: T[], insert: (batch: T[]) => Promise<unknown>, size = 1000): Promise<void> {
  for (let i = 0; i < rows.length; i += size) await insert(rows.slice(i, i + size));
}

/** Move every top-level Date field of the rows by `delta` ms (generation clock -> real clock). */
export function shiftDates(rows: ReadonlyArray<object | null>, delta: number): void {
  if (!delta) return;
  for (const row of rows) {
    if (!row) continue;
    const r = row as Record<string, unknown>;
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (v instanceof Date) r[k] = new Date(v.getTime() + delta);
    }
  }
}

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Valid-format GSTIN (state code + PAN-like body + entity + Z + checksum). */
export function gstin(rng: Rng, stateCode: string): string {
  const letters = (n: number) => Array.from({ length: n }, () => pick(rng, [...LETTERS])).join('');
  const digits = (n: number) => Array.from({ length: n }, () => String(int(rng, 0, 9))).join('');
  const body = `${stateCode}${letters(3)}${pick(rng, ['C', 'P', 'F', 'H'])}${letters(1)}${digits(4)}${letters(1)}${pick(rng, ['1', '1', '2'])}Z`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const v = GST_CHARS.indexOf(body[i]!) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return body + GST_CHARS[(36 - (sum % 36)) % 36];
}

/** First name of "Rakesh Sharma". */
export const firstName = (name: string) => name.split(' ')[0] ?? name;
