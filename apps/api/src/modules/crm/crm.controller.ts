import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  AccountCreateSchema,
  AccountListQuerySchema,
  AccountUpdateSchema,
  API_ROUTES,
  ContactCreateSchema,
  ContactListQuerySchema,
  ContactUpdateSchema,
  CrmBulkActionSchema,
  CrmMergeSchema,
  CrmNoteCreateSchema,
  CursorPaginationQuerySchema,
  DealBoardQuerySchema,
  DealBulkActionSchema,
  DealCreateSchema,
  DealListQuerySchema,
  DealMoveSchema,
  DealUpdateSchema,
  IdParamSchema,
  LeadConvertSchema,
  type AccountCreate,
  type AccountListQuery,
  type AccountUpdate,
  type ContactCreate,
  type ContactListQuery,
  type ContactUpdate,
  type CrmBulkAction,
  type CrmMerge,
  type CrmNoteCreate,
  type CursorPaginationQuery,
  type DealBoardQuery,
  type DealBulkAction,
  type DealCreate,
  type DealListQuery,
  type DealMove,
  type DealUpdate,
  type LeadConvert,
} from '@vistar/shared';
import type { Request } from 'express';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { AccountsService } from './accounts.service.js';
import { ContactsService } from './contacts.service.js';
import { CrmActivityService } from './crm-activity.service.js';
import { DealsService } from './deals.service.js';
import { LeadConvertService } from './lead-convert.service.js';

type IdParam = { id: string };
const Id = () => new ZodPipe(IdParamSchema);

/** Static routes (merge, bulk, board) are declared before the `/:id` routes of the same resource. */
@Controller()
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly activity: CrmActivityService,
  ) {}

  @ApiRoute(API_ROUTES.contactList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(ContactListQuerySchema)) q: ContactListQuery) {
    return this.contacts.list(auth, q);
  }

  @ApiRoute(API_ROUTES.contactCreate)
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(ContactCreateSchema)) body: ContactCreate) {
    return this.contacts.create(auth, body);
  }

  @ApiRoute(API_ROUTES.contactMerge)
  merge(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(CrmMergeSchema)) body: CrmMerge) {
    return this.contacts.merge(auth, req, body);
  }

  @ApiRoute(API_ROUTES.contactBulk)
  bulk(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(CrmBulkActionSchema)) body: CrmBulkAction) {
    return this.contacts.bulk(auth, req, body);
  }

  @ApiRoute(API_ROUTES.contactGet)
  get(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam) {
    return this.contacts.get(auth, id);
  }

  @ApiRoute(API_ROUTES.contactUpdate)
  update(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Body(new ZodPipe(ContactUpdateSchema)) body: ContactUpdate) {
    return this.contacts.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.contactDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(Id()) { id }: IdParam) {
    return this.contacts.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.contactDuplicates)
  duplicates(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam) {
    return this.contacts.duplicates(auth, id);
  }

  @ApiRoute(API_ROUTES.contactRelated)
  related(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam) {
    return this.activity.related(auth, 'contact', id);
  }

  @ApiRoute(API_ROUTES.contactTimeline)
  timeline(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Query(new ZodPipe(CursorPaginationQuerySchema)) q: CursorPaginationQuery) {
    return this.activity.timeline(auth, 'contact', id, q);
  }

  @ApiRoute(API_ROUTES.contactNoteCreate)
  note(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Body(new ZodPipe(CrmNoteCreateSchema)) body: CrmNoteCreate) {
    return this.activity.addNote(auth, 'contact', id, body);
  }
}

