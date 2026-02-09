-- AlterTable: Add systemRole column to roles table
ALTER TABLE "roles" ADD COLUMN "systemRole" BOOLEAN NOT NULL DEFAULT false;

-- Mark the ADMIN role as a system role
UPDATE "roles" SET "systemRole" = true WHERE "name" = 'ADMIN';

-- CreateIndex
CREATE INDEX "roles_systemRole_idx" ON "roles"("systemRole");
