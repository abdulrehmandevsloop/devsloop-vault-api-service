-- CreateEnum
CREATE TYPE "ProjectStakeholderRole" AS ENUM ('MANAGER', 'LEAD', 'OBSERVER');

-- CreateTable: unified project_stakeholders replaces project_managers + project_leads
CREATE TABLE "project_stakeholders" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ProjectStakeholderRole" NOT NULL,

    CONSTRAINT "project_stakeholders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_stakeholders_projectId_idx" ON "project_stakeholders"("projectId");

-- CreateIndex
CREATE INDEX "project_stakeholders_userId_idx" ON "project_stakeholders"("userId");

-- CreateIndex
CREATE INDEX "project_stakeholders_projectId_role_idx" ON "project_stakeholders"("projectId", "role");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "project_stakeholders_projectId_userId_role_key" ON "project_stakeholders"("projectId", "userId", "role");

-- AddForeignKey
ALTER TABLE "project_stakeholders" ADD CONSTRAINT "project_stakeholders_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_stakeholders" ADD CONSTRAINT "project_stakeholders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Migrate existing data: copy all manager rows
INSERT INTO "project_stakeholders" ("id", "projectId", "userId", "role")
SELECT "id", "projectId", "userId", 'MANAGER'::"ProjectStakeholderRole"
FROM "project_managers";

-- Migrate existing data: copy all lead rows
-- Use a new cuid-style id by appending '_lead' suffix to avoid collisions
INSERT INTO "project_stakeholders" ("id", "projectId", "userId", "role")
SELECT "id" || '_lead', "projectId", "userId", 'LEAD'::"ProjectStakeholderRole"
FROM "project_leads";

-- DropForeignKey
ALTER TABLE "project_managers" DROP CONSTRAINT "project_managers_projectId_fkey";
ALTER TABLE "project_managers" DROP CONSTRAINT "project_managers_userId_fkey";

-- DropForeignKey
ALTER TABLE "project_leads" DROP CONSTRAINT "project_leads_projectId_fkey";
ALTER TABLE "project_leads" DROP CONSTRAINT "project_leads_userId_fkey";

-- DropTable
DROP TABLE "project_managers";

-- DropTable
DROP TABLE "project_leads";
