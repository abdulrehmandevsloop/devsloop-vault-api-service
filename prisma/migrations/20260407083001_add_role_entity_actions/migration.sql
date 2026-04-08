-- AlterTable
ALTER TABLE "role_entities" ADD COLUMN     "actions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: Give all role-entity rows for 'project' entity a default 'read' action
UPDATE "role_entities"
SET "actions" = ARRAY['read']
WHERE "entityId" IN (SELECT "id" FROM "entities" WHERE "name" = 'project');

-- Backfill: Give ADMIN role full project actions
UPDATE "role_entities"
SET "actions" = ARRAY['read', 'read_all', 'write', 'manage_users', 'manage_roadmap']
WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "name" = 'ADMIN')
  AND "entityId" IN (SELECT "id" FROM "entities" WHERE "name" = 'project');

-- Backfill: Give SYSTEM role full project actions
UPDATE "role_entities"
SET "actions" = ARRAY['read', 'read_all', 'write', 'manage_users', 'manage_roadmap']
WHERE "roleId" IN (SELECT "id" FROM "roles" WHERE "name" = 'SYSTEM')
  AND "entityId" IN (SELECT "id" FROM "entities" WHERE "name" = 'project');
