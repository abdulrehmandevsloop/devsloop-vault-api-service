-- Performance indexes migration
-- This migration was recreated after the migration file was lost.
-- The indexes below may already exist; they are created with IF NOT EXISTS to be safe.

CREATE INDEX IF NOT EXISTS "worklogs_user_id_idx" ON "worklogs"("userId");
CREATE INDEX IF NOT EXISTS "worklogs_project_id_idx" ON "worklogs"("projectId");
CREATE INDEX IF NOT EXISTS "worklogs_date_idx" ON "worklogs"("date");
CREATE INDEX IF NOT EXISTS "worklogs_user_id_date_idx" ON "worklogs"("userId", "date");
CREATE INDEX IF NOT EXISTS "worklogs_project_id_date_idx" ON "worklogs"("projectId", "date");
