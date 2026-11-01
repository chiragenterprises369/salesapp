/** Small time helpers for 24h HH:MM values (theme schedule, business hours). Display in en-IN 12h. */

export function formatHhMm(hhmm: string): string {
  const [h = '0', m = '00'] = hhmm.split(':');
  const hour = Number(h);
  const suffix = hour < 12 ? 'am' : 'pm';
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${m.padStart(2, '0')} ${suffix}`;
}

/** Hourly options 00:00 to 23:00, plus `extra` values (e.g. a saved 19:30) kept in order. */
export function hourOptions(extra: readonly string[] = []): string[] {
  const hours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
  return [...new Set([...hours, ...extra])].sort();
}

export function toMinutes(hhmm: string): number {
  const [h = '0', m = '0'] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
}

/** "2 Nov, 2:30 pm" in the given IANA timezone. */
export function formatDateTimeIn(iso: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/** "2:30 pm" in the given IANA timezone. */
export function formatTimeIn(iso: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));
}

/** mm:ss countdown (h:mm:ss above an hour). Negative values clamp to 0:00. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
