-- Drop index on hasAccess if it exists (may have been created manually)
DROP INDEX IF EXISTS "users_hasAccess_idx";

-- Remove hasAccess column from users table
ALTER TABLE "users" DROP COLUMN IF EXISTS "hasAccess";
