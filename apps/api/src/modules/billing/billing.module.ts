import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ApiCallMeterInterceptor } from './api-call-meter.interceptor.js';
import { BillingCoreService } from './billing-core.service.js';
import { BillingCycleScheduler } from './billing-cycle.scheduler.js';
import { BillingProfileService } from './billing-profile.service.js';
import { BillingController, RazorpayWebhookController } from './billing.controller.js';
import { CheckoutService } from './checkout.service.js';
import { PlanLimitsService } from './plan-limits.service.js';
import { PlatformInvoicesService } from './platform-invoices.service.js';
import { RazorpayConfigService } from './razorpay-config.service.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { SuperBillingController } from './super-billing.controller.js';
import { UsageService } from './usage.service.js';

/**
 * OWNER: backend-core (BILLING-PDF, change #19 wave C; D-072). Vistar subscription billing: subscriptions, usage
 * metering and plan limits, Vistar invoices with GST and PDFs, Razorpay or mock checkout and webhook, Super Admin
 * billing, the billing cycle cron. Global so PlanLimitsService and UsageService can be injected by invites, leads
 * and API keys without module imports (and without import cycles).
 */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [BillingController, RazorpayWebhookController, SuperBillingController],
  providers: [
    BillingCoreService,
    UsageService,
    PlanLimitsService,
    BillingProfileService,
    RazorpayConfigService,
    PlatformInvoicesService,
    CheckoutService,
    SubscriptionsService,
    BillingCycleScheduler,
    { provide: APP_INTERCEPTOR, useClass: ApiCallMeterInterceptor },
  ],
  exports: [PlanLimitsService, UsageService, BillingCoreService],
})
export class BillingModule {}
