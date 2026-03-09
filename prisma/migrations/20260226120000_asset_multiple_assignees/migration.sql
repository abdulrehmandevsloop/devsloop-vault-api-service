-- Ensure gen_random_uuid() is available (PostgreSQL 13+ has it in core; older versions need pgcrypto)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "asset_assignments" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignmentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedById" TEXT,
    "returnedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);

-- Migrate existing single assignee to asset_assignments
INSERT INTO "asset_assignments" ("id", "assetId", "userId", "assignmentDate", "returnedAt", "createdAt")
SELECT gen_random_uuid()::text, "id", "assignedEmployeeId", COALESCE("updatedAt", CURRENT_TIMESTAMP), NULL, CURRENT_TIMESTAMP
FROM "assets"
WHERE "assignedEmployeeId" IS NOT NULL;

-- CreateIndex
CREATE INDEX "asset_assignments_assetId_idx" ON "asset_assignments"("assetId");

-- CreateIndex
CREATE INDEX "asset_assignments_userId_idx" ON "asset_assignments"("userId");

-- CreateIndex
CREATE INDEX "asset_assignments_assetId_userId_idx" ON "asset_assignments"("assetId", "userId");

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_assignedEmployeeId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "assets_assignedEmployeeId_idx";

-- AlterTable
ALTER TABLE "assets" DROP COLUMN "assignedEmployeeId";
