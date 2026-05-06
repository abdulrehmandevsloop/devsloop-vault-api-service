-- Publish the seeded built-in workflow templates.
--
-- When the isDraft column was added the existing rows were defaulted to true,
-- leaving the seeded templates in draft state. This marks them as published so
-- the dynamic form activates for LOAN, REIMBURSEMENT, and ADVANCE_SALARY.

UPDATE "workflow_templates"
SET "isDraft" = false
WHERE "requestType" IN ('LOAN', 'REIMBURSEMENT', 'ADVANCE_SALARY')
  AND "isDraft" = true;
