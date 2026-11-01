import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  CustomRecordCreateSchema,
  CustomRecordListQuerySchema,
  CustomRecordUpdateSchema,
  ObjectKeyParamSchema,
  RecordParamSchema,
  type CustomRecordCreate,
  type CustomRecordListQuery,
  type CustomRecordUpdate,
} from '@vistar/shared';
import type { Request } from 'express';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { RecordsService } from './records.service.js';

type KeyParam = { key: string };
type RecordParam = { key: string; id: string };

@Controller()
export class RecordsController {
  constructor(private readonly records: RecordsService) {}

  @ApiRoute(API_ROUTES.recordList)
  list(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(ObjectKeyParamSchema)) { key }: KeyParam, @Query(new ZodPipe(CustomRecordListQuerySchema)) query: CustomRecordListQuery) {
    return this.records.list(auth, key, query);
  }

  @ApiRoute(API_ROUTES.recordCreate)
  create(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(ObjectKeyParamSchema)) { key }: KeyParam, @Body(new ZodPipe(CustomRecordCreateSchema)) body: CustomRecordCreate) {
    return this.records.create(auth, key, body);
  }

  @ApiRoute(API_ROUTES.recordGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(RecordParamSchema)) p: RecordParam) {
    return this.records.get(auth, p.key, p.id);
  }

  @ApiRoute(API_ROUTES.recordUpdate)
  update(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(RecordParamSchema)) p: RecordParam, @Body(new ZodPipe(CustomRecordUpdateSchema)) body: CustomRecordUpdate) {
    return this.records.update(auth, p.key, p.id, body);
  }

  @ApiRoute(API_ROUTES.recordDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(RecordParamSchema)) p: RecordParam) {
    return this.records.remove(auth, req, p.key, p.id);
  }
}
