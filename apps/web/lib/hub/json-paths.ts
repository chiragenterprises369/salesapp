/**
 * JSON path helpers for the inbound mapping editor. Paths are dot separated with numeric array
 * indexes ("RESPONSE.0.SENDER_MOBILE", "data.customer.name"), the "JSONPath-lite" form the API
 * evaluates (PayloadMappingSchema.from). Keys that contain dots or spaces are quoted in brackets
 * (`meta["user.id"]`), which the API path parser accepts as well.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const SIMPLE_KEY = /^[A-Za-z_][\w-]*$/;

/** Join path segments: keys with dots, spaces or brackets go in `["..."]`. */
export function formatPath(segments: ReadonlyArray<string | number>): string {
  let out = '';
  for (const seg of segments) {
    if (typeof seg === 'number') out += out ? `.${seg}` : String(seg);
    else if (SIMPLE_KEY.test(seg)) out += out ? `.${seg}` : seg;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

/** Split a path back into segments ("a.0.b", 'a["x.y"].c'). Returns null when malformed. */
export function parsePath(path: string): Array<string | number> | null {
  const out: Array<string | number> = [];
  let i = 0;
  const s = path.trim();
  if (!s) return [];
  while (i < s.length) {
    if (s[i] === '.') {
      i++;
      continue;
    }
    if (s[i] === '[') {
      const close = s.indexOf(']', i);
      if (close < 0) return null;
      const inner = s.slice(i + 1, close).trim();
      if (/^\d+$/.test(inner)) out.push(Number(inner));
      else {
        try {
          const key: unknown = JSON.parse(inner.replace(/^'(.*)'$/, '"$1"'));
          if (typeof key !== 'string') return null;
          out.push(key);
        } catch {
          return null;
        }
      }
      i = close + 1;
      continue;
    }
    let j = i;
    while (j < s.length && s[j] !== '.' && s[j] !== '[') j++;
    const part = s.slice(i, j);
    out.push(/^\d+$/.test(part) ? Number(part) : part);
    i = j;
  }
  return out;
}

/** Value at a path, or undefined when any step is missing. */
export function getAtPath(value: unknown, path: string): unknown {
  const segs = parsePath(path);
  if (!segs) return undefined;
  let cur: unknown = value;
  for (const seg of segs) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

export interface JsonLeaf {
  path: string;
  /** Last key ("SENDER_MOBILE") for matching and display. */
  key: string;
  value: string | number | boolean | null;
}

/** Every scalar in the payload with its path (arrays: the first 3 items), at most `limit` leaves. */
export function flattenLeaves(value: unknown, limit = 400): JsonLeaf[] {
  const out: JsonLeaf[] = [];
  const walk = (v: unknown, segs: Array<string | number>, depth: number) => {
    if (out.length >= limit || depth > 12) return;
    if (Array.isArray(v)) {
      v.slice(0, 3).forEach((item, i) => walk(item, [...segs, i], depth + 1));
      return;
    }
    if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) walk(child, [...segs, k], depth + 1);
      return;
    }
    if (v === undefined || typeof v === 'function' || typeof v === 'symbol' || typeof v === 'bigint') return;
    const last = segs[segs.length - 1];
    out.push({ path: formatPath(segs), key: last === undefined ? '' : String(last), value: v as string | number | boolean | null });
  };
  walk(value, [], 0);
  return out;
}

/** Parse pasted JSON with a readable error ("Line 3: Unexpected token"). */
export function parseSample(text: string): { ok: true; value: JsonValue } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Paste a JSON payload first.' };
  try {
    return { ok: true, value: JSON.parse(t) as JsonValue };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON';
    const pos = /position (\d+)/.exec(msg);
    if (pos) {
      const line = t.slice(0, Number(pos[1])).split('\n').length;
      return { ok: false, error: `This is not valid JSON (line ${line}). ${msg.replace(/ in JSON at position \d+.*$/, '')}.` };
    }
    return { ok: false, error: `This is not valid JSON. ${msg}` };
  }
}

/** Short preview of a value for the tree and the mapping rows. */
export function previewValue(v: unknown, max = 60): string {
  if (v === undefined) return '(missing)';
  if (v === null) return 'null';
  if (typeof v === 'string') return v.length > max ? `"${v.slice(0, max - 1)}…"` : `"${v}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `[${v.length} ${v.length === 1 ? 'item' : 'items'}]`;
  if (typeof v === 'object') return `{${Object.keys(v as object).length} keys}`;
  return String(v);
}

/**
 * Name-based guesses for a first mapping (the user reviews every row): IndiaMART, JustDial,
 * website forms and common CRM payloads use these key names.
 */
const GUESSES: ReadonlyArray<{ to: string; keys: RegExp; transform?: string }> = [
  { to: 'phone', keys: /^(sender_?mobile|mobile|mobile_?(no|number)|phone|phone_?(no|number)|contact_?(no|number)|whatsapp|msisdn)$/i, transform: 'phone_in' },
  { to: 'email', keys: /^(sender_?email|email|email_?(id|address)|mail)$/i, transform: 'lower' },
  { to: 'name', keys: /^(sender_?name|name|full_?name|customer_?name|contact_?name|lead_?name)$/i, transform: 'trim' },
  { to: 'companyName', keys: /^(sender_?company|company|company_?name|organisation|organization|business_?name|firm)$/i, transform: 'trim' },
  { to: 'city', keys: /^(sender_?city|city|town)$/i, transform: 'trim' },
  { to: 'state', keys: /^(sender_?state|state|region)$/i, transform: 'trim' },
  { to: 'productInterest', keys: /^(query_?product_?name|product|product_?name|subject|service|interest)$/i, transform: 'trim' },
  { to: 'requirement', keys: /^(query_?message|message|requirement|enquiry|inquiry|comments?|description|notes?)$/i, transform: 'trim' },
  { to: 'sourceRef', keys: /^(unique_?query_?id|query_?id|lead_?id|enquiry_?id|ref|reference|id)$/i },
  { to: 'valueInr', keys: /^(value|amount|budget|order_?value|deal_?value)$/i, transform: 'number' },
];

/** First-guess rows for the leaves; one row per lead field, first matching leaf wins. */
export function suggestMapping(leaves: readonly JsonLeaf[], allowedTransforms: readonly string[]): Array<{ from: string; to: string; transform: string }> {
  const out: Array<{ from: string; to: string; transform: string }> = [];
  const used = new Set<string>();
  for (const g of GUESSES) {
    const leaf = leaves.find((l) => g.keys.test(l.key) && !used.has(l.path) && l.value !== null && l.value !== '');
    if (!leaf) continue;
    used.add(leaf.path);
    const transform = g.transform && allowedTransforms.includes(g.transform) ? g.transform : allowedTransforms.includes('none') ? 'none' : (allowedTransforms[0] ?? 'none');
    out.push({ from: leaf.path, to: g.to, transform });
  }
  return out;
}
