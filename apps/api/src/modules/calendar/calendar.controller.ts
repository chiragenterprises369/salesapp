import { Body, Controller, Param, Query } from '@nestjs/common';
import {
  API_ROUTES,
  AvailabilityQuerySchema,
  IdParamSchema,
  MeetingCancelSchema,
  MeetingCreateSchema,
  MeetingListQuerySchema,
  MeetingRespondSchema,
  MeetingUpdateSchema,
  TimeOffCreateSchema,
  TimeOffListQuerySchema,
  type AvailabilityQuery,
  type MeetingCancel,
  type MeetingCreate,
  type MeetingListQuery,
  type MeetingRespond,
  type MeetingUpdate,
  type TimeOffCreate,
  type TimeOffListQuery,
} from '@vistar/shared';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { AvailabilityService } from './availability.service.js';
import { MeetingsService } from './meetings.service.js';

type IdParam = { id: string };

@Controller()
export class CalendarController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly availability: AvailabilityService,
  ) {}

  @ApiRoute(API_ROUTES.meetingList)
  list(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(MeetingListQuerySchema)) q: MeetingListQuery) {
    return this.meetings.list(auth, q);
  }

  @ApiRoute(API_ROUTES.meetingCreate)
  create(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(MeetingCreateSchema)) body: MeetingCreate) {
    return this.meetings.create(auth, body);
  }

  @ApiRoute(API_ROUTES.meetingGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.meetings.get(auth, id);
  }

  @ApiRoute(API_ROUTES.meetingUpdate)
  update(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(MeetingUpdateSchema)) body: MeetingUpdate) {
    return this.meetings.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.meetingDelete)
  remove(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.meetings.remove(auth, id);
  }

  @ApiRoute(API_ROUTES.meetingCancel)
  cancel(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(MeetingCancelSchema)) body: MeetingCancel) {
    return this.meetings.cancel(auth, id, body);
  }

  @ApiRoute(API_ROUTES.meetingRespond)
  respond(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(MeetingRespondSchema)) body: MeetingRespond) {
    return this.meetings.respond(auth, id, body);
  }

  @ApiRoute(API_ROUTES.calendarAvailability)
  availabilityOf(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(AvailabilityQuerySchema)) q: AvailabilityQuery) {
    return this.availability.availability(auth, q);
  }

  @ApiRoute(API_ROUTES.timeOffList)
  timeOff(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(TimeOffListQuerySchema)) q: TimeOffListQuery) {
    return this.availability.listTimeOff(auth, q);
  }

  @ApiRoute(API_ROUTES.timeOffCreate)
  addTimeOff(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(TimeOffCreateSchema)) body: TimeOffCreate) {
    return this.availability.createTimeOff(auth, body);
  }

  @ApiRoute(API_ROUTES.timeOffDelete)
  removeTimeOff(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.availability.deleteTimeOff(auth, id);
  }
}
