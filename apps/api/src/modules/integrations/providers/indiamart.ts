import { normalizePhoneLoose, type MappedLead } from '@vistar/shared';
import { createHash } from 'node:crypto';
import { safeFetch } from '../../../infra/http/safe-http.js';

/**
 * IndiaMART Lead Manager CRM API v2 (pull) and Push API payloads.
 * Pull rules (help.indiamart.com, "Integration of IndiaMART's Lead Manager Pull API"): start_time / end_time in IST as
 * DD-Mon-YYYYHH:MM:SS, at most 7 days apart, at most one call per 5 minutes (more = CODE 429; 5+ calls a minute block the
 * key for 15 minutes), the key expires after 7 days without use. Recommended: start = previous end - 5 minutes (overlap),
 * end = now, dedupe by UNIQUE_QUERY_ID.
 */
export const INDIAMART_MIN_INTERVAL_MS = 5 * 60_000;
export const INDIAMART_MAX_WINDOW_MS = 7 * 86_400_000;
export const INDIAMART_OVERLAP_MS = 5 * 60_000;
export const INDIAMART_FIRST_WINDOW_MS = 86_400_000;

export interface IndiamartRecord {
  UNIQUE_QUERY_ID: string;
  QUERY_TYPE?: string | null;
  QUERY_TIME?: string | null;
  SENDER_NAME?: string | null;
  SENDER_MOBILE?: string | null;
  SENDER_EMAIL?: string | null;
  SENDER_COMPANY?: string | null;
  SENDER_ADDRESS?: string | null;
  SENDER_CITY?: string | null;
  SENDER_STATE?: string | null;
  SENDER_PINCODE?: string | null;
  SENDER_COUNTRY_ISO?: string | null;
  SENDER_MOBILE_ALT?: string | null;
  SENDER_PHONE?: string | null;
  SENDER_EMAIL_ALT?: string | null;
  SUBJECT?: string | null;
  QUERY_PRODUCT_NAME?: string | null;
  QUERY_MESSAGE?: string | null;
  QUERY_MCAT_NAME?: string | null;
  CALL_DURATION?: string | null;
}

