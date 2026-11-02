import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  CaptureFormCreateSchema,
  CaptureFormKeyParamSchema,
  CaptureFormUpdateSchema,
  CaptureSubmissionListQuerySchema,
  IdParamSchema,
  PublicCaptureSubmitSchema,
  type CaptureFormCreate,
  type CaptureFormUpdate,
  type CursorPaginationQuery,
  type PublicCaptureSubmit,
} from '@vistar/shared';
import type { Request } from 'express';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { CaptureService } from './capture.service.js';

type IdParam = { id: string };

@Controller()
export class CaptureController {
  constructor(private readonly capture: CaptureService) {}

  @ApiRoute(API_ROUTES.captureFormList)
  list(@CurrentAuth() auth: AuthContext) {
    return this.capture.list(auth);
  }

  @ApiRoute(API_ROUTES.captureFormCreate)
  create(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(CaptureFormCreateSchema)) body: CaptureFormCreate) {
    return this.capture.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.captureFormGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.capture.get(auth, id);
  }

  @ApiRoute(API_ROUTES.captureFormUpdate)
  update(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(CaptureFormUpdateSchema)) body: CaptureFormUpdate) {
    return this.capture.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.captureFormDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.capture.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.captureSubmissionList)
  submissions(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Query(new ZodPipe(CaptureSubmissionListQuerySchema)) q: CursorPaginationQuery) {
    return this.capture.submissions(auth, id, q);
  }

  // ---------------------------------------------------------------- public (hosted page /f/<key>)

  @ApiRoute(API_ROUTES.publicCaptureFormGet)
  publicGet(@Param(new ZodPipe(CaptureFormKeyParamSchema)) { key }: { key: string }) {
    return this.capture.getPublic(key);
  }

  @ApiRoute(API_ROUTES.publicCaptureFormSubmit)
  publicSubmit(@Req() req: Request, @Param(new ZodPipe(CaptureFormKeyParamSchema)) { key }: { key: string }, @Body(new ZodPipe(PublicCaptureSubmitSchema)) body: PublicCaptureSubmit) {
    return this.capture.submit(key, body, req);
  }
}
