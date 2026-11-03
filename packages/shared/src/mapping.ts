/**
 * Inbound webhook payload mapping (change #19 wave C, D-069). Pure functions shared by the API (ingestion,
 * POST /webhooks/mapping/preview) and the web mapping editor (instant preview), so both give the same lead.
 *
 * Path expressions:
 *   data.customer.mobile        dot path ("$." prefix optional)
 *   items[0].name / items.0.name array index
 *   ["field with space"]        bracket key
 *   mobile || phone             first non-empty alternative
 *   first_name + last_name      join non-empty parts with one space
 *   "IndiaMART"                 quoted constant (inside + or ||)
 */
import { LEAD_SOURCES } from './enums.js';
import { normalizeIndianPhone } from './format.js';
import type { MappingTransform, PayloadMapping } from './schemas/integration.js';

type Json = unknown;

/** Split `s` on a separator outside quotes. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quote) {
      cur += ch;
      if (ch === quote && s[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (s.startsWith(sep, i)) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((p) => p.trim());
}

/** `a.b[0]["c d"].e` -> ['a', 'b', '0', 'c d', 'e']. */
export function parsePath(path: string): string[] {
  let p = path.trim();
  if (p.startsWith('$')) p = p.slice(1);
  if (p.startsWith('.')) p = p.slice(1);
  const tokens: string[] = [];
  const re = /\[\s*(?:"([^"]*)"|'([^']*)'|(\d+))\s*\]|([^.[\]]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) tokens.push((m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim());
  return tokens.filter((t) => t !== '');
}

/** Value at a plain path, or undefined. */
export function resolvePath(payload: Json, path: string): Json {
  let node: Json = payload;
  for (const key of parsePath(path)) {
    if (node === null || node === undefined) return undefined;
    if (Array.isArray(node)) {
      const idx = Number(key);
      node = Number.isInteger(idx) ? node[idx] : undefined;
    } else if (typeof node === 'object') {
      node = (node as Record<string, Json>)[key];
    } else {
      return undefined;
    }
  }
  return node;
}

const isEmpty = (v: Json) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
const unquote = (t: string): string | null => {
  const m = /^(["'])(.*)\1$/s.exec(t);
  return m ? (m[2] ?? '') : null;
};
const asText = (v: Json): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v));

/** Evaluate a full expression (fallbacks and joins). */
export function evaluateExpression(payload: Json, expr: string): Json {
  for (const alt of splitTop(expr, '||')) {
    const terms = splitTop(alt, '+').filter(Boolean);
    const values = terms.map((t) => {
      const constant = unquote(t);
      return constant !== null ? constant : resolvePath(payload, t);
    });
    let value: Json;
    if (values.length <= 1) value = values[0];
    else {
      const parts = values.filter((v) => !isEmpty(v)).map(asText);
      value = parts.length ? parts.join(' ') : undefined;
    }
    if (!isEmpty(value)) return value;
  }
  return undefined;
}

/** Indian mobile (any common way of writing it) or E.164; null otherwise. */
export function normalizePhoneLoose(raw: string): string | null {
  const indian = normalizeIndianPhone(raw);
  if (indian) return indian;
  const compact = raw.replace(/[\s().-]/g, '');
  const e164 = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  return /^\+[1-9]\d{6,14}$/.test(e164) ? e164 : null;
}

export function applyTransform(value: Json, transform: MappingTransform): Json {
  if (isEmpty(value) || transform === 'none') return value;
  const text = asText(value).trim();
  switch (transform) {
    case 'trim':
      return text;
    case 'lower':
      return text.toLowerCase();
    case 'upper':
      return text.toUpperCase();
    case 'phone_in':
      return normalizePhoneLoose(text) ?? text;
    case 'number': {
      const n = Number(text.replace(/(₹|rs\.?|inr|,|\s)/gi, ''));
      return Number.isFinite(n) ? n : text;
    }
    case 'first_name':
      return text.split(/\s+/)[0] ?? '';
    case 'last_name':
      return text.split(/\s+/).slice(1).join(' ');
    default:
      return value;
  }
}

/** Lead fields a mapping can produce (string fields), plus valueInr, tags, sourceRef, source, ownerEmail, stageName. */
const TEXT_LIMITS: Record<string, number> = {
  name: 120,
  companyName: 160,
  city: 80,
  state: 80,
  sourceRef: 120,
  productInterest: 200,
  requirement: 4000,
  ownerEmail: 254,
  stageName: 80,
};

export interface MappedLead {
  name?: string;
  companyName?: string;
  phone?: string;
  email?: string;
  city?: string;
  state?: string;
  source?: (typeof LEAD_SOURCES)[number];
  sourceRef?: string;
  productInterest?: string;
  requirement?: string;
  valueInr?: number;
  tags?: string[];
  ownerEmail?: string;
  stageName?: string;
  customFields: Record<string, Json>;
}

