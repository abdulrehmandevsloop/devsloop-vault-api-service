-- Rename RBAC entity 'reimbursement' to 'requests'
UPDATE "entities"
SET name = 'requests',
    "displayName" = 'Requests',
    description = 'Employee requests submission (reimbursements, loans, advance salary)'
WHERE name = 'reimbursement';

-- Rename RBAC entity 'manage_reimbursement' to 'review-requests'
UPDATE "entities"
SET name = 'review-requests',
    "displayName" = 'Review Requests',
    description = 'Management review and processing of employee requests'
WHERE name = 'manage_reimbursement';
