-- DropIndex
DROP INDEX "Target_workspaceId_userId_teamId_metric_period_key";

-- AlterTable
ALTER TABLE "PlatformAdmin" ADD COLUMN     "totpLastStep" INTEGER;

-- AlterTable
ALTER TABLE "Target" ADD COLUMN     "subjectKey" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Target_workspaceId_subjectKey_metric_period_key" ON "Target"("workspaceId", "subjectKey", "metric", "period");
