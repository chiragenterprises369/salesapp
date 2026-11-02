import { Body, Controller, Param, Query } from '@nestjs/common';
import {
  ActiveCallEventSchema,
  API_ROUTES,
  CallListQuerySchema,
  CallUpdateSchema,
  DeviceCallLogBatchSchema,
  IdParamSchema,
  type Call,
  type DeviceCallLogResult,
  type Page,
} from '@vistar/shared';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { CallsService } from './calls.service.js';

/** Calls (D-057): live phone state, device call log, call list and detail. */
@Controller()
export class CallsController {
  constructor(private readonly calls: CallsService) {}

  @ApiRoute(API_ROUTES.myCallActive)
  active(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(ActiveCallEventSchema)) body: z.output<typeof ActiveCallEventSchema>): Promise<Call> {
    return this.calls.active(auth, body);
  }

  @ApiRoute(API_ROUTES.myCallDeviceLog)
  deviceLog(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(DeviceCallLogBatchSchema)) body: z.output<typeof DeviceCallLogBatchSchema>): Promise<DeviceCallLogResult> {
    return this.calls.deviceLog(auth, body);
  }

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

  /**
   * Recording upload needs the PLATFORM storage adapter (D-065), which is not on agent/backend-core
   * yet. Until it lands this answers 501 so the app keeps the file and retries later.
   */
  @ApiRoute(API_ROUTES.callRecordingUpload)
  async recording(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>): Promise<Call> {
    await this.calls.get(auth, params.id); // 404 for calls outside the scope, before the 501
    throw new AppException('SERVICE_UNAVAILABLE', 'Recording upload is not available yet. Keep the file and try again later', { status: 501 });
  }
}
