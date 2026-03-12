-- DropIndex: one log per user per calendar day per project (was: per user per day only)
DROP INDEX IF EXISTS "worklogs_userId_date_key";

-- CreateIndex
CREATE UNIQUE INDEX "worklogs_userId_date_projectId_key" ON "worklogs"("userId", "date", "projectId");
