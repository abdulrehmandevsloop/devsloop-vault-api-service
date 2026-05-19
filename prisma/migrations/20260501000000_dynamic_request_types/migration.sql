-- Dynamic Request Types migration
--
-- 1. Change WorkflowTemplate.requestType and WorkflowInstance.requestType
--    from the RequestType PostgreSQL enum to VARCHAR(100).
--    Existing data is preserved by casting the enum to text.
--
-- 2. Drop the RequestType enum (no longer used as a column type).
--
-- 3. Add DynamicRequestStatus enum.
--
-- 4. Create request_type_definitions table.
--
-- 5. Create dynamic_requests table.
--
-- 6. Seed 4 built-in request types.

-- ─── 1. Change enum columns to VARCHAR ────────────────────────────────────────

-- Drop the default partial-unique index first (references the column)
DROP INDEX IF EXISTS "workflow_templates_default_per_type";

ALTER TABLE "workflow_templates"
  ALTER COLUMN "requestType" TYPE VARCHAR(100) USING "requestType"::text;

ALTER TABLE "workflow_instances"
  ALTER COLUMN "requestType" TYPE VARCHAR(100) USING "requestType"::text;

-- Re-create the partial unique index now that the column is VARCHAR
CREATE UNIQUE INDEX "workflow_templates_default_per_type"
  ON "workflow_templates" ("requestType") WHERE "isDefault" = true;

-- ─── 2. Drop the old RequestType enum ─────────────────────────────────────────

DROP TYPE IF EXISTS "RequestType";

-- ─── 3. Create DynamicRequestStatus enum ──────────────────────────────────────

CREATE TYPE "DynamicRequestStatus" AS ENUM (
  'PENDING',
  'IN_PROGRESS',
  'APPROVED',
  'REJECTED',
  'CANCELLED'
);

-- ─── 4. Create request_type_definitions ───────────────────────────────────────

CREATE TABLE "request_type_definitions" (
  "id"          TEXT         NOT NULL,
  "key"         VARCHAR(100) NOT NULL,
  "name"        VARCHAR(255) NOT NULL,
  "description" VARCHAR(1000),
  "fieldSchema" JSONB        NOT NULL DEFAULT '[]',
  "isBuiltIn"   BOOLEAN      NOT NULL DEFAULT false,
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "icon"        VARCHAR(50),
  "color"       VARCHAR(50),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "request_type_definitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "request_type_definitions_key_key"
  ON "request_type_definitions" ("key");

CREATE INDEX "request_type_definitions_isActive_idx"
  ON "request_type_definitions" ("isActive");

-- ─── 5. Create dynamic_requests ───────────────────────────────────────────────

CREATE TABLE "dynamic_requests" (
  "id"          TEXT                   NOT NULL,
  "typeKey"     VARCHAR(100)           NOT NULL,
  "requesterId" TEXT                   NOT NULL,
  "formData"    JSONB                  NOT NULL,
  "status"      "DynamicRequestStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt"   TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "dynamic_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "dynamic_requests_typeKey_fkey"
    FOREIGN KEY ("typeKey") REFERENCES "request_type_definitions" ("key")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "dynamic_requests_requesterId_fkey"
    FOREIGN KEY ("requesterId") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "dynamic_requests_typeKey_idx"     ON "dynamic_requests" ("typeKey");
CREATE INDEX "dynamic_requests_requesterId_idx" ON "dynamic_requests" ("requesterId");
CREATE INDEX "dynamic_requests_status_idx"      ON "dynamic_requests" ("status");

-- ─── 6. Seed 4 built-in request types ─────────────────────────────────────────

INSERT INTO "request_type_definitions"
  ("id", "key", "name", "description", "fieldSchema", "isBuiltIn", "isActive", "icon", "color", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'LEAVE',          'Leave',          'Annual, sick, WFH & special leave requests',    '[]'::jsonb, true, true, 'calendar',  'emerald', NOW(), NOW()),
  (gen_random_uuid()::text, 'LOAN',           'Loan',           'Personal loan requests from employees',         '[]'::jsonb, true, true, 'banknote',  'blue',    NOW(), NOW()),
  (gen_random_uuid()::text, 'REIMBURSEMENT',  'Reimbursement',  'Expense claims and reimbursement requests',     '[]'::jsonb, true, true, 'receipt',   'amber',   NOW(), NOW()),
  (gen_random_uuid()::text, 'ADVANCE_SALARY', 'Advance Salary', 'Early salary advance requests',                 '[]'::jsonb, true, true, 'wallet',    'violet',  NOW(), NOW())
ON CONFLICT ("key") DO NOTHING;
