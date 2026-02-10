-- ============================================
-- 1. Remove unused UserRole enum
-- ============================================
DROP TYPE IF EXISTS "UserRole";

-- ============================================
-- 2. Add VarChar constraints to User table
-- ============================================
ALTER TABLE "users" ALTER COLUMN "email" TYPE VARCHAR(320);
ALTER TABLE "users" ALTER COLUMN "name" TYPE VARCHAR(255);
ALTER TABLE "users" ALTER COLUMN "password" TYPE VARCHAR(255);
ALTER TABLE "users" ALTER COLUMN "department" TYPE VARCHAR(255);
ALTER TABLE "users" ALTER COLUMN "avatarUrl" TYPE VARCHAR(2048);
ALTER TABLE "users" ALTER COLUMN "passwordResetToken" TYPE VARCHAR(512);
ALTER TABLE "users" ALTER COLUMN "emailVerificationToken" TYPE VARCHAR(512);
ALTER TABLE "users" ALTER COLUMN "rejectionReason" TYPE VARCHAR(1000);

-- ============================================
-- 3. Add VarChar constraints to Project table
-- ============================================
ALTER TABLE "projects" ALTER COLUMN "name" TYPE VARCHAR(255);
ALTER TABLE "projects" ALTER COLUMN "clientName" TYPE VARCHAR(255);
ALTER TABLE "projects" ALTER COLUMN "domain" TYPE VARCHAR(255);
ALTER TABLE "projects" ALTER COLUMN "description" TYPE VARCHAR(2000);

-- ============================================
-- 4. Add VarChar constraints to AuditLog table
-- ============================================
ALTER TABLE "audit_logs" ALTER COLUMN "action" TYPE VARCHAR(255);
ALTER TABLE "audit_logs" ALTER COLUMN "entityType" TYPE VARCHAR(100);
ALTER TABLE "audit_logs" ALTER COLUMN "entityId" TYPE VARCHAR(255);
ALTER TABLE "audit_logs" ALTER COLUMN "ipAddress" TYPE VARCHAR(45);
ALTER TABLE "audit_logs" ALTER COLUMN "userAgent" TYPE VARCHAR(512);

-- ============================================
-- 5. Add VarChar constraints to Entity table
-- ============================================
ALTER TABLE "entities" ALTER COLUMN "name" TYPE VARCHAR(100);
ALTER TABLE "entities" ALTER COLUMN "displayName" TYPE VARCHAR(255);
ALTER TABLE "entities" ALTER COLUMN "description" TYPE VARCHAR(1000);

-- ============================================
-- 6. Add VarChar constraints to Role table
-- ============================================
ALTER TABLE "roles" ALTER COLUMN "name" TYPE VARCHAR(100);
ALTER TABLE "roles" ALTER COLUMN "displayName" TYPE VARCHAR(255);
ALTER TABLE "roles" ALTER COLUMN "description" TYPE VARCHAR(1000);

-- ============================================
-- 7. Remove redundant/low-cardinality indexes on User
-- ============================================
-- @@index([email]) — redundant, @unique already creates an index
DROP INDEX IF EXISTS "users_email_idx";

-- @@index([emailVerified]) — low-cardinality boolean
DROP INDEX IF EXISTS "users_emailVerified_idx";

-- @@index([hasAccess]) — low-cardinality int (0/1)
DROP INDEX IF EXISTS "users_hasAccess_idx";

-- @@index([isSystem]) — low-cardinality boolean
DROP INDEX IF EXISTS "users_isSystem_idx";

-- ============================================
-- 8. Add composite index for admin user filtering
-- ============================================
CREATE INDEX "users_isSystem_approvalStatus_idx" ON "users"("isSystem", "approvalStatus");

-- ============================================
-- 9. Remove redundant indexes on Entity and Role (name is @unique)
-- ============================================
DROP INDEX IF EXISTS "entities_name_idx";
DROP INDEX IF EXISTS "roles_name_idx";