export interface MappingResult {
  lead: MappedLead;
  errors: Array<{ path: string; message: string }>;
  /** One row per mapping field (for the editor's live preview): the value after the transform, or the error. */
  rows: Array<{ index: number; from: string; to: string; value: unknown; error: string | null }>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assign(lead: MappedLead, errors: MappingResult['errors'], to: string, raw: Json, where: string): void {
  if (isEmpty(raw)) return;
  if (to.startsWith('custom.')) {
    lead.customFields[to.slice(7)] = typeof raw === 'string' ? raw.trim() : raw;
    return;
  }
  switch (to) {
    case 'phone': {
      const phone = normalizePhoneLoose(asText(raw));
      if (phone) lead.phone = phone;
      else errors.push({ path: where, message: 'Not a valid phone number (use +91XXXXXXXXXX or a 10-digit Indian mobile)' });
      return;
    }
    case 'email': {
      const email = asText(raw).trim().toLowerCase();
      if (EMAIL_RE.test(email) && email.length <= 254) lead.email = email;
      else errors.push({ path: where, message: 'Not a valid e-mail address' });
      return;
    }
    case 'valueInr': {
      const n = typeof raw === 'number' ? raw : Number(asText(raw).replace(/(₹|rs\.?|inr|,|\s)/gi, ''));
      if (Number.isFinite(n) && n >= 0) lead.valueInr = Math.min(2_000_000_000, Math.round(n));
      else errors.push({ path: where, message: 'Not a number' });
      return;
    }
    case 'tags': {
      const list = Array.isArray(raw) ? raw.map(asText) : asText(raw).split(/[,;|]/);
      const tags = [...new Set([...(lead.tags ?? []), ...list.map((t) => t.trim().slice(0, 40)).filter(Boolean)])].slice(0, 30);
      lead.tags = tags;
      return;
    }
    case 'source': {
      const v = asText(raw).trim().toLowerCase().replace(/[\s-]/g, '');
      if ((LEAD_SOURCES as readonly string[]).includes(v)) lead.source = v as MappedLead['source'];
      else errors.push({ path: where, message: `Unknown source (use one of ${LEAD_SOURCES.join(', ')})` });
      return;
    }
    default: {
      const limit = TEXT_LIMITS[to];
      if (limit === undefined) {
        errors.push({ path: where, message: `Unknown lead field "${to}"` });
        return;
      }
      (lead as unknown as Record<string, string>)[to] = asText(raw).trim().slice(0, limit);
    }
  }
}

/**
 * Apply a mapping to a payload. Errors are per field (`fields.<i>` or `defaults.<field>`); the lead keeps every
 * valid value. A lead without a name gets an error on `name` (the API falls back to the phone or e-mail).
 */
export function applyPayloadMapping(payload: Json, mapping: PayloadMapping): MappingResult {
  const lead: MappedLead = { customFields: {} };
  const errors: MappingResult['errors'] = [];
  const rows: MappingResult['rows'] = [];
  mapping.fields.forEach((f, i) => {
    const value = applyTransform(evaluateExpression(payload, f.from), f.transform ?? 'none');
    const before = errors.length;
    assign(lead, errors, f.to, value, `fields.${i}`);
    rows.push({ index: i, from: f.from, to: f.to, value: value ?? null, error: errors.length > before ? errors[errors.length - 1]!.message : null });
  });
  for (const [to, constant] of Object.entries(mapping.defaults ?? {})) {
    const current = to.startsWith('custom.') ? lead.customFields[to.slice(7)] : (lead as unknown as Record<string, Json>)[to];
    if (isEmpty(current)) assign(lead, errors, to, constant, `defaults.${to}`);
  }
  if (!lead.name) errors.push({ path: 'name', message: 'No value for the lead name' });
  return { lead, errors, rows };
}

export interface PayloadPath {
  path: string;
  type: 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
  sample: string | null;
}

/** Leaf paths of a sample payload for the path picker (first 3 items of each array, max depth 8, max 300 paths). */
export function listPayloadPaths(payload: Json, opts: { maxDepth?: number; maxPaths?: number } = {}): PayloadPath[] {
  const maxDepth = opts.maxDepth ?? 8;
  const maxPaths = opts.maxPaths ?? 300;
  const out: PayloadPath[] = [];
  const keyPart = (k: string) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? `.${k}` : `["${k.replace(/"/g, '\\"')}"]`);
  const walk = (node: Json, path: string, depth: number) => {
    if (out.length >= maxPaths) return;
    if (Array.isArray(node)) {
      if (!node.length || depth >= maxDepth) out.push({ path, type: 'array', sample: node.length ? `${node.length} items` : null });
      node.slice(0, 3).forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1));
      return;
    }
    if (node !== null && typeof node === 'object') {
      const entries = Object.entries(node as Record<string, Json>);
      if (!entries.length || depth >= maxDepth) out.push({ path, type: 'object', sample: null });
      if (depth < maxDepth) for (const [k, v] of entries) walk(v, `${path}${keyPart(k)}`, depth + 1);
      return;
    }
    const type = node === null ? 'null' : (typeof node as PayloadPath['type']);
    out.push({ path, type, sample: node === null || node === undefined ? null : asText(node).slice(0, 80) });
  };
  walk(payload, '', 0);
  return out.filter((p) => p.path !== '').map((p) => ({ ...p, path: p.path.startsWith('.') ? p.path.slice(1) : p.path }));
}
