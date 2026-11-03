import { Injectable, Logger } from '@nestjs/common';
import {
  WHATSAPP_WINDOW_HOURS,
  type Conversation,
  type ConversationListQuery,
  type Message,
  type MessageSend,
  type Page,
  type QuickReply,
  type Template,
} from '@vistar/shared';
import type { AuthContext } from '../../common/auth/auth-context.js';
import { ScopeService } from '../../common/auth/scope.service.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { toUserSummary, USER_SUMMARY_SELECT } from '../../common/mappers/user.mapper.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { EventBus } from '../../infra/events/event-bus.service.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { assertInTenant } from '../../infra/prisma/tenant.js';
import { publishSafe, requestActor, type TenantDb } from '../leads/lib/context.js';
import { decodeCursor, encodeCursor, isTimeCursor, isUuid } from '../leads/lib/cursor.js';
// ---- change #20: prod
import { mediaKind, WhatsappSender, whatsappTemplatePayload, type WhatsappPayload } from '../whatsapp/whatsapp-sender.service.js';

const MESSAGE_TYPE_OF_MEDIA = { image: 'image', video: 'video', audio: 'audio', document: 'document' } as const;
// ---- end change #20: prod

const WINDOW_MS = WHATSAPP_WINDOW_HOURS * 3_600_000;
const PREVIEW_MAX = 140;

const CONVERSATION_INCLUDE = {
  contact: { select: { id: true, name: true, phone: true, whatsappOptIn: true } },
  assignee: { select: USER_SUMMARY_SELECT },
} as const;
type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;
type MessageRow = Prisma.MessageGetPayload<object>;

export function toConversation(c: ConversationRow): Conversation {
  return {
    id: c.id,
    channel: 'whatsapp',
    contactId: c.contactId,
    contactName: c.contact.name,
    contactPhone: c.contact.phone ?? '',
    leadId: c.leadId,
    assignee: toUserSummary(c.assignee),
    status: c.status,
    unreadCount: c.unreadCount,
    lastMessagePreview: c.lastMessagePreview,
    lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    lastInboundAt: c.lastInboundAt?.toISOString() ?? null,
    windowExpiresAt: c.lastInboundAt ? new Date(c.lastInboundAt.getTime() + WINDOW_MS).toISOString() : null,
    optIn: c.contact.whatsappOptIn ?? null,
  };
}

/** Conversation list cursor: (lastMessageAt desc nulls last, id desc); `t` null = the null tail. */
interface ConvCursor extends Record<string, unknown> {
  t: string | null;
  id: string;
}
const isConvCursor = (v: Record<string, unknown>): v is ConvCursor => (v.t === null || (typeof v.t === 'string' && !Number.isNaN(Date.parse(v.t)))) && isUuid(v.id);

