-- AlterTable: Add isSystem column to users table
ALTER TABLE "users" ADD COLUMN "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- Migrate data: Set isSystem=true on users whose primary role was a system role
UPDATE "users"
SET "isSystem" = true
WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "isSystem" = true);

-- Migrate data: Also set isSystem=true on users assigned a system role via user_roles
UPDATE "users"
SET "isSystem" = true
WHERE "id" IN (
  SELECT ur."userId"
  FROM "user_roles" ur
  JOIN "roles" r ON ur."roleId" = r."id"
  WHERE r."isSystem" = true
);

-- DropIndex
DROP INDEX "roles_isSystem_idx";

-- AlterTable: Remove isSystem column from roles table
ALTER TABLE "roles" DROP COLUMN "isSystem";

-- CreateIndex
CREATE INDEX "users_isSystem_idx" ON "users"("isSystem");
