import {
  fieldAccessFor,
  parseTarget,
  validateCustomValues,
  visibleValues,
  type CustomFieldValue,
  type CustomFieldValues,
  type FieldDefinition,
  type FieldError,
  type FieldTarget,
} from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import type { TenantDb } from '../leads/lib/context.js';
import { FIELD_ORDER, toFieldDefinitions } from './field.mapper.js';

/**
 * Custom values on core entities (lead, task, ...) and custom object records.
 * Every write goes through `validateValues` (types, required, archived, field permissions by Role.key,
 * referenced ids in the tenant); every read through `visibleFor` (strips fields hidden for the role).
 */

const roleKeyCache = new WeakMap<AuthContext, Promise<string | null>>();

/** Caller's Role.key (cached per request). API keys and system callers have no role: no field restrictions. */
export function roleKeyOf(db: TenantDb, auth: AuthContext): Promise<string | null> {
  if (!auth.roleId) return Promise.resolve(null);
  let pending = roleKeyCache.get(auth);
  if (!pending) {
    pending = db.role.findUnique({ where: { id: auth.roleId }, select: { key: true } }).then((r) => r?.key ?? null);
    roleKeyCache.set(auth, pending);
  }
  return pending;
}

/** Field definitions are admin data: callers with settings.manage see every field. */
export const canManageFields = (auth: AuthContext): boolean => auth.permissions.includes('settings.manage');

/** All definitions of a target, archived included (validation reports archived keys, reads keep their values). */
export async function loadFieldDefs(db: TenantDb, target: FieldTarget | string): Promise<FieldDefinition[]> {
  return toFieldDefinitions(await db.customField.findMany({ where: { target }, orderBy: FIELD_ORDER }));
}

/** 422 VALIDATION_FAILED with field errors (paths like `values.<key>` or `customFields.<key>`). */
export function invalidValues(errors: FieldError[], message = 'Some fields are invalid'): AppException {
  return new AppException('VALIDATION_FAILED', message, { details: errors, status: 422 });
}

const idsOf = (v: CustomFieldValue): string[] => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []);

/** Ids in user / relation / file values must exist in the caller's workspace (tenant client). */
export async function referenceErrors(db: TenantDb, defs: readonly FieldDefinition[], values: CustomFieldValues, pathPrefix: string): Promise<FieldError[]> {
  const errors: FieldError[] = [];
  for (const def of defs) {
    if (!(def.key in values) || (def.type !== 'user' && def.type !== 'relation' && def.type !== 'file')) continue;
    const ids = [...new Set(idsOf(values[def.key]!))];
    if (!ids.length) continue;
    const where = { id: { in: ids } };
    let found = 0;
    if (def.type === 'user') found = await db.user.count({ where: { ...where, deletedAt: null } });
    else if (def.type === 'file') found = await db.file.count({ where });
    else {
      const target = String((def.config as { target?: unknown }).target ?? '');
      const t = parseTarget(target);
      if (t.kind === 'object') found = await db.customRecord.count({ where: { ...where, deletedAt: null, object: { key: t.key } } });
      else if (t.entity === 'lead') found = await db.lead.count({ where: { ...where, deletedAt: null } });
      else if (t.entity === 'contact') found = await db.contact.count({ where });
      else if (t.entity === 'company') found = await db.company.count({ where });
      else if (t.entity === 'deal') found = await db.deal.count({ where });
      else if (t.entity === 'task') found = await db.task.count({ where: { ...where, deletedAt: null } });
      else if (t.entity === 'call') found = await db.call.count({ where });
    }
    if (found !== ids.length) {
      const what = def.type === 'user' ? 'team member' : def.type === 'file' ? 'file' : 'linked record';
      errors.push({ path: `${pathPrefix}.${def.key}`, message: `The selected ${what} was not found` });
    }
  }
  return errors;
}

/**
 * Validate a create body / update patch for the caller. Throws 422 with details; returns the parsed values
 * (patch in update mode, `null` = clear).
 */
export async function validateValues(
  db: TenantDb,
  auth: AuthContext,
  defs: readonly FieldDefinition[],
  input: Record<string, unknown> | null | undefined,
  opts: { mode: 'create' | 'update'; pathPrefix: string; roleKey?: string | null },
): Promise<CustomFieldValues> {
  const roleKey = opts.roleKey !== undefined ? opts.roleKey : await roleKeyOf(db, auth);
  const r = validateCustomValues(defs, input, { mode: opts.mode, roleKey, pathPrefix: opts.pathPrefix });
  if (!r.ok) throw invalidValues(r.errors);
  const refs = await referenceErrors(db, defs, r.values, opts.pathPrefix);
  if (refs.length) throw invalidValues(refs);
  return r.values;
}

/** Values the caller may read. */
export function visibleFor(defs: readonly FieldDefinition[], values: CustomFieldValues | null | undefined, roleKey: string | null): CustomFieldValues {
  return visibleValues(defs, values, roleKey);
}

/** Keys hidden for at least one role. Event payloads are broadcast, so they never carry these values. */
export function restrictedKeys(defs: readonly FieldDefinition[]): Set<string> {
  return new Set(defs.filter((d) => d.access.hiddenFor.length > 0).map((d) => d.key));
}

/** Values safe for broadcast (realtime events): fields hidden for any role are removed. */
export function publicValues(defs: readonly FieldDefinition[], values: CustomFieldValues | null | undefined): CustomFieldValues {
  if (!values) return {};
  const hidden = restrictedKeys(defs);
  return hidden.size ? Object.fromEntries(Object.entries(values).filter(([k]) => !hidden.has(k))) : { ...values };
}

/** Definitions the role can see (active only, display order). */
export function visibleDefs(defs: readonly FieldDefinition[], roleKey: string | null): FieldDefinition[] {
  return defs.filter((d) => !d.archivedAt && fieldAccessFor(d, roleKey) !== 'hidden').sort((a, b) => a.order - b.order);
}

/** Apply a validated patch: given keys change, `null` removes the key. */
export function applyPatch(current: CustomFieldValues, patch: CustomFieldValues): CustomFieldValues {
  const next: CustomFieldValues = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next;
}

/** Stable JSON for value comparison (object keys sorted). */
export const sameValue = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b);
function canonical(v: unknown): string {
  return JSON.stringify(v ?? null, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x,
  );
}

/** Keys whose value differs between two value maps. */
export function changedKeys(before: CustomFieldValues, after: CustomFieldValues): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => !sameValue(before[k], after[k]));
}
