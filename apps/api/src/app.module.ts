import { Module, type Provider } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module.js';
import { DevAuthGuard } from './common/auth/dev-auth.guard.js';
import { getEnv } from './config/env.js';
import { HealthController } from './health/health.controller.js';
import { EventsModule } from './infra/events/events.module.js';
import { PrismaModule } from './infra/prisma/prisma.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CallsModule } from './modules/calls/calls.module.js';
import { CustomizationModule } from './modules/customization/customization.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { LeadsModule } from './modules/leads/leads.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { PacksModule } from './modules/packs/packs.module.js';
import { PipelineModule } from './modules/pipeline/pipeline.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { SuperadminModule } from './modules/superadmin/superadmin.module.js';
import { PlatformConfigModule } from './modules/platform-config/platform-config.module.js';
import { FloorsModule } from './modules/floors/floors.module.js';
import { CalendarModule } from './modules/calendar/calendar.module.js';
import { CaptureModule } from './modules/capture/capture.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CrmModule } from './modules/crm/crm.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { RoutingModule } from './modules/routing/routing.module.js';
import { TeamMessagesModule } from './modules/team-messages/team-messages.module.js';
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
    ScheduleModule.forRoot(),
    StorageModule,
    // backend-core
    AuthModule,
    WorkspaceModule,
    LeadsModule,
    TasksModule,
    PipelineModule,
    NotificationsModule,
    DashboardModule,
    CustomizationModule,
    PacksModule,
    // change #19 PLATFORM stream
    PlatformConfigModule,
    FloorsModule,
    // change #19 wave B CRM-API stream (SPEC 29.9)
    CatalogModule,
    CrmModule,
    DocumentsModule,
    CalendarModule,
    RoutingModule,
    CaptureModule,
    TeamMessagesModule,
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
