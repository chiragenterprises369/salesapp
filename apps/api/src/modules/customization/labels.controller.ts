import { Body, Controller, Req } from '@nestjs/common';
import { API_ROUTES, LabelsUpdateSchema } from '@vistar/shared';
import type { Request } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { LabelsService } from './labels.service.js';

@Controller()
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @ApiRoute(API_ROUTES.labelsGet)
  get(@CurrentAuth() auth: AuthContext) {
    return this.labels.get(auth);
  }

  @ApiRoute(API_ROUTES.labelsUpdate)
  update(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(LabelsUpdateSchema)) body: z.output<typeof LabelsUpdateSchema>) {
    return this.labels.update(auth, req, body);
  }
}
