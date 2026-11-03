-- Change #20 (SPEC 30, D-073, D-074): config registry (PlatformSetting rows, no table), e-mail templates,
-- WhatsApp templates synced with Meta, password reset and e-mail verification links.

-- CreateEnum
CREATE TYPE "UserTokenKind" AS ENUM ('password_reset', 'email_verify');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

-- Accounts created before e-mail verification existed count as verified (no nagging banner for them).
UPDATE "User" SET "emailVerifiedAt" = "createdAt" WHERE "emailVerifiedAt" IS NULL;

-- AlterTable
ALTER TABLE "Template" ADD COLUMN "headerFormat" TEXT NOT NULL DEFAULT 'none',
ADD COLUMN "headerExample" TEXT,
ADD COLUMN "bodyExamples" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "buttons" JSONB,
ADD COLUMN "rejectionReason" TEXT,
ADD COLUMN "submittedAt" TIMESTAMP(3),
ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN "mode" "IntegrationMode",
ADD COLUMN "createdById" UUID;

-- Templates that already had a header text are text headers.
UPDATE "Template" SET "headerFormat" = 'text' WHERE "header" IS NOT NULL AND "header" <> '';

-- AlterTable (change #20: prod, for PROD-HUB's Google Calendar sync)
ALTER TABLE "Meeting" ADD COLUMN "externalProvider" TEXT,
ADD COLUMN "externalCalendarId" TEXT,
ADD COLUMN "externalEventId" TEXT,
ADD COLUMN "externalEtag" TEXT,
ADD COLUMN "externalSyncedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Meeting_workspaceId_externalProvider_externalEventId_key" ON "Meeting"("workspaceId", "externalProvider", "externalEventId");

-- CreateTable
CREATE TABLE "UserToken" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "UserTokenKind" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformEmailTemplate" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformEmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserToken_tokenHash_key" ON "UserToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UserToken_userId_kind_createdAt_idx" ON "UserToken"("userId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "UserToken_expiresAt_idx" ON "UserToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_workspaceId_key_key" ON "EmailTemplate"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformEmailTemplate_key_key" ON "PlatformEmailTemplate"("key");

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserToken" ADD CONSTRAINT "UserToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
