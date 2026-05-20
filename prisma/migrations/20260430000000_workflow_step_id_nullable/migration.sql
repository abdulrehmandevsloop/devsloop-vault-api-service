-- Make WorkflowStepInstance.stepId nullable with ON DELETE SET NULL.
--
-- Rationale: workflow_step_instances stores a stepSnapshot (JSON copy of the
-- step config at the time the workflow started). When a template is updated,
-- the old WorkflowStep rows are deleted and replaced. Because step_instances
-- reference those rows via stepId, PostgreSQL's default RESTRICT behaviour
-- caused a foreign key violation on every template update. Since all data
-- needed to drive in-flight workflows lives in stepSnapshot, nullifying stepId
-- on template update is safe — the FK is purely for reporting/joins.

-- 1. Drop the existing NOT NULL constraint + FK
ALTER TABLE "workflow_step_instances"
  DROP CONSTRAINT IF EXISTS "workflow_step_instances_stepId_fkey";

-- 2. Make the column nullable
ALTER TABLE "workflow_step_instances"
  ALTER COLUMN "stepId" DROP NOT NULL;

-- 3. Re-add the FK with ON DELETE SET NULL
ALTER TABLE "workflow_step_instances"
  ADD CONSTRAINT "workflow_step_instances_stepId_fkey"
  FOREIGN KEY ("stepId")
  REFERENCES "workflow_steps"("id")
  ON DELETE SET NULL
  ON UPDATE CASCADE;
