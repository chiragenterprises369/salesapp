import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  PipelineListQuerySchema,
  type PipelineListQuery,
  API_ROUTES,
  IdParamSchema,
  LeadMoveSchema,
  StageCreateSchema,
  StageReorderSchema,
  StageUpdateSchema,
  type LeadMove,
  type StageCreate,
  type StageUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { PipelineService } from './pipeline.service.js';

type IdParam = { id: string };
const BoardQuery = API_ROUTES.pipelineBoard.query;
const ColumnQuery = API_ROUTES.boardColumnPage.query;
const ColumnParams = API_ROUTES.boardColumnPage.params;

@Controller()
export class PipelineController {
  constructor(private readonly pipelines: PipelineService) {}

  @ApiRoute(API_ROUTES.pipelineList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(PipelineListQuerySchema)) q: PipelineListQuery) {
    return this.pipelines.list(auth, q.entity);
  }

  @ApiRoute(API_ROUTES.pipelineBoard)
  board(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Query(new ZodPipe(BoardQuery)) query: z.output<typeof BoardQuery>) {
    return this.pipelines.board(auth, id, query);
  }

  @ApiRoute(API_ROUTES.boardColumnPage)
  column(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(ColumnParams)) params: z.output<typeof ColumnParams>,
    @Query(new ZodPipe(ColumnQuery)) query: z.output<typeof ColumnQuery>,
  ) {
    return this.pipelines.columnPage(auth, params.id, params.stageId, query);
  }

  @ApiRoute(API_ROUTES.stageCreate)
  createStage(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(StageCreateSchema)) body: StageCreate) {
    return this.pipelines.createStage(auth, id, body);
  }

  @ApiRoute(API_ROUTES.stageReorder)
  reorder(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(StageReorderSchema)) body: z.output<typeof StageReorderSchema>) {
    return this.pipelines.reorderStages(auth, id, body.stageIds);
  }

  @ApiRoute(API_ROUTES.stageUpdate)
  updateStage(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(StageUpdateSchema)) body: StageUpdate) {
    return this.pipelines.updateStage(auth, id, body);
  }

  @ApiRoute(API_ROUTES.stageDelete)
  deleteStage(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.pipelines.deleteStage(auth, req, id);
  }

  @ApiRoute(API_ROUTES.leadMove)
  move(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(LeadMoveSchema)) body: LeadMove) {
    return this.pipelines.move(auth, id, body);
  }
}
