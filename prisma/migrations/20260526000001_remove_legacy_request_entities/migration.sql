-- Remove deprecated RBAC entities: 'requests', 'review-requests', 'workflow-approve'.
--
-- Access to these flows is now governed by the workflow engine (visibility +
-- approver resolution at the workflow-template level) plus JWT auth on the
-- affected APIs, so the entity-level gate is no longer needed.
--
-- role_entities and acl_entries reference Entity with ON DELETE CASCADE,
-- so deleting the parent rows cleans up all role assignments and direct ACL
-- grants in one shot.

DELETE FROM "entities"
WHERE "name" IN ('requests', 'review-requests', 'workflow-approve');
