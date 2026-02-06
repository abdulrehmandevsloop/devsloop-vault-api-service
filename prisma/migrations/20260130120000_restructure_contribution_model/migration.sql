-- Migration: Restructure Contribution model
-- Changes:
-- 1. Rename ContributionStatus enum value PENDING -> SUBMITTED
-- 2. Rename and restructure Contribution fields

-- Step 1: Update enum value from PENDING to SUBMITTED
ALTER TYPE "ContributionStatus" RENAME VALUE 'PENDING' TO 'SUBMITTED';

-- Step 2: Add new required columns with temporary defaults
ALTER TABLE "contributions" ADD COLUMN "problem" TEXT;
ALTER TABLE "contributions" ADD COLUMN "solution" TEXT;

-- Step 3: Migrate data from old columns to new columns
-- Map task -> problem, action -> solution
UPDATE "contributions" SET 
  "problem" = COALESCE("task", 'Migrated contribution - problem not specified'),
  "solution" = COALESCE("action", 'Migrated contribution - solution not specified');

-- Step 4: Make new columns NOT NULL after data migration
ALTER TABLE "contributions" ALTER COLUMN "problem" SET NOT NULL;
ALTER TABLE "contributions" ALTER COLUMN "solution" SET NOT NULL;

-- Step 5: Rename existing columns
ALTER TABLE "contributions" RENAME COLUMN "userId" TO "authorId";
ALTER TABLE "contributions" RENAME COLUMN "keyLearnings" TO "learnings";
ALTER TABLE "contributions" RENAME COLUMN "toolsTechnologies" TO "toolsAndTechnologies";
ALTER TABLE "contributions" RENAME COLUMN "visibilityLevel" TO "visibility";
ALTER TABLE "contributions" RENAME COLUMN "reviewComments" TO "reviewerComment";

-- Step 6: Drop old columns
ALTER TABLE "contributions" DROP COLUMN "roleInProject";
ALTER TABLE "contributions" DROP COLUMN "task";
ALTER TABLE "contributions" DROP COLUMN "action";
ALTER TABLE "contributions" DROP COLUMN "attachments";
ALTER TABLE "contributions" DROP COLUMN "submittedAt";
ALTER TABLE "contributions" DROP COLUMN "reviewedAt";

-- Step 7: Update indexes
-- Drop old indexes
DROP INDEX IF EXISTS "contributions_userId_idx";
DROP INDEX IF EXISTS "contributions_visibilityLevel_idx";
DROP INDEX IF EXISTS "contributions_submittedAt_idx";
DROP INDEX IF EXISTS "contributions_userId_status_idx";

-- Create new indexes
CREATE INDEX "contributions_authorId_idx" ON "contributions"("authorId");
CREATE INDEX "contributions_visibility_idx" ON "contributions"("visibility");
CREATE INDEX "contributions_authorId_status_idx" ON "contributions"("authorId", "status");
