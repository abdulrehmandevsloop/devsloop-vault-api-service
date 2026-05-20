-- Post-hoc verification for the loan / advance-salary → dynamic_requests migration
-- (applied in 20260514000002_migrate_loans_data, which already dropped the legacy
-- loan_requests and advance_salary_requests tables, so row-count parity against
-- the legacy source is no longer possible).
--
-- This migration is read-only: it asserts the migrated data is internally consistent
-- and aborts the transaction if anything is off. Safe to re-run.

DO $$
DECLARE
  loan_type_def_exists       BOOLEAN;
  as_type_def_exists         BOOLEAN;
  loan_count                 INT;
  as_count                   INT;
  orphan_loan_repayments     INT;
  orphan_as_repayments       INT;
  mismatched_loan_repayments INT;
  mismatched_as_repayments   INT;
  orphan_workflow_instances  INT;
BEGIN
  -- 1. request_type_definitions for LOAN / ADVANCE_SALARY must exist.
  SELECT EXISTS (SELECT 1 FROM "request_type_definitions" WHERE "key" = 'LOAN')           INTO loan_type_def_exists;
  SELECT EXISTS (SELECT 1 FROM "request_type_definitions" WHERE "key" = 'ADVANCE_SALARY') INTO as_type_def_exists;
  IF NOT loan_type_def_exists THEN
    RAISE EXCEPTION 'Verification failed: request_type_definitions row for key=LOAN is missing';
  END IF;
  IF NOT as_type_def_exists THEN
    RAISE EXCEPTION 'Verification failed: request_type_definitions row for key=ADVANCE_SALARY is missing';
  END IF;

  -- 2. Every loan_repayments.requestId must resolve to a dynamic_requests row of typeKey='LOAN'.
  SELECT COUNT(*) INTO orphan_loan_repayments
  FROM "loan_repayments" lr
  WHERE NOT EXISTS (SELECT 1 FROM "dynamic_requests" dr WHERE dr.id = lr."requestId");
  IF orphan_loan_repayments > 0 THEN
    RAISE EXCEPTION 'Verification failed: % loan_repayments rows have no matching dynamic_requests row', orphan_loan_repayments;
  END IF;

  SELECT COUNT(*) INTO mismatched_loan_repayments
  FROM "loan_repayments" lr
  JOIN "dynamic_requests" dr ON dr.id = lr."requestId"
  WHERE dr."typeKey" <> 'LOAN';
  IF mismatched_loan_repayments > 0 THEN
    RAISE EXCEPTION 'Verification failed: % loan_repayments point at a dynamic_requests row with typeKey <> LOAN', mismatched_loan_repayments;
  END IF;

  -- 3. Same for advance_salary_repayments.
  SELECT COUNT(*) INTO orphan_as_repayments
  FROM "advance_salary_repayments" asr
  WHERE NOT EXISTS (SELECT 1 FROM "dynamic_requests" dr WHERE dr.id = asr."requestId");
  IF orphan_as_repayments > 0 THEN
    RAISE EXCEPTION 'Verification failed: % advance_salary_repayments rows have no matching dynamic_requests row', orphan_as_repayments;
  END IF;

  SELECT COUNT(*) INTO mismatched_as_repayments
  FROM "advance_salary_repayments" asr
  JOIN "dynamic_requests" dr ON dr.id = asr."requestId"
  WHERE dr."typeKey" <> 'ADVANCE_SALARY';
  IF mismatched_as_repayments > 0 THEN
    RAISE EXCEPTION 'Verification failed: % advance_salary_repayments point at a dynamic_requests row with typeKey <> ADVANCE_SALARY', mismatched_as_repayments;
  END IF;

  -- 4. Any workflow_instances tagged as LOAN/ADVANCE_SALARY must resolve in dynamic_requests.
  SELECT COUNT(*) INTO orphan_workflow_instances
  FROM "workflow_instances" wi
  WHERE wi."requestType" IN ('LOAN', 'ADVANCE_SALARY')
    AND NOT EXISTS (SELECT 1 FROM "dynamic_requests" dr WHERE dr.id = wi."requestId");
  IF orphan_workflow_instances > 0 THEN
    RAISE EXCEPTION 'Verification failed: % workflow_instances for LOAN/ADVANCE_SALARY reference missing dynamic_requests rows', orphan_workflow_instances;
  END IF;

  -- 5. NULL status guard (defensive — should already be impossible).
  IF EXISTS (SELECT 1 FROM "dynamic_requests" WHERE "typeKey" IN ('LOAN', 'ADVANCE_SALARY') AND "status" IS NULL) THEN
    RAISE EXCEPTION 'Verification failed: LOAN/ADVANCE_SALARY rows with NULL status detected in dynamic_requests';
  END IF;

  SELECT COUNT(*) INTO loan_count FROM "dynamic_requests" WHERE "typeKey" = 'LOAN';
  SELECT COUNT(*) INTO as_count   FROM "dynamic_requests" WHERE "typeKey" = 'ADVANCE_SALARY';
  RAISE NOTICE 'Loan/AS migration verified: LOAN=%, ADVANCE_SALARY=%', loan_count, as_count;
END $$;
