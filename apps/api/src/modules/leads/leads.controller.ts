import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  CursorPaginationQuerySchema,
  FieldListQuerySchema,
  IdParamSchema,
  LeadBulkActionSchema,
  LeadCreateSchema,
  LeadListQuerySchema,
  LeadMergeSchema,
  LeadUpdateSchema,
  NoteCreateSchema,
  SavedViewCreateSchema,
  type CursorPaginationQuery,
  type LeadBulkAction,
  type LeadCreate,
  type LeadListQuery,
  type LeadMerge,
  type LeadUpdate,
  type NoteCreate,
  type SavedViewCreate,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { LeadBulkService } from './lead-bulk.service.js';
import { LeadMetaService } from './lead-meta.service.js';
import { LeadsService } from './leads.service.js';

type IdParam = { id: string };

@Controller()
export class LeadsController {
  constructor(
    private readonly leads: LeadsService,
    private readonly bulkService: LeadBulkService,
    private readonly meta: LeadMetaService,
  ) {}

  @ApiRoute(API_ROUTES.leadList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(LeadListQuerySchema)) query: LeadListQuery, @Query() raw: Record<string, unknown>) {
    return this.leads.list(auth, query, raw);
  }

  @ApiRoute(API_ROUTES.leadCreate)
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(LeadCreateSchema)) body: LeadCreate) {
    return this.leads.create(auth, body);
  }

  @ApiRoute(API_ROUTES.leadBulk)
  bulk(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(LeadBulkActionSchema)) body: LeadBulkAction) {
    return this.bulkService.bulk(auth, req, body);
  }

  @ApiRoute(API_ROUTES.leadMerge)
  merge(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(LeadMergeSchema)) body: LeadMerge) {
    return this.bulkService.merge(auth, req, body);
  }

  @ApiRoute(API_ROUTES.leadGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.leads.get(auth, id);
  }

  @ApiRoute(API_ROUTES.leadUpdate)
  update(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(LeadUpdateSchema)) body: LeadUpdate) {
    return this.leads.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.leadDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.leads.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.leadDuplicates)
  duplicates(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.leads.duplicates(auth, id);
  }

  @ApiRoute(API_ROUTES.leadTimeline)
  timeline(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(IdParamSchema)) { id }: IdParam,
    @Query(new ZodPipe(CursorPaginationQuerySchema)) query: CursorPaginationQuery,
  ) {
    return this.leads.timeline(auth, id, query);
  }

  @ApiRoute(API_ROUTES.leadNoteCreate)
  addNote(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(NoteCreateSchema)) body: NoteCreate) {
    return this.leads.addNote(auth, id, body);
  }

  // ---------------------------------------------------------------- saved views, tags, custom fields

  @ApiRoute(API_ROUTES.viewList)
  listViews(@CurrentAuth() auth: AuthContext) {
    return this.meta.listViews(auth);
  }

  @ApiRoute(API_ROUTES.viewCreate)
  createView(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(SavedViewCreateSchema)) body: SavedViewCreate) {
    return this.meta.createView(auth, body);
  }

  @ApiRoute(API_ROUTES.viewDelete)
  deleteView(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.meta.deleteView(auth, id);
  }

  @ApiRoute(API_ROUTES.tagList)
  tags(@CurrentAuth() auth: AuthContext) {
    return this.meta.listTags(auth);
  }

  @ApiRoute(API_ROUTES.fieldList)
  fields(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(FieldListQuerySchema)) query: z.infer<typeof FieldListQuerySchema>) {
    return this.meta.listFields(auth, query);
  }
}
