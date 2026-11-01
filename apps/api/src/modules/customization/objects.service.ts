import { Injectable, Logger } from '@nestjs/common';
import { objectTarget, type CustomObject, type CustomObjectSpec, type CustomObjectUpdateSchema, type FieldDefinition, type FieldError } from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { conflict, notFound } from '../../common/errors/app-exception.js';
import type { CustomObject as ObjectRow, Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { publishSafe, requestActor, type TenantDb } from '../leads/lib/context.js';
import { canManageFields, invalidValues, roleKeyOf, visibleDefs } from './custom-values.js';
import { FIELD_ORDER, toFieldDefinitions } from './field.mapper.js';
import { fieldCreateData, relationTargetErrors } from './fields.service.js';

export type CustomObjectUpdate = z.output<typeof CustomObjectUpdateSchema>;

/** Row + its field definitions -> CustomObject. `fields` = what the caller may see. */
export function toCustomObject(o: ObjectRow, fields: FieldDefinition[], recordCount?: number): CustomObject {
  return {
    id: o.id,
    key: o.key,
    labelSingular: o.labelSingular,
    labelPlural: o.labelPlural,
    icon: o.icon,
    description: o.description,
    primaryFieldKey: o.primaryFieldKey,
    showInNav: o.showInNav,
    packKey: o.packKey,
    archivedAt: o.archivedAt?.toISOString() ?? null,
    fields,
    ...(recordCount !== undefined ? { recordCount } : {}),
    createdAt: o.createdAt.toISOString(),
  };
}

/** Custom objects (definitions). Records live in RecordsService. */
@Injectable()
export class ObjectsService {
  private readonly logger = new Logger(ObjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
  ) {}

  /** Field definitions per object target, filtered for the caller (admins: all, archived only on request). */
  private async fieldsFor(db: TenantDb, auth: AuthContext, keys: string[], includeArchived: boolean): Promise<Map<string, FieldDefinition[]>> {
    const rows = await db.customField.findMany({ where: { target: { in: keys.map(objectTarget) } }, orderBy: FIELD_ORDER });
    const defs = toFieldDefinitions(rows);
    const admin = canManageFields(auth);
    const roleKey = admin ? null : await roleKeyOf(db, auth);
    const out = new Map<string, FieldDefinition[]>();
    for (const key of keys) {
      const own = defs.filter((d) => d.target === objectTarget(key));
      out.set(key, admin ? own.filter((d) => includeArchived || !d.archivedAt) : visibleDefs(own, roleKey));
    }
    return out;
  }

  async list(auth: AuthContext, q: { includeArchived?: boolean }): Promise<{ items: CustomObject[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const includeArchived = !!q.includeArchived && canManageFields(auth);
    const rows = await db.customObject.findMany({ where: includeArchived ? {} : { archivedAt: null }, orderBy: [{ labelPlural: 'asc' }, { key: 'asc' }] });
    if (!rows.length) return { items: [] };
    const scoped = (await this.scope.where(auth, 'ownerId')) as Prisma.CustomRecordWhereInput;
    const [fields, counts] = await Promise.all([
      this.fieldsFor(db, auth, rows.map((r) => r.key), includeArchived),
      db.customRecord.groupBy({ by: ['objectId'], where: { ...scoped, deletedAt: null, objectId: { in: rows.map((r) => r.id) } }, _count: { _all: true } }),
    ]);
    const byObject = new Map(counts.map((c) => [c.objectId, c._count._all]));
    return { items: rows.map((r) => toCustomObject(r, fields.get(r.key) ?? [], byObject.get(r.id) ?? 0)) };
  }

  /** Archived objects are visible to admins only (restore screen). */
  async load(db: TenantDb, auth: AuthContext, key: string): Promise<ObjectRow> {
    const row = await db.customObject.findFirst({ where: { key } });
    if (!row || (row.archivedAt && !canManageFields(auth))) throw notFound('Custom object');
    return row;
  }

  async get(auth: AuthContext, key: string): Promise<CustomObject> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await this.load(db, auth, key);
    const fields = await this.fieldsFor(db, auth, [key], canManageFields(auth));
    return toCustomObject(row, fields.get(key) ?? []);
  }

  private async present(db: TenantDb, auth: AuthContext, row: ObjectRow): Promise<CustomObject> {
    const fields = await this.fieldsFor(db, auth, [row.key], true);
    return toCustomObject(row, fields.get(row.key) ?? []);
  }

  private async changed(auth: AuthContext, req: Request, action: string, row: ObjectRow, diff: Record<string, unknown>): Promise<void> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const actor = await requestActor(db, auth);
    await this.audit.record(auth, req, { action, entityType: 'custom_object', entityId: row.id, diff: { key: row.key, ...diff } }, actor.summary?.name);
    await publishSafe(this.events, this.logger, 'customization.changed', auth.workspaceId, { scope: 'objects', target: row.key }, { actor: actor.event });
  }

  /** Object + its fields in ONE transaction. Object keys are never reused (archived objects keep theirs). */
  async create(auth: AuthContext, req: Request, body: CustomObjectSpec): Promise<CustomObject> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    if (await db.customObject.count({ where: { key: body.key } })) {
      throw conflict('An object with this key already exists (archived objects keep their key)');
    }
    const errors: FieldError[] = [];
    for (const [i, f] of body.fields.entries()) errors.push(...(await relationTargetErrors(db, f, `fields.${i}.config.target`, body.key)));
    if (errors.length) throw invalidValues(errors);

    const target = objectTarget(body.key);
    const row = await db.$transaction(async (tx) => {
      const obj = await tx.customObject.create({
        data: {
          workspaceId: wid,
          key: body.key,
          labelSingular: body.labelSingular,
          labelPlural: body.labelPlural,
          icon: body.icon,
          description: body.description ?? null,
          primaryFieldKey: body.primaryFieldKey,
          showInNav: body.showInNav,
        },
      });
      await tx.customField.createMany({ data: body.fields.map((f, order) => fieldCreateData(wid, target, f, order, { customObjectId: obj.id })) });
      return obj;
    });
    await this.changed(auth, req, 'object.create', row, { labelPlural: row.labelPlural, fields: body.fields.map((f) => f.key) });
    return this.present(db, auth, row);
  }

  async update(auth: AuthContext, req: Request, key: string, body: CustomObjectUpdate): Promise<CustomObject> {
    const wid = auth.workspaceId;
    const db = this.prisma.forTenant(wid);
    const row = await this.load(db, auth, key);
    const data: Prisma.CustomObjectUncheckedUpdateInput = {};
    const diff: Record<string, unknown> = {};
    for (const k of ['labelSingular', 'labelPlural', 'icon', 'description', 'showInNav'] as const) {
      if (body[k] !== undefined && body[k] !== row[k]) {
        (data as Record<string, unknown>)[k] = body[k];
        diff[k] = body[k];
      }
    }
    const titleChanged = body.primaryFieldKey !== undefined && body.primaryFieldKey !== row.primaryFieldKey;
    if (titleChanged) {
      const field = await db.customField.findFirst({ where: { target: objectTarget(key), key: body.primaryFieldKey, archivedAt: null } });
      if (!field || field.type !== 'text') throw invalidValues([{ path: 'primaryFieldKey', message: 'The title field must be an active text field of this object' }]);
      data.primaryFieldKey = diff.primaryFieldKey = body.primaryFieldKey;
    }
    if (!Object.keys(data).length) return this.present(db, auth, row);
    const updated = await db.$transaction(async (tx) => {
      const obj = await tx.customObject.update({ where: { id: row.id }, data });
      if (titleChanged) {
        // Denormalised record titles follow the new title field. Raw SQL: workspaceId filtered explicitly.
        await tx.$executeRaw`
          UPDATE "CustomRecord" SET "title" = COALESCE(LEFT("values" ->> ${obj.primaryFieldKey}, 500), ''), "updatedAt" = NOW()
          WHERE "workspaceId" = ${wid}::uuid AND "objectId" = ${obj.id}::uuid`;
      }
      return obj;
    });
    await this.changed(auth, req, 'object.update', updated, diff);
    return this.present(db, auth, updated);
  }

  async archive(auth: AuthContext, req: Request, key: string): Promise<CustomObject> {
    return this.setArchived(auth, req, key, true);
  }

  async restore(auth: AuthContext, req: Request, key: string): Promise<CustomObject> {
    return this.setArchived(auth, req, key, false);
  }

  private async setArchived(auth: AuthContext, req: Request, key: string, archived: boolean): Promise<CustomObject> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const row = await this.load(db, auth, key);
    if (!!row.archivedAt === archived) return this.present(db, auth, row);
    const updated = await db.customObject.update({ where: { id: row.id }, data: { archivedAt: archived ? new Date() : null } });
    await this.changed(auth, req, archived ? 'object.archive' : 'object.restore', updated, {});
    return this.present(db, auth, updated);
  }
}
