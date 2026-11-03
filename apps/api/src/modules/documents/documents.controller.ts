import { Body, Controller, Param, Query, Req, Res } from '@nestjs/common';
import {
  API_ROUTES,
  DocumentPdfQuerySchema,
  DocumentShareCreateSchema,
  DocumentTokenParamSchema,
  IdParamSchema,
  InvoiceCancelSchema,
  InvoiceCreateSchema,
  InvoiceIssueSchema,
  InvoiceListQuerySchema,
  InvoiceUpdateSchema,
  PaymentCreateSchema,
  PaymentParamSchema,
  QuotationCreateSchema,
  QuotationListQuerySchema,
  QuotationStatusChangeSchema,
  QuotationUpdateSchema,
  SellerProfileSchema,
  type DocumentShareCreate,
  type InvoiceCancel,
  type InvoiceCreate,
  type InvoiceIssue,
  type InvoiceListQuery,
  type InvoiceUpdate,
  type PaymentCreate,
  type QuotationCreate,
  type QuotationListQuery,
  type QuotationStatusChange,
  type QuotationUpdate,
  type SellerProfile,
  // ---- change #20: prod (document delivery)
  DocumentDeliverSchema,
  type DocumentDeliver,
  type DocumentDeliveryResult,
} from '@vistar/shared';
import type { Request, Response } from 'express';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { DocumentDeliveryService } from './delivery/document-delivery.service.js';
import { InvoicesService } from './invoices.service.js';
import { PublicDocumentsService } from './public-documents.service.js';
import { QuotationsService } from './quotations.service.js';
import { SellerProfileService } from './seller-profile.service.js';

type IdParam = { id: string };

/** PDFs: inline by default, attachment with ?download=1; never cached by shared caches. */
function sendPdf(res: Response, pdf: { buffer: Buffer; fileName: string }, download?: boolean): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(pdf.buffer.length));
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${pdf.fileName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.end(pdf.buffer);
}

@Controller()
export class DocumentsController {
  constructor(
    private readonly quotations: QuotationsService,
    private readonly invoices: InvoicesService,
    private readonly seller: SellerProfileService,
    private readonly publicDocs: PublicDocumentsService,
    private readonly delivery: DocumentDeliveryService,
  ) {}

  // ---- change #20: prod (send by e-mail with the PDF attached, or WhatsApp with the share link)

