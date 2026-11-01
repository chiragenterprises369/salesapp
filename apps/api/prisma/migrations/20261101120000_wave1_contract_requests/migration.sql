-- Wave 1 contract requests: trigram search, byte-order positions, saved view mode.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Fractional-index positions must compare byte by byte on every Postgres build (glibc/ICU/RDS).
ALTER TABLE "Lead" ALTER COLUMN "position" TYPE TEXT COLLATE "C";

-- AlterTable
ALTER TABLE "SavedView" ADD COLUMN     "viewMode" TEXT;

-- CreateIndex
CREATE INDEX "Lead_name_trgm_idx" ON "Lead" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Lead_companyName_trgm_idx" ON "Lead" USING GIN ("companyName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Lead_email_trgm_idx" ON "Lead" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Lead_phone_trgm_idx" ON "Lead" USING GIN ("phone" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Lead_requirement_trgm_idx" ON "Lead" USING GIN ("requirement" gin_trgm_ops);
