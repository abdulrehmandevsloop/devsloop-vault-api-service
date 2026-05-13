-- Add DISBURSE action to the last (Disbursement Approval) step of LOAN and ADVANCE_SALARY
-- workflow templates. The last step shows a Disburse button in the review UI instead of Approve.

UPDATE "workflow_steps"
SET "actions" = ARRAY['DISBURSE', 'REJECT', 'VIEW']
WHERE "order" = 2
  AND "templateId" IN (
    SELECT id FROM "workflow_templates"
    WHERE "requestType" IN ('LOAN', 'ADVANCE_SALARY')
  );

-- Also patch any in-flight workflow step instances still PENDING on step order 2
-- so active requests pick up the new action immediately.
UPDATE "workflow_step_instances"
SET "stepSnapshot" = jsonb_set(
  "stepSnapshot"::jsonb,
  '{actions}',
  '["DISBURSE", "REJECT", "VIEW"]'
)
WHERE "resolution" = 'PENDING'
  AND "stepOrder" = 2
  AND "workflowInstanceId" IN (
    SELECT id FROM "workflow_instances"
    WHERE "requestType" IN ('LOAN', 'ADVANCE_SALARY')
  );
