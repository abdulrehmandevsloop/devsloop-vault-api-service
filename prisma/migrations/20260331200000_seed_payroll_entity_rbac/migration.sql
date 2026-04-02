-- Idempotent: payroll RBAC entity + grant to SYSTEM (and ADMIN) roles.
-- Users with the SYSTEM role (e.g. seeded system user) resolve payroll via role_entities → JWT permissions.

INSERT INTO "entities" ("id", "name", "displayName", "description", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'payroll',
  'Payroll',
  'Payroll periods, calculations, and bank exports',
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT ("name") DO NOTHING;

-- SYSTEM role → payroll (system user inherits via user_roles)
WITH target_entity AS (
  SELECT "id" FROM "entities" WHERE "name" = 'payroll'
),
target_role AS (
  SELECT "id" FROM "roles" WHERE "name" = 'SYSTEM'
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

-- ADMIN role → payroll (aligned with application seed)
WITH target_entity AS (
  SELECT "id" FROM "entities" WHERE "name" = 'payroll'
),
target_role AS (
  SELECT "id" FROM "roles" WHERE "name" = 'ADMIN'
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