  @ApiRoute(API_ROUTES.quotationDeliver)
  quotationDeliver(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(DocumentDeliverSchema)) body: DocumentDeliver): Promise<DocumentDeliveryResult> {
    return this.delivery.deliver(auth, req, 'quotation', id, body);
  }

  @ApiRoute(API_ROUTES.invoiceDeliver)
  invoiceDeliver(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(DocumentDeliverSchema)) body: DocumentDeliver): Promise<DocumentDeliveryResult> {
    return this.delivery.deliver(auth, req, 'invoice', id, body);
  }
  // ---- end change #20: prod

  // ---------------------------------------------------------------- seller profile

  @ApiRoute(API_ROUTES.sellerProfileGet)
  profile(@CurrentAuth() auth: AuthContext) {
    return this.seller.get(auth);
  }

  @ApiRoute(API_ROUTES.sellerProfileUpdate)
  saveProfile(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(SellerProfileSchema)) body: SellerProfile) {
    return this.seller.update(auth, req, body);
  }

  // ---------------------------------------------------------------- quotations

  @ApiRoute(API_ROUTES.quotationList)
  quotationList(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(QuotationListQuerySchema)) q: QuotationListQuery) {
    return this.quotations.list(auth, q);
  }

  @ApiRoute(API_ROUTES.quotationCreate)
  quotationCreate(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(QuotationCreateSchema)) body: QuotationCreate) {
    return this.quotations.create(auth, body);
  }

  @ApiRoute(API_ROUTES.quotationGet)
  quotationGet(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.quotations.get(auth, id);
  }

  @ApiRoute(API_ROUTES.quotationUpdate)
  quotationUpdate(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(QuotationUpdateSchema)) body: QuotationUpdate) {
    return this.quotations.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.quotationDelete)
  quotationDelete(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.quotations.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.quotationStatus)
  quotationStatus(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(QuotationStatusChangeSchema)) body: QuotationStatusChange) {
    return this.quotations.changeStatus(auth, id, body);
  }

  @ApiRoute(API_ROUTES.quotationSend)
  quotationSend(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(DocumentShareCreateSchema)) body: DocumentShareCreate) {
    return this.quotations.send(auth, id, body);
  }

  @ApiRoute(API_ROUTES.quotationShare)
  quotationShare(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(DocumentShareCreateSchema)) body: DocumentShareCreate) {
    return this.quotations.share(auth, id, body);
  }

  @ApiRoute(API_ROUTES.quotationShareRevoke)
  quotationShareRevoke(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.quotations.revokeShare(auth, id);
  }

  @ApiRoute(API_ROUTES.quotationPdf)
  async quotationPdf(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Query(new ZodPipe(DocumentPdfQuerySchema)) q: { download?: boolean }, @Res() res: Response) {
    sendPdf(res, await this.quotations.pdf(auth, id), q.download);
  }

  @ApiRoute(API_ROUTES.quotationConvert)
  quotationConvert(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.quotations.convert(auth, id);
  }

  @ApiRoute(API_ROUTES.quotationDuplicate)
  quotationDuplicate(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.quotations.duplicate(auth, id);
  }

  // ---------------------------------------------------------------- invoices

  @ApiRoute(API_ROUTES.invoiceList)
  invoiceList(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(InvoiceListQuerySchema)) q: InvoiceListQuery) {
    return this.invoices.list(auth, q);
  }

  @ApiRoute(API_ROUTES.invoiceCreate)
  invoiceCreate(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(InvoiceCreateSchema)) body: InvoiceCreate) {
    return this.invoices.create(auth, body);
  }

  @ApiRoute(API_ROUTES.invoiceGet)
  invoiceGet(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.invoices.get(auth, id);
  }

  @ApiRoute(API_ROUTES.invoiceUpdate)
  invoiceUpdate(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(InvoiceUpdateSchema)) body: InvoiceUpdate) {
    return this.invoices.update(auth, id, body);
  }

  @ApiRoute(API_ROUTES.invoiceDelete)
  invoiceDelete(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.invoices.remove(auth, req, id);
  }

  @ApiRoute(API_ROUTES.invoiceIssue)
  invoiceIssue(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(InvoiceIssueSchema)) body: InvoiceIssue) {
    return this.invoices.issue(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.invoiceCancel)
  invoiceCancel(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(InvoiceCancelSchema)) body: InvoiceCancel) {
    return this.invoices.cancel(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.invoiceSend)
  invoiceSend(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(DocumentShareCreateSchema)) body: DocumentShareCreate) {
    return this.invoices.send(auth, req, id, body);
  }

  @ApiRoute(API_ROUTES.invoiceShare)
  invoiceShare(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(DocumentShareCreateSchema)) body: DocumentShareCreate) {
    return this.invoices.share(auth, id, body);
  }

  @ApiRoute(API_ROUTES.invoiceShareRevoke)
  invoiceShareRevoke(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.invoices.revokeShare(auth, id);
  }

  @ApiRoute(API_ROUTES.invoicePdf)
  async invoicePdf(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Query(new ZodPipe(DocumentPdfQuerySchema)) q: { download?: boolean }, @Res() res: Response) {
    sendPdf(res, await this.invoices.pdf(auth, id), q.download);
  }

  @ApiRoute(API_ROUTES.paymentCreate)
  paymentCreate(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(PaymentCreateSchema)) body: PaymentCreate) {
    return this.invoices.addPayment(auth, id, body);
  }

  @ApiRoute(API_ROUTES.paymentDelete)
  paymentDelete(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Param(new ZodPipe(PaymentParamSchema)) p: { id: string; paymentId: string }) {
    return this.invoices.voidPayment(auth, req, p.id, p.paymentId);
  }

  // ---------------------------------------------------------------- public share links

  @ApiRoute(API_ROUTES.publicDocumentGet)
  publicGet(@Param(new ZodPipe(DocumentTokenParamSchema)) { token }: { token: string }) {
    return this.publicDocs.get(token);
  }

  @ApiRoute(API_ROUTES.publicDocumentPdf)
  async publicPdf(@Param(new ZodPipe(DocumentTokenParamSchema)) { token }: { token: string }, @Query(new ZodPipe(DocumentPdfQuerySchema)) q: { download?: boolean }, @Res() res: Response) {
    sendPdf(res, await this.publicDocs.pdf(token), q.download);
  }
}