@Controller()
export class AccountsController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly activity: CrmActivityService,
  ) {}

  @ApiRoute(API_ROUTES.accountList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(AccountListQuerySchema)) q: AccountListQuery) {
    return this.accounts.list(auth, q);
  }

  @ApiRoute(API_ROUTES.accountCreate)
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(AccountCreateSchema)) body: AccountCreate) {
    return this.accounts.create(auth, body);
  }

  @ApiRoute(API_ROUTES.accountMerge)
  merge(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(CrmMergeSchema)) body: CrmMerge) {
    return this.accounts.merge(auth, req, body);
  }

  @ApiRoute(API_ROUTES.accountBulk)
  bulk(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(CrmBulkActionSchema)) body: CrmBulkAction) {
    return this.accounts.bulk(auth, req, body);
  }

  @ApiRoute(API_ROUTES.accountGet)
  get(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam) {
    return this.accounts.get(auth, id);
  }

  @ApiRoute(API_ROUTES.accountUpdate)
  update(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Body(new ZodPipe(AccountUpdateSchema)) body: AccountUpdate) {
    return this.accounts.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.accountDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(Id()) { id }: IdParam) {
    return this.accounts.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.accountDuplicates)
  duplicates(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam) {
    return this.accounts.duplicates(auth, id);
  }

  @ApiRoute(API_ROUTES.accountRelated)
  related(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam) {
    return this.activity.related(auth, 'account', id);
  }

  @ApiRoute(API_ROUTES.accountTimeline)
  timeline(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Query(new ZodPipe(CursorPaginationQuerySchema)) q: CursorPaginationQuery) {
    return this.activity.timeline(auth, 'account', id, q);
  }

  @ApiRoute(API_ROUTES.accountNoteCreate)
  note(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Body(new ZodPipe(CrmNoteCreateSchema)) body: CrmNoteCreate) {
    return this.activity.addNote(auth, 'account', id, body);
  }
}

@Controller()
export class DealsController {
  constructor(
    private readonly deals: DealsService,
    private readonly activity: CrmActivityService,
    private readonly convertService: LeadConvertService,
  ) {}

  @ApiRoute(API_ROUTES.dealBoard)
  board(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(DealBoardQuerySchema)) q: DealBoardQuery) {
    return this.deals.board(auth, q);
  }

  @ApiRoute(API_ROUTES.dealBulk)
  bulk(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(DealBulkActionSchema)) body: DealBulkAction) {
    return this.deals.bulk(auth, req, body);
  }

  @ApiRoute(API_ROUTES.dealList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(DealListQuerySchema)) q: DealListQuery) {
    return this.deals.list(auth, q);
  }

  @ApiRoute(API_ROUTES.dealCreate)
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(DealCreateSchema)) body: DealCreate) {
    return this.deals.create(auth, body);
  }

  @ApiRoute(API_ROUTES.dealGet)
  get(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam) {
    return this.deals.get(auth, id);
  }

  @ApiRoute(API_ROUTES.dealUpdate)
  update(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Body(new ZodPipe(DealUpdateSchema)) body: DealUpdate) {
    return this.deals.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.dealDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(Id()) { id }: IdParam) {
    return this.deals.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.dealMove)
  move(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Body(new ZodPipe(DealMoveSchema)) body: DealMove) {
    return this.deals.move(auth, id, body);
  }

  @ApiRoute(API_ROUTES.dealRelated)
  related(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam) {
    return this.activity.related(auth, 'deal', id);
  }

  @ApiRoute(API_ROUTES.dealTimeline)
  timeline(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Query(new ZodPipe(CursorPaginationQuerySchema)) q: CursorPaginationQuery) {
    return this.activity.timeline(auth, 'deal', id, q);
  }

  @ApiRoute(API_ROUTES.dealNoteCreate)
  note(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Body(new ZodPipe(CrmNoteCreateSchema)) body: CrmNoteCreate) {
    return this.activity.addNote(auth, 'deal', id, body);
  }

  @ApiRoute(API_ROUTES.leadConvert)
  convert(@CurrentAuth() auth: AuthContext, @Param(Id()) { id }: IdParam, @Body(new ZodPipe(LeadConvertSchema)) body: LeadConvert) {
    return this.convertService.convert(auth, id, body);
  }
}
