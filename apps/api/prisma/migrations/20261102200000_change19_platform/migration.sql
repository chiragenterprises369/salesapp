-- Change #19 wave A (SPEC 29, D-056..D-066), PLATFORM stream. One migration for the wave.
-- Storage (File purpose/visibility/driver/sha256, PlatformFile), branding and component style (Setting rows, no DDL),
-- custom domains, platform settings (Firebase, encrypted), Android releases, devices, presence + history,
-- SIM call fields on Call, attendance sessions, location pings, tracking consent, floor requests and floor assets,
-- User.isFieldStaff, feature flags custom_domain and field_tracking on the plans.
-- CreateEnum
CREATE TYPE "PresenceStatus" AS ENUM ('available', 'on_call', 'in_meeting', 'on_break', 'lunch', 'field_visit', 'away', 'offline');

-- CreateEnum
CREATE TYPE "PresenceSource" AS ENUM ('session', 'heartbeat', 'manual', 'phone_state', 'call_log', 'telephony', 'attendance', 'working_hours', 'timeout', 'system');

-- CreateEnum
CREATE TYPE "CallSource" AS ENUM ('sim', 'voip', 'mock');

-- CreateEnum
CREATE TYPE "CallResult" AS ENUM ('connected', 'missed', 'no_answer', 'busy', 'rejected', 'failed');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('logo', 'favicon', 'login_image', 'reference_image', 'floor_model', 'apk', 'call_recording', 'attachment');

-- CreateEnum
CREATE TYPE "FileVisibility" AS ENUM ('private', 'public');

