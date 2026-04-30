-- Data migration: insert manage-expense entity and wire to SYSTEM + ADMIN roles.
-- Safe to apply multiple times (all statements use ON CONFLICT DO NOTHING / DO UPDATE).

-- 1. Insert the entity (no-op if it already exists)
INSERT INTO entities (id, name, "displayName", description, "isActive", "createdAt", "updatedAt")
VALUES (
  md5('manage-expense'),
  'manage-expense',
  'Manage Expense',
  'Manage company expenses in Expense Tracker',
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT (name) DO UPDATE SET
  "displayName" = EXCLUDED."displayName",
  description   = EXCLUDED.description,
  "isActive"    = EXCLUDED."isActive",
  "updatedAt"   = NOW();

-- 2. Link to SYSTEM role with all actions
INSERT INTO role_entities (id, "roleId", "entityId", actions, "createdAt")
SELECT
  md5('SYSTEM-manage-expense'),
  r.id,
  e.id,
  ARRAY['view', 'create', 'edit', 'delete'],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'SYSTEM'
  AND e.name = 'manage-expense'
ON CONFLICT ("roleId", "entityId") DO UPDATE SET
  actions = ARRAY['view', 'create', 'edit', 'delete'];

-- 3. Link to ADMIN role with all actions
INSERT INTO role_entities (id, "roleId", "entityId", actions, "createdAt")
SELECT
  md5('ADMIN-manage-expense'),
  r.id,
  e.id,
  ARRAY['view', 'create', 'edit', 'delete'],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'ADMIN'
  AND e.name = 'manage-expense'
ON CONFLICT ("roleId", "entityId") DO UPDATE SET
  actions = ARRAY['view', 'create', 'edit', 'delete'];
