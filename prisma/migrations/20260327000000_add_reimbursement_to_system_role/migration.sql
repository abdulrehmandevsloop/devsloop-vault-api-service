-- Add reimbursement entities to SYSTEM role
-- This migration adds the missing SYSTEM role permissions for reimbursements

-- 1) Attach reimbursement entity to SYSTEM role (if both exist)
WITH target_entity AS (
  SELECT "id"
  FROM "entities"
  WHERE "name" = 'reimbursement'
),
target_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "name" = 'SYSTEM'
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

-- 2) Attach manage_reimbursement entity to SYSTEM role (if both exist)
WITH target_entity AS (
  SELECT "id"
  FROM "entities"
  WHERE "name" = 'manage_reimbursement'
),
target_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "name" = 'SYSTEM'
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