-- CreateEnum
CREATE TYPE "CustomDomainStatus" AS ENUM ('pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "FloorRequestStatus" AS ENUM ('submitted', 'in_progress', 'published', 'rejected');

-- CreateEnum
CREATE TYPE "FloorImageCategory" AS ENUM ('work_area', 'cabin', 'meeting_room', 'reception', 'pantry_lounge', 'floor_plan', 'other');

-- CreateEnum
CREATE TYPE "FloorAssetStatus" AS ENUM ('draft', 'published', 'superseded');

-- CreateEnum
CREATE TYPE "FloorModelFormat" AS ENUM ('glb', 'gltf_zip', 'layout_json');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('android', 'web');

-- AlterTable
ALTER TABLE "Call" ADD COLUMN     "clientCallId" TEXT,
ADD COLUMN     "deviceCallId" TEXT,
ADD COLUMN     "deviceId" UUID,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "recordingFileId" UUID,
ADD COLUMN     "result" "CallResult",
ADD COLUMN     "source" "CallSource" NOT NULL DEFAULT 'voip';

-- AlterTable
ALTER TABLE "File" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "driver" TEXT NOT NULL DEFAULT 's3',
ADD COLUMN     "purpose" "FilePurpose" NOT NULL DEFAULT 'attachment',
ADD COLUMN     "sha256" TEXT,
ADD COLUMN     "uploadedByAdminId" UUID,
ADD COLUMN     "visibility" "FileVisibility" NOT NULL DEFAULT 'private';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isFieldStaff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "installationId" TEXT NOT NULL,
    "fcmToken" TEXT,
    "appVersion" TEXT NOT NULL,
    "appBuild" INTEGER,
    "model" TEXT,
    "osVersion" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenInvalidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Presence" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "PresenceStatus" NOT NULL DEFAULT 'offline',
    "source" "PresenceSource" NOT NULL DEFAULT 'system',
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "manualStatus" "PresenceStatus",
    "manualNote" TEXT,
    "manualSetAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "client" TEXT,
    "clientActivity" TEXT,
    "callId" UUID,
    "callStartedAt" TIMESTAMP(3),
    "leadId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Presence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PresenceEvent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "PresenceStatus" NOT NULL,
    "previousStatus" "PresenceStatus",
    "source" "PresenceSource" NOT NULL,
    "callId" UUID,
    "meta" JSONB,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PresenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceSession" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkInLat" DOUBLE PRECISION NOT NULL,
    "checkInLng" DOUBLE PRECISION NOT NULL,
    "checkInAccuracy" DOUBLE PRECISION,
    "checkOutAt" TIMESTAMP(3),
    "checkOutLat" DOUBLE PRECISION,
    "checkOutLng" DOUBLE PRECISION,
    "checkOutAccuracy" DOUBLE PRECISION,
    "checkOutReason" TEXT,
    "deviceId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationPing" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "speed" DOUBLE PRECISION,
    "heading" DOUBLE PRECISION,
    "battery" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackingConsent" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "accepted" BOOLEAN NOT NULL,
    "deviceId" UUID,
    "ip" TEXT,
    "userAgent" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackingConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomDomain" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "CustomDomainStatus" NOT NULL DEFAULT 'pending',
    "txtToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomDomain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorRequest" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "status" "FloorRequestStatus" NOT NULL DEFAULT 'submitted',
    "headcount" INTEGER NOT NULL,
    "notes" TEXT,
    "statusNote" TEXT,
    "createdById" UUID,
    "handledByAdminId" UUID,
    "publishedFloorId" UUID,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorRequestImage" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "fileId" UUID NOT NULL,
    "category" "FloorImageCategory" NOT NULL,
    "caption" TEXT,
    "order" INTEGER NOT NULL,

    CONSTRAINT "FloorRequestImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FloorAsset" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "requestId" UUID,
    "version" INTEGER NOT NULL,
    "status" "FloorAssetStatus" NOT NULL DEFAULT 'draft',
    "format" "FloorModelFormat" NOT NULL,
    "modelFileId" UUID NOT NULL,
    "seatMap" JSONB,
    "notes" TEXT,
    "uploadedByAdminId" UUID,
    "publishedAt" TIMESTAMP(3),
    "publishedByAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FloorAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformFile" (
    "id" UUID NOT NULL,
    "purpose" "FilePurpose" NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "driver" TEXT NOT NULL DEFAULT 'local',
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformSetting" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB,
    "secretEncrypted" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AndroidRelease" (
    "id" UUID NOT NULL,
    "versionName" TEXT NOT NULL,
    "versionCode" INTEGER NOT NULL,
    "notes" TEXT,
    "fileId" UUID NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "minSupported" BOOLEAN NOT NULL DEFAULT false,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AndroidRelease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Device_fcmToken_key" ON "Device"("fcmToken");

-- CreateIndex
CREATE INDEX "Device_workspaceId_userId_idx" ON "Device"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_workspaceId_userId_installationId_key" ON "Device"("workspaceId", "userId", "installationId");

-- CreateIndex
CREATE UNIQUE INDEX "Presence_userId_key" ON "Presence"("userId");

-- CreateIndex
CREATE INDEX "Presence_workspaceId_status_idx" ON "Presence"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "PresenceEvent_workspaceId_userId_at_idx" ON "PresenceEvent"("workspaceId", "userId", "at");

-- CreateIndex
CREATE INDEX "PresenceEvent_workspaceId_at_idx" ON "PresenceEvent"("workspaceId", "at");

-- CreateIndex
CREATE INDEX "AttendanceSession_workspaceId_date_idx" ON "AttendanceSession"("workspaceId", "date");

-- CreateIndex
CREATE INDEX "AttendanceSession_workspaceId_userId_checkInAt_idx" ON "AttendanceSession"("workspaceId", "userId", "checkInAt");

-- CreateIndex
CREATE INDEX "LocationPing_workspaceId_sessionId_at_idx" ON "LocationPing"("workspaceId", "sessionId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "LocationPing_workspaceId_userId_at_key" ON "LocationPing"("workspaceId", "userId", "at");

-- CreateIndex
CREATE INDEX "TrackingConsent_workspaceId_userId_at_idx" ON "TrackingConsent"("workspaceId", "userId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "CustomDomain_workspaceId_key" ON "CustomDomain"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomDomain_hostname_key" ON "CustomDomain"("hostname");

-- CreateIndex
CREATE INDEX "FloorRequest_workspaceId_submittedAt_idx" ON "FloorRequest"("workspaceId", "submittedAt");

-- CreateIndex
CREATE INDEX "FloorRequest_status_submittedAt_idx" ON "FloorRequest"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "FloorRequestImage_workspaceId_requestId_idx" ON "FloorRequestImage"("workspaceId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "FloorRequestImage_requestId_fileId_key" ON "FloorRequestImage"("requestId", "fileId");

-- CreateIndex
CREATE INDEX "FloorAsset_workspaceId_status_idx" ON "FloorAsset"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FloorAsset_workspaceId_version_key" ON "FloorAsset"("workspaceId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformSetting_key_key" ON "PlatformSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "AndroidRelease_versionCode_key" ON "AndroidRelease"("versionCode");

-- CreateIndex
CREATE UNIQUE INDEX "AndroidRelease_fileId_key" ON "AndroidRelease"("fileId");

-- CreateIndex
CREATE INDEX "AndroidRelease_createdAt_idx" ON "AndroidRelease"("createdAt");

-- CreateIndex
CREATE INDEX "Call_workspaceId_phone_idx" ON "Call"("workspaceId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "Call_workspaceId_userId_deviceCallId_key" ON "Call"("workspaceId", "userId", "deviceCallId");

-- CreateIndex
CREATE UNIQUE INDEX "Call_workspaceId_userId_clientCallId_key" ON "Call"("workspaceId", "userId", "clientCallId");

-- CreateIndex
CREATE INDEX "File_workspaceId_purpose_idx" ON "File"("workspaceId", "purpose");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Presence" ADD CONSTRAINT "Presence_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceEvent" ADD CONSTRAINT "PresenceEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PresenceEvent" ADD CONSTRAINT "PresenceEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceSession" ADD CONSTRAINT "AttendanceSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPing" ADD CONSTRAINT "LocationPing_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AttendanceSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingConsent" ADD CONSTRAINT "TrackingConsent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrackingConsent" ADD CONSTRAINT "TrackingConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomDomain" ADD CONSTRAINT "CustomDomain_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorRequest" ADD CONSTRAINT "FloorRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorRequestImage" ADD CONSTRAINT "FloorRequestImage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorRequestImage" ADD CONSTRAINT "FloorRequestImage_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FloorRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FloorAsset" ADD CONSTRAINT "FloorAsset_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AndroidRelease" ADD CONSTRAINT "AndroidRelease_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "PlatformFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------- data backfill
-- Existing calls: the mock adapter and the simulator wrote provider 'mock'.
UPDATE "Call" SET "source" = 'mock' WHERE "provider" = 'mock';
-- Counterpart number for lead matching (E.164 only).
UPDATE "Call" SET "phone" = CASE WHEN "direction" = 'outbound' THEN "toNumber" ELSE "fromNumber" END
WHERE "phone" IS NULL AND (CASE WHEN "direction" = 'outbound' THEN "toNumber" ELSE "fromNumber" END) ~ '^\+[1-9][0-9]{6,14}$';
-- Technical result from the old status.
UPDATE "Call" SET "result" = CASE
    WHEN "status" = 'completed' THEN 'connected'::"CallResult"
    WHEN "status" = 'missed' AND "direction" = 'inbound' THEN 'missed'::"CallResult"
    WHEN "status" = 'missed' THEN 'no_answer'::"CallResult"
    WHEN "status" = 'failed' THEN 'failed'::"CallResult"
    ELSE NULL END
WHERE "result" IS NULL;
-- New feature flags on the plan catalogue: custom_domain off everywhere (Super Admin switch per company),
-- field_tracking on for growth and enterprise.
UPDATE "PlanDefinition" SET "features" = "features" || jsonb_build_object('custom_domain', false, 'field_tracking', "key" IN ('growth', 'enterprise'));