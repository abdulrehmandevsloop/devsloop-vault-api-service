-- Additive data migration for Workflow Hierarchy System.
-- Safe on live data: uses INSERT ... ON CONFLICT DO NOTHING throughout.

-- ── 1. Insert new entities ────────────────────────────────────────────────────

INSERT INTO entities (id, name, "displayName", description, "isActive", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'workflow',         'Workflow Management', 'Create, edit, delete, and view workflow templates',    true, NOW(), NOW()),
  (gen_random_uuid()::text, 'workflow-approve', 'Workflow Approve',    'Act on workflow steps (approve/reject/return)',         true, NOW(), NOW())
ON CONFLICT (name) DO NOTHING;

-- ── 2. Assign workflow-approve to TEAM_LEAD ───────────────────────────────────

INSERT INTO role_entities ("id", "roleId", "entityId", "actions", "createdAt")
SELECT
  gen_random_uuid()::text,
  r.id,
  e.id,
  ARRAY[]::text[],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'TEAM_LEAD'
  AND e.name = 'workflow-approve'
  AND NOT EXISTS (
    SELECT 1 FROM role_entities re
    WHERE re."roleId" = r.id AND re."entityId" = e.id
  );

-- ── 3. Assign workflow (read, write) to ADMIN ─────────────────────────────────

INSERT INTO role_entities ("id", "roleId", "entityId", "actions", "createdAt")
SELECT
  gen_random_uuid()::text,
  r.id,
  e.id,
  ARRAY['read', 'write']::text[],
  NOW()
FROM roles r
CROSS JOIN entities e
WHERE r.name = 'ADMIN'
  AND e.name = 'workflow'
  AND NOT EXISTS (
    SELECT 1 FROM role_entities re
    WHERE re."roleId" = r.id AND re."entityId" = e.id
  );

-- ── 4. Insert default workflow templates with steps ───────────────────────────
-- Using DO $$ blocks so we can use variables for template IDs.

DO $$
DECLARE
  leave_template_id   text := gen_random_uuid()::text;
  loan_template_id    text := gen_random_uuid()::text;
  reimb_template_id   text := gen_random_uuid()::text;
  adv_template_id     text := gen_random_uuid()::text;
BEGIN

  -- Leave Approval (Default)
  IF NOT EXISTS (SELECT 1 FROM workflow_templates WHERE name = 'Leave Approval (Default)') THEN
    INSERT INTO workflow_templates (
      id, name, "requestType", "isActive", "isDefault", version,
      departments, "employeeTypes", "allowEditAfterSubmit",
      "preventConsecutiveApproval", "maxReturnCount", "createdAt", "updatedAt"
    ) VALUES (
      leave_template_id, 'Leave Approval (Default)', 'LEAVE', true, true, 1,
      ARRAY[]::text[], ARRAY[]::text[], false, true, 3, NOW(), NOW()
    );

    INSERT INTO workflow_steps (
      id, "templateId", name, "order", "approverType", "approverValue",
      "rejectionPolicy", "isOptional", "createdAt", "updatedAt"
    ) VALUES
      (gen_random_uuid()::text, leave_template_id, 'Reporting Manager Review', 1,
       'SPECIFIC_USER', 'metadata:reportingManagerId', 'RETURN_TO_START', false, NOW(), NOW()),
      (gen_random_uuid()::text, leave_template_id, 'HR Final Approval', 2,
       'ENTITY', 'leave-review', 'TERMINATE', false, NOW(), NOW());
  END IF;

  -- Loan Approval (Default)
  IF NOT EXISTS (SELECT 1 FROM workflow_templates WHERE name = 'Loan Approval (Default)') THEN
    INSERT INTO workflow_templates (
      id, name, "requestType", "isActive", "isDefault", version,
      departments, "employeeTypes", "allowEditAfterSubmit",
      "preventConsecutiveApproval", "maxReturnCount", "createdAt", "updatedAt"
    ) VALUES (
      loan_template_id, 'Loan Approval (Default)', 'LOAN', true, true, 1,
      ARRAY[]::text[], ARRAY[]::text[], false, true, 3, NOW(), NOW()
    );

    INSERT INTO workflow_steps (
      id, "templateId", name, "order", "approverType", "approverValue",
      "rejectionPolicy", "isOptional", "createdAt", "updatedAt"
    ) VALUES
      (gen_random_uuid()::text, loan_template_id, 'HR/Finance Review', 1,
       'ENTITY', 'review-requests', 'TERMINATE', false, NOW(), NOW()),
      (gen_random_uuid()::text, loan_template_id, 'Disbursement Approval', 2,
       'ENTITY', 'review-requests', 'TERMINATE', false, NOW(), NOW());
  END IF;

  -- Reimbursement Approval (Default)
  IF NOT EXISTS (SELECT 1 FROM workflow_templates WHERE name = 'Reimbursement Approval (Default)') THEN
    INSERT INTO workflow_templates (
      id, name, "requestType", "isActive", "isDefault", version,
      departments, "employeeTypes", "allowEditAfterSubmit",
      "preventConsecutiveApproval", "maxReturnCount", "createdAt", "updatedAt"
    ) VALUES (
      reimb_template_id, 'Reimbursement Approval (Default)', 'REIMBURSEMENT', true, true, 1,
      ARRAY[]::text[], ARRAY[]::text[], false, true, 3, NOW(), NOW()
    );

    INSERT INTO workflow_steps (
      id, "templateId", name, "order", "approverType", "approverValue",
      "rejectionPolicy", "isOptional", "createdAt", "updatedAt"
    ) VALUES
      (gen_random_uuid()::text, reimb_template_id, 'HR Review', 1,
       'ENTITY', 'review-requests', 'TERMINATE', false, NOW(), NOW()),
      (gen_random_uuid()::text, reimb_template_id, 'Finance Processing', 2,
       'ENTITY', 'review-requests', 'TERMINATE', false, NOW(), NOW());
  END IF;

  -- Advance Salary Approval (Default)
  IF NOT EXISTS (SELECT 1 FROM workflow_templates WHERE name = 'Advance Salary Approval (Default)') THEN
    INSERT INTO workflow_templates (
      id, name, "requestType", "isActive", "isDefault", version,
      departments, "employeeTypes", "allowEditAfterSubmit",
      "preventConsecutiveApproval", "maxReturnCount", "createdAt", "updatedAt"
    ) VALUES (
      adv_template_id, 'Advance Salary Approval (Default)', 'ADVANCE_SALARY', true, true, 1,
      ARRAY[]::text[], ARRAY[]::text[], false, true, 3, NOW(), NOW()
    );

    INSERT INTO workflow_steps (
      id, "templateId", name, "order", "approverType", "approverValue",
      "rejectionPolicy", "isOptional", "createdAt", "updatedAt"
    ) VALUES
      (gen_random_uuid()::text, adv_template_id, 'HR/Finance Review', 1,
       'ENTITY', 'review-requests', 'TERMINATE', false, NOW(), NOW()),
      (gen_random_uuid()::text, adv_template_id, 'Disbursement Approval', 2,
       'ENTITY', 'review-requests', 'TERMINATE', false, NOW(), NOW());
  END IF;

END $$;
