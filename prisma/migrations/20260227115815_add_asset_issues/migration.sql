-- CreateEnum
CREATE TYPE "AssetIssueType" AS ENUM ('HARDWARE', 'SOFTWARE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetIssuePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "AssetIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED');

-- CreateTable
CREATE TABLE "asset_issues" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "reportedById" TEXT NOT NULL,
    "issueType" "AssetIssueType" NOT NULL,
    "description" TEXT NOT NULL,
    "priority" "AssetIssuePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "AssetIssueStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asset_issues_assetId_idx" ON "asset_issues"("assetId");

-- CreateIndex
CREATE INDEX "asset_issues_reportedById_idx" ON "asset_issues"("reportedById");

-- CreateIndex
CREATE INDEX "asset_issues_status_idx" ON "asset_issues"("status");

-- AddForeignKey
ALTER TABLE "asset_issues" ADD CONSTRAINT "asset_issues_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_issues" ADD CONSTRAINT "asset_issues_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
