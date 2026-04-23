-- Make wfhAllowancePerMonth nullable so employees without an explicit override
-- fall back to the global leave policy setting (leave_policy_wfh_per_month).
-- Employees already at the old hardcoded default (1) are reset to NULL so the
-- global policy takes effect for them going forward.
ALTER TABLE "users" ALTER COLUMN "wfhAllowancePerMonth" DROP NOT NULL;
ALTER TABLE "users" ALTER COLUMN "wfhAllowancePerMonth" DROP DEFAULT;
UPDATE "users" SET "wfhAllowancePerMonth" = NULL WHERE "wfhAllowancePerMonth" = 1;
