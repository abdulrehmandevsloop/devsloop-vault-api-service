-- Add asset entity for RBAC (if not exists)
INSERT INTO "entities" ("id", "name", "displayName", "description", "isActive", "createdAt", "updatedAt")
SELECT 
  gen_random_uuid()::text,
  'asset',
  'Asset',
  'Asset management',
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM "entities" WHERE "name" = 'asset');

-- Add asset entity to ADMIN role (role with name 'ADMIN')
INSERT INTO "role_entities" ("id", "roleId", "entityId", "createdAt")
SELECT 
  gen_random_uuid()::text,
  r.id,
  e.id,
  NOW()
FROM "roles" r
CROSS JOIN "entities" e
WHERE r.name = 'ADMIN' AND e.name = 'asset'
AND NOT EXISTS (
  SELECT 1 FROM "role_entities" re 
  WHERE re."roleId" = r.id AND re."entityId" = e.id
);

-- Add asset entity to SYSTEM role (system admins have all entities)
INSERT INTO "role_entities" ("id", "roleId", "entityId", "createdAt")
SELECT 
  gen_random_uuid()::text,
  r.id,
  e.id,
  NOW()
FROM "roles" r
CROSS JOIN "entities" e
WHERE r.name = 'SYSTEM' AND e.name = 'asset'
AND NOT EXISTS (
  SELECT 1 FROM "role_entities" re 
  WHERE re."roleId" = r.id AND re."entityId" = e.id
);

-- Seed asset types (Laptop, Phone, Monitor, Accessories, Other)
INSERT INTO "asset_types" ("id", "name", "isActive", "createdAt", "updatedAt")
SELECT 
  gen_random_uuid()::text,
  v.name,
  true,
  NOW(),
  NOW()
FROM (VALUES ('Laptop'), ('Phone'), ('Monitor'), ('Accessories'), ('Other')) AS v(name)
WHERE NOT EXISTS (SELECT 1 FROM "asset_types" WHERE "asset_types"."name" = v.name);
