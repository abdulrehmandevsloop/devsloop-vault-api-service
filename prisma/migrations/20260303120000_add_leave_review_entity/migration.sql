-- Seed RBAC entity for leave review and attach to TEAM_LEAD role
-- This migration is idempotent and safe to run on existing databases.

-- 1) Ensure the leave-review entity exists
INSERT INTO "entities" ("id", "name", "displayName", "description", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'leave-review',
  'Leave Review',
  'Review leave and WFH requests (approve/reject) and appear as selectable reporting manager',
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT ("name") DO NOTHING;

-- 2) Attach leave-review entity to TEAM_LEAD role (if both exist)
WITH target_entity AS (
  SELECT "id"
  FROM "entities"
  WHERE "name" = 'leave-review'
),
target_role AS (
  SELECT "id"
  FROM "roles"
  WHERE "name" = 'TEAM_LEAD'
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

