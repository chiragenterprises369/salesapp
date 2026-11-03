import { Body, Controller, Param, Query, Req, Res } from '@nestjs/common';
import {
  API_ROUTES,
  DocumentPdfQuerySchema,
  IdParamSchema,
  ManualInvoiceCreateSchema,
  PlanRequestDecideSchema,
  PlanRequestListQuerySchema,
  PlatformBillingProfileSchema,
  PlatformInvoiceCancelSchema,
  PlatformInvoiceIssueSchema,
  PlatformInvoiceMarkPaidSchema,
  RazorpayConfigUpdateSchema,
  SubscriptionListQuerySchema,
  SuperInvoiceListQuerySchema,
  SuperPlanChangeSchema,
  TrialExtendSchema,
  type PlatformBillingProfile,
  type PlatformInvoiceMarkPaid,
  type RazorpayConfigUpdate,
  type SuperPlanChange,
  type TrialExtend,
} from '@vistar/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { CurrentPlatformAdmin, type PlatformAuthContext } from '../../common/auth/auth-context.js';
import { ApiRoute } from '../../common/http/api-route.decorator.js';
import { ZodPipe } from '../../common/validation/zod.pipe.js';
import { BillingCoreService } from './billing-core.service.js';
import { BillingProfileService } from './billing-profile.service.js';
import { sendPdf } from './billing.controller.js';
import { PlatformInvoicesService } from './platform-invoices.service.js';
import { RazorpayConfigService } from './razorpay-config.service.js';
import { SubscriptionsService } from './subscriptions.service.js';

type IdParam = { id: string };

/** Super Admin Billing (/super-admin/billing) and the Razorpay card of Super Admin > Config. */
@Controller()
export class SuperBillingController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly invoices: PlatformInvoicesService,
    private readonly profiles: BillingProfileService,
    private readonly razorpay: RazorpayConfigService,
    private readonly core: BillingCoreService,
  ) {}

  @ApiRoute(API_ROUTES.superPlanList)
  async planList() {
    return { items: await this.core.plans() };
  }

  @ApiRoute(API_ROUTES.superBillingSubscriptions)
  subscriptionList(@Query(new ZodPipe(SubscriptionListQuerySchema)) q: z.output<typeof SubscriptionListQuerySchema>) {
    return this.subscriptions.list(q);
  }

  @ApiRoute(API_ROUTES.superBillingCompany)
  company(@Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.subscriptions.companyBilling(id);
  }

  @ApiRoute(API_ROUTES.superBillingInvoiceCreate)
  invoiceCreate(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(ManualInvoiceCreateSchema)) body: z.output<typeof ManualInvoiceCreateSchema>) {
    return this.subscriptions.createManualInvoice(admin, req, id, body);
  }

  @ApiRoute(API_ROUTES.superBillingTrialExtend)
  extendTrial(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(TrialExtendSchema)) body: TrialExtend) {
    return this.subscriptions.extendTrial(admin, req, id, body);
  }

  @ApiRoute(API_ROUTES.superBillingPlanChange)
  planChange(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(SuperPlanChangeSchema)) body: SuperPlanChange) {
    return this.subscriptions.superChangePlan(admin, req, id, body);
  }

  @ApiRoute(API_ROUTES.superBillingInvoiceList)
  invoiceList(@Query(new ZodPipe(SuperInvoiceListQuerySchema)) q: z.output<typeof SuperInvoiceListQuerySchema>) {
    return this.invoices.list(q, false);
  }

  @ApiRoute(API_ROUTES.superBillingInvoiceGet)
  invoiceGet(@Param(new ZodPipe(IdParamSchema)) { id }: IdParam) {
    return this.invoices.get(id, null, false);
  }

  @ApiRoute(API_ROUTES.superBillingInvoicePdf)
  async invoicePdf(@Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Query(new ZodPipe(DocumentPdfQuerySchema)) q: { download?: boolean }, @Res() res: Response) {
    sendPdf(res, await this.invoices.pdf(id, null, false), q.download);
  }

  @ApiRoute(API_ROUTES.superBillingInvoiceIssue)
  invoiceIssue(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(PlatformInvoiceIssueSchema)) body: z.output<typeof PlatformInvoiceIssueSchema>) {
    return this.subscriptions.issueInvoice(admin, req, id, body.dueDate);
  }

  @ApiRoute(API_ROUTES.superBillingInvoiceMarkPaid)
  invoiceMarkPaid(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(PlatformInvoiceMarkPaidSchema)) body: PlatformInvoiceMarkPaid) {
    return this.subscriptions.markPaid(admin, req, id, body);
  }

  @ApiRoute(API_ROUTES.superBillingInvoiceCancel)
  invoiceCancel(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(PlatformInvoiceCancelSchema)) body: z.output<typeof PlatformInvoiceCancelSchema>) {
    return this.subscriptions.cancelInvoice(admin, req, id, body.reason);
  }

  @ApiRoute(API_ROUTES.superBillingRequestList)
  requests(@Query(new ZodPipe(PlanRequestListQuerySchema)) q: z.output<typeof PlanRequestListQuerySchema>) {
    return this.subscriptions.requests(q.status);
  }

  @ApiRoute(API_ROUTES.superBillingRequestDecide)
  decide(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Param(new ZodPipe(IdParamSchema)) { id }: IdParam, @Body(new ZodPipe(PlanRequestDecideSchema)) body: z.output<typeof PlanRequestDecideSchema>) {
    return this.subscriptions.decide(admin, req, id, body);
  }

  @ApiRoute(API_ROUTES.superBillingProfileGet)
  profile() {
    return this.profiles.response();
  }

  @ApiRoute(API_ROUTES.superBillingProfileUpdate)
  profileUpdate(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Body(new ZodPipe(PlatformBillingProfileSchema)) body: PlatformBillingProfile) {
    return this.profiles.save(admin, req, body);
  }

  @ApiRoute(API_ROUTES.superRazorpayGet)
  razorpayGet() {
    return this.razorpay.status();
  }

  @ApiRoute(API_ROUTES.superRazorpayUpdate)
  razorpayUpdate(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request, @Body(new ZodPipe(RazorpayConfigUpdateSchema)) body: RazorpayConfigUpdate) {
    return this.razorpay.save(admin, req, body);
  }

  @ApiRoute(API_ROUTES.superRazorpayDelete)
  razorpayDelete(@CurrentPlatformAdmin() admin: PlatformAuthContext, @Req() req: Request) {
    return this.razorpay.remove(admin, req);
  }
}
