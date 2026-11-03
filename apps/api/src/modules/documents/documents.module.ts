import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { WhatsappModule } from '../whatsapp/whatsapp.module.js';
import { WorkspaceModule } from '../workspace/workspace.module.js';
import { DocumentDeliveryService } from './delivery/document-delivery.service.js';
import { DocumentMailer } from './delivery/mailers.js';
import { DocumentCoreService } from './document-core.service.js';
import { DocumentsController } from './documents.controller.js';
import { InvoicesService } from './invoices.service.js';
import { PublicDocumentsService } from './public-documents.service.js';
import { QuotationsService } from './quotations.service.js';
import { SellerProfileService } from './seller-profile.service.js';

/**
 * OWNER: backend-core (CRM-API, change #19 wave B). Quotations and invoices with GST (gst.ts), numbering
 * per financial year, payments, A4 PDFs (pdf/), share links and the seller profile.
 * StorageModule is global (logo bytes for PDFs); BrandingService comes from WorkspaceModule.
 * Change #20 (PROD-HUB): delivery by e-mail (PDF attached; company SMTP or the platform mailer) and WhatsApp
 * (approved template with the link) in delivery/.
 */
@Module({
  imports: [WorkspaceModule, IntegrationsModule, WhatsappModule],
  controllers: [DocumentsController],
  providers: [
    DocumentCoreService,
    SellerProfileService,
    QuotationsService,
    InvoicesService,
    PublicDocumentsService,
    // ---- change #20: prod (CompanyEmailService comes from the global MailModule)
    DocumentMailer,
    DocumentDeliveryService,
    // ---- end change #20: prod
  ],
  exports: [QuotationsService, InvoicesService, SellerProfileService, DocumentDeliveryService],
})
export class DocumentsModule {}
