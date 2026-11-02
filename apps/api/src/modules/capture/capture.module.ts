import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { CaptureRateLimiter } from './capture-rate-limit.js';
import { CaptureController } from './capture.controller.js';
import { CaptureService } from './capture.service.js';

/** OWNER: backend-core (CRM-API, change #19 wave B). Lead capture forms: builder, public form, submissions -> routed leads. */
@Module({
  imports: [LeadsModule, WorkspaceModule],
  controllers: [CaptureController],
  providers: [CaptureService, CaptureRateLimiter],
})
export class CaptureModule {}
