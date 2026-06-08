-- Data migration: register the "event" entity and wire it to roles.
-- Mirrors the seed config in prisma/seed.ts so deployments that run migrations
-- (and not the seed) still get action-level event permissions.
-- Safe to apply multiple times (all statements use ON CONFLICT DO NOTHING / DO UPDATE).

-- 1. Insert the entity (upsert metadata if it already exists)
INSERT INTO entities (id, name, "displayName", description, "isActive", "createdAt", "updatedAt")
VALUES (
  md5('event'),
  'event',
  'Events',
  'Create and assign events/tasks, view assigned events, and track completion',
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT (name) DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  description   = EXCLUDED.description,
  "isActive"    = EXCLUDED."isActive",
  "updatedAt"   = NOW();

-- 2. SYSTEM role — full access (system users bypass checks, but kept consistent)
INSERT INTO role_entities (id, "roleId", "entityId", actions, "createdAt")
SELECT
  md5('SYSTEM-event'),
  r.id,
  e.id,
  ARRAY['read', 'read_all', 'write'],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'SYSTEM'
  AND e.name = 'event'
ON CONFLICT ("roleId", "entityId") DO UPDATE SET
  actions = ARRAY['read', 'read_all', 'write'];

-- 3. ADMIN role — full management
INSERT INTO role_entities (id, "roleId", "entityId", actions, "createdAt")
SELECT
  md5('ADMIN-event'),
  r.id,
  e.id,
  ARRAY['read', 'read_all', 'write'],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'ADMIN'
  AND e.name = 'event'
ON CONFLICT ("roleId", "entityId") DO UPDATE SET
  actions = ARRAY['read', 'read_all', 'write'];

-- 4. EMPLOYEE role — view & complete events assigned to them
INSERT INTO role_entities (id, "roleId", "entityId", actions, "createdAt")
SELECT
  md5('EMPLOYEE-event'),
  r.id,
  e.id,
  ARRAY['read'],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'EMPLOYEE'
  AND e.name = 'event'
ON CONFLICT ("roleId", "entityId") DO UPDATE SET
  actions = ARRAY['read'];

-- 5. TEAM_LEAD role — view & complete events assigned to them
INSERT INTO role_entities (id, "roleId", "entityId", actions, "createdAt")
SELECT
  md5('TEAM_LEAD-event'),
  r.id,
  e.id,
  ARRAY['read'],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'TEAM_LEAD'
  AND e.name = 'event'
ON CONFLICT ("roleId", "entityId") DO UPDATE SET
  actions = ARRAY['read'];
