import { Injectable, Logger } from '@nestjs/common';
import {
  fieldAccessFor,
  parseFieldConfig,
  parseTarget,
  type FieldDefinition,
  type FieldDefinitionUpdate,
  type FieldError,
  type FieldSpec,
  type FieldTarget,
} from '@vistar/shared';
import type { Request } from 'express';
import { ZodError } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { AppException, conflict, notFound } from '../../common/errors/app-exception.js';
import { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { publishSafe, requestActor, type TenantDb } from '../leads/lib/context.js';
import { canManageFields, invalidValues, roleKeyOf } from './custom-values.js';
import { FIELD_ORDER, toFieldDefinition, toFieldDefinitions } from './field.mapper.js';

const fieldNotFound = () => notFound('Field');

/** Zod issues of a config check -> field errors under `prefix`. */
export function configErrors(err: unknown, prefix: string): FieldError[] {
  if (err instanceof ZodError) return err.issues.map((i) => ({ path: [prefix, ...i.path.map(String)].join('.'), message: i.message }));
  return [{ path: prefix, message: 'Invalid configuration' }];
}

/**
 * Relation fields must point at a core entity or an ACTIVE custom object of this workspace
 * (`selfKey` = object being created in the same request).
 */
export async function relationTargetErrors(db: TenantDb, spec: Pick<FieldSpec, 'type' | 'config'>, path: string, selfKey?: string): Promise<FieldError[]> {
  if (spec.type !== 'relation') return [];
  const target = (spec.config as { target: string }).target;
  const t = parseTarget(target);
  if (t.kind === 'core' || t.key === selfKey) return [];
  const ok = await db.customObject.count({ where: { key: t.key, archivedAt: null } });
  return ok ? [] : [{ path, message: 'Link to an existing custom object' }];
}

/** Row data for a new field (also used by object create). */
export function fieldCreateData(workspaceId: string, target: string, spec: FieldSpec, order: number, extra: { customObjectId?: string | null; packKey?: string | null } = {}): Prisma.CustomFieldUncheckedCreateInput {
  return {
    workspaceId,
    target,
    customObjectId: extra.customObjectId ?? null,
    key: spec.key,
    label: spec.label,
    type: spec.type,
    config: spec.config as Prisma.InputJsonObject,
    access: spec.access as unknown as Prisma.InputJsonObject,
    helpText: spec.helpText ?? null,
    required: spec.required,
    isUnique: spec.unique,
    order,
    packKey: extra.packKey ?? null,
  };
}

/** Field definitions: list, create, update, archive, restore, reorder (GET/POST/PATCH /fields...). */
@Injectable()
export class FieldsService {
  private readonly logger = new Logger(FieldsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  /** Non-admins do not receive definitions of fields hidden for their role. */
  async list(auth: AuthContext, q: { target?: FieldTarget; includeArchived?: boolean }): Promise<{ items: FieldDefinition[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const rows = await db.customField.findMany({
      where: { ...(q.target ? { target: q.target } : {}), ...(q.includeArchived ? {} : { archivedAt: null }) },
      orderBy: [{ target: 'asc' }, ...FIELD_ORDER],
    });
    let items = toFieldDefinitions(rows);
    if (!canManageFields(auth)) {
      const roleKey = await roleKeyOf(db, auth);
      items = items.filter((d) => fieldAccessFor(d, roleKey) !== 'hidden');
    }
    return { items };
  }

  private async load(db: TenantDb, id: string) {
    const row = await db.customField.findUnique({ where: { id } });
    if (!row) throw fieldNotFound();
    return row;
  }

  private async changed(auth: AuthContext, req: Request | null, action: string, def: FieldDefinition, diff: Record<string, unknown>): Promise<void> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action, entityType: 'custom_field', entityId: def.id, diff: { target: def.target, key: def.key, ...diff } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'customization.changed', auth.workspaceId, { scope: 'fields', target: def.target }, { actor: actor.event });
  }

  private present(row: Parameters<typeof toFieldDefinition>[0]): FieldDefinition {
    const def = toFieldDefinition(row);
    if (!def) throw new AppException('INTERNAL_ERROR', 'This field has an invalid stored definition');
    return def;
  }

  async create(auth: AuthContext, req: Request, body: { target: FieldTarget; field: FieldSpec }): Promise<FieldDefinition> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const t = parseTarget(body.target);
    let customObjectId: string | null = null;
    if (t.kind === 'object') {
      const obj = await db.customObject.findFirst({ where: { key: t.key } });
      if (!obj) throw notFound('Custom object');
      if (obj.archivedAt) throw conflict('This object is archived. Restore it before adding fields');
      customObjectId = obj.id;
    }
    // Keys are never reused, not even after archive.
    if (await db.customField.count({ where: { target: body.target, key: body.field.key } })) {
      throw new AppException('FIELD_KEY_TAKEN', 'A field with this key already exists (archived fields keep their key)', {
        details: [{ path: 'field.key', message: 'Choose another key' }],
      });
    }
    const refErrors = await relationTargetErrors(db, body.field, 'field.config.target', t.kind === 'object' ? t.key : undefined);
    if (refErrors.length) throw invalidValues(refErrors);

    const last = await db.customField.aggregate({ where: { target: body.target }, _max: { order: true } });
    const order = (last._max.order ?? -1) + 1;
    const row = await db.customField.create({ data: fieldCreateData(wid, body.target, body.field, order, { customObjectId }) });
    const def = this.present(row);
    await this.changed(auth, req, 'field.create', def, { type: def.type, label: def.label });
    return def;
  }

  async update(auth: AuthContext, req: Request, id: string, body: FieldDefinitionUpdate): Promise<FieldDefinition> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await this.load(db, id);
    const current = this.present(row);
    const data: Prisma.CustomFieldUncheckedUpdateInput = {};
    const diff: Record<string, unknown> = {};

    if (body.config !== undefined) {
      let config: Record<string, unknown>;
      try {
        config = parseFieldConfig(current.type, body.config) as Record<string, unknown>;
      } catch (err) {
        throw invalidValues(configErrors(err, 'config'), 'The field settings are invalid');
      }
      const t = parseTarget(current.target);
      const refErrors = await relationTargetErrors(db, { type: current.type, config } as FieldSpec, 'config.target', t.kind === 'object' ? t.key : undefined);
      if (refErrors.length) throw invalidValues(refErrors);
      data.config = config as Prisma.InputJsonObject;
      diff.config = true;
    }
    if (body.label !== undefined && body.label !== current.label) data.label = diff.label = body.label;
    if (body.helpText !== undefined && body.helpText !== current.helpText) data.helpText = diff.helpText = body.helpText;
    if (body.required !== undefined && body.required !== current.required) data.required = diff.required = body.required;
    if (body.access !== undefined) {
      data.access = body.access as unknown as Prisma.InputJsonObject;
      diff.access = body.access;
    }
    if (body.unique !== undefined && body.unique !== current.unique) {
      if (body.unique) await this.assertNoDuplicates(db, auth.workspaceId, current);
      data.isUnique = diff.unique = body.unique;
    }
    if (!Object.keys(data).length) return current;
    const def = this.present(await db.customField.update({ where: { id }, data }));
    await this.changed(auth, req, 'field.update', def, diff);
    return def;
  }

  /** Turning on "unique" requires the existing values to be unique already. */
  private async assertNoDuplicates(db: TenantDb, workspaceId: string, def: FieldDefinition): Promise<void> {
    const t = parseTarget(def.target);
    let dup = false;
    if (t.kind === 'object') {
      const rows = await db.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM "CustomRecord" r JOIN "CustomObject" o ON o."id" = r."objectId"
        WHERE r."workspaceId" = ${workspaceId}::uuid AND o."key" = ${t.key} AND r."deletedAt" IS NULL AND r."values" ? ${def.key}
          AND r."values" -> ${def.key} <> 'null'::jsonb
        GROUP BY r."values" -> ${def.key} HAVING COUNT(*) > 1 LIMIT 1`;
      dup = rows.length > 0;
    } else if (t.entity === 'lead' || t.entity === 'task') {
      // Table name from a fixed list (never user input); values are bound parameters.
      const table = Prisma.raw(t.entity === 'lead' ? '"Lead"' : '"Task"');
      const rows = await db.$queryRaw<Array<{ n: number }>>`
        SELECT COUNT(*)::int AS n FROM ${table}
        WHERE "workspaceId" = ${workspaceId}::uuid AND "deletedAt" IS NULL AND "customFields" ? ${def.key}
          AND "customFields" -> ${def.key} <> 'null'::jsonb
        GROUP BY "customFields" -> ${def.key} HAVING COUNT(*) > 1 LIMIT 1`;
      dup = rows.length > 0;
    }
    if (dup) {
      throw new AppException('FIELD_VALUE_NOT_UNIQUE', `Some records share the same ${def.label}. Fix the duplicates before making it unique`, {
        details: [{ path: 'unique', message: 'Existing values are not unique' }],
      });
    }
  }

  async archive(auth: AuthContext, req: Request, id: string): Promise<FieldDefinition> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await this.load(db, id);
    if (row.archivedAt) return this.present(row);
    const t = parseTarget(row.target);
    if (t.kind === 'object') {
      const obj = await db.customObject.findFirst({ where: { key: t.key }, select: { primaryFieldKey: true } });
      if (obj?.primaryFieldKey === row.key) throw conflict('This is the title field of the object. Choose another title field first');
    }
    const def = this.present(await db.customField.update({ where: { id }, data: { archivedAt: new Date() } }));
    await this.changed(auth, req, 'field.archive', def, {});
    return def;
  }

  async restore(auth: AuthContext, req: Request, id: string): Promise<FieldDefinition> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await this.load(db, id);
    if (!row.archivedAt) return this.present(row);
    const def = this.present(await db.customField.update({ where: { id }, data: { archivedAt: null } }));
    await this.changed(auth, req, 'field.restore', def, {});
    return def;
  }

  /** Every active field of the target exactly once; archived fields keep their place after them. */
  async reorder(auth: AuthContext, req: Request, body: { target: FieldTarget; fieldIds: string[] }): Promise<{ items: FieldDefinition[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const rows = await db.customField.findMany({ where: { target: body.target }, orderBy: FIELD_ORDER });
    const active = rows.filter((r) => !r.archivedAt);
    const ids = new Set(body.fieldIds);
    if (ids.size !== body.fieldIds.length || ids.size !== active.length || active.some((r) => !ids.has(r.id))) {
      throw new AppException('VALIDATION_FAILED', 'Send every active field of this target exactly once', { details: [{ path: 'fieldIds', message: 'Must list each active field once' }] });
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ordered = [...body.fieldIds.map((fid) => byId.get(fid)!), ...rows.filter((r) => r.archivedAt)];
    await db.$transaction(async (tx) => {
      for (const [i, r] of ordered.entries()) if (r.order !== i) await tx.customField.update({ where: { id: r.id }, data: { order: i } });
    });
    const items = toFieldDefinitions(await db.customField.findMany({ where: { target: body.target, archivedAt: null }, orderBy: FIELD_ORDER }));
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action: 'field.reorder', entityType: 'custom_field', diff: { target: body.target, fieldIds: body.fieldIds } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'customization.changed', auth.workspaceId, { scope: 'fields', target: body.target }, { actor: actor.event });
    return { items };
  }
}
