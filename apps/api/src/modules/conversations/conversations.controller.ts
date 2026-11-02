import { Body, Controller, Param, Query } from '@nestjs/common';
import {
  API_ROUTES,
  ConversationAssignSchema,
  ConversationListQuerySchema,
  CursorPaginationQuerySchema,
  IdParamSchema,
  MessageSendSchema,
  type Conversation,
  type Message,
  type Page,
  type QuickReply,
  type Template,
} from '@vistar/shared';
import { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { ConversationsService } from './conversations.service.js';

const TemplateListQuerySchema = z.object({ channel: z.string().max(20).optional(), status: z.string().max(20).optional() });

/** WhatsApp inbox (SPEC 14): conversations, messages, templates, quick replies. */
@Controller()
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @ApiRoute(API_ROUTES.conversationList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(ConversationListQuerySchema)) query: z.output<typeof ConversationListQuerySchema>): Promise<Page<Conversation>> {
    return this.conversations.list(auth, query);
  }

  @ApiRoute(API_ROUTES.conversationGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>): Promise<Conversation> {
    return this.conversations.get(auth, params.id);
  }

  @ApiRoute(API_ROUTES.messageList)
  messages(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>,
    @Query(new ZodPipe(CursorPaginationQuerySchema)) query: z.output<typeof CursorPaginationQuerySchema>,
  ): Promise<Page<Message>> {
    return this.conversations.messages(auth, params.id, query);
  }

  @ApiRoute(API_ROUTES.messageSend)
  send(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>,
    @Body(new ZodPipe(MessageSendSchema)) body: z.output<typeof MessageSendSchema>,
  ): Promise<Message> {
    return this.conversations.send(auth, params.id, body);
  }

  @ApiRoute(API_ROUTES.conversationAssign)
  assign(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>,
    @Body(new ZodPipe(ConversationAssignSchema)) body: z.output<typeof ConversationAssignSchema>,
  ): Promise<Conversation> {
    return this.conversations.assign(auth, params.id, body.assigneeId);
  }

  @ApiRoute(API_ROUTES.conversationRead)
  read(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>): Promise<{ ok: true }> {
    return this.conversations.markRead(auth, params.id);
  }

  @ApiRoute(API_ROUTES.templateList)
  templates(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(TemplateListQuerySchema)) query: z.output<typeof TemplateListQuerySchema>): Promise<{ items: Template[] }> {
    return this.conversations.templates(auth, query);
  }

  @ApiRoute(API_ROUTES.quickReplyList)
  quickReplies(@CurrentAuth() auth: AuthContext): Promise<{ items: QuickReply[] }> {
    return this.conversations.quickReplies(auth);
  }
}
