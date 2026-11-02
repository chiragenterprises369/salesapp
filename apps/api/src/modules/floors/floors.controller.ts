import { Body, Controller, Param, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import {
  API_ROUTES,
  FloorRequestCreateSchema,
  FloorRequestStatusChangeSchema,
  FloorUploadFieldsSchema,
  IdParamSchema,
  SeatMapSchema,
  SuperFloorRequestListQuerySchema,
  UPLOAD_LIMITS,
  type FloorAsset,
  type FloorRequest,
  type FloorRequestCreate,
  type Page,
  type SeatMap,
  type TeamFloorLayout,
} from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth, CurrentPlatformAdmin, type AuthContext, type PlatformAuthContext } from '../../common/auth/auth-context.js';
import { AppException } from '../../common/errors/app-exception.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { diskUpload } from '../storage/files.controller.js';
import { StorageService, type UploadedFileLike } from '../storage/storage.service.js';
import { FloorsService } from './floors.service.js';

type IdParam = { id: string };

/** Company side: floor requests (settings.manage) and the published layout (teamfloor.read). */
@Controller()
export class FloorsController {
  constructor(private readonly floors: FloorsService) {}

  @ApiRoute(API_ROUTES.floorRequestCreate)
  create(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(FloorRequestCreateSchema)) body: FloorRequestCreate): Promise<FloorRequest> {
    return this.floors.createRequest(auth, req, body);
  }

  @ApiRoute(API_ROUTES.floorRequestList)
  list(@CurrentAuth() auth: AuthContext): Promise<{ items: FloorRequest[] }> {
    return this.floors.listRequests(auth);
  }

  @ApiRoute(API_ROUTES.floorRequestGet)
  get(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<FloorRequest> {
    return this.floors.getRequest(auth, id);
  }

  @ApiRoute(API_ROUTES.teamFloorLayout)
  layout(@CurrentAuth() auth: AuthContext): Promise<TeamFloorLayout> {
    return this.floors.layout(auth);
  }
}

/** Super Admin side: requests across companies, AI-made floor uploads, seat map, publish. */
@Controller()
export class SuperFloorsController {
  constructor(
    private readonly floors: FloorsService,
    private readonly storage: StorageService,
  ) {}

  @ApiRoute(API_ROUTES.superFloorRequestList)
  list(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Query(new ZodPipe(SuperFloorRequestListQuerySchema)) query: z.output<typeof SuperFloorRequestListQuerySchema>): Promise<Page<FloorRequest>> {
    return this.floors.superListRequests(query);
  }

  @ApiRoute(API_ROUTES.superFloorRequestGet)
  get(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<FloorRequest> {
    return this.floors.superGetRequest(id);
  }

  @ApiRoute(API_ROUTES.superFloorRequestStatus)
  status(
    @CurrentPlatformAdmin() admin: PlatformAuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(IdParamSchema)) { id }: IdParam,
    @Body(new ZodPipe(FloorRequestStatusChangeSchema)) body: z.output<typeof FloorRequestStatusChangeSchema>,
  ): Promise<FloorRequest> {
    return this.floors.superChangeStatus(admin, req, id, body);
  }

  @ApiRoute(API_ROUTES.superFloorList)
  floors_(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<{ items: FloorAsset[] }> {
    return this.floors.superListFloors(id);
  }

  @ApiRoute(API_ROUTES.superFloorUpload)
  @UseInterceptors(diskUpload(UPLOAD_LIMITS.floor_model.maxBytes))
  async upload(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @UploadedFile() file: UploadedFileLike | undefined): Promise<FloorAsset> {
    try {
      const fields = FloorUploadFieldsSchema.safeParse(req.body ?? {});
      if (!fields.success) throw new AppException('VALIDATION_FAILED', 'Some fields are invalid', { details: fields.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      return await this.floors.superUpload(admin, req, id, file, fields.data);
    } finally {
      await this.storage.discard(file);
    }
  }

  @ApiRoute(API_ROUTES.superFloorGet)
  floor(@CurrentPlatformAdmin() _admin: PlatformAuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<FloorAsset> {
    return this.floors.superGetFloor(id);
  }

  @ApiRoute(API_ROUTES.superFloorSeatMap)
  seatMap(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(SeatMapSchema)) body: SeatMap): Promise<FloorAsset> {
    return this.floors.superSaveSeatMap(admin, req, id, body);
  }

  @ApiRoute(API_ROUTES.superFloorPublish)
  publish(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam): Promise<FloorAsset> {
    return this.floors.superPublish(admin, req, id);
  }
}
