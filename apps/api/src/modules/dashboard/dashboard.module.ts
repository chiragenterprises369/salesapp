import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';
import { MyTodayService } from './my-today.service.js';

/**
 * OWNER: backend-core. Dashboard summary (KPIs, funnel, sources, calls per hour, leaderboard, feed, attention)
 * and Employee Home (`GET /me/today`).
 */
@Module({
  controllers: [DashboardController],
  providers: [DashboardService, MyTodayService],
})
export class DashboardModule {}
