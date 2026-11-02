import { Module } from '@nestjs/common';
import { WorkspaceModule } from '../workspace/workspace.module.js';
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
 */
@Module({
  imports: [WorkspaceModule],
  controllers: [DocumentsController],
  providers: [DocumentCoreService, SellerProfileService, QuotationsService, InvoicesService, PublicDocumentsService],
  exports: [QuotationsService, InvoicesService, SellerProfileService],
})
export class DocumentsModule {}
