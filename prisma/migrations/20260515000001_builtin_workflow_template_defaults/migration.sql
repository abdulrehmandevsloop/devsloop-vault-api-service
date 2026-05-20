-- Add isBuiltIn flag to workflow_templates
ALTER TABLE "workflow_templates" ADD COLUMN "isBuiltIn" BOOLEAN NOT NULL DEFAULT false;

-- Mark the 4 default templates as builtin and uncheck block double approval
UPDATE "workflow_templates"
SET
  "isBuiltIn" = true,
  "preventConsecutiveApproval" = false
WHERE "requestType" IN ('LEAVE', 'LOAN', 'REIMBURSEMENT', 'ADVANCE_SALARY')
  AND "isDefault" = true;
