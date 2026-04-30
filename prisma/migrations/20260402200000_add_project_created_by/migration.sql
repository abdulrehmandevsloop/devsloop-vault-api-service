-- AlterTable: add createdById to projects
ALTER TABLE "projects" ADD COLUMN "createdById" TEXT;

-- CreateIndex
CREATE INDEX "projects_createdById_idx" ON "projects"("createdById");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: set createdById = first project manager for existing projects
UPDATE "projects" p
SET "createdById" = pm."userId"
FROM "project_managers" pm
WHERE pm."projectId" = p.id
  AND p."createdById" IS NULL;
