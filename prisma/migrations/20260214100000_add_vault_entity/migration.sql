-- Insert the vault entity for knowledge base access
INSERT INTO "entities" ("id", "name", "displayName", "description", "isActive", "createdAt", "updatedAt")
VALUES (
  concat('clv', substring(md5(random()::text) from 1 for 22)),
  'vault',
  'Vault',
  'Knowledge base vault access',
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("name") DO NOTHING;
