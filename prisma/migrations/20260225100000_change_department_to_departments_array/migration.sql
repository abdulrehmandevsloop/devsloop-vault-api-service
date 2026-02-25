-- AlterTable: add departments array column
ALTER TABLE "users" ADD COLUMN "departments" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Migrate existing data: copy single department into array
UPDATE "users" SET "departments" = ARRAY["department"] WHERE "department" IS NOT NULL;

-- Drop old column
ALTER TABLE "users" DROP COLUMN "department";

-- CreateIndex
CREATE INDEX "users_departments_idx" ON "users"("departments");

-- DropIndex (old single-value index)
DROP INDEX IF EXISTS "users_department_idx";
