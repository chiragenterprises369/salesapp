import { Body, Controller, Param, Req } from '@nestjs/common';
import {
  API_ROUTES,
  IdParamSchema,
  RoutingRuleCreateSchema,
  RoutingRuleOrderSchema,
  RoutingRuleUpdateSchema,
  RoutingTestSchema,
  type RoutingRuleCreate,
  type RoutingRuleUpdate,
  type RoutingTest,
} from '@vistar/shared';
import type { Request } from 'express';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { RoutingService } from './routing.service.js';

type IdParam = { id: string };

@Controller()
export class RoutingController {
  constructor(private readonly routing: RoutingService) {}

  @ApiRoute(API_ROUTES.routingRuleList)
  list(@CurrentAuth() auth: AuthContext) {
    return this.routing.list(auth);
  }

  @ApiRoute(API_ROUTES.routingRuleCreate)
  create(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(RoutingRuleCreateSchema)) body: RoutingRuleCreate) {
    return this.routing.create(auth, req, body);
  }

  @ApiRoute(API_ROUTES.routingRuleOrder)
  order(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(RoutingRuleOrderSchema)) body: { ids: string[] }) {
    return this.routing.reorder(auth, body.ids);
  }

  @ApiRoute(API_ROUTES.routingTest)
  test(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(RoutingTestSchema)) body: RoutingTest) {
    return this.routing.test(auth, body);
  }

  @ApiRoute(API_ROUTES.routingRuleUpdate)
  update(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(RoutingRuleUpdateSchema)) body: RoutingRuleUpdate) {
    return this.routing.update(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.routingRuleDelete)
  remove(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.routing.remove(auth, req, id);
  }
}
