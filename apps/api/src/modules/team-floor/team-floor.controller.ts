import { Controller, Query } from '@nestjs/common';
import { API_ROUTES, IdSchema, type TeamFloorSnapshot } from '@vistar/shared';
import { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { TeamFloorService } from './team-floor.service.js';

const SnapshotQuerySchema = z.object({ teamId: IdSchema.optional() });

@Controller()
export class TeamFloorController {
  constructor(private readonly floor: TeamFloorService) {}

  @ApiRoute(API_ROUTES.teamFloorSnapshot)
  snapshot(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(SnapshotQuerySchema)) query: z.output<typeof SnapshotQuerySchema>): Promise<TeamFloorSnapshot> {
    return this.floor.snapshot(auth, query.teamId);
  }
}
