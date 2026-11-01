import { Body, Controller, Req } from '@nestjs/common';
import { API_ROUTES, SupportAccessUpdateSchema, WorkspaceUpdateSchema, type ThemeMode, type WorkspaceUpdate } from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { CurrentAuth, type AuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { WorkspaceService } from './workspace.service.js';

@Controller()
export class WorkspaceController {
  constructor(private readonly workspaces: WorkspaceService) {}

  @ApiRoute(API_ROUTES.workspaceGet)
  get(@CurrentAuth() auth: AuthContext) {
    return this.workspaces.get(auth.workspaceId);
  }

  @ApiRoute(API_ROUTES.workspaceUpdate)
  update(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(WorkspaceUpdateSchema)) body: WorkspaceUpdate) {
    return this.workspaces.update(auth, req, body);
  }

  @ApiRoute(API_ROUTES.workspaceTheme)
  theme(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(API_ROUTES.workspaceTheme.body)) body: { mode: ThemeMode }) {
    return this.workspaces.setTheme(auth, req, body.mode);
  }

  @ApiRoute(API_ROUTES.supportAccessUpdate)
  supportAccess(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Body(new ZodPipe(SupportAccessUpdateSchema)) body: z.output<typeof SupportAccessUpdateSchema>,
  ) {
    return this.workspaces.setSupportAccess(auth, req, body);
  }
}
