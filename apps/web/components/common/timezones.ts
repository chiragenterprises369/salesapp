/** Timezones offered first (Indian SMEs and common export markets). */
export const COMMON_TIME_ZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Kathmandu',
  'Asia/Dhaka',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Australia/Sydney',
] as const;

/**
 * Full IANA list from the browser (client only: server and browser ICU lists can differ, so do not
 * render this during SSR). Common zones first, then the rest alphabetically; `current` is always kept.
 */
export function allTimeZones(current?: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [];
  }
  const rest = zones.filter((z) => !(COMMON_TIME_ZONES as readonly string[]).includes(z));
  return [...new Set([...COMMON_TIME_ZONES, ...(current ? [current] : []), ...rest])];
}
