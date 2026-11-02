import { Body, Controller, Param, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  API_ROUTES,
  AndroidReleaseUpdateSchema,
  AndroidReleaseUploadFieldsSchema,
  DeviceRegisterSchema,
  FirebaseConfigPartSchema,
  IdParamSchema,
  PushTestSchema,
  UPLOAD_LIMITS,
  type AndroidRelease,
  type AppConfig,
  type Device,
  type DeviceRegister,
  type FirebaseConfigStatus,
  type PushTestResult,
} from '@vistar/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CurrentAuth, CurrentPlatformAdmin, type AuthContext, type PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { diskUpload } from '../storage/files.controller.js';
import { StorageService, type UploadedFileLike } from '../storage/storage.service.js';
import { AndroidReleasesService } from './android-releases.service.js';
import { DevicesService } from './devices.service.js';
import { FirebaseConfigService } from './firebase-config.service.js';
import { PushService } from './push.service.js';

/** Firebase JSON files are small: memory upload, 64 KB. */
const jsonUpload = () => FileInterceptor('file', { limits: { fileSize: 64 * 1024, files: 1, fields: 5 } });
type IdParam = { id: string };

/** Super Admin config section (D-058): Firebase files, test push, APK releases. Platform audience only. */
@Controller()
export class SuperConfigController {
  constructor(
    private readonly firebase: FirebaseConfigService,
    private readonly releases: AndroidReleasesService,
    private readonly push: PushService,
    private readonly storage: StorageService,
  ) {}

  @ApiRoute(API_ROUTES.superFirebaseGet)
  firebaseStatus(@CurrentPlatformAdmin() _admin: PlatformAuthContext): Promise<FirebaseConfigStatus> {
    return this.firebase.status();
  }

  @ApiRoute(API_ROUTES.superFirebaseClientUpload)
  @UseInterceptors(jsonUpload())
  firebaseClient(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @UploadedFile() file: UploadedFileLike | undefined): Promise<FirebaseConfigStatus> {
    return this.firebase.uploadClient(admin, req, file);
  }

  @ApiRoute(API_ROUTES.superFirebaseServiceAccountUpload)
  @UseInterceptors(jsonUpload())
  firebaseServiceAccount(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @UploadedFile() file: UploadedFileLike | undefined): Promise<FirebaseConfigStatus> {
    return this.firebase.uploadServiceAccount(admin, req, file);
  }

  @ApiRoute(API_ROUTES.superFirebaseDelete)
  firebaseDelete(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(FirebaseConfigPartSchema)) { part }: z.output<typeof FirebaseConfigPartSchema>): Promise<FirebaseConfigStatus> {
    return this.firebase.remove(admin, req, part);
  }

  @ApiRoute(API_ROUTES.superPushTest)
  pushTest(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Body(new ZodPipe(PushTestSchema)) body: z.output<typeof PushTestSchema>): Promise<PushTestResult> {
    return this.push.test(body.token);
  }

  @ApiRoute(API_ROUTES.superAndroidReleaseList)
  releaseList(@CurrentPlatformAdmin() _admin: PlatformAuthContext): Promise<{ items: AndroidRelease[] }> {
    return this.releases.list();
  }

  @ApiRoute(API_ROUTES.superAndroidReleaseUpload)
  @UseInterceptors(diskUpload(UPLOAD_LIMITS.apk.maxBytes))
  async releaseUpload(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @UploadedFile() file: UploadedFileLike | undefined): Promise<AndroidRelease> {
    try {
      const fields = AndroidReleaseUploadFieldsSchema.safeParse(req.body ?? {});
      if (!fields.success) throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: fields.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      return await this.releases.upload(admin, req, file, fields.data);
    } finally {
      await this.storage.discard(file);
    }
  }

  @ApiRoute(API_ROUTES.superAndroidReleaseUpdate)
  releaseUpdate(
    @CurrentPlatformAdmin() admin: PlatformAuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(IdParamSchema)) { id }: IdParam,
    @Body(new ZodPipe(AndroidReleaseUpdateSchema)) body: z.output<typeof AndroidReleaseUpdateSchema>,
  ): Promise<AndroidRelease> {
    return this.releases.update(admin, req, id, body);
  }
}

/** Public app bootstrap and APK download (no auth). */
@Controller()
export class AppController {
  constructor(private readonly releases: AndroidReleasesService) {}

  @ApiRoute(API_ROUTES.appConfig)
  config(): Promise<AppConfig> {
    return this.releases.appConfig();
  }

  @ApiRoute(API_ROUTES.appAndroidLatest)
  latest(@Res() res: Response): Promise<void> {
    return this.releases.downloadLatest(res);
  }
}

@Controller()
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @ApiRoute(API_ROUTES.myDeviceList)
  list(@CurrentAuth() auth: AuthContext): Promise<{ items: Device[] }> {
    return this.devices.list(auth);
  }

  @ApiRoute(API_ROUTES.myDeviceRegister)
  register(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(DeviceRegisterSchema)) body: DeviceRegister): Promise<Device> {
    return this.devices.register(auth, body);
  }

  @ApiRoute(API_ROUTES.myDeviceDelete)
  remove(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<{ ok: true }> {
    return this.devices.remove(auth, id);
  }
}