export interface IndiamartPullResult {
  code: number;
  message: string;
  records: IndiamartRecord[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 330 * 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** 2026-11-03T04:30:00Z -> "03-Nov-202610:00:00" (IST, the format IndiaMART documents). */
export function formatIndiamartTime(d: Date): string {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  return `${pad(t.getUTCDate())}-${MONTHS[t.getUTCMonth()]}-${t.getUTCFullYear()}${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}

/** Pull window: overlap the previous end by 5 minutes, never more than 7 days back, first pull = last 24 hours. */
export function pullWindow(lastWindowEnd: Date | null, now: Date): { start: Date; end: Date } {
  const end = now;
  const earliest = now.getTime() - INDIAMART_MAX_WINDOW_MS + 60_000;
  const wanted = lastWindowEnd ? lastWindowEnd.getTime() - INDIAMART_OVERLAP_MS : now.getTime() - INDIAMART_FIRST_WINDOW_MS;
  return { start: new Date(Math.max(earliest, wanted)), end };
}

const isRecord = (v: unknown): v is IndiamartRecord => !!v && typeof v === 'object' && typeof (v as { UNIQUE_QUERY_ID?: unknown }).UNIQUE_QUERY_ID !== 'undefined';

/** Records from a pull response or a push body ({ CODE, STATUS, RESPONSE: {...} | [...] }). */
export function recordsOf(body: unknown): IndiamartRecord[] {
  const response = (body as { RESPONSE?: unknown } | null)?.RESPONSE;
  const list = Array.isArray(response) ? response : response ? [response] : Array.isArray(body) ? body : [];
  return list.filter(isRecord).map((r) => ({ ...r, UNIQUE_QUERY_ID: String(r.UNIQUE_QUERY_ID) }));
}

/** Live pull. The key is a query parameter: never log the URL. */
export async function pullLive(baseUrl: string, crmKey: string, start: Date, end: Date): Promise<IndiamartPullResult> {
  const url = new URL(baseUrl);
  url.searchParams.set('glusr_crm_key', crmKey);
  url.searchParams.set('start_time', formatIndiamartTime(start));
  url.searchParams.set('end_time', formatIndiamartTime(end));
  const res = await safeFetch({ url: url.toString(), method: 'GET', headers: { accept: 'application/json' }, timeoutMs: 20_000, maxResponseBytes: 5 * 1024 * 1024 });
  let json: { CODE?: number; MESSAGE?: string; RESPONSE?: unknown } = {};
  try {
    json = JSON.parse(res.body) as typeof json;
  } catch {
    return { code: res.status || 502, message: `IndiaMART answered HTTP ${res.status} without JSON`, records: [] };
  }
  const code = Number(json.CODE ?? res.status);
  return { code, message: String(json.MESSAGE ?? ''), records: code === 200 ? recordsOf(json) : [] };
}

const MOCK_NAMES = ['Ramesh Patil', 'Sunita Agarwal', 'Imran Shaikh', 'Kavya Reddy', 'Harpreet Singh', 'Deepak Joshi', 'Meena Iyer', 'Arjun Nair'];
const MOCK_CITIES = [['Pune', 'Maharashtra'], ['Ahmedabad', 'Gujarat'], ['Indore', 'Madhya Pradesh'], ['Coimbatore', 'Tamil Nadu'], ['Ludhiana', 'Punjab'], ['Jaipur', 'Rajasthan']] as const;
const MOCK_PRODUCTS = ['MS Angle', 'Industrial Air Compressor', 'Stainless Steel Sheet', 'Packaging Machine', 'Solar Inverter', 'PVC Pipes'];
const MOCK_TYPES = ['W', 'B', 'P', 'WA'];

/**
 * Dev mock of the pull API: one enquiry in about a third of the 10-minute buckets of the window, deterministic per
 * workspace and bucket (overlapping windows return the same UNIQUE_QUERY_IDs, so dedupe is exercised). At most 5.
 */
export function pullMock(workspaceId: string, start: Date, end: Date): IndiamartPullResult {
  const bucketMs = 10 * 60_000;
  const out: IndiamartRecord[] = [];
  for (let b = Math.floor(start.getTime() / bucketMs); b <= Math.floor(end.getTime() / bucketMs); b++) {
    const h = createHash('sha256').update(`${workspaceId}:${b}`).digest();
    if (h[0]! % 3 !== 0) continue;
    const at = b * bucketMs + (h[1]! % 10) * 60_000;
    if (at < start.getTime() || at > end.getTime()) continue;
    const [city, state] = MOCK_CITIES[h[2]! % MOCK_CITIES.length]!;
    const mobile = `9${String(100_000_000 + (h.readUInt32BE(3) % 899_999_999)).slice(0, 9)}`;
    const name = MOCK_NAMES[h[7]! % MOCK_NAMES.length]!;
    out.push({
      UNIQUE_QUERY_ID: `MOCK${b}${h[8]! % 10}`,
      QUERY_TYPE: MOCK_TYPES[h[9]! % MOCK_TYPES.length]!,
      QUERY_TIME: new Date(at).toISOString(),
      SENDER_NAME: name,
      SENDER_MOBILE: `+91-${mobile}`,
      SENDER_EMAIL: `${name.split(' ')[0]!.toLowerCase()}.${b % 1000}@example.in`,
      SENDER_COMPANY: `${name.split(' ')[1]} Traders`,
      SENDER_CITY: city,
      SENDER_STATE: state,
      SENDER_COUNTRY_ISO: 'IN',
      QUERY_PRODUCT_NAME: MOCK_PRODUCTS[h[10]! % MOCK_PRODUCTS.length]!,
      QUERY_MESSAGE: `Need a quotation for ${MOCK_PRODUCTS[h[10]! % MOCK_PRODUCTS.length]} (${1 + (h[11]! % 20)} units). Mock enquiry from the dev IndiaMART adapter.`,
      SUBJECT: 'Requirement for your product',
    });
  }
  out.sort((a, b) => String(b.QUERY_TIME).localeCompare(String(a.QUERY_TIME)));
  const records = out.slice(0, 5);
  return { code: records.length ? 200 : 204, message: records.length ? '' : 'There are no leads in the given time duration.', records };
}

const TYPE_TAGS: Record<string, string> = { W: 'direct-enquiry', B: 'buy-lead', P: 'pns-call', BIZ: 'catalog-view', WA: 'whatsapp-enquiry' };

/** One IndiaMART record -> mapped lead (source indiamart, sourceRef = UNIQUE_QUERY_ID). */
export function recordToLead(r: IndiamartRecord, extraTags: readonly string[]): MappedLead {
  const clean = (v: string | null | undefined, max: number) => (v ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) || undefined : undefined);
  const phoneRaw = r.SENDER_MOBILE || r.SENDER_MOBILE_ALT || r.SENDER_PHONE || '';
  const phone = phoneRaw ? (normalizePhoneLoose(phoneRaw) ?? undefined) : undefined;
  const emailRaw = (r.SENDER_EMAIL || r.SENDER_EMAIL_ALT || '').trim().toLowerCase();
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : undefined;
  const typeTag = r.QUERY_TYPE ? TYPE_TAGS[r.QUERY_TYPE] : undefined;
  const requirement = [r.SUBJECT, r.QUERY_MESSAGE, r.QUERY_MCAT_NAME ? `Category: ${r.QUERY_MCAT_NAME}` : null, r.SENDER_ADDRESS ? `Address: ${r.SENDER_ADDRESS}${r.SENDER_PINCODE ? ` ${r.SENDER_PINCODE}` : ''}` : null, r.CALL_DURATION ? `Call duration: ${r.CALL_DURATION} s` : null]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
  return {
    name: clean(r.SENDER_NAME, 120) ?? 'IndiaMART Buyer',
    phone,
    email,
    companyName: clean(r.SENDER_COMPANY, 160),
    city: clean(r.SENDER_CITY, 80),
    state: clean(r.SENDER_STATE, 80),
    productInterest: clean(r.QUERY_PRODUCT_NAME, 200),
    requirement: requirement || undefined,
    source: 'indiamart',
    sourceRef: String(r.UNIQUE_QUERY_ID).slice(0, 120),
    tags: [...extraTags, ...(typeTag ? [typeTag] : [])],
    customFields: {},
  };
}
