-- Add 'export' action to the ADMIN role's manage-expense entity assignment.
-- Only appends if not already present to make this idempotent.
UPDATE "role_entities" re
SET actions = array_append(actions, 'export')
FROM "roles" r, "entities" e
WHERE re."roleId" = r.id
  AND re."entityId" = e.id
  AND r.name = 'ADMIN'
  AND e.name = 'manage-expense'
  AND NOT ('export' = ANY(re.actions));