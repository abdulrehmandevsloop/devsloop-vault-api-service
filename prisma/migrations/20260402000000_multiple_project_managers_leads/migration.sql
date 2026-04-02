-- CreateTable: project_managers (multiple project managers per project)
CREATE TABLE "project_managers" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "project_managers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: project_leads (multiple project leads per project)
CREATE TABLE "project_leads" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "project_leads_pkey" PRIMARY KEY ("id")
);

-- Migrate existing single-manager data into the new join table
INSERT INTO "project_managers" ("id", "projectId", "userId")
SELECT gen_random_uuid()::text, "id", "projectManagerId"
FROM "projects"
WHERE "projectManagerId" IS NOT NULL;

-- Migrate existing single-lead data into the new join table
INSERT INTO "project_leads" ("id", "projectId", "userId")
SELECT gen_random_uuid()::text, "id", "projectLeadId"
FROM "projects"
WHERE "projectLeadId" IS NOT NULL;

-- CreateUniqueIndex
CREATE UNIQUE INDEX "project_managers_projectId_userId_key" ON "project_managers"("projectId", "userId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "project_leads_projectId_userId_key" ON "project_leads"("projectId", "userId");

-- CreateIndex
CREATE INDEX "project_managers_projectId_idx" ON "project_managers"("projectId");

-- CreateIndex
CREATE INDEX "project_managers_userId_idx" ON "project_managers"("userId");

-- CreateIndex
CREATE INDEX "project_leads_projectId_idx" ON "project_leads"("projectId");

-- CreateIndex
CREATE INDEX "project_leads_userId_idx" ON "project_leads"("userId");

-- AddForeignKey
ALTER TABLE "project_managers" ADD CONSTRAINT "project_managers_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_managers" ADD CONSTRAINT "project_managers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_leads" ADD CONSTRAINT "project_leads_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_leads" ADD CONSTRAINT "project_leads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey (old single-manager/lead relations)
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_projectManagerId_fkey";
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_projectLeadId_fkey";

-- DropColumn
ALTER TABLE "projects" DROP COLUMN IF EXISTS "projectManagerId";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "projectLeadId";
