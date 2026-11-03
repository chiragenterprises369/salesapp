import { Body, Controller, Param, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import {
  ActiveCallEventSchema,
  API_ROUTES,
  CallListQuerySchema,
  CallUpdateSchema,
  ClickToCallSchema,
  DeviceCallLogBatchSchema,
  IdParamSchema,
  UPLOAD_LIMITS,
  type Call,
  type DeviceCallLogResult,
  type Page,
  type RecordingUrl,
} from '@vistar/shared';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { diskUpload } from '../storage/files.controller.js';
import { StorageService, type UploadedFileLike } from '../storage/storage.service.js';
import { CallsService } from './calls.service.js';

/** Calls (D-057): live phone state, device call log, call list and detail, recordings. */
@Controller()
export class CallsController {
  constructor(
    private readonly calls: CallsService,
    private readonly storage: StorageService,
  ) {}

  @ApiRoute(API_ROUTES.myCallActive)
  active(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(ActiveCallEventSchema)) body: z.output<typeof ActiveCallEventSchema>): Promise<Call> {
    return this.calls.active(auth, body);
  }

  @ApiRoute(API_ROUTES.myCallDeviceLog)
  deviceLog(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(DeviceCallLogBatchSchema)) body: z.output<typeof DeviceCallLogBatchSchema>): Promise<DeviceCallLogResult> {
    return this.calls.deviceLog(auth, body);
  }

  // ---- change #20: prod (click-to-call through the telephony integration)
  @ApiRoute(API_ROUTES.callCreate)
  clickToCall(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(ClickToCallSchema)) body: z.output<typeof ClickToCallSchema>): Promise<Call> {
    return this.calls.clickToCall(auth, body);
  }
  // ---- end change #20: prod

  @ApiRoute(API_ROUTES.callList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(CallListQuerySchema)) query: z.output<typeof CallListQuerySchema>): Promise<Page<Call>> {
    return this.calls.list(auth, query);
  }

  @ApiRoute(API_ROUTES.callGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>): Promise<Call> {
    return this.calls.get(auth, params.id);
  }

  @ApiRoute(API_ROUTES.callUpdate)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>,
    @Body(new ZodPipe(CallUpdateSchema)) body: z.output<typeof CallUpdateSchema>,
  ): Promise<Call> {
    return this.calls.update(auth, params.id, body);
  }

  /** The phone recorder file of my call (multipart `file`, max 50 MB; PLATFORM storage, D-065). */
  @ApiRoute(API_ROUTES.callRecordingUpload)
  @UseInterceptors(diskUpload(UPLOAD_LIMITS.call_recording.maxBytes))
  async recording(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>,
    @UploadedFile() file: UploadedFileLike | undefined,
  ): Promise<Call> {
    try {
      return await this.calls.uploadRecording(auth, params.id, file);
    } finally {
      await this.storage.discard(file);
    }
  }

  @ApiRoute(API_ROUTES.callRecording)
  recordingUrl(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>): Promise<RecordingUrl> {
    return this.calls.recordingUrl(auth, params.id);
  }
}
