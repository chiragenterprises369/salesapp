-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'cancelled');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('monthly', 'yearly');

-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('draft', 'issued', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('created', 'captured', 'failed', 'refunded');

-- CreateEnum
CREATE TYPE "PlanChangeStatus" AS ENUM ('pending', 'approved', 'rejected', 'cancelled');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'billing_trial_ending';
ALTER TYPE "NotificationType" ADD VALUE 'billing_payment_failed';
ALTER TYPE "NotificationType" ADD VALUE 'billing_invoice_issued';

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "plan" "Plan" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'trialing',
    "cycle" "BillingCycle" NOT NULL DEFAULT 'monthly',
    "extraSeats" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "pendingPlan" "Plan",
    "pendingCycle" "BillingCycle",
    "pastDueSince" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "billingContact" JSONB,
    "trialReminderAt" TIMESTAMP(3),
    "dunningStep" INTEGER NOT NULL DEFAULT 0,
    "lastDunningAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoice" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT,
    "financialYear" TEXT,
    "sequence" INTEGER,
    "kind" TEXT NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'draft',
    "plan" "Plan",
    "cycle" "BillingCycle",
    "extraSeats" INTEGER,
    "periodStart" DATE,
    "periodEnd" DATE,
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "seller" JSONB,
    "buyer" JSONB NOT NULL,
    "buyerName" TEXT NOT NULL,
    "placeOfSupply" TEXT,
    "taxMode" TEXT NOT NULL DEFAULT 'intra',
    "lines" JSONB NOT NULL,
    "subtotalPaise" BIGINT NOT NULL DEFAULT 0,
    "discountPaise" BIGINT NOT NULL DEFAULT 0,
    "taxablePaise" BIGINT NOT NULL DEFAULT 0,
    "cgstPaise" BIGINT NOT NULL DEFAULT 0,
    "sgstPaise" BIGINT NOT NULL DEFAULT 0,
    "igstPaise" BIGINT NOT NULL DEFAULT 0,
    "roundOffPaise" BIGINT NOT NULL DEFAULT 0,
    "totalPaise" BIGINT NOT NULL DEFAULT 0,
    "paidPaise" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'created',
    "provider" TEXT NOT NULL,
    "mode" "PaymentMode",
    "providerOrderId" TEXT,
    "providerPaymentId" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "paidOn" DATE,
    "failureReason" TEXT,
    "clientPaymentId" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanChangeRequest" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "fromPlan" "Plan" NOT NULL,
    "toPlan" "Plan" NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "status" "PlanChangeStatus" NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "requestedById" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoiceSeries" (
    "id" UUID NOT NULL,
    "financialYear" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformInvoiceSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingWebhookEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "workspaceId" UUID,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_workspaceId_key" ON "Subscription"("workspaceId");

-- CreateIndex
CREATE INDEX "Subscription_status_currentPeriodEnd_idx" ON "Subscription"("status", "currentPeriodEnd");

-- CreateIndex
CREATE INDEX "Subscription_status_trialEndsAt_idx" ON "Subscription"("status", "trialEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_number_key" ON "PlatformInvoice"("number");

-- CreateIndex
CREATE INDEX "PlatformInvoice_workspaceId_createdAt_idx" ON "PlatformInvoice"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformInvoice_status_dueDate_idx" ON "PlatformInvoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "PlatformInvoice_kind_status_idx" ON "PlatformInvoice"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_providerOrderId_key" ON "PlatformPayment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_providerPaymentId_key" ON "PlatformPayment"("providerPaymentId");

-- CreateIndex
CREATE INDEX "PlatformPayment_workspaceId_createdAt_idx" ON "PlatformPayment"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformPayment_invoiceId_clientPaymentId_key" ON "PlatformPayment"("invoiceId", "clientPaymentId");

-- CreateIndex
CREATE INDEX "PlanChangeRequest_workspaceId_status_idx" ON "PlanChangeRequest"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "PlanChangeRequest_status_createdAt_idx" ON "PlanChangeRequest"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoiceSeries_financialYear_key" ON "PlatformInvoiceSeries"("financialYear");

-- CreateIndex
CREATE INDEX "BillingWebhookEvent_receivedAt_idx" ON "BillingWebhookEvent"("receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BillingWebhookEvent_provider_eventId_key" ON "BillingWebhookEvent"("provider", "eventId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PlatformInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanChangeRequest" ADD CONSTRAINT "PlanChangeRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- data (change #19 wave C: billing)

-- One subscription per existing company: trials keep their trial window, everyone else starts a monthly period today.
INSERT INTO "Subscription" ("id", "workspaceId", "plan", "status", "cycle", "currentPeriodStart", "currentPeriodEnd", "trialEndsAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), w."id", w."plan",
  CASE WHEN w."status" = 'trial' AND w."trialEndsAt" IS NOT NULL THEN 'trialing'::"SubscriptionStatus" ELSE 'active'::"SubscriptionStatus" END,
  'monthly'::"BillingCycle",
  CASE WHEN w."status" = 'trial' AND w."trialEndsAt" IS NOT NULL THEN w."createdAt" ELSE date_trunc('day', now()) END,
  CASE WHEN w."status" = 'trial' AND w."trialEndsAt" IS NOT NULL THEN w."trialEndsAt" ELSE date_trunc('day', now()) + interval '1 month' END,
  CASE WHEN w."status" = 'trial' THEN w."trialEndsAt" ELSE NULL END,
  now(), now()
FROM "Workspace" w
WHERE w."deletedAt" IS NULL
ON CONFLICT ("workspaceId") DO NOTHING;

-- New plan limits (PlanLimitsSchema.apiKeys, .apiCallsPerMonth); JSON null = unlimited. Same values as prisma/seed/base.ts.
UPDATE "PlanDefinition"
SET "limits" = "limits" || jsonb_build_object(
  'apiKeys', CASE "key" WHEN 'free' THEN to_jsonb(0) WHEN 'starter' THEN to_jsonb(2) WHEN 'growth' THEN to_jsonb(10) ELSE 'null'::jsonb END,
  'apiCallsPerMonth', CASE "key" WHEN 'free' THEN to_jsonb(0) WHEN 'starter' THEN to_jsonb(10000) WHEN 'growth' THEN to_jsonb(100000) ELSE 'null'::jsonb END
)
WHERE NOT ("limits" ? 'apiKeys');