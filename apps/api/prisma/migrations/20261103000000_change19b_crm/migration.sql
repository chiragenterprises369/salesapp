-- CreateEnum
CREATE TYPE "QuotationStatus" AS ENUM ('draft', 'sent', 'accepted', 'rejected', 'expired');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'issued', 'partially_paid', 'paid', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('cash', 'upi', 'bank_transfer', 'cheque', 'card', 'other');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('scheduled', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "AttendeeResponse" AS ENUM ('pending', 'accepted', 'declined', 'tentative');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'meeting_reminder';

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "additionalEmails" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "additionalPhones" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "billingAddress" JSONB,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" UUID,
ADD COLUMN     "ownerId" UUID,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "shippingAddress" JSONB,
ADD COLUMN     "stateCode" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "additionalEmails" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "additionalPhones" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "billingAddress" JSONB,
ADD COLUMN     "gstin" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "mergedIntoId" UUID,
ADD COLUMN     "ownerId" UUID,
ADD COLUMN     "pan" TEXT,
ADD COLUMN     "shippingAddress" JSONB,
ADD COLUMN     "stateCode" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "title" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "companyId" UUID,
ADD COLUMN     "contactId" UUID,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "lostReason" TEXT,
ADD COLUMN     "ownerId" UUID,
ADD COLUMN     "pipelineId" UUID,
ADD COLUMN     "position" TEXT NOT NULL DEFAULT 'a0',
ADD COLUMN     "probability" INTEGER,
ADD COLUMN     "stageId" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "leadId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Pipeline" ADD COLUMN     "entity" TEXT NOT NULL DEFAULT 'lead';

-- CreateTable
CREATE TABLE "DealLine" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "dealId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hsnSac" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'NOS',
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPricePaise" BIGINT NOT NULL,
    "discountKind" TEXT NOT NULL DEFAULT 'percent',
    "discountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gstRate" INTEGER NOT NULL,
    "taxablePaise" BIGINT NOT NULL,

    CONSTRAINT "DealLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'goods',
    "hsnSac" TEXT NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'NOS',
    "gstRate" INTEGER NOT NULL,
    "unitPricePaise" BIGINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceList" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validFrom" DATE,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceListItem" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "unitPricePaise" BIGINT NOT NULL,

    CONSTRAINT "PriceListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSeries" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quotation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "QuotationStatus" NOT NULL DEFAULT 'draft',
    "issueDate" DATE NOT NULL,
    "validUntil" DATE,
    "ownerId" UUID,
    "companyId" UUID,
    "contactId" UUID,
    "dealId" UUID,
    "leadId" UUID,
    "priceListId" UUID,
    "buyerName" TEXT NOT NULL,
    "buyer" JSONB NOT NULL,
    "seller" JSONB,
    "placeOfSupply" TEXT,
    "taxMode" TEXT NOT NULL DEFAULT 'intra',
    "subtotalPaise" BIGINT NOT NULL DEFAULT 0,
    "discountPaise" BIGINT NOT NULL DEFAULT 0,
    "taxablePaise" BIGINT NOT NULL DEFAULT 0,
    "cgstPaise" BIGINT NOT NULL DEFAULT 0,
    "sgstPaise" BIGINT NOT NULL DEFAULT 0,
    "igstPaise" BIGINT NOT NULL DEFAULT 0,
    "roundOffPaise" BIGINT NOT NULL DEFAULT 0,
    "totalPaise" BIGINT NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "statusReason" TEXT,
    "shareTokenHash" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "sharedAt" TIMESTAMP(3),
    "createdById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Quotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotationLine" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "quotationId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hsnSac" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'NOS',
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPricePaise" BIGINT NOT NULL,
    "discountKind" TEXT NOT NULL DEFAULT 'percent',
    "discountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gstRate" INTEGER NOT NULL,
    "grossPaise" BIGINT NOT NULL,
    "discountPaise" BIGINT NOT NULL,
    "taxablePaise" BIGINT NOT NULL,
    "cgstPaise" BIGINT NOT NULL,
    "sgstPaise" BIGINT NOT NULL,
    "igstPaise" BIGINT NOT NULL,
    "totalPaise" BIGINT NOT NULL,

    CONSTRAINT "QuotationLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT,
    "financialYear" TEXT,
    "sequence" INTEGER,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'draft',
    "issueDate" DATE NOT NULL,
    "dueDate" DATE,
    "ownerId" UUID,
    "companyId" UUID,
    "contactId" UUID,
    "dealId" UUID,
    "leadId" UUID,
    "quotationId" UUID,
    "priceListId" UUID,
    "buyerName" TEXT NOT NULL,
    "buyer" JSONB NOT NULL,
    "seller" JSONB,
    "placeOfSupply" TEXT,
    "taxMode" TEXT NOT NULL DEFAULT 'intra',
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
    "terms" TEXT,
    "issuedAt" TIMESTAMP(3),
    "lastPaymentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "shareTokenHash" TEXT,
    "shareExpiresAt" TIMESTAMP(3),
    "sharedAt" TIMESTAMP(3),
    "createdById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" UUID,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "hsnSac" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'NOS',
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPricePaise" BIGINT NOT NULL,
    "discountKind" TEXT NOT NULL DEFAULT 'percent',
    "discountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gstRate" INTEGER NOT NULL,
    "grossPaise" BIGINT NOT NULL,
    "discountPaise" BIGINT NOT NULL,
    "taxablePaise" BIGINT NOT NULL,
    "cgstPaise" BIGINT NOT NULL,
    "sgstPaise" BIGINT NOT NULL,
    "igstPaise" BIGINT NOT NULL,
    "totalPaise" BIGINT NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "paidOn" DATE NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "clientPaymentId" TEXT,
    "recordedById" UUID,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmNote" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'in_person',
    "location" TEXT,
    "videoUrl" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "status" "MeetingStatus" NOT NULL DEFAULT 'scheduled',
    "organizerId" UUID,
    "leadId" UUID,
    "contactId" UUID,
    "companyId" UUID,
    "dealId" UUID,
    "reminders" INTEGER[] DEFAULT ARRAY[15]::INTEGER[],
    "recurrence" JSONB,
    "seriesEndAt" TIMESTAMP(3),
    "exceptionDates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seriesId" UUID,
    "outcome" TEXT,
    "cancelReason" TEXT,
    "createdById" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingAttendee" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "userId" UUID,
    "contactId" UUID,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "response" "AttendeeResponse" NOT NULL DEFAULT 'pending',
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingReminderLog" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "meetingId" UUID NOT NULL,
    "occurrenceStart" TIMESTAMP(3) NOT NULL,
    "minutesBefore" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeOff" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'leave',
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoutingRule" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "strategy" TEXT NOT NULL DEFAULT 'round_robin',
    "teamId" UUID,
    "userIds" UUID[] DEFAULT ARRAY[]::UUID[],
    "respectWorkingHours" BOOLEAN NOT NULL DEFAULT true,
    "respectAvailability" BOOLEAN NOT NULL DEFAULT true,
    "requireOnline" BOOLEAN NOT NULL DEFAULT false,
    "fallbackOwnerId" UUID,
    "lastAssignedUserId" UUID,
    "assignedCount" INTEGER NOT NULL DEFAULT 0,
    "lastAssignedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureForm" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "fields" JSONB NOT NULL,
    "settings" JSONB NOT NULL,
    "submissionCount" INTEGER NOT NULL DEFAULT 0,
    "lastSubmissionAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CaptureForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSubmission" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "formId" UUID NOT NULL,
    "leadId" UUID,
    "duplicateOfLeadId" UUID,
    "values" JSONB NOT NULL,
    "utm" JSONB NOT NULL DEFAULT '{}',
    "consent" BOOLEAN,
    "pageUrl" TEXT,
    "referrer" TEXT,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "clientSubmissionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DealLine_workspaceId_dealId_position_idx" ON "DealLine"("workspaceId", "dealId", "position");

-- CreateIndex
CREATE INDEX "Product_workspaceId_active_name_idx" ON "Product"("workspaceId", "active", "name");

-- CreateIndex
CREATE INDEX "Product_name_trgm_idx" ON "Product" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "Product_workspaceId_sku_key" ON "Product"("workspaceId", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "PriceList_workspaceId_name_key" ON "PriceList"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "PriceListItem_workspaceId_productId_idx" ON "PriceListItem"("workspaceId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceListItem_priceListId_productId_key" ON "PriceListItem"("priceListId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSeries_workspaceId_kind_financialYear_key" ON "DocumentSeries"("workspaceId", "kind", "financialYear");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_shareTokenHash_key" ON "Quotation"("shareTokenHash");

-- CreateIndex
CREATE INDEX "Quotation_workspaceId_status_issueDate_idx" ON "Quotation"("workspaceId", "status", "issueDate");

-- CreateIndex
CREATE INDEX "Quotation_workspaceId_ownerId_idx" ON "Quotation"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "Quotation_workspaceId_companyId_idx" ON "Quotation"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Quotation_workspaceId_contactId_idx" ON "Quotation"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "Quotation_workspaceId_dealId_idx" ON "Quotation"("workspaceId", "dealId");

-- CreateIndex
CREATE INDEX "Quotation_workspaceId_leadId_idx" ON "Quotation"("workspaceId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_workspaceId_number_key" ON "Quotation"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "QuotationLine_workspaceId_quotationId_position_idx" ON "QuotationLine"("workspaceId", "quotationId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_shareTokenHash_key" ON "Invoice"("shareTokenHash");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_status_issueDate_idx" ON "Invoice"("workspaceId", "status", "issueDate");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_status_dueDate_idx" ON "Invoice"("workspaceId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_ownerId_idx" ON "Invoice"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_companyId_idx" ON "Invoice"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_contactId_idx" ON "Invoice"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_dealId_idx" ON "Invoice"("workspaceId", "dealId");

-- CreateIndex
CREATE INDEX "Invoice_workspaceId_quotationId_idx" ON "Invoice"("workspaceId", "quotationId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_workspaceId_number_key" ON "Invoice"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLine_workspaceId_invoiceId_position_idx" ON "InvoiceLine"("workspaceId", "invoiceId", "position");

-- CreateIndex
CREATE INDEX "Payment_workspaceId_invoiceId_idx" ON "Payment"("workspaceId", "invoiceId");

-- CreateIndex
CREATE INDEX "Payment_workspaceId_paidOn_idx" ON "Payment"("workspaceId", "paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_invoiceId_clientPaymentId_key" ON "Payment"("invoiceId", "clientPaymentId");

-- CreateIndex
CREATE INDEX "CrmNote_workspaceId_entityType_entityId_createdAt_idx" ON "CrmNote"("workspaceId", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_startAt_idx" ON "Meeting"("workspaceId", "startAt");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_organizerId_startAt_idx" ON "Meeting"("workspaceId", "organizerId", "startAt");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_leadId_idx" ON "Meeting"("workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_contactId_idx" ON "Meeting"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_companyId_idx" ON "Meeting"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Meeting_workspaceId_dealId_idx" ON "Meeting"("workspaceId", "dealId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_workspaceId_userId_idx" ON "MeetingAttendee"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "MeetingAttendee_workspaceId_contactId_idx" ON "MeetingAttendee"("workspaceId", "contactId");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingAttendee_meetingId_userId_key" ON "MeetingAttendee"("meetingId", "userId");

-- CreateIndex
CREATE INDEX "MeetingReminderLog_workspaceId_sentAt_idx" ON "MeetingReminderLog"("workspaceId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MeetingReminderLog_meetingId_occurrenceStart_minutesBefore_key" ON "MeetingReminderLog"("meetingId", "occurrenceStart", "minutesBefore");

-- CreateIndex
CREATE INDEX "TimeOff_workspaceId_userId_startAt_idx" ON "TimeOff"("workspaceId", "userId", "startAt");

-- CreateIndex
CREATE INDEX "TimeOff_workspaceId_startAt_idx" ON "TimeOff"("workspaceId", "startAt");

-- CreateIndex
CREATE INDEX "RoutingRule_workspaceId_active_priority_idx" ON "RoutingRule"("workspaceId", "active", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureForm_key_key" ON "CaptureForm"("key");

-- CreateIndex
CREATE INDEX "CaptureForm_workspaceId_idx" ON "CaptureForm"("workspaceId");

-- CreateIndex
CREATE INDEX "CaptureSubmission_workspaceId_formId_createdAt_idx" ON "CaptureSubmission"("workspaceId", "formId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSubmission_formId_clientSubmissionId_key" ON "CaptureSubmission"("formId", "clientSubmissionId");

-- CreateIndex
CREATE INDEX "Company_workspaceId_ownerId_idx" ON "Company"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "Company_workspaceId_gstin_idx" ON "Company"("workspaceId", "gstin");

-- CreateIndex
CREATE INDEX "Company_tags_idx" ON "Company" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "Company_name_trgm_idx" ON "Company" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Contact_workspaceId_ownerId_idx" ON "Contact"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_companyId_idx" ON "Contact"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Contact_tags_idx" ON "Contact" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "Contact_name_trgm_idx" ON "Contact" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Deal_workspaceId_stageId_position_idx" ON "Deal"("workspaceId", "stageId", "position");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_ownerId_idx" ON "Deal"("workspaceId", "ownerId");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_companyId_idx" ON "Deal"("workspaceId", "companyId");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_contactId_idx" ON "Deal"("workspaceId", "contactId");

-- CreateIndex
CREATE INDEX "Deal_title_trgm_idx" ON "Deal" USING GIN ("title" gin_trgm_ops);

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "Pipeline"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealLine" ADD CONSTRAINT "DealLine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealLine" ADD CONSTRAINT "DealLine_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealLine" ADD CONSTRAINT "DealLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceList" ADD CONSTRAINT "PriceList_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceListItem" ADD CONSTRAINT "PriceListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSeries" ADD CONSTRAINT "DocumentSeries_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationLine" ADD CONSTRAINT "QuotationLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "Quotation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmNote" ADD CONSTRAINT "CrmNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingAttendee" ADD CONSTRAINT "MeetingAttendee_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingReminderLog" ADD CONSTRAINT "MeetingReminderLog_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeOff" ADD CONSTRAINT "TimeOff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureForm" ADD CONSTRAINT "CaptureForm_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSubmission" ADD CONSTRAINT "CaptureSubmission_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSubmission" ADD CONSTRAINT "CaptureSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "CaptureForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------- hand-written part (change #19 wave B)

-- Deals board order: fractional indexes compare in byte order, like "Lead"."position" (migration 20261101120000).
ALTER TABLE "Deal" ALTER COLUMN "position" SET DATA TYPE TEXT COLLATE "C";

-- Owners and links from the linked leads (the oldest lead with an owner wins). Deal pipeline and stage are
-- backfilled by the API on first use (the default deal pipeline is created per workspace then).
UPDATE "Contact" c SET "ownerId" = l."ownerId"
FROM (
  SELECT DISTINCT ON ("contactId") "contactId", "ownerId" FROM "Lead"
  WHERE "contactId" IS NOT NULL AND "ownerId" IS NOT NULL AND "deletedAt" IS NULL
  ORDER BY "contactId", "createdAt"
) l
WHERE c."id" = l."contactId" AND c."ownerId" IS NULL;

UPDATE "Company" a SET "ownerId" = l."ownerId"
FROM (
  SELECT DISTINCT ON ("companyId") "companyId", "ownerId" FROM "Lead"
  WHERE "companyId" IS NOT NULL AND "ownerId" IS NOT NULL AND "deletedAt" IS NULL
  ORDER BY "companyId", "createdAt"
) l
WHERE a."id" = l."companyId" AND a."ownerId" IS NULL;

UPDATE "Deal" d SET
  "ownerId" = COALESCE(d."ownerId", l."ownerId"),
  "contactId" = COALESCE(d."contactId", l."contactId"),
  "companyId" = COALESCE(d."companyId", l."companyId")
FROM "Lead" l
WHERE d."leadId" = l."id" AND d."workspaceId" = l."workspaceId";

-- New permissions for the SYSTEM roles of existing workspaces (DEFAULT_ROLE_PERMISSIONS in rbac.ts; custom roles unchanged).
UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY[
  'contacts.read', 'contacts.create', 'contacts.update', 'contacts.delete', 'contacts.merge',
  'accounts.read', 'accounts.create', 'accounts.update', 'accounts.delete', 'accounts.merge',
  'deals.read', 'deals.create', 'deals.update', 'deals.delete',
  'products.read', 'products.manage',
  'quotations.read', 'quotations.create', 'quotations.update', 'quotations.send', 'quotations.delete',
  'invoices.read', 'invoices.create', 'invoices.update', 'invoices.issue', 'invoices.cancel', 'invoices.payments', 'invoices.delete',
  'calendar.read', 'calendar.create', 'calendar.update', 'calendar.delete',
  'routing.manage', 'capture_forms.manage'
]::TEXT[]))
WHERE "isSystem" = true AND "kind" = 'company_admin';

UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY[
  'contacts.read', 'contacts.create', 'contacts.update', 'contacts.merge',
  'accounts.read', 'accounts.create', 'accounts.update', 'accounts.merge',
  'deals.read', 'deals.create', 'deals.update',
  'products.read',
  'quotations.read', 'quotations.create', 'quotations.update', 'quotations.send',
  'invoices.read', 'invoices.create', 'invoices.update', 'invoices.issue', 'invoices.payments',
  'calendar.read', 'calendar.create', 'calendar.update', 'calendar.delete'
]::TEXT[]))
WHERE "isSystem" = true AND "kind" = 'manager';

UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY[
  'contacts.read', 'contacts.create', 'contacts.update',
  'accounts.read', 'accounts.create', 'accounts.update',
  'deals.read', 'deals.create', 'deals.update',
  'products.read',
  'quotations.read', 'quotations.create', 'quotations.update', 'quotations.send',
  'invoices.read',
  'calendar.read', 'calendar.create', 'calendar.update', 'calendar.delete'
]::TEXT[]))
WHERE "isSystem" = true AND "kind" = 'employee';

UPDATE "Role" SET "permissions" = ARRAY(SELECT DISTINCT unnest("permissions" || ARRAY[
  'contacts.read', 'accounts.read', 'deals.read', 'products.read', 'quotations.read', 'invoices.read', 'calendar.read'
]::TEXT[]))
WHERE "isSystem" = true AND "kind" = 'viewer';
