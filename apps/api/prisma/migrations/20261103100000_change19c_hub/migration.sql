-- change #19 wave C: hub (integration hub, inbound and outbound webhooks, API keys). D-069, D-070.
-- Owner: HUB-API (backend-core). New enum values are not used inside this migration (ALTER TYPE ... ADD VALUE).

-- AlterEnum: rename keeps existing rows and the column default (enum constants are stored by OID)
ALTER TYPE "IntegrationStatus" RENAME VALUE 'disconnected' TO 'not_connected';
ALTER TYPE "IntegrationStatus" ADD VALUE 'needs_attention';

-- AlterEnum
ALTER TYPE "InboundWebhookAction" ADD VALUE 'update_lead';

-- CreateEnum
CREATE TYPE "IntegrationMode" AS ENUM ('live', 'mock');

-- CreateEnum
CREATE TYPE "WebhookVerification" AS ENUM ('hmac', 'token');

-- AlterTable
ALTER TABLE "Integration" ADD COLUMN     "attention" TEXT,
ADD COLUMN     "connectedById" UUID,
ADD COLUMN     "inboundTokensEncrypted" TEXT,
ADD COLUMN     "lastSyncAt" TIMESTAMP(3),
ADD COLUMN     "mode" "IntegrationMode" NOT NULL DEFAULT 'live',
ADD COLUMN     "nextSyncAt" TIMESTAMP(3),
ADD COLUMN     "secretHints" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "stats" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "syncLockedUntil" TIMESTAMP(3),
ADD COLUMN     "syncState" JSONB NOT NULL DEFAULT '{}',
ALTER COLUMN "status" SET DEFAULT 'not_connected';

-- AlterTable
ALTER TABLE "WebhookEndpoint" ADD COLUMN     "captureUntil" TIMESTAMP(3),
ADD COLUMN     "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createIfMissing" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "createdById" UUID,
ADD COLUMN     "deadStreak" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledReason" TEXT,
ADD COLUMN     "lastDeliveryAt" TIMESTAMP(3),
ADD COLUMN     "lastFailureAt" TIMESTAMP(3),
ADD COLUMN     "lastSuccessAt" TIMESTAMP(3),
ADD COLUMN     "matchBy" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "previousSecretEncrypted" TEXT,
ADD COLUMN     "previousSecretExpiresAt" TIMESTAMP(3),
ADD COLUMN     "sampleCapturedAt" TIMESTAMP(3),
ADD COLUMN     "samplePayload" JSONB,
ADD COLUMN     "secretRotatedAt" TIMESTAMP(3),
ADD COLUMN     "verification" "WebhookVerification";

-- AlterTable
ALTER TABLE "WebhookDelivery" ADD COLUMN     "attempts" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "bodyHash" TEXT,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "result" JSONB,
ADD COLUMN     "signatureValid" BOOLEAN;

-- AlterTable
ALTER TABLE "ApiKey" ADD COLUMN     "lastUsedIp" TEXT,
ADD COLUMN     "previousKeyExpiresAt" TIMESTAMP(3),
ADD COLUMN     "previousKeyHash" TEXT,
ADD COLUMN     "rateLimitPerMinute" INTEGER,
ADD COLUMN     "rotatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Integration_provider_nextSyncAt_idx" ON "Integration"("provider", "nextSyncAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_dedupeKey_key" ON "WebhookDelivery"("endpointId", "dedupeKey");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_previousKeyHash_key" ON "ApiKey"("previousKeyHash");

-- Backfill: existing inbound sources verify with HMAC and match by phone, then e-mail.
UPDATE "WebhookEndpoint" SET "verification" = 'hmac', "matchBy" = ARRAY['phone', 'email']::TEXT[]
WHERE "direction" = 'inbound' AND "verification" IS NULL;

-- Backfill: attempt timeline for existing deliveries (one entry with the last result).
UPDATE "WebhookDelivery" SET "attempts" = jsonb_build_array(jsonb_build_object(
  'attempt', GREATEST("attempt", 1),
  'at', to_char("updatedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'ok', "status" = 'success',
  'responseStatus', "responseStatus",
  'latencyMs', "latencyMs",
  'error', "error"
))
WHERE "attempts" = '[]'::jsonb AND "attempt" > 0;

-- Permissions (CHANGE_19C_PERMISSIONS): read routes need integrations.read / webhooks.read. System admin and manager
-- roles get them, and so does every role that already holds the matching .manage permission.
UPDATE "Role" SET "permissions" = array_append("permissions", 'integrations.read')
WHERE NOT ('integrations.read' = ANY("permissions"))
  AND (("isSystem" AND "kind" IN ('company_admin', 'manager')) OR 'integrations.manage' = ANY("permissions"));

UPDATE "Role" SET "permissions" = array_append("permissions", 'webhooks.read')
WHERE NOT ('webhooks.read' = ANY("permissions"))
  AND (("isSystem" AND "kind" IN ('company_admin', 'manager')) OR 'webhooks.manage' = ANY("permissions"));
