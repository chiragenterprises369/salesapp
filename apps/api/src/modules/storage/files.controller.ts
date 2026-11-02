import { Controller, Param, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { API_ROUTES, FileUploadFieldsSchema, IdParamSchema, SignedFileTokenParamSchema, UPLOAD_LIMITS, WORKSPACE_UPLOAD_PURPOSES, type FileUrl, type StoredFile } from '@vistar/shared';
import type { Request, Response } from 'express';
import { CurrentAuth, CurrentPlatformAdmin, type AuthContext, type PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException, notFound } from '../../common/errors/app-exception.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import type { File as FileRow } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { StorageService, UPLOAD_TMP_DIR, type UploadedFileLike } from './storage.service.js';

const WORKSPACE_MAX = Math.max(...WORKSPACE_UPLOAD_PURPOSES.map((p) => UPLOAD_LIMITS[p].maxBytes));

/** Multer on disk (temp dir), one `file` part; per-purpose limits are checked by StorageService. */
export const diskUpload = (maxBytes: number) => FileInterceptor('file', { dest: UPLOAD_TMP_DIR, limits: { fileSize: maxBytes, files: 1, fields: 20, fieldSize: 16_384 } });

type IdParam = { id: string };

/** Who may read a tenant file through /files/{id}: branding for everyone, company files for settings.manage. */
function assertCanRead(auth: AuthContext, row: FileRow): void {
  if (row.visibility === 'public') return;
  if (row.purpose === 'call_recording') throw new AppException('FORBIDDEN', 'Use the call recording route for recordings');
  if (!auth.permissions.includes('settings.manage')) throw new AppException('FORBIDDEN', 'You do not have permission to do this');
}

@Controller()
export class FilesController {
  constructor(
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiRoute(API_ROUTES.fileUpload)
  @UseInterceptors(diskUpload(WORKSPACE_MAX))
  async upload(@CurrentAuth() auth: AuthContext, @Req() req: Request, @UploadedFile() file: UploadedFileLike | undefined): Promise<StoredFile> {
    try {
      const fields = FileUploadFieldsSchema.safeParse(req.body ?? {});
      if (!fields.success) {
        throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: fields.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      }
      const row = await this.storage.saveTenantFile(auth.workspaceId, fields.data.purpose, file, { uploadedById: auth.userId });
      return this.storage.toStoredFile(row);
    } finally {
      await this.storage.discard(file);
    }
  }

  private async tenantFile(auth: AuthContext, id: string): Promise<FileRow> {
    const row = await this.prisma.forTenant(auth.workspaceId).file.findFirst({ where: { id, deletedAt: null } });
    if (!row) throw notFound('File');
    assertCanRead(auth, row);
    return row;
  }

  @ApiRoute(API_ROUTES.fileGet)
  async get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<StoredFile> {
    return this.storage.toStoredFile(await this.tenantFile(auth, id));
  }

  @ApiRoute(API_ROUTES.fileUrl)
  async url(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<FileUrl> {
    return this.storage.signedUrl(await this.tenantFile(auth, id));
  }

  @ApiRoute(API_ROUTES.fileSignedDownload)
  async signed(@Param(new ZodPipe(SignedFileTokenParamSchema)) { token }: { token: string }, @Res() res: Response): Promise<void> {
    const t = this.storage.verifyToken(token);
    if (!t) throw notFound('File');
    // Root client: the signature decides access (tenant files across workspaces, platform files).
    const row = t.scope === 't' ? await this.prisma.file.findFirst({ where: { id: t.id, deletedAt: null } }) : await this.prisma.platformFile.findUnique({ where: { id: t.id } });
    if (!row) throw notFound('File');
    await this.storage.send(res, row, { cache: 'private', download: row.purpose === 'apk' });
  }

  @ApiRoute(API_ROUTES.filePublicDownload)
  async public(@Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Res() res: Response): Promise<void> {
    const row = await this.prisma.file.findFirst({ where: { id, visibility: 'public', deletedAt: null } });
    if (!row) throw notFound('File');
    await this.storage.send(res, row, { cache: 'public' });
  }

  @ApiRoute(API_ROUTES.superFileUrl)
  async superUrl(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<FileUrl> {
    const tenant = await this.prisma.file.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (tenant) return this.storage.signedUrl(tenant, 't');
    const platform = await this.prisma.platformFile.findUnique({ where: { id }, select: { id: true } });
    if (platform) return this.storage.signedUrl(platform, 'p');
    throw notFound('File');
  }
}
