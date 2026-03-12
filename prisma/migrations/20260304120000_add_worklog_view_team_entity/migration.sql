-- Add worklog-team entity for view/export team worklogs permission.
-- Safe to run: uses ON CONFLICT DO NOTHING if entity already exists.
INSERT INTO "entities" ("id", "name", "displayName", "description", "isActive", "createdAt", "updatedAt")
VALUES (
  concat('c', substring(md5(random()::text || clock_timestamp()::text) from 1 for 24)),
  'worklog-team',
  'View/Export Team Worklogs',
  'View and export worklogs of team members on assigned projects',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;
