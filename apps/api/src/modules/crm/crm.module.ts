import { Module } from '@nestjs/common';
import { CalendarModule } from '../calendar/calendar.module.js';
import { LeadsModule } from '../leads/leads.module.js';
import { AccountsService } from './accounts.service.js';
import { ContactsService } from './contacts.service.js';
import { CrmActivityService } from './crm-activity.service.js';
import { AccountsController, ContactsController, DealsController } from './crm.controller.js';
import { DealsService } from './deals.service.js';
import { LeadConvertService } from './lead-convert.service.js';

/**
 * OWNER: backend-core (CRM-API, change #19 wave B). Contacts, accounts (Prisma Company), deals on the deal
 * pipeline, notes, merged timelines, related lists and lead conversion. Exports DealsService for the
 * pipeline module (GET /pipelines?entity=deal).
 */
@Module({
  imports: [LeadsModule, CalendarModule],
  controllers: [ContactsController, AccountsController, DealsController],
  providers: [ContactsService, AccountsService, DealsService, CrmActivityService, LeadConvertService],
  exports: [ContactsService, AccountsService, DealsService],
})
export class CrmModule {}
