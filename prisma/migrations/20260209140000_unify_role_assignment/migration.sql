-- ============================================
-- Unify Role Assignment: Remove User.roleId, use UserRoleAssignment as single source of truth
-- ============================================

-- Step 1: Add isPrimary column to user_roles (UserRoleAssignment)
ALTER TABLE "user_roles" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- Step 2: Migrate existing User.roleId into UserRoleAssignment as isPrimary=true
-- Only insert where there isn't already an assignment for the same user+role combo
INSERT INTO "user_roles" ("id", "userId", "roleId", "isPrimary", "assignedAt", "assignedBy")
SELECT
  gen_random_uuid()::text,
  u."id",
  u."roleId",
  true,
  NOW(),
  NULL
FROM "users" u
WHERE u."roleId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user_roles" ur
    WHERE ur."userId" = u."id" AND ur."roleId" = u."roleId"
  );

-- Step 3: For users who already had a matching UserRoleAssignment, mark it as primary
UPDATE "user_roles" ur
SET "isPrimary" = true
FROM "users" u
WHERE ur."userId" = u."id"
  AND ur."roleId" = u."roleId"
  AND u."roleId" IS NOT NULL
  AND ur."isPrimary" = false;

-- Step 4: Drop the foreign key constraint on users.roleId
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_roleId_fkey";

-- Step 5: Drop the index on users.roleId
DROP INDEX IF EXISTS "users_roleId_idx";

-- Step 6: Drop the roleId column from users table
ALTER TABLE "users" DROP COLUMN "roleId";

-- Step 7: Add composite index for fast primary role lookup
CREATE INDEX "user_roles_userId_isPrimary_idx" ON "user_roles"("userId", "isPrimary");
