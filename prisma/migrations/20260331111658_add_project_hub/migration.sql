-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('DISCOVERY', 'IN_DEVELOPMENT', 'UAT', 'LIVE');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClientSignOff" AS ENUM ('PENDING', 'YES', 'NO');

-- CreateEnum
CREATE TYPE "SprintStatus" AS ENUM ('PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EncryptionLevel" AS ENUM ('NONE', 'BASIC', 'ADVANCED');

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "clientContactEmail" VARCHAR(320),
ADD COLUMN     "clientContactName" VARCHAR(255),
ADD COLUMN     "deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "documentationUrl" VARCHAR(2048),
ADD COLUMN     "executiveSummary" TEXT,
ADD COLUMN     "figmaUrl" VARCHAR(2048),
ADD COLUMN     "githubUrl" VARCHAR(2048),
ADD COLUMN     "liveUrl" VARCHAR(2048),
ADD COLUMN     "problemStatement" TEXT,
ADD COLUMN     "projectLeadId" TEXT,
ADD COLUMN     "projectManagerId" TEXT,
ADD COLUMN     "securityProtocols" JSONB,
ADD COLUMN     "stagingUrl" VARCHAR(2048),
ADD COLUMN     "status" "ProjectStatus" NOT NULL DEFAULT 'DISCOVERY';

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "clientSignOff" "ClientSignOff" NOT NULL DEFAULT 'PENDING',
    "deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sprints" (
    "id" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "SprintStatus" NOT NULL DEFAULT 'PLANNED',
    "deliverables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sprints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "milestones_projectId_idx" ON "milestones"("projectId");

-- CreateIndex
CREATE INDEX "milestones_projectId_status_idx" ON "milestones"("projectId", "status");

-- CreateIndex
CREATE INDEX "sprints_milestoneId_idx" ON "sprints"("milestoneId");

-- CreateIndex
CREATE INDEX "projects_status_idx" ON "projects"("status");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_projectManagerId_fkey" FOREIGN KEY ("projectManagerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_projectLeadId_fkey" FOREIGN KEY ("projectLeadId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sprints" ADD CONSTRAINT "sprints_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
