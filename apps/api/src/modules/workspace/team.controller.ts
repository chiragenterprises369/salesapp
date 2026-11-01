import { Body, Controller, Param, Query, Req } from '@nestjs/common';
import { API_ROUTES, IdParamSchema, RoleCreateSchema, RoleUpdateSchema, UserUpdateSchema, type RoleCreate, type UserUpdate } from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { RolesService, type RoleUpdate } from './roles.service.js';
import { TeamsService } from './teams.service.js';
import { UsersService } from './users.service.js';

type UserListQuery = z.output<NonNullable<typeof API_ROUTES.userList.query>>;
type TeamCreateBody = z.output<typeof API_ROUTES.teamCreate.body>;

/** Users, teams and roles (Team and roles screens, pickers). */
@Controller()
export class TeamController {
  constructor(
    private readonly users: UsersService,
    private readonly teams: TeamsService,
    private readonly roles: RolesService,
  ) {}

  @ApiRoute(API_ROUTES.userList)
  listUsers(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(API_ROUTES.userList.query)) query: UserListQuery,
    @Query('includeInactive') includeInactiveRaw?: string,
  ) {
    // z.coerce.boolean() turns "false" into true; read the raw flag explicitly (see CONTRACT-REQUEST).
    const includeInactive = includeInactiveRaw === undefined ? false : ['true', '1'].includes(String(includeInactiveRaw).toLowerCase());
    return this.users.list(auth, { q: query.q, teamId: query.teamId }, includeInactive);
  }

  @ApiRoute(API_ROUTES.userOptions)
  userOptions(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(API_ROUTES.userOptions.query)) query: { q?: string }) {
    return this.users.options(auth, query.q);
  }

  @ApiRoute(API_ROUTES.userUpdate)
  updateUser(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(IdParamSchema)) params: { id: string },
    @Body(new ZodPipe(UserUpdateSchema)) body: UserUpdate,
  ) {
    return this.users.update(auth, req, params.id, body);
  }

  @ApiRoute(API_ROUTES.teamList)
  listTeams(@CurrentAuth() auth: AuthContext) {
    return this.teams.list(auth);
  }

  @ApiRoute(API_ROUTES.teamCreate)
  createTeam(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(API_ROUTES.teamCreate.body)) body: TeamCreateBody) {
    return this.teams.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.roleList)
  listRoles(@CurrentAuth() auth: AuthContext) {
    return this.roles.list(auth);
  }

  @ApiRoute(API_ROUTES.roleCreate)
  createRole(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(RoleCreateSchema)) body: RoleCreate) {
    return this.roles.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.roleUpdate)
  updateRole(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Param(new ZodPipe(IdParamSchema)) params: { id: string },
    @Body(new ZodPipe(RoleUpdateSchema)) body: RoleUpdate,
  ) {
    return this.roles.update(auth, req, params.id, body);
  }

  @ApiRoute(API_ROUTES.roleDelete)
  deleteRole(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) params: { id: string }) {
    return this.roles.remove(auth, req, params.id);
  }
}
