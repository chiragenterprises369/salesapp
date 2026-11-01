import { Module, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module.js';
import { DevAuthGuard } from './common/auth/dev-auth.guard.js';
import { getEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { EventsModule } from './infra/events/events.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CallsModule } from './modules/calls/calls.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { LeadsModule } from './modules/leads/leads.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PipelineModule } from './modules/pipeline/pipeline.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { SuperadminModule } from './modules/superadmin/superadmin.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module.js';
import { WorkflowsModule } from './modules/workflows/workflows.module.js';
import { WorkspaceModule } from './modules/workspace/workspace.module.js';

/** Wave 1 only (see common/auth/dev-auth.guard.ts). */
const devProviders: Provider[] = getEnv().DEV_AUTH ? [{ provide: APP_GUARD, useClass: DevAuthGuard }] : [];

/** Root module. OWNER: orchestrator. Feature modules register their own providers. */
@Module({
  imports: [
    // infra (global)
    PrismaModule,
    RedisModule,
    EventsModule,
    CommonModule,
    // backend-core
    AuthModule,
    WorkspaceModule,
    LeadsModule,
    TasksModule,
    PipelineModule,
    NotificationsModule,
    DashboardModule,
    // realtime-integrations
    RealtimeModule,
    WebhooksModule,
    IntegrationsModule,
    WhatsappModule,
    CallsModule,
    // workflow-engine
    WorkflowsModule,
    // superadmin-panel (Phase 9)
    SuperadminModule,
  ],
  controllers: [HealthController],
  providers: devProviders,
})
export class AppModule {}
