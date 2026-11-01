import { z } from 'zod';
import { AuditActorTypeSchema, NotificationTypeSchema } from '../enums.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema } from './common.js';

export const NotificationSchema = z.object({
  id: IdSchema,
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string().nullable(),
  /** Deep link inside the app, e.g. /leads/<id>. */
  href: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  readAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListQuerySchema = CursorPaginationQuerySchema.extend({
  unread: z.stringbool().optional().describe('true | false'),
});

export const NotificationMarkReadSchema = z.object({
  ids: z.array(IdSchema).optional().describe('Omit to mark all as read'),
});

export const PushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export const AuditLogSchema = z.object({
  id: IdSchema,
  actorType: AuditActorTypeSchema,
  actorId: z.string().nullable(),
  actorName: z.string().nullable(),
  action: z.string().describe('e.g. lead.update, user.role_change, apikey.create'),
  entityType: z.string(),
  entityId: z.string().nullable(),
  diff: z.record(z.string(), z.unknown()).nullable(),
  ip: z.string().nullable(),
  createdAt: IsoDateTimeSchema,
});
export type AuditLog = z.infer<typeof AuditLogSchema>;

export const AuditLogQuerySchema = CursorPaginationQuerySchema.extend({
  actorId: z.string().optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  action: z.string().optional(),
  from: IsoDateTimeSchema.optional(),
  to: IsoDateTimeSchema.optional(),
});
