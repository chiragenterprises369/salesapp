import { Global, Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { CompanyEmailService } from './company-email.service.js';
import { EmailTemplatesController, SuperEmailTemplatesController } from './email-templates.controller.js';
import { EmailTemplatesService } from './email-templates.service.js';
import { PlatformMailerService } from './platform-mailer.service.js';

/**
 * OWNER: backend-core (CONFIG-API stream, change #20, D-074). Platform mailer, company e-mail (company SMTP or
 * the platform mailer), platform and company e-mail templates.
 * Global: auth (invites, password reset, verification, Super Admin alerts), billing, webhooks and PROD-HUB's
 * documents use PlatformMailerService / CompanyEmailService without importing this module.
 */
@Global()
@Module({
  imports: [IntegrationsModule, WorkspaceModule],
  controllers: [SuperEmailTemplatesController, EmailTemplatesController],
  providers: [PlatformMailerService, CompanyEmailService, EmailTemplatesService],
  exports: [PlatformMailerService, CompanyEmailService],
})
export class MailModule {}
