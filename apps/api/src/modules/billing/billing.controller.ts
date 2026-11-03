import { Body, Controller, Headers, Param, Query, Req, Res, type RawBodyRequest } from '@nestjs/common';
import {
  API_ROUTES,
  BillingContactUpdateSchema,
  CheckoutVerifySchema,
  DocumentPdfQuerySchema,
  IdParamSchema,
  MockCheckoutPaySchema,
  PlanChangeCreateSchema,
  PlatformInvoiceListQuerySchema,
  PlatformPaymentListQuerySchema,
  type BillingContact,
  type CheckoutVerify,
  type PlanChangeCreate,
} from '@vistar/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { type AuthContext, CurrentAuth } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { CheckoutService } from './checkout.service.js';
import { PlatformInvoicesService } from './platform-invoices.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

type IdParam = { id: string };

/** PDFs: inline by default, attachment with ?download=1; never cached by shared caches. */
export function sendPdf(res: Response, pdf: { buffer: Buffer; fileName: string }, download?: boolean): void {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Length', String(pdf.buffer.length));
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${pdf.fileName}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.end(pdf.buffer);
}

/** Company Billing and usage (/app/billing): billing.read to look, billing.manage to change or pay. */
@Controller()
export class BillingController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly invoices: PlatformInvoicesService,
    private readonly checkout: CheckoutService,
    private readonly prisma: PrismaService,
  ) {}

  @ApiRoute(API_ROUTES.billingOverview)
  overview(@CurrentAuth() auth: AuthContext) {
    return this.subscriptions.overview(auth.workspaceId);
  }

  @ApiRoute(API_ROUTES.billingUsage)
  usage(@CurrentAuth() auth: AuthContext) {
    return this.subscriptions.usageOf(auth.workspaceId);
  }

  @ApiRoute(API_ROUTES.billingPlans)
  plans() {
    return this.subscriptions.activePlans();
  }

  @ApiRoute(API_ROUTES.billingContactUpdate)
  contact(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(BillingContactUpdateSchema)) body: BillingContact) {
    return this.subscriptions.updateContact(auth, req, body);
  }

  @ApiRoute(API_ROUTES.billingPlanChange)
  planChange(@CurrentAuth() auth: AuthContext, @Req() req: Request, @Body(new ZodPipe(PlanChangeCreateSchema)) body: PlanChangeCreate) {
    return this.subscriptions.changePlan(auth, req, body);
  }

  @ApiRoute(API_ROUTES.billingPlanChangeCancel)
  planChangeCancel(@CurrentAuth() auth: AuthContext, @Req() req: Request) {
    return this.subscriptions.cancelChange(auth, req);
  }

  @ApiRoute(API_ROUTES.billingInvoiceList)
  invoiceList(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(PlatformInvoiceListQuerySchema)) q: z.output<typeof PlatformInvoiceListQuerySchema>) {
    return this.invoices.list({ ...q, workspaceId: auth.workspaceId }, true);
  }

  @ApiRoute(API_ROUTES.billingInvoiceGet)
  invoiceGet(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.invoices.get(id, auth.workspaceId, true);
  }

  @ApiRoute(API_ROUTES.billingInvoicePdf)
  async invoicePdf(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Query(new ZodPipe(DocumentPdfQuerySchema)) q: { download?: boolean }, @Res() res: Response) {
    sendPdf(res, await this.invoices.pdf(id, auth.workspaceId, true), q.download);
  }

  @ApiRoute(API_ROUTES.billingInvoicePay)
  async invoicePay(@CurrentAuth() auth: AuthContext, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    const user = auth.userId ? await this.prisma.forTenant(auth.workspaceId).user.findFirst({ where: { id: auth.userId }, select: { name: true, email: true, phone: true } }) : null;
    return this.checkout.start(auth.workspaceId, id, { name: user?.name ?? null, email: user?.email ?? null, contact: user?.phone ?? null });
  }

  @ApiRoute(API_ROUTES.billingCheckoutVerify)
  verify(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(CheckoutVerifySchema)) body: CheckoutVerify) {
    return this.checkout.verify(auth.workspaceId, body);
  }

  @ApiRoute(API_ROUTES.billingCheckoutMockPay)
  mockPay(@CurrentAuth() auth: AuthContext, @Body(new ZodPipe(MockCheckoutPaySchema)) body: z.output<typeof MockCheckoutPaySchema>) {
    return this.checkout.mockPay(auth.workspaceId, body);
  }

  @ApiRoute(API_ROUTES.billingPaymentList)
  payments(@CurrentAuth() auth: AuthContext, @Query(new ZodPipe(PlatformPaymentListQuerySchema)) q: z.output<typeof PlatformPaymentListQuerySchema>) {
    return this.invoices.payments(auth.workspaceId, q);
  }
}

/**
 * Razorpay webhook (/api/hooks/razorpay). The signature covers the raw body (main.ts sets rawBody: true); the
 * JSON body is only parsed after the signature check.
 */
@Controller()
export class RazorpayWebhookController {
  constructor(private readonly checkout: CheckoutService) {}

  @ApiRoute(API_ROUTES.razorpayWebhook)
  receive(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature: string | undefined, @Headers('x-razorpay-event-id') eventId: string | undefined, @Body() body: unknown) {
    const raw = req.rawBody ?? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body ?? {}), 'utf8');
    return this.checkout.webhook(raw, signature, eventId, body);
  }
}
