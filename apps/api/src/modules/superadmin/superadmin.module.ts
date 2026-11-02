import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { SuperCompaniesController } from './super-companies.controller.js';
import { SuperCompaniesService } from './super-companies.service.js';

/**
 * OWNER: superadmin-panel (Phase 9). Super Admin API under /api/super: companies, plans and billing,
 * usage, feature flags, platform health, analytics, impersonation, content, platform audit, system settings.
 * Super Admin AUTH (login, mandatory TOTP, platform guard) lives in modules/auth (backend-core, Phase 1).
 * Change #19 (backend-core, PLATFORM stream): companies list / detail / create with an admin invite, and the
 * per-company switches (PUT /api/super/companies/{id}/flags).
 */
@Module({
  imports: [AuthModule],
  controllers: [SuperCompaniesController],
  providers: [SuperCompaniesService],
})
export class SuperadminModule {}