/**
 * WhatsApp inbox (SPEC 14) over the stored conversations, with data scope: a conversation is visible when its
 * assignee is in the caller's scope; unassigned ones need scope all or `messages.team_inbox`. Sending (change #20)
 * goes through the workspace's WhatsApp Cloud API connection (WhatsappSender; mock in development): text inside the
 * 24 h window, approved templates at any time, media by link; opted-out contacts are refused. The message is stored
 * queued, then sent with the provider message id (or failed with the provider's error); delivered and read come back
 * through the receiver. Support sessions without content access see message bodies as null.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly events: EventBus,
    private readonly whatsapp: WhatsappSender,
  ) {}

  private async scopeWhere(auth: AuthContext): Promise<Prisma.ConversationWhereInput> {
    const ids = await this.scope.visibleUserIds(auth);
    if (ids === null) return {};
    const teamInbox = auth.permissions.includes('messages.team_inbox');
    return teamInbox ? { OR: [{ assigneeId: { in: ids } }, { assigneeId: null }] } : { assigneeId: { in: ids } };
  }

  private async visible(db: TenantDb, auth: AuthContext, id: string): Promise<ConversationRow> {
    const row = await db.conversation.findFirst({ where: { AND: [{ id }, await this.scopeWhere(auth)] }, include: CONVERSATION_INCLUDE });
    if (!row) throw notFound('Conversation');
    return row;
  }

  async list(auth: AuthContext, q: ConversationListQuery): Promise<Page<Conversation>> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const and: Prisma.ConversationWhereInput[] = [await this.scopeWhere(auth)];
    if (q.status) and.push({ status: q.status });
    if (q.assigneeId === 'me') and.push({ assigneeId: auth.userId });
    else if (q.assigneeId === 'unassigned') and.push({ assigneeId: null });
    else if (q.assigneeId) and.push({ assigneeId: q.assigneeId });
    if (q.unread === true) and.push({ unreadCount: { gt: 0 } });
    if (q.unread === false) and.push({ unreadCount: 0 });
    const term = q.q?.trim();
    if (term) and.push({ contact: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { phone: { contains: term.replace(/\s+/g, '') } }] } });
    if (q.cursor) {
      const c = decodeCursor(q.cursor, isConvCursor);
      and.push(
        c.t === null
          ? { lastMessageAt: null, id: { lt: c.id } }
          : { OR: [{ lastMessageAt: { lt: new Date(c.t) } }, { lastMessageAt: new Date(c.t), id: { lt: c.id } }, { lastMessageAt: null }] },
      );
    }
    const rows = await db.conversation.findMany({
      where: { AND: and },
      include: CONVERSATION_INCLUDE,
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    return {
      items: page.map(toConversation),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.lastMessageAt?.toISOString() ?? null, id: last.id }) : null,
    };
  }

  async get(auth: AuthContext, id: string): Promise<Conversation> {
    return toConversation(await this.visible(this.prisma.forTenant(auth.workspaceId), auth, id));
  }

  async messages(auth: AuthContext, id: string, q: { cursor?: string; limit: number }): Promise<Page<Message>> {
    const db = this.prisma.forTenant(auth.workspaceId);
    await this.visible(db, auth, id);
    const where: Prisma.MessageWhereInput = { conversationId: id };
    if (q.cursor) {
      const c = decodeCursor(q.cursor, isTimeCursor);
      const t = new Date(c.t);
      where.OR = [{ createdAt: { lt: t } }, { createdAt: t, id: { lt: c.id } }];
    }
    const rows = await db.message.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: q.limit + 1 });
    const page = rows.slice(0, q.limit);
    const hideContent = Boolean(auth.impersonation && !auth.impersonation.contentAccess);
    const items = await this.toMessages(db, page, hideContent);
    const last = page.at(-1);
    return { items, nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id }) : null };
  }

  private async toMessages(db: TenantDb, rows: MessageRow[], hideContent = false): Promise<Message[]> {
    const authorIds = [...new Set(rows.map((r) => r.authorId).filter((x): x is string => !!x))];
    const fileIds = [...new Set(rows.map((r) => r.mediaFileId).filter((x): x is string => !!x))];
    const [authors, files] = await Promise.all([
      authorIds.length ? db.user.findMany({ where: { id: { in: authorIds } }, select: USER_SUMMARY_SELECT }) : Promise.resolve([]),
      fileIds.length ? db.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, mime: true, name: true, size: true } }) : Promise.resolve([]),
    ]);
    const authorBy = new Map(authors.map((a) => [a.id, toUserSummary(a)]));
    const fileBy = new Map(files.map((f) => [f.id, f]));
    return rows.map((r) => {
      const f = r.mediaFileId ? fileBy.get(r.mediaFileId) : undefined;
      return {
        id: r.id,
        conversationId: r.conversationId,
        direction: r.direction,
        type: r.type,
        body: hideContent ? null : r.body,
        templateName: r.templateName,
        media: f ? { fileId: f.id, mime: f.mime, name: f.name, size: f.size } : null,
        status: r.status,
        error: r.error,
        isInternalNote: r.isInternalNote,
        author: r.authorId ? (authorBy.get(r.authorId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async send(auth: AuthContext, id: string, body: MessageSend): Promise<Message> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const conv = await this.visible(db, auth, id);
    const now = new Date();
    const isNote = body.type === 'note';
    if (!isNote) {
      if (conv.contact.whatsappOptIn === 'opted_out') throw new AppException('CONSENT_OPTED_OUT', 'This contact opted out of WhatsApp messages');
      const windowOpen = !!conv.lastInboundAt && now.getTime() - conv.lastInboundAt.getTime() < WINDOW_MS;
      if (body.type !== 'template' && !windowOpen) throw new AppException('WHATSAPP_WINDOW_CLOSED', 'The 24-hour window is closed. Send an approved template instead');
    }
    // ---- change #20: prod (WhatsApp Cloud API through the connected integration; mock in development)
    const wa = isNote ? null : await this.whatsapp.connection(auth.workspaceId);
    if (!isNote && !conv.contact.phone) throw new AppException('VALIDATION_FAILED', 'This contact has no WhatsApp number');
    let payload: WhatsappPayload | null = null;
    // ---- end change #20: prod
    let text: string | null = null;
    let templateId: string | null = null;
    let templateName: string | null = null;
    let mediaFileId: string | null = null;
    if (body.type === 'text' || body.type === 'note') text = body.body;
    if (body.type === 'text') payload = { kind: 'text', body: body.body };
    if (body.type === 'template') {
      const t = await db.template.findFirst({ where: { id: body.templateId } });
      if (!t) throw notFound('Template');
      if (t.status !== 'approved') throw new AppException('WHATSAPP_TEMPLATE_NOT_APPROVED', 'This template is not approved by WhatsApp yet');
      templateId = t.id;
      templateName = t.name;
      text = renderTemplateBody(t.body, t.variables, body.variables ?? {});
      payload = whatsappTemplatePayload(t, body.variables ?? {});
    }
    if (body.type === 'media') {
      await assertInTenant(db, { file: body.fileId } as never);
      mediaFileId = body.fileId;
      text = body.caption ?? null;
      const file = await db.file.findFirst({ where: { id: body.fileId, deletedAt: null }, select: { id: true, mime: true, name: true } });
      if (!file) throw notFound('File');
      payload = { kind: 'media', fileId: file.id, mime: file.mime, name: file.name, caption: body.caption ?? null };
    }
    const type = body.type === 'note' ? 'note' : body.type === 'media' ? (payload?.kind === 'media' ? MESSAGE_TYPE_OF_MEDIA[mediaKind(payload.mime)] : 'document') : body.type;
    const created = await db.message.create({
      data: {
        workspaceId: auth.workspaceId,
        conversationId: id,
        direction: 'outbound',
        type,
        body: text,
        templateId,
        templateName,
        mediaFileId,
        status: isNote ? 'sent' : 'queued',
        isInternalNote: isNote,
        authorId: auth.userId,
      },
    });
    let sent = created;
    if (wa && payload) {
      const result = await this.whatsapp.send(auth.workspaceId, wa, conv.contact.phone!, payload);
      sent = await db.message.update({ where: { id: created.id }, data: { status: result.status, providerMessageId: result.providerMessageId, error: result.error } });
      if (result.mode === 'mock' && result.status === 'sent') this.whatsapp.simulateMockStatuses(auth.workspaceId, { id: sent.id, conversationId: id });
    }
    const updatedConv = isNote
      ? conv
      : await db.conversation.update({
          where: { id },
          data: { lastMessageAt: sent.createdAt, lastMessagePreview: (text ?? templateName ?? 'Attachment').slice(0, PREVIEW_MAX) },
          include: CONVERSATION_INCLUDE,
        });
    const [message] = await this.toMessages(db, [sent]);
    const actor = await requestActor(db, auth);
    if (!isNote && conv.leadId) {
      await db.activity.create({
        data: {
          workspaceId: auth.workspaceId,
          leadId: conv.leadId,
          type: 'message',
          actorType: actor.activityActorType,
          actorId: actor.activityActorId,
          payload: { conversationId: id, messageId: sent.id, direction: 'outbound', preview: (text ?? templateName ?? 'Attachment').slice(0, 200) },
        },
      });
    }
    await publishSafe(this.events, this.logger, 'message.sent', auth.workspaceId, { conversation: toConversation(updatedConv), message: message! }, { actor: actor.event });
    return message!;
  }

  async markRead(auth: AuthContext, id: string): Promise<{ ok: true }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const conv = await this.visible(db, auth, id);
    if (conv.unreadCount > 0) {
      const updated = await db.conversation.update({ where: { id }, data: { unreadCount: 0 }, include: CONVERSATION_INCLUDE });
      const actor = await requestActor(db, auth);
      await publishSafe(this.events, this.logger, 'conversation.updated', auth.workspaceId, { conversation: toConversation(updated) }, { actor: actor.event });
    }
    return { ok: true };
  }

  async assign(auth: AuthContext, id: string, assigneeId: string | null): Promise<Conversation> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const conv = await this.visible(db, auth, id);
    if (assigneeId) {
      const user = await db.user.findFirst({ where: { id: assigneeId, deletedAt: null, isActive: true }, select: { id: true } });
      if (!user) throw notFound('User');
      // Assigning to someone outside your scope would hand over a conversation you then cannot see.
      if (!(await this.scope.canSee(auth, assigneeId))) throw notFound('User');
    }
    if (conv.assigneeId === assigneeId) return toConversation(conv);
    const updated = await db.conversation.update({ where: { id }, data: { assigneeId }, include: CONVERSATION_INCLUDE });
    const actor = await requestActor(db, auth);
    await publishSafe(this.events, this.logger, 'conversation.updated', auth.workspaceId, { conversation: toConversation(updated) }, { actor: actor.event });
    return toConversation(updated);
  }

  async templates(auth: AuthContext, q: { channel?: string; status?: string }): Promise<{ items: Template[] }> {
    const db = this.prisma.forTenant(auth.workspaceId);
    const rows = await db.template.findMany({
      where: { ...(q.channel ? { channel: q.channel as never } : {}), ...(q.status ? { status: q.status as never } : {}) },
      orderBy: [{ name: 'asc' }, { language: 'asc' }],
      take: 500,
    });
    return {
      items: rows.map((t) => ({
        id: t.id,
        channel: t.channel,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        body: t.body,
        variables: t.variables,
        header: t.header,
        footer: t.footer,
        updatedAt: t.updatedAt.toISOString(),
      })),
    };
  }

  async quickReplies(auth: AuthContext): Promise<{ items: QuickReply[] }> {
    const rows = await this.prisma.forTenant(auth.workspaceId).quickReply.findMany({ orderBy: { shortcut: 'asc' }, take: 500 });
    return { items: rows.map((r) => ({ id: r.id, shortcut: r.shortcut, body: r.body })) };
  }
}

/** Fill `{{1}}`-style placeholders by position and `{{lead.name}}`-style ones by key. */
export function renderTemplateBody(body: string, variables: readonly string[], values: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, key: string) => {
    if (/^\d+$/.test(key)) {
      const name = variables[Number(key) - 1];
      return values[key] ?? (name ? values[name] : undefined) ?? m;
    }
    return values[key] ?? m;
  });
}
