import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import {
  API_ROUTES,
  AttendanceCheckSchema,
  AttendanceRegisterQuerySchema,
  FieldLiveQuerySchema,
  FieldRouteQuerySchema,
  IdParamSchema,
  LocationBatchSchema,
  TrackingConsentUpdateSchema,
  type AttendanceRegister,
  type AttendanceSession,
  type FieldLive,
  type FieldRoute,
  type LocationBatchResult,
  type MyAttendanceToday,
  type TrackingConsent,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { AttendanceService } from './attendance.service.js';

/** Attendance, field tracking and consent (D-063). */
@Controller()
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @ApiRoute(API_ROUTES.myAttendanceToday)
  today(@CurrentAuth() auth: AuthContext): Promise<MyAttendanceToday> {
    return this.attendance.today(auth);
  }

  @ApiRoute(API_ROUTES.myAttendanceCheckIn)
  checkIn(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(AttendanceCheckSchema)) body: z.output<typeof AttendanceCheckSchema>): Promise<AttendanceSession> {
    return this.attendance.checkIn(auth, body);
  }

  @ApiRoute(API_ROUTES.myAttendanceCheckOut)
  checkOut(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(AttendanceCheckSchema)) body: z.output<typeof AttendanceCheckSchema>): Promise<AttendanceSession> {
    return this.attendance.checkOut(auth, body);
  }

  @ApiRoute(API_ROUTES.myLocationBatch)
  location(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(LocationBatchSchema)) body: z.output<typeof LocationBatchSchema>): Promise<LocationBatchResult> {
    return this.attendance.location(auth, body);
  }

  @ApiRoute(API_ROUTES.myTrackingConsentGet)
  consent(@CurrentAuth() auth: AuthContext): Promise<TrackingConsent> {
    return this.attendance.consentGet(auth);
  }

  @ApiRoute(API_ROUTES.myTrackingConsentSet)
  setConsent(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(TrackingConsentUpdateSchema)) body: z.output<typeof TrackingConsentUpdateSchema>): Promise<TrackingConsent> {
    return this.attendance.consentSet(auth, req, body);
  }

  @ApiRoute(API_ROUTES.attendanceRegister)
  register(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(AttendanceRegisterQuerySchema)) query: z.output<typeof AttendanceRegisterQuerySchema>): Promise<AttendanceRegister> {
    return this.attendance.register(auth, query);
  }

  @ApiRoute(API_ROUTES.fieldLive)
  live(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(FieldLiveQuerySchema)) query: z.output<typeof FieldLiveQuerySchema>): Promise<FieldLive> {
    return this.attendance.live(auth, query.teamId);
  }

  @ApiRoute(API_ROUTES.fieldUserRoute)
  route(
    @CurrentAuth() auth: AuthContext,
    @Param(new ZodPipe(IdParamSchema)) params: z.output<typeof IdParamSchema>,
    @Query(new ZodPipe(FieldRouteQuerySchema)) query: z.output<typeof FieldRouteQuerySchema>,
  ): Promise<FieldRoute> {
    return this.attendance.route(auth, params.id, query.date);
  }
}
