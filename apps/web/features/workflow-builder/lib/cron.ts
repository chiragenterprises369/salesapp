/** Minimal 5-field cron parser for previews ("0 11 * * 1" -> "Every Monday at 11:00"). */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const RANGES: Array<[number, number]> = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
const FIELD_NAMES = ['minute', 'hour', 'day of month', 'month', 'day of week'];

export const CRON_PRESETS = [
  { value: '0 10 * * 1-6', label: 'Every working day (Mon-Sat) at 10:00' },
  { value: '0 11 * * 1', label: 'Every Monday at 11:00' },
  { value: '0 9 * * *', label: 'Every day at 09:00' },
  { value: '30 17 * * 5', label: 'Every Friday at 17:30' },
  { value: '0 10 1 * *', label: 'On the 1st of every month at 10:00' },
  { value: '0 * * * *', label: 'Every hour' },
];

interface Field {
  all: boolean;
  values: number[];
  step: number | null;
}

function parseField(src: string, [min, max]: [number, number]): Field | null {
  if (src === '*') return { all: true, values: [], step: null };
  const values = new Set<number>();
  let step: number | null = null;
  for (const part of src.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const [, base, stepStr] = m;
    let lo = min;
    let hi = max;
    if (base !== '*') {
      const [a, b] = base!.split('-').map(Number);
      lo = a!;
      hi = b ?? a!;
    }
    if (lo < min || hi > max || lo > hi) return null;
    const st = stepStr ? Number(stepStr) : 1;
    if (st < 1) return null;
    if (stepStr) step = st;
    for (let v = lo; v <= hi; v += st) values.add(v);
  }
  if (src.startsWith('*/') && step)
    return { all: false, values: [...values].sort((a, b) => a - b), step };
  return { all: false, values: [...values].sort((a, b) => a - b), step: null };
}

export function validateCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5)
    return 'Use 5 fields: minute hour day month weekday, for example 0 10 * * 1-6';
  for (let i = 0; i < 5; i++) {
    if (!parseField(parts[i]!, RANGES[i]!)) return `Check the ${FIELD_NAMES[i]} field`;
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, '0');

function listJoin(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function contiguous(values: number[]): boolean {
  return values.length > 2 && values.every((v, i) => i === 0 || v === values[i - 1]! + 1);
}

function describeDays(f: Field): string | null {
  if (f.all) return null;
  const days = [...new Set(f.values.map((d) => d % 7))].sort((a, b) => a - b);
  if (days.length === 7) return null;
  const sameAsWeekdays = days.join(',') === '1,2,3,4,5';
  if (sameAsWeekdays) return 'Monday to Friday';
  if (days.join(',') === '1,2,3,4,5,6') return 'Monday to Saturday';
  if (contiguous(days)) return `${DAY_NAMES[days[0]!]} to ${DAY_NAMES[days[days.length - 1]!]}`;
  return listJoin(days.map((d) => DAY_NAMES[d]!));
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** Human sentence for a cron expression, or null when invalid. */
export function describeCron(cron: string): string | null {
  if (validateCron(cron)) return null;
  const [mi, ho, dom, mo, dow] = cron
    .trim()
    .split(/\s+/)
    .map((p, i) => parseField(p, RANGES[i]!)!) as [Field, Field, Field, Field, Field];

  let time: string;
  if (mi.step && ho.all) time = `Every ${mi.step} minutes`;
  else if (mi.all && ho.all) time = 'Every minute';
  else if (ho.all && mi.values.length === 1)
    time = mi.values[0] === 0 ? 'Every hour' : `Every hour at ${pad(mi.values[0]!)} minutes past`;
  else if (ho.step && mi.values.length === 1)
    time = `Every ${ho.step} hours at ${pad(mi.values[0]!)} minutes past`;
  else if (mi.values.length === 1 && ho.values.length >= 1)
    time = `At ${listJoin(ho.values.map((h) => `${pad(h)}:${pad(mi.values[0]!)}`))}`;
  else time = 'At the listed minutes';

  const parts: string[] = [time];
  const days = describeDays(dow);
  if (!dom.all) parts.push(`on the ${listJoin(dom.values.map(ordinal))}`);
  if (days) parts.push(dom.all ? (days.includes(' to ') ? days : `every ${days}`) : `or ${days}`);
  else if (dom.all && !time.startsWith('Every')) parts.push('every day');
  if (!mo.all) parts.push(`in ${listJoin(mo.values.map((m) => MONTHS[m - 1]!))}`);
  return parts.join(', ').replace(', every day', ' every day');
}
