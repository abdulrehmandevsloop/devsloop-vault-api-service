-- Rename columns (preserves data)
ALTER TABLE "users" RENAME COLUMN "approvedById" TO "reviewedById";
ALTER TABLE "users" RENAME COLUMN "approvalAt" TO "reviewedAt";

-- Rename foreign key constraint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_approvedById_fkey";
ALTER TABLE "users" ADD CONSTRAINT "users_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
