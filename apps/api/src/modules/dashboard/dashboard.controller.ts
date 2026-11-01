import { Controller, Query } from '@nestjs/common';
import { API_ROUTES, DashboardQuerySchema, type DashboardQuery } from '@vistar/shared';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { DashboardService } from './dashboard.service.js';
import { MyTodayService } from './my-today.service.js';

@Controller()
export class DashboardController {
  constructor(
    private readonly dashboard: DashboardService,
    private readonly myToday: MyTodayService,
  ) {}

  @ApiRoute(API_ROUTES.dashboardSummary)
  summary(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(DashboardQuerySchema)) query: DashboardQuery) {
    return this.dashboard.summary(auth, query);
  }

  @ApiRoute(API_ROUTES.myToday)
  today(@CurrentAuth() auth: AuthContext) {
    return this.myToday.today(auth);
  }
}
