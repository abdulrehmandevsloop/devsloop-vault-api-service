-- Step 2 of 2: Migrate loan_requests and advance_salary_requests into dynamic_requests.
-- Enum values DISBURSED/REPAYING/COMPLETED were added (and committed) in 20260514000001.
-- Repayment tables keep their structure but their FK now points to dynamic_requests.
-- IDs are preserved so workflow_instances.requestId references remain valid.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Migrate loan_requests → dynamic_requests
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "dynamic_requests" ("id", "typeKey", "requesterId", "formData", "status", "createdAt", "updatedAt")
SELECT
  lr.id,
  'LOAN',
  lr."employeeId",
  jsonb_build_object(
    'amount',                   lr.amount,
    'purpose',                  lr.purpose,
    'requestedRepaymentMonths', lr."requestedRepaymentMonths",
    'notes',                    lr.notes,
    'monthlyDeduction',         lr."monthlyDeduction",
    'reviewedById',             lr."reviewedById",
    'reviewedAt',               lr."reviewedAt",
    'reviewComment',            lr."reviewComment",
    'approvedAmount',           lr."approvedAmount",
    'approvedRepaymentMonths',  lr."approvedRepaymentMonths",
    'disbursedAt',              lr."disbursedAt",
    'disbursedById',            lr."disbursedById",
    'repaymentStartMonth',      lr."repaymentStartMonth",
    'totalRepaid',              lr."totalRepaid",
    'remainingBalance',         lr."remainingBalance"
  ),
  lr.status::text::"DynamicRequestStatus",
  lr."createdAt",
  lr."updatedAt"
FROM "loan_requests" lr
ON CONFLICT ("id") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Migrate advance_salary_requests → dynamic_requests
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO "dynamic_requests" ("id", "typeKey", "requesterId", "formData", "status", "createdAt", "updatedAt")
SELECT
  asr.id,
  'ADVANCE_SALARY',
  asr."employeeId",
  jsonb_build_object(
    'amount',                   asr.amount,
    'reason',                   asr.reason,
    'requestedRepaymentMonths', asr."requestedRepaymentMonths",
    'notes',                    asr.notes,
    'monthlyDeduction',         asr."monthlyDeduction",
    'reviewedById',             asr."reviewedById",
    'reviewedAt',               asr."reviewedAt",
    'reviewComment',            asr."reviewComment",
    'approvedAmount',           asr."approvedAmount",
    'approvedRepaymentMonths',  asr."approvedRepaymentMonths",
    'disbursedAt',              asr."disbursedAt",
    'disbursedById',            asr."disbursedById",
    'repaymentStartMonth',      asr."repaymentStartMonth",
    'totalRepaid',              asr."totalRepaid",
    'remainingBalance',         asr."remainingBalance"
  ),
  asr.status::text::"DynamicRequestStatus",
  asr."createdAt",
  asr."updatedAt"
FROM "advance_salary_requests" asr
ON CONFLICT ("id") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Re-key loan_repayments: loanId → requestId, FK → dynamic_requests
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "loan_repayments" DROP CONSTRAINT IF EXISTS "loan_repayments_loanId_fkey";
ALTER TABLE "loan_repayments" RENAME COLUMN "loanId" TO "requestId";
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "dynamic_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loan_repayments" DROP CONSTRAINT IF EXISTS "loan_repayments_loanId_installmentNo_key";
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_requestId_installmentNo_key"
  UNIQUE ("requestId", "installmentNo");

DROP INDEX IF EXISTS "loan_repayments_loanId_idx";
CREATE INDEX IF NOT EXISTS "loan_repayments_requestId_idx" ON "loan_repayments"("requestId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Re-key advance_salary_repayments: advanceSalaryId → requestId, FK → dynamic_requests
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "advance_salary_repayments" DROP CONSTRAINT IF EXISTS "advance_salary_repayments_advanceSalaryId_fkey";
ALTER TABLE "advance_salary_repayments" RENAME COLUMN "advanceSalaryId" TO "requestId";
ALTER TABLE "advance_salary_repayments" ADD CONSTRAINT "advance_salary_repayments_requestId_fkey"
  FOREIGN KEY ("requestId") REFERENCES "dynamic_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "advance_salary_repayments" DROP CONSTRAINT IF EXISTS "advance_salary_repayments_advanceSalaryId_installmentNo_key";
ALTER TABLE "advance_salary_repayments" ADD CONSTRAINT "advance_salary_repayments_requestId_installmentNo_key"
  UNIQUE ("requestId", "installmentNo");

DROP INDEX IF EXISTS "advance_salary_repayments_advanceSalaryId_idx";
CREATE INDEX IF NOT EXISTS "advance_salary_repayments_requestId_idx" ON "advance_salary_repayments"("requestId");

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Drop old tables and enums (data is now in dynamic_requests)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS "loan_requests";
DROP TABLE IF EXISTS "advance_salary_requests";

DROP TYPE IF EXISTS "LoanStatus";
DROP TYPE IF EXISTS "AdvanceSalaryStatus";
