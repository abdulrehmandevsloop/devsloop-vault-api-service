-- Data migration: register the "manage-assets" entity and wire it to roles.
-- Mirrors the seed config in prisma/seed.ts so deployments that run migrations
-- (and not the seed) still get the entity. The "All assets" management page in
-- the portal is gated on the "manage-assets" permission; without this entity
-- row the page/sidebar stay hidden in staging/production even when assigned.
-- Safe to apply multiple times (all statements use ON CONFLICT DO NOTHING / DO UPDATE).

-- 1. Insert the entity (upsert metadata if it already exists)
INSERT INTO entities (id, name, "displayName", description, "isActive", "createdAt", "updatedAt")
VALUES (
  md5('manage-assets'),
  'manage-assets',
  'Manage Assets',
  'Manage own assets',
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
  md5('SYSTEM-manage-assets'),
  r.id,
  e.id,
  ARRAY['read', 'read_all', 'write'],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'SYSTEM'
  AND e.name = 'manage-assets'
ON CONFLICT ("roleId", "entityId") DO UPDATE SET
  actions = ARRAY['read', 'read_all', 'write'];

-- 3. ADMIN role — gates the "All assets" management page.
--    Mirrors the seed, which assigns this entity to ADMIN with no specific
--    actions (visibility is keyed on entity name presence, not actions).
INSERT INTO role_entities (id, "roleId", "entityId", actions, "createdAt")
SELECT
  md5('ADMIN-manage-assets'),
  r.id,
  e.id,
  ARRAY[]::text[],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'ADMIN'
  AND e.name = 'manage-assets'
ON CONFLICT ("roleId", "entityId") DO NOTHING;
