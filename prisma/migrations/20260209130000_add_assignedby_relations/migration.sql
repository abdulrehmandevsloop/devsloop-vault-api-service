-- ============================================
-- Convert assignedBy/grantedBy from raw strings to FK relations
-- Adds foreign key constraints with ON DELETE SET NULL
-- ============================================

-- Step 1: Clean up any orphaned/invalid assignedBy/grantedBy values
-- Set to NULL where the value doesn't reference an existing user id
UPDATE "user_projects"
  SET "assignedBy" = NULL
  WHERE "assignedBy" IS NOT NULL
    AND "assignedBy" NOT IN (SELECT "id" FROM "users");

UPDATE "user_roles"
  SET "assignedBy" = NULL
  WHERE "assignedBy" IS NOT NULL
    AND "assignedBy" NOT IN (SELECT "id" FROM "users");

UPDATE "acl_entries"
  SET "grantedBy" = NULL
  WHERE "grantedBy" IS NOT NULL
    AND "grantedBy" NOT IN (SELECT "id" FROM "users");

-- Step 2: Add foreign key constraints
ALTER TABLE "user_projects"
  ADD CONSTRAINT "user_projects_assignedBy_fkey"
  FOREIGN KEY ("assignedBy") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_assignedBy_fkey"
  FOREIGN KEY ("assignedBy") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "acl_entries"
  ADD CONSTRAINT "acl_entries_grantedBy_fkey"
  FOREIGN KEY ("grantedBy") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 3: Add indexes on FK columns for join performance
CREATE INDEX "user_projects_assignedBy_idx" ON "user_projects"("assignedBy");
CREATE INDEX "user_roles_assignedBy_idx" ON "user_roles"("assignedBy");
CREATE INDEX "acl_entries_grantedBy_idx" ON "acl_entries"("grantedBy");
