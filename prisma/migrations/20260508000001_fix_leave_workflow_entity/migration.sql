-- Fix Leave workflow: HR Final Approval step used 'leave-review' entity
-- but HR users hold the 'user' entity. Update all affected step rows.

UPDATE "workflow_steps"
SET "approverValue" = 'user'
WHERE "approverType" = 'ENTITY'
  AND "approverValue" = 'leave-review'
  AND "templateId" IN (
    SELECT id FROM "workflow_templates" WHERE "requestType" = 'LEAVE'
  );

-- Also update any already-running workflow step instances that are still
-- PENDING, so in-flight leave requests don't get stuck.
UPDATE "workflow_step_instances"
SET "stepSnapshot" = jsonb_set(
  "stepSnapshot"::jsonb,
  '{approverValue}',
  '"user"'
)
WHERE "resolution" = 'PENDING'
  AND ("stepSnapshot"::jsonb ->> 'approverValue') = 'leave-review'
  AND "workflowInstanceId" IN (
    SELECT id FROM "workflow_instances" WHERE "requestType" = 'LEAVE'
  );
