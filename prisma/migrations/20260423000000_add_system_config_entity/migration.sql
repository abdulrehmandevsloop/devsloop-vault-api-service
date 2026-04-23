-- Insert the system-config entity (no-op if it already exists)
INSERT INTO "entities" ("id", "name", "displayName", "description", "isActive", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'system-config',
  'System Configuration',
  'Manage platform-wide settings: payroll defaults, lunch rates, worklog alerts, and leave policies',
  true,
  NOW(),
  NOW()
)
ON CONFLICT ("name") DO NOTHING;

-- Assign system-config to the ADMIN role
INSERT INTO "role_entities" ("id", "roleId", "entityId", "actions", "createdAt")
SELECT
  gen_random_uuid()::text,
  r."id",
  e."id",
  '{}',
  NOW()
FROM "roles" r
CROSS JOIN "entities" e
WHERE r."name" = 'ADMIN'
  AND e."name" = 'system-config'
ON CONFLICT ("roleId", "entityId") DO NOTHING;

-- Assign system-config to the SYSTEM role (covers all isSystem = true users)
INSERT INTO "role_entities" ("id", "roleId", "entityId", "actions", "createdAt")
SELECT
  gen_random_uuid()::text,
  r."id",
  e."id",
  ARRAY['read','read_all','write','manage_users','manage_roadmap','view','create','edit','authorize','export','lock'],
  NOW()
FROM "roles" r
CROSS JOIN "entities" e
WHERE r."name" = 'SYSTEM'
  AND e."name" = 'system-config'
ON CONFLICT ("roleId", "entityId") DO NOTHING;

-- Seed the leave policy config keys with their defaults (only inserts, never overwrites)
INSERT INTO "system_config" ("key", "value", "updatedAt")
VALUES
  ('leave_policy_maternity_max_days',           '22',  NOW()),
  ('leave_policy_wfh_per_month',                '1',   NOW()),
  ('leave_policy_wedding_max_days',             '5',   NOW()),
  ('leave_policy_umrah_hajj_max_days',          '10',  NOW()),
  ('leave_policy_umrah_hajj_min_service_months','12',  NOW()),
  ('leave_policy_casual_advance_notice_days',   '3',   NOW()),
  ('leave_policy_wfh_advance_notice_days',      '1',   NOW()),
  ('leave_policy_multi_day_advance_notice_days','7',   NOW())
ON CONFLICT ("key") DO NOTHING;
