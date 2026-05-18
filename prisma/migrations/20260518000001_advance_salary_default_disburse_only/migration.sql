-- Reshape the built-in default Advance Salary workflow template to a single
-- Disbursement stage assigned to the `user` entity. Admins can still add more
-- stages or change approvers afterwards — this migration only touches the
-- shipped default template.
--
-- Existing WorkflowStepInstances reference workflow_steps with ON DELETE SET
-- NULL and carry their own stepSnapshot, so dropping the old steps does not
-- break in-flight or historical workflow instances.

WITH target_template AS (
  SELECT "id"
  FROM "workflow_templates"
  WHERE "requestType" = 'ADVANCE_SALARY'
    AND "isDefault" = true
    AND "isBuiltIn" = true
  LIMIT 1
)
DELETE FROM "workflow_steps"
WHERE "templateId" IN (SELECT "id" FROM target_template);

INSERT INTO "workflow_steps" (
  "id",
  "templateId",
  "name",
  "order",
  "approverType",
  "approverValue",
  "rejectionPolicy",
  "isOptional",
  "actions",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  t."id",
  'Disbursement',
  1,
  'ENTITY'::"ApproverType",
  'user',
  'TERMINATE'::"RejectionPolicy",
  false,
  ARRAY['DISBURSE', 'REJECT', 'VIEW'],
  NOW(),
  NOW()
FROM "workflow_templates" t
WHERE t."requestType" = 'ADVANCE_SALARY'
  AND t."isDefault" = true
  AND t."isBuiltIn" = true;
