-- Seed RBAC entities and role permissions for reimbursements
-- This migration is idempotent and safe to run on existing databases.

-- 1) Ensure the reimbursement entity exists
INSERT INTO "entities" ("id", "name", "displayName", "description", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'reimbursement',
  'Reimbursement',
  'Employee reimbursement requests submission',
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT ("name") DO NOTHING;

-- 2) Ensure the manage_reimbursement entity exists
INSERT INTO "entities" ("id", "name", "displayName", "description", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'manage_reimbursement',
  'Manage Reimbursements',
  'Admin reimbursement management and processing',
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT ("name") DO NOTHING;

-- 3) Attach reimbursement entity to EMPLOYEE role (if both exist)
WITH target_entity AS (
  SELECT "id"
  FROM "entities"
  WHERE "name" = 'reimbursement'
),
target_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "name" = 'EMPLOYEE'
)
INSERT INTO "role_entities" ("id", "roleId", "entityId", "createdAt")
SELECT
  gen_random_uuid()::text,
  target_role."id",
  target_entity."id",
  NOW()
FROM target_role, target_entity
WHERE NOT EXISTS (
  SELECT 1
  FROM "role_entities" re
  WHERE re."roleId" = target_role."id"
    AND re."entityId" = target_entity."id"
);

-- 4) Attach manage_reimbursement entity to ADMIN role (if both exist)
WITH target_entity AS (
  SELECT "id"
  FROM "entities"
  WHERE "name" = 'manage_reimbursement'
),
target_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "name" = 'ADMIN'
)
INSERT INTO "role_entities" ("id", "roleId", "entityId", "createdAt")
SELECT
  gen_random_uuid()::text,
  target_role."id",
  target_entity."id",
  NOW()
FROM target_role, target_entity
WHERE NOT EXISTS (
  SELECT 1
  FROM "role_entities" re
  WHERE re."roleId" = target_role."id"
    AND re."entityId" = target_entity."id"
);