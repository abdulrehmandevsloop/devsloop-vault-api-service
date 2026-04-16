-- Add action-level permissions to the payroll entity for ADMIN and SYSTEM roles.
-- Mirrors the project entity pattern: read, write, authorize, export, lock.

-- ADMIN role → payroll actions
UPDATE "role_entities"
SET "actions" = ARRAY['read', 'write', 'authorize', 'export', 'lock']
WHERE "roleId" = (SELECT "id" FROM "roles" WHERE "name" = 'ADMIN')
  AND "entityId" = (SELECT "id" FROM "entities" WHERE "name" = 'payroll');

-- SYSTEM role → payroll actions (full access)
UPDATE "role_entities"
SET "actions" = ARRAY['read', 'write', 'authorize', 'export', 'lock']
WHERE "roleId" = (SELECT "id" FROM "roles" WHERE "name" = 'SYSTEM')
  AND "entityId" = (SELECT "id" FROM "entities" WHERE "name" = 'payroll');
