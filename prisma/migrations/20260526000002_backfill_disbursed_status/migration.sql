-- Backfill dynamic_requests.status for LOAN/ADVANCE_SALARY rows that were
-- disbursed (formData.disbursedAt populated, repayment schedule present) but
-- got their status overwritten back to APPROVED by the generic
-- handleWorkflowCompleted listener firing on a post-disburse workflow step.
--
-- Without this, payroll silently skips the deduction because its filter requires
-- the parent status to be DISBURSED / REPAYING / COMPLETED.
--
-- Terminal status chosen per row:
--   COMPLETED — remainingBalance ≤ 0 (fully repaid)
--   REPAYING  — at least one repayment row already DEDUCTED
--   DISBURSED — otherwise (funds out, no deductions processed yet)

UPDATE "dynamic_requests" AS dr
SET "status" = CASE
  WHEN COALESCE(NULLIF(dr."formData"->>'remainingBalance', '')::numeric, 0) <= 0
    THEN 'COMPLETED'::"DynamicRequestStatus"
  WHEN dr."typeKey" = 'LOAN' AND EXISTS (
    SELECT 1 FROM "loan_repayments" lr
    WHERE lr."requestId" = dr.id AND lr.status = 'DEDUCTED'
  ) THEN 'REPAYING'::"DynamicRequestStatus"
  WHEN dr."typeKey" = 'ADVANCE_SALARY' AND EXISTS (
    SELECT 1 FROM "advance_salary_repayments" ar
    WHERE ar."requestId" = dr.id AND ar.status = 'DEDUCTED'
  ) THEN 'REPAYING'::"DynamicRequestStatus"
  ELSE 'DISBURSED'::"DynamicRequestStatus"
END
WHERE dr."typeKey" IN ('LOAN', 'ADVANCE_SALARY')
  AND dr."status" = 'APPROVED'
  AND dr."formData" ? 'disbursedAt'
  AND NULLIF(dr."formData"->>'disbursedAt', '') IS NOT NULL
  AND (
    (dr."typeKey" = 'LOAN' AND EXISTS (
      SELECT 1 FROM "loan_repayments" lr WHERE lr."requestId" = dr.id
    ))
    OR
    (dr."typeKey" = 'ADVANCE_SALARY' AND EXISTS (
      SELECT 1 FROM "advance_salary_repayments" ar WHERE ar."requestId" = dr.id
    ))
  );
