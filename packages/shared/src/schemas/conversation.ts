import { z } from 'zod';
import {
  ChannelSchema,
  ConsentSourceSchema,
  ConsentStatusSchema,
  ConversationStatusSchema,
  MessageDirectionSchema,
  MessageStatusSchema,
  MessageTypeSchema,
  TemplateCategorySchema,
  TemplateStatusSchema,
} from '../enums.js';
import { CursorPaginationQuerySchema, IdSchema, IsoDateTimeSchema, PhoneSchema } from './common.js';
import { UserSummarySchema } from './workspace.js';

/** WhatsApp customer-service window: free-form allowed only within 24h of the last inbound message. */
export const WHATSAPP_WINDOW_HOURS = 24;

export const MessageSchema = z.object({
  id: IdSchema,
  conversationId: IdSchema,
  direction: MessageDirectionSchema,
  type: MessageTypeSchema,
  body: z.string().nullable(),
  templateName: z.string().nullable(),
  media: z
    .object({ fileId: IdSchema, mime: z.string(), name: z.string().nullable(), size: z.number().int() })
    .nullable(),
  status: MessageStatusSchema,
  error: z.string().nullable(),
  isInternalNote: z.boolean(),
  author: UserSummarySchema.nullable(),
  createdAt: IsoDateTimeSchema,
});
export type Message = z.infer<typeof MessageSchema>;

export const ConversationSchema = z.object({
  id: IdSchema,
  channel: z.literal('whatsapp'),
  contactId: IdSchema,
  contactName: z.string(),
  contactPhone: PhoneSchema,
  leadId: IdSchema.nullable(),
  assignee: UserSummarySchema.nullable(),
  status: ConversationStatusSchema,
  unreadCount: z.number().int(),
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: IsoDateTimeSchema.nullable(),
  lastInboundAt: IsoDateTimeSchema.nullable(),
  /** Derived: lastInboundAt + 24h, null if no inbound yet. */
  windowExpiresAt: IsoDateTimeSchema.nullable(),
  optIn: ConsentStatusSchema.nullable(),
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const ConversationListQuerySchema = CursorPaginationQuerySchema.extend({
  status: ConversationStatusSchema.optional(),
  assigneeId: z.union([IdSchema, z.literal('me'), z.literal('unassigned')]).optional(),
  unread: z.stringbool().optional().describe('true | false'),
  q: z.string().max(200).optional(),
});
export type ConversationListQuery = z.infer<typeof ConversationListQuerySchema>;

export const MessageSendSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), body: z.string().trim().min(1).max(4096) }),
  z.object({
    type: z.literal('template'),
    templateId: IdSchema,
    variables: z.record(z.string(), z.string()).default({}),
  }),
  z.object({ type: z.literal('media'), fileId: IdSchema, caption: z.string().max(1024).optional() }),
  z.object({ type: z.literal('note'), body: z.string().trim().min(1).max(4096) }),
]);
export type MessageSend = z.infer<typeof MessageSendSchema>;

export const ConversationAssignSchema = z.object({ assigneeId: IdSchema.nullable() });

export const TemplateSchema = z.object({
  id: IdSchema,
  channel: ChannelSchema,
  name: z.string().describe('Provider template name, e.g. welcome_indiamart_v1'),
  language: z.string().default('en'),
  category: TemplateCategorySchema,
  status: TemplateStatusSchema,
  body: z.string().describe('Body with {{1}}-style or {{lead.name}}-style placeholders'),
  variables: z.array(z.string()).describe('Ordered variable keys, e.g. ["lead.name","owner.name"]'),
  header: z.string().nullable(),
  footer: z.string().nullable(),
  updatedAt: IsoDateTimeSchema,
});
export type Template = z.infer<typeof TemplateSchema>;

export const ConsentRecordSchema = z.object({
  id: IdSchema,
  contactId: IdSchema,
  channel: ChannelSchema,
  status: ConsentStatusSchema,
  source: ConsentSourceSchema,
  createdAt: IsoDateTimeSchema,
});
export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export const QuickReplySchema = z.object({ id: IdSchema, shortcut: z.string(), body: z.string() });
export type QuickReply = z.infer<typeof QuickReplySchema>;
