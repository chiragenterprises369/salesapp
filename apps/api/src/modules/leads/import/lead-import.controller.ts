import { Body, Controller, Param, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { API_ROUTES, IdParamSchema, ImportCommitRequestSchema, type ImportCommitRequest } from '@vistar/shared';
import type { Request, Response } from 'express';
import { type AuthContext, CurrentAuth } from '../../../common/auth/auth-context.js';
import { ApiRoute } from '../../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../../common/validation/zod.pipe.js';
import { LeadExportQuerySchema, LeadExportService, type LeadExportQuery } from './lead-export.service.js';
import { LeadImportService, type UploadedFileLike } from './lead-import.service.js';
import { IMPORT_MAX_BYTES } from './table.js';

/** Registered before LeadsController so `/leads/export` is not captured by `/leads/:id`. */
@Controller()
export class LeadImportController {
  constructor(
    private readonly imports: LeadImportService,
    private readonly exports: LeadExportService,
  ) {}

  @ApiRoute(API_ROUTES.leadExport)
  export(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response,
    @Query(new ZodPipe(LeadExportQuerySchema)) query: LeadExportQuery,
    @Query() raw: Record<string, unknown>,
  ): Promise<void> {
    return this.exports.export(auth, req, res, query, raw);
  }

  @ApiRoute(API_ROUTES.leadImportPreview)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES, files: 1, fields: 10 } }))
  preview(@CurrentAuth() auth: AuthContext, @UploadedFile() file: UploadedFileLike | undefined) {
    return this.imports.preview(auth, file);
  }

  @ApiRoute(API_ROUTES.leadImportCommit)
  commit(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(IdParamSchema)) { id }: { id: string },
    @Body(new ZodPipe(ImportCommitRequestSchema)) body: ImportCommitRequest,
  ) {
    return this.imports.commit(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.leadImportGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: { id: string }) {
    return this.imports.get(auth, id);
  }
}